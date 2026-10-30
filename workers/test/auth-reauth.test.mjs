/**
 * Step-up re-authentication and security notices (AVE-113), on a real SQLite
 * AUTH_DB through the real session middleware:
 * - the freshness gate: a session is fresh for 5 minutes after it was created
 *   or re-authenticated; stale, unknown and other users' sessions are not, and
 *   a re-auth never carries over to another session;
 * - every sensitive change (recovery email, sign-in methods, passkeys,
 *   password with 2FA, account deletion) answers 403 `reauth_required` with
 *   the methods the account can use, until the session re-authenticates;
 * - `POST /api/v1/me/reauth` with a password (+ TOTP / backup code when 2FA
 *   is on), a passkey assertion, or an emailed code (accounts without a
 *   password), throttled and counted like sign-in;
 * - "was this you?" mail goes to the login, the recovery email and the
 *   address a change replaced, with a link to the sign-in settings.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-reauth.test.mjs
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { getAuth } from "../auth/index.ts";
import { ACCOUNT_FAILURE_LIMIT } from "../auth/rate-limit.ts";
import {
	REAUTH_MAX_AGE_MS,
	REAUTH_REQUIRED_CODE,
	isReauthFresh,
	maskEmail,
	reauthFreshUntil,
	recordReauth,
} from "../auth/reauth.ts";
import { describeChange, securityNoticeEmail } from "../auth/security-notice.ts";
import {
	addMailbox,
	addUser,
	authedRequest,
	createAuthTestEnv,
	flushWaitUntil,
	lastCodeSentTo,
	signIn,
} from "./auth-fixtures.mjs";

function base32Decode(input) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const ch of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
	return Buffer.from(bytes);
}
function totp(secretBase32, at = Date.now()) {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
	const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
	const offset = mac[mac.length - 1] & 0xf;
	return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const wrongCode = (code) => String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");

const { env, d1, db, bucket, email } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email", password: "ada password 123" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email", password: "bob password 123" });
// Signed up with Google: no password, login address outside Inboxies.
const gus = await addUser(db, { id: "gus", email: "gus@gmail.com" });
await db.insert((await import("../auth/schema.ts")).account).values({
	id: "google_gus",
	accountId: "google-sub-gus",
	providerId: "google",
	userId: "gus",
});
// Apple user with a hidden placeholder login and nothing else.
const pia = await addUser(db, { id: "pia", email: "pia@users.inboxies.invalid" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "bob@inboxies.email", { owners: ["bob"] });

const MIN = 60 * 1000;
/** Pretend `sessionId` signed in `ms` ago. */
const age = (sessionId, ms) =>
	d1.prepare("update session set created_at = ? where id = ?").bind(Date.now() - ms, sessionId).run();
/** A signed-in session that is no longer fresh. */
async function staleSession(user) {
	const s = await signIn(env, user);
	await age(s.sessionId, 10 * MIN);
	return s;
}
const reauth = (token, body) => authedRequest(env, { method: "POST", path: "/api/v1/me/reauth", token, body });
const mailsTo = (to) => email.sent.filter((m) => m.to === to);

// ── The freshness gate ──────────────────────────────────────────
{
	const s = await signIn(env, ada);
	const p = { userId: "ada", sessionId: s.sessionId };
	assert.equal(await isReauthFresh(db, p), true, "a session that just signed in is fresh");
	const now = Date.now();
	assert.equal(await isReauthFresh(db, p, now + REAUTH_MAX_AGE_MS + 1000), false, "…for 5 minutes");

	await age(s.sessionId, 10 * MIN);
	assert.equal(await isReauthFresh(db, p), false, "stale");
	assert.equal(await isReauthFresh(db, { userId: "ada", sessionId: "no-such-session" }), false, "missing session");
	assert.equal(await isReauthFresh(db, { userId: "bob", sessionId: s.sessionId }), false, "another user's session");

	const until = await recordReauth(db, p);
	assert.ok(until.getTime() > Date.now() + 4 * MIN);
	assert.equal(await isReauthFresh(db, p), true, "re-authenticated");
	assert.equal(await isReauthFresh(db, p, Date.now() + REAUTH_MAX_AGE_MS + 1000), false, "re-auth also lasts 5 minutes");
	assert.ok((await reauthFreshUntil(db, p)).getTime() >= until.getTime() - 5);

	// Never carries over to another session, even the same user's.
	const other = await staleSession(ada);
	assert.equal(await isReauthFresh(db, { userId: "ada", sessionId: other.sessionId }), false, "wrong session");
	// A proof row that names someone else doesn't count.
	await d1.prepare("update verification set value = 'bob' where id = ?").bind(`reauth:${s.sessionId}`).run();
	assert.equal(await isReauthFresh(db, p), false);

	assert.equal(maskEmail("ada.backup@gmail.com"), "a•••p@gmail.com");
	assert.equal(maskEmail("al@x.io"), "a•••@x.io");
}

