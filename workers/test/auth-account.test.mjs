/**
 * Account routes through the real session middleware (workers/auth/middleware.ts):
 * the compatibility sign-in shapes, 401s shipped apps recognise, logout and
 * password changes revoking sessions, password reset only via a verified
 * recovery email, recovery-email codes, the session list, scoped extension
 * tokens, sign-in methods, and account deletion.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-account.test.mjs
 */

import assert from "node:assert/strict";
import { mailboxRole } from "../auth/authz.ts";
import { EXPIRED_SESSION_ERROR } from "../auth/middleware.ts";
import {
	addMailbox,
	addUser,
	authedRequest,
	createAuthTestEnv,
	lastCodeSentTo,
	signIn,
} from "./auth-fixtures.mjs";

const { env, d1, db, bucket, mailboxes, email } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email", password: "ada password 123" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email", password: "bob password 123" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "bob@inboxies.email", { owners: ["bob"] });
await addMailbox(db, bucket, "shared@inboxies.email", { owners: ["ada", "bob"] });

const login = (body) => authedRequest(env, { method: "POST", path: "/api/v1/auth/password", body });
const sessionCount = async (userId) =>
	d1.prepare("select count(*) as n from session where user_id = ?").bind(userId).first("n");

// ── Middleware: no session, bad session, pre-cutover tokens ─────
{
	const anon = await authedRequest(env, { path: "/api/v1/me" });
	assert.equal(anon.status, 401);
	assert.deepEqual(anon.payload, { error: "Unauthorized" });

	// Shipped iOS/Android builds sign out only on this exact text.
	const oldJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyOmFkYSJ9.c2lnbmF0dXJl";
	for (const token of [oldJwt, "not-a-real-session-token"]) {
		const res = await authedRequest(env, { path: "/api/v1/mailboxes", token });
		assert.equal(res.status, 401);
		assert.equal(res.payload.error, EXPIRED_SESSION_ERROR);
	}
	// Public routes stay public with a dead token.
	assert.equal((await authedRequest(env, { path: "/api/v1/config", token: oldJwt })).status, 200);

	// A signed-out browser opening an app page goes to /login.
	const page = await authedRequest(env, { path: "/settings?tab=x", headers: { accept: "text/html" } });
	assert.equal(page.status, 302);
	assert.equal(page.headers.get("location"), "/login?next=%2Fsettings%3Ftab%3Dx");
}

// ── Password sign-in (compatibility shape) ──────────────────────
let adaToken;
{
	const wrong = await login({ email: "ada@inboxies.email", password: "nope nope nope" });
	assert.equal(wrong.status, 401);
	assert.deepEqual(wrong.payload, { error: "Invalid email or password" });
	const unknown = await login({ email: "who@inboxies.email", password: "ada password 123" });
	assert.equal(unknown.status, 401);

	const ok = await login({ email: "Ada+news@Inboxies.Email", password: "ada password 123" });
	assert.equal(ok.status, 200);
	assert.equal(ok.payload.email, "ada@inboxies.email");
	assert.equal(ok.payload.sub, "user:ada");
	assert.ok(ok.payload.keys.includes("user:ada"));
	assert.ok(Date.parse(ok.payload.expiresAt) > Date.now());
	assert.match(ok.headers.get("set-cookie"), /better-auth\.session_token=.*HttpOnly/);
	adaToken = ok.payload.token;

	const me = await authedRequest(env, { path: "/api/v1/me", token: adaToken });
	assert.equal(me.status, 200);
	assert.equal(me.payload.userId, "ada");
	assert.ok(Array.isArray(me.payload.keys), "iOS decodes keys as required");
}

// ── Sessions: list, revoke one, sign out everywhere else ────────
{
	const other = await signIn(env, ada);
	const list = await authedRequest(env, { path: "/api/v1/me/sessions", token: adaToken });
	assert.equal(list.status, 200);
	assert.equal(list.payload.length, 2);
	assert.equal(list.payload.filter((s) => s.current).length, 1);
	assert.equal(list.payload.some((s) => "token" in s), false, "tokens are never listed");

	// Bob can't revoke Ada's session.
	const bobSession = await signIn(env, bob);
	assert.equal(
		(await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${other.sessionId}`, token: bobSession.token })).status,
		404,
	);
	const revoke = await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${other.sessionId}`, token: adaToken });
	assert.equal(revoke.status, 200);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: other.token })).status, 401);

	const third = await signIn(env, ada);
	const everywhere = await authedRequest(env, { method: "POST", path: "/api/v1/me/sessions/revoke-others", token: adaToken });
	assert.equal(everywhere.payload.revoked, 1);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: third.token })).status, 401);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: adaToken })).status, 200, "the caller stays signed in");
}