// ── Every sensitive change needs a fresh session ────────────────
{
	const { token } = await staleSession(ada);
	const gated = [
		["POST", "/api/v1/me/recovery-email", { email: "ada.backup@gmail.com" }],
		["DELETE", "/api/v1/me/recovery-email", undefined],
		["POST", "/api/v1/me/identities/attach", { provider: "google", idToken: "x" }],
		["DELETE", "/api/v1/me/identities/google", undefined],
		["DELETE", "/api/v1/me", { confirm: "DELETE" }],
		["GET", "/api/auth/passkey/generate-register-options", undefined],
		["POST", "/api/auth/passkey/verify-registration", { response: {} }],
		["POST", "/api/auth/passkey/delete-passkey", { id: "x" }],
		["POST", "/api/auth/link-social", { provider: "google", idToken: { token: "x" } }],
		["POST", "/api/auth/unlink-account", { providerId: "google" }],
		["POST", "/api/auth/change-password", { currentPassword: "ada password 123", newPassword: "ada password 456" }],
	];
	for (const [method, path, body] of gated) {
		const res = await authedRequest(env, { method, path, token, body });
		assert.equal(res.status, 403, `${method} ${path} needs a fresh session`);
		assert.equal(res.payload.code, REAUTH_REQUIRED_CODE, `${method} ${path} code`);
		assert.deepEqual(res.payload.methods, ["password", "sign_in"]);
		assert.equal(res.payload.twoFactor, false);
		assert.equal(res.payload.maxAgeSeconds, 300);
		assert.match(res.payload.error, /sign back in/, "old app builds show this text");
	}
	assert.equal(await d1.prepare("select count(*) as n from user where id = 'ada'").first("n"), 1, "nothing changed");

	// Reading stays open; scoped sessions can't re-auth at all.
	assert.equal((await authedRequest(env, { path: "/api/v1/me/recovery-email", token })).status, 200);
	assert.equal((await authedRequest(env, { path: "/api/auth/passkey/list-user-passkeys", token })).status, 200);
	const scoped = await signIn(env, ada, { scope: "aliases", label: "Browser extension" });
	assert.equal((await reauth(scoped.token, { method: "password", password: "ada password 123" })).status, 403);
	assert.equal((await authedRequest(env, { path: "/api/v1/me/reauth" })).status, 401);
}

// ── Re-auth with the password ───────────────────────────────────
{
	const { token, sessionId } = await staleSession(ada);
	const status = await authedRequest(env, { path: "/api/v1/me/reauth", token });
	assert.equal(status.status, 200);
	assert.equal(status.payload.fresh, false);
	assert.deepEqual(status.payload.methods, ["password", "sign_in"]);

	assert.equal((await reauth(token, { method: "password" })).status, 400);
	assert.equal((await reauth(token, { method: "magic" })).status, 400);
	const wrong = await reauth(token, { method: "password", password: "not my password" });
	assert.equal(wrong.status, 401);
	assert.equal(wrong.payload.code, "reauth_failed");
	assert.equal(await isReauthFresh(db, { userId: "ada", sessionId }), false);
	// Wrong passwords count against the account like at sign-in (AVE-124).
	assert.equal(await d1.prepare("select count(*) as n from verification where id like 'password-failures:%'").first("n"), 1);

	const ok = await reauth(token, { method: "password", password: "ada password 123" });
	assert.equal(ok.status, 200);
	assert.ok(Date.parse(ok.payload.freshUntil) > Date.now() + 4 * MIN);
	assert.equal((await authedRequest(env, { path: "/api/v1/me/reauth", token })).payload.fresh, true);

	// Now the change goes through, once, and the old verified address hears.
	const set = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token, body: { email: "ada.backup@gmail.com" } });
	assert.equal(set.status, 200);
	const code = lastCodeSentTo(email, "ada.backup@gmail.com");
	await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email/verify", token, body: { code } });

	// Another stale session of Ada's gets no benefit from that re-auth.
	const other = await staleSession(ada);
	const blocked = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token: other.token, body: { email: "thief@evil.test" } });
	assert.equal(blocked.status, 403);
	assert.deepEqual(await authedRequest(env, { path: "/api/v1/me/recovery-email", token }).then((r) => r.payload), {
		email: "ada.backup@gmail.com",
		verified: true,
	});
}

// ── A days-old session can add a passkey once it re-authenticates ──
{
	const s = await signIn(env, bob);
	await age(s.sessionId, 3 * 24 * 60 * MIN);
	assert.equal((await authedRequest(env, { path: "/api/auth/passkey/generate-register-options", token: s.token })).status, 403);
	assert.equal((await reauth(s.token, { method: "password", password: "bob password 123" })).status, 200);
	const reg = await authedRequest(env, { path: "/api/auth/passkey/generate-register-options", token: s.token });
	assert.equal(reg.status, 200, "Better Auth's own 1-day freshness check doesn't override the re-auth");
	assert.ok(reg.payload.challenge);
}

// ── Notices: the replaced address, the login and the new recovery email ──
{
	await flushWaitUntil();
	const { token } = await signIn(env, ada); // fresh: just signed in
	const before = email.sent.length;
	const set = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token, body: { email: "ada.new@gmail.com" } });
	assert.equal(set.status, 200);
	await flushWaitUntil();
	const notices = email.sent.slice(before).filter((m) => /recovery email was changed/.test(m.subject));
	assert.deepEqual(notices.map((m) => m.to).sort(), ["ada.backup@gmail.com", "ada@inboxies.email"], "old recovery address + login");
	for (const n of notices) {
		assert.match(n.text, /https:\/\/inboxies\.test\/settings\/sign-in/, "wasn't-me link to sign-in settings");
		assert.match(n.text, /a•••w@gmail\.com/, "the new address, masked");
		assert.match(n.html, /href="https:\/\/inboxies\.test\/settings\/sign-in"/);
		assert.equal(n.from.email, "noreply@inboxies.email");
	}
	// Resending the code to the same unconfirmed address is not a new change.
	await new Promise((r) => setTimeout(r, 5));
	const count = email.sent.length;
	await d1.prepare("update verification set value = json_set(value, '$.issuedAt', 0) where identifier = 'otp:recovery-email:ada'").run();
	await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token, body: { email: "ada.new@gmail.com" } });
	await flushWaitUntil();
	assert.equal(email.sent.slice(count).filter((m) => /recovery email/.test(m.subject)).length, 0);
	const code = lastCodeSentTo(email, "ada.new@gmail.com");
	assert.equal((await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email/verify", token, body: { code } })).status, 200);

	// Copy and links.
	assert.equal(describeChange({ kind: "passkey_added" }).subject, "A passkey was added to your Inboxies account");
	const deleted = securityNoticeEmail({ change: { kind: "account_deleted" }, login: "a@b.c", when: new Date(0), settingsUrl: null });
	assert.doesNotMatch(deleted.text, /settings/);
	assert.match(deleted.text, /1970-01-01 00:00 UTC/);
	const xss = securityNoticeEmail({
		change: { kind: "sign_in_method_removed", provider: "<b>x</b>" },
		login: "a@b.c",
		when: new Date(),
		settingsUrl: "https://x.test/settings/sign-in",
	});
	assert.doesNotMatch(xss.html, /<b>x<\/b>/, "escaped");
}

// ── Change password: the current password is the proof, unless 2FA is on ──
{
	const { token, sessionId } = await staleSession(bob);
	const before = email.sent.length;
	const ok = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/password",
		token,
		body: { currentPassword: "bob password 123", newPassword: "bob password 456" },
	});
	assert.equal(ok.status, 200, "shipped apps keep working: they send the current password");
	assert.equal(await isReauthFresh(db, { userId: "bob", sessionId }), true, "and that counts as re-auth");
	await flushWaitUntil();
	assert.deepEqual(email.sent.slice(before).map((m) => [m.to, m.subject]), [["bob@inboxies.email", "Your Inboxies password was changed"]]);
}