// ── Scoped extension / AutoFill tokens ─────────────────────────
{
	const minted = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/extension-session",
		token: adaToken,
		body: { client: "ios-autofill" },
	});
	assert.equal(minted.status, 200);
	assert.equal(minted.payload.label, "iPhone AutoFill");
	const scoped = minted.payload.token;

	assert.equal((await authedRequest(env, { path: "/api/v1/mailboxes", token: scoped })).status, 200);
	assert.equal((await authedRequest(env, { path: "/api/v1/mailboxes/ada@inboxies.email/aliases", token: scoped })).status, 200);
	for (const [method, path] of [
		["GET", "/api/v1/mailboxes/ada@inboxies.email/emails"],
		["POST", "/api/v1/mailboxes/ada@inboxies.email/emails"],
		["POST", "/api/v1/me/extension-session"],
		["GET", "/api/v1/me/sessions"],
		["DELETE", "/api/v1/me"],
	]) {
		const res = await authedRequest(env, { method, path, token: scoped, body: method === "GET" ? undefined : {} });
		assert.equal(res.status, 403, `${method} ${path} refused for a scoped token`);
	}
	// It shows up in the owner's list and can be revoked like any session.
	const list = await authedRequest(env, { path: "/api/v1/me/sessions", token: adaToken });
	const entry = list.payload.find((s) => s.scope === "aliases");
	assert.equal(entry.label, "iPhone AutoFill");
	await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${entry.id}`, token: adaToken });
	assert.equal((await authedRequest(env, { path: "/api/v1/mailboxes", token: scoped })).status, 401);
}

// ── Logout revokes the session and its push tokens ─────────────
{
	const s = await login({ email: "bob@inboxies.email", password: "bob password 123" });
	const token = s.payload.token;
	const reg = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/mailboxes/bob@inboxies.email/device-token",
		token,
		body: { token: "bob-iphone", platform: "ios" },
	});
	assert.equal(reg.status, 200);
	assert.equal(mailboxes.deviceTokens.get("bob@inboxies.email").has("bob-iphone"), true);

	const out = await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/logout", token });
	assert.equal(out.status, 200);
	assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token })).status, 401);
	assert.equal(mailboxes.deviceTokens.get("bob@inboxies.email").has("bob-iphone"), false, "the device stops getting pushes");
}

// ── Recovery email: codes are bound to the address, hosted addresses refused ──
{
	const hosted = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token: adaToken, body: { email: "shared@inboxies.email" } });
	assert.equal(hosted.status, 400, "a mailbox others may read can't receive reset codes");

	const set = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token: adaToken, body: { email: "Ada.Backup@Gmail.com" } });
	assert.equal(set.status, 200);
	assert.equal(set.payload.verified, false);
	const code = lastCodeSentTo(email, "ada.backup@gmail.com");
	assert.ok(code);

	// Switching the address invalidates the code sent to the old one.
	await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email", token: adaToken, body: { email: "ada.other@gmail.com" } });
	const stale = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email/verify", token: adaToken, body: { code } });
	assert.equal(stale.status, 400);

	const fresh = lastCodeSentTo(email, "ada.other@gmail.com");
	const ok = await authedRequest(env, { method: "POST", path: "/api/v1/me/recovery-email/verify", token: adaToken, body: { code: fresh } });
	assert.equal(ok.status, 200);
	const got = await authedRequest(env, { path: "/api/v1/me/recovery-email", token: adaToken });
	assert.deepEqual(got.payload, { email: "ada.other@gmail.com", verified: true });
}

// ── Password reset: only to the verified recovery email ─────────
{
	// Bob has no verified recovery email: nothing is sent anywhere.
	const before = email.sent.length;
	const bobForgot = await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/forgot", body: { email: "bob@inboxies.email" } });
	assert.equal(bobForgot.status, 200);
	assert.equal(email.sent.length, before, "no reset mail without a verified recovery email");
	assert.equal(bobForgot.payload.devResetCode, undefined);

	const otherSession = await signIn(env, ada);
	const forgot = await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/forgot", body: { email: "ada@inboxies.email" } });
	assert.equal(forgot.status, 200);
	const mail = email.sent.at(-1);
	assert.equal(mail.to, "ada.other@gmail.com", "the code goes to the recovery address, never the mailbox");
	assert.equal(
		email.sent.some((m) => /password/i.test(m.subject) && (m.to === "ada@inboxies.email" || m.to === "shared@inboxies.email")),
		false,
	);
	const code = lastCodeSentTo(email, "ada.other@gmail.com");

	const badCode = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/auth/password/reset",
		body: { email: "ada@inboxies.email", code: code === "000000" ? "111111" : "000000", newPassword: "ada new password 1" },
	});
	assert.equal(badCode.status, 400);
	const reset = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/auth/password/reset",
		body: { email: "ada@inboxies.email", code, newPassword: "ada new password 1" },
	});
	assert.equal(reset.status, 200);
	assert.ok(reset.payload.token, "shipped apps decode token + expiresAt from reset");
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: otherSession.token })).status, 401, "reset revokes every session");
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: adaToken })).status, 401);
	assert.equal((await login({ email: "ada@inboxies.email", password: "ada password 123" })).status, 401);
	adaToken = reset.payload.token;
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: adaToken })).status, 200);

	// The emailed link token works once.
	await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/forgot", body: { email: "ada@inboxies.email" } });
	const linkToken = email.sent.at(-1).text.match(/token=([0-9a-f]{64})/)[1];
	const viaLink = await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/reset", body: { token: linkToken, newPassword: "ada third password" } });
	assert.equal(viaLink.status, 200);
	const replay = await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/reset", body: { token: linkToken, newPassword: "ada fourth password" } });
	assert.equal(replay.status, 400);
	adaToken = viaLink.payload.token;
}

// ── Change password: other sessions end ────────────────────────
{
	const other = await signIn(env, ada);
	const wrong = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/password",
		token: adaToken,
		body: { currentPassword: "nope nope nope", newPassword: "ada fifth password" },
	});
	assert.equal(wrong.status, 403);
	assert.match(wrong.payload.error, /incorrect/, "shipped apps match on 'incorrect'");
	const ok = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/password",
		token: adaToken,
		body: { currentPassword: "ada third password", newPassword: "ada fifth password" },
	});
	assert.equal(ok.status, 200);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: other.token })).status, 401);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: adaToken })).status, 200);
}

// ── Sign-in methods ────────────────────────────────────────────
{
	const ids = await authedRequest(env, { path: "/api/v1/me/identities", token: adaToken });
	assert.equal(ids.payload.accountId, "ada");
	assert.deepEqual(ids.payload.identities.map((i) => i.type), ["password"]);

	const dup = await authedRequest(env, { method: "POST", path: "/api/v1/me/identities/attach", token: adaToken, body: { provider: "password", password: "whatever password" } });
	assert.equal(dup.status, 409);
	assert.match(dup.payload.error, /already has a password/);

	const last = await authedRequest(env, { method: "DELETE", path: "/api/v1/me/identities/password", token: adaToken });
	assert.equal(last.status, 400, "the last sign-in method stays");

	for (const path of ["/api/v1/me/identity-link-codes", "/api/v1/auth/redeem-identity-link"]) {
		assert.equal((await authedRequest(env, { method: "POST", path, token: adaToken, body: { code: "x" } })).status, 410);
	}
	const directory = await authedRequest(env, { path: "/api/v1/accounts", token: adaToken });
	assert.deepEqual(directory.payload, [], "no account directory");
}

// ── Delete account ─────────────────────────────────────────────
{
	const s = await signIn(env, bob);
	const unconfirmed = await authedRequest(env, { method: "DELETE", path: "/api/v1/me", token: s.token, body: {} });
	assert.equal(unconfirmed.status, 400);
	const del = await authedRequest(env, { method: "DELETE", path: "/api/v1/me", token: s.token, body: { confirm: "DELETE" } });
	assert.equal(del.status, 200);
	assert.deepEqual(del.payload.deletedMailboxes, ["bob@inboxies.email"]);
	assert.deepEqual(del.payload.leftMailboxes, ["shared@inboxies.email"]);
	assert.ok(mailboxes.calls.some(([id, m]) => id === "bob@inboxies.email" && m === "purgeMailbox"));
	assert.equal(await mailboxRole(db, "ada", "shared@inboxies.email"), "owner", "a co-owned mailbox survives");
	assert.equal(await d1.prepare("select count(*) as n from user where id = 'bob'").first("n"), 0);
	assert.equal(await sessionCount("bob"), 0);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: s.token })).status, 401);
	assert.equal((await login({ email: "bob@inboxies.email", password: "bob password 123" })).status, 401);
}

console.log("auth-account: ok");