// ── Two-factor: the password needs a code too ───────────────────
let totpSecret;
let backupCodes;
{
	const setup = await signIn(env, ada);
	const enable = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/enable",
		token: setup.token,
		body: { password: "ada password 123" },
	});
	assert.equal(enable.status, 200);
	totpSecret = new URL(enable.payload.totpURI).searchParams.get("secret");
	backupCodes = enable.payload.backupCodes;
	const confirm = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/verify-totp",
		token: setup.token,
		body: { code: totp(totpSecret) },
	});
	assert.equal(confirm.status, 200);

	const { token, sessionId } = await staleSession(ada);
	const gate = await authedRequest(env, { method: "DELETE", path: "/api/v1/me/recovery-email", token });
	assert.equal(gate.status, 403);
	assert.equal(gate.payload.twoFactor, true);

	const noCode = await reauth(token, { method: "password", password: "ada password 123" });
	assert.equal(noCode.status, 401);
	assert.equal(noCode.payload.code, "two_factor_required");
	const badCode = await reauth(token, { method: "password", password: "ada password 123", code: wrongCode(totp(totpSecret)) });
	assert.equal(badCode.status, 401);
	assert.equal(badCode.payload.code, "two_factor_invalid_code");
	assert.equal(await isReauthFresh(db, { userId: "ada", sessionId }), false);
	const ok = await reauth(token, { method: "password", password: "ada password 123", code: totp(totpSecret) });
	assert.equal(ok.status, 200);
	assert.equal(await isReauthFresh(db, { userId: "ada", sessionId }), true);
	assert.equal(await d1.prepare("select count(*) as n from session where id = ?").bind(sessionId).first("n"), 1, "same session, not rotated");

	// A backup code works too (and is used up).
	const s2 = await staleSession(ada);
	const viaBackup = await reauth(s2.token, { method: "password", password: "ada password 123", code: backupCodes[0], codeType: "backup_code" });
	assert.equal(viaBackup.status, 200);
	const s3 = await staleSession(ada);
	const reused = await reauth(s3.token, { method: "password", password: "ada password 123", code: backupCodes[0], codeType: "backup_code" });
	assert.equal(reused.status, 401);

	// With 2FA on, the current password alone no longer changes the password.
	const s4 = await staleSession(ada);
	const change = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/password",
		token: s4.token,
		body: { currentPassword: "ada password 123", newPassword: "ada password 456" },
	});
	assert.equal(change.status, 403);
	assert.equal(change.payload.code, REAUTH_REQUIRED_CODE);
}

// ── Passkeys: the plugin checks the assertion; its side-effect session is dropped ──
{
	const api = getAuth(env).api;
	const real = api.verifyPasskeyAuthentication;
	assert.equal(typeof real, "function");
	const ctx = await getAuth(env).$context;
	let mintedFor = "ada";
	let seenHeaders = null;
	api.verifyPasskeyAuthentication = async ({ headers }) => {
		seenHeaders = headers;
		const session = await ctx.internalAdapter.createSession(mintedFor);
		return { session, user: { id: mintedFor } };
	};
	try {
		await d1.prepare(
			"insert into passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up) values ('pk1', 'Mac', 'x', 'ada', 'cred1', 0, 'multiDevice', 1)",
		).run();
		const { token, sessionId } = await staleSession(ada);
		const gate = await authedRequest(env, { method: "DELETE", path: "/api/v1/me/recovery-email", token });
		assert.deepEqual(gate.payload.methods, ["password", "passkey", "sign_in"]);

		const sessionsBefore = await d1.prepare("select count(*) as n from session where user_id = 'ada'").first("n");
		const ok = await authedRequest(env, {
			method: "POST",
			path: "/api/v1/me/reauth",
			token,
			headers: { cookie: "better-auth.better-auth-passkey=signed-challenge", origin: "https://inboxies.test" },
			body: { method: "passkey", response: { id: "cred1" } },
		});
		assert.equal(ok.status, 200);
		assert.equal(seenHeaders.get("cookie"), "better-auth.better-auth-passkey=signed-challenge", "the challenge cookie goes to the plugin");
		assert.equal(seenHeaders.get("authorization"), null);
		assert.equal(await d1.prepare("select count(*) as n from session where user_id = 'ada'").first("n"), sessionsBefore, "no extra session left behind");
		assert.equal(await isReauthFresh(db, { userId: "ada", sessionId }), true);

		// Someone else's passkey proves nothing about Ada.
		mintedFor = "bob";
		const s2 = await staleSession(ada);
		const bobSessions = await d1.prepare("select count(*) as n from session where user_id = 'bob'").first("n");
		const other = await reauth(s2.token, { method: "passkey", response: { id: "bob-cred" } });
		assert.equal(other.status, 401);
		assert.equal(await d1.prepare("select count(*) as n from session where user_id = 'bob'").first("n"), bobSessions, "Bob gets no session either");
		api.verifyPasskeyAuthentication = async () => {
			throw new Error("AUTHENTICATION_FAILED");
		};
		assert.equal((await reauth(s2.token, { method: "passkey", response: { id: "x" } })).status, 401);
		assert.equal(await isReauthFresh(db, { userId: "ada", sessionId: s2.sessionId }), false);

		// Removing a passkey (fresh) mails a notice.
		const fresh = await signIn(env, ada);
		const before = email.sent.length;
		const del = await authedRequest(env, { method: "POST", path: "/api/auth/passkey/delete-passkey", token: fresh.token, body: { id: "pk1" } });
		assert.equal(del.status, 200);
		await flushWaitUntil();
		const notices = email.sent.slice(before).filter((m) => /passkey was removed/.test(m.subject));
		assert.deepEqual(notices.map((m) => m.to).sort(), ["ada.new@gmail.com", "ada@inboxies.email"]);
	} finally {
		api.verifyPasskeyAuthentication = real;
	}
	// The real plugin refuses a forged assertion.
	const s = await staleSession(ada);
	const forged = await reauth(s.token, { method: "passkey", response: { id: "nope", rawId: "nope", type: "public-key", response: {} } });
	assert.equal(forged.status, 401);
}

// ── Emailed code: accounts without a password ───────────────────
{
	const { token, sessionId } = await staleSession(gus);
	const status = await authedRequest(env, { path: "/api/v1/me/reauth", token });
	assert.deepEqual(status.payload.methods, ["email_code", "sign_in"]);
	assert.equal(status.payload.emailCodeTo, "g•••s@gmail.com");

	assert.equal(
		(await authedRequest(env, { method: "POST", path: "/api/v1/me/reauth/email-code", token: (await staleSession(ada)).token })).status,
		400,
		"password accounts use the password",
	);
	const send = await authedRequest(env, { method: "POST", path: "/api/v1/me/reauth/email-code", token });
	assert.equal(send.status, 200);
	assert.equal(send.payload.sentTo, "g•••s@gmail.com");
	const code = lastCodeSentTo(email, "gus@gmail.com");
	assert.ok(code);

	// The code only re-authenticates the session that asked for it.
	const other = await staleSession(gus);
	assert.equal((await reauth(other.token, { method: "email_code", code })).status, 401);
	assert.equal((await reauth(token, { method: "email_code", code: wrongCode(code) })).status, 401);
	const ok = await reauth(token, { method: "email_code", code });
	assert.equal(ok.status, 200);
	assert.equal(await isReauthFresh(db, { userId: "gus", sessionId }), true);
	assert.equal((await reauth(token, { method: "email_code", code })).status, 401, "single use");

	// Then adding a password works and is announced.
	const before = email.sent.length;
	const add = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/attach",
		token,
		body: { provider: "password", password: "gus password 123" },
	});
	assert.equal(add.status, 200);
	await flushWaitUntil();
	assert.deepEqual(email.sent.slice(before).map((m) => [m.to, m.subject]), [["gus@gmail.com", "A password was added to your Inboxies account"]]);

	// A placeholder login with nothing else: signing in again is the way.
	const pias = await staleSession(pia);
	const piaStatus = await authedRequest(env, { path: "/api/v1/me/reauth", token: pias.token });
	assert.deepEqual(piaStatus.payload.methods, ["sign_in"]);
	assert.equal((await authedRequest(env, { method: "POST", path: "/api/v1/me/reauth/email-code", token: pias.token })).status, 400);
	const fresh = await signIn(env, pia);
	assert.equal((await authedRequest(env, { path: "/api/v1/me/reauth", token: fresh.token })).payload.fresh, true);
}

// ── Throttling: the account lock applies to re-auth passwords ───
{
	const carl = await addUser(db, { id: "carl", email: "carl@inboxies.email", password: "carl password 123" });
	const { token } = await staleSession(carl);
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) await reauth(token, { method: "password", password: `wrong ${i}` });
	const locked = await reauth(token, { method: "password", password: "carl password 123" });
	assert.equal(locked.status, 429, "locked like sign-in, even with the right password");
}

// ── Deleting the account: fresh session, notice to the recovery email ──
{
	const { token } = await signIn(env, ada);
	const before = email.sent.length;
	const del = await authedRequest(env, { method: "DELETE", path: "/api/v1/me", token, body: { confirm: "DELETE" } });
	assert.equal(del.status, 200);
	await flushWaitUntil();
	const notices = email.sent.slice(before);
	assert.deepEqual(notices.map((m) => [m.to, m.subject]), [["ada.new@gmail.com", "Your Inboxies account was deleted"]], "the deleted mailbox isn't mailed");
	assert.equal(mailsTo("thief@evil.test").length, 0);
}

console.log("auth-reauth: ok");
