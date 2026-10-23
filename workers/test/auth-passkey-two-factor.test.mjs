/**
 * Passkeys and optional TOTP two-factor (AVE-74) on a real SQLite AUTH_DB,
 * through the real session middleware and the /api/auth allowlist:
 * - the passkey relying party comes from APP_BASE_URL; registering needs a
 *   full session, the sign-in step is public;
 * - turning 2FA on needs the password, and secrets/backup codes are stored
 *   encrypted;
 * - with 2FA on, password sign-in (ours and Better Auth's) answers with a
 *   challenge instead of a session, and `/api/v1/auth/two-factor/verify`
 *   finishes it with a TOTP or a one-time backup code;
 * - a password reset still ends in the challenge; users without 2FA are
 *   unaffected; turning it off restores plain sign-in.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-passkey-two-factor.test.mjs
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { passkeyRelyingParty } from "../auth/index.ts";
import * as schema from "../auth/schema.ts";
import { addMailbox, addUser, authedRequest, createAuthTestEnv, lastCodeSentTo, signIn } from "./auth-fixtures.mjs";

// ── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) for the test's authenticator ──
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
	const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
	return String(code).padStart(6, "0");
}
const wrongCode = (code) => String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");

// ── Relying party config ────────────────────────────────────────
assert.deepEqual(passkeyRelyingParty({ APP_BASE_URL: "https://inboxies.app" }), {
	rpID: "inboxies.app",
	origin: ["https://inboxies.app"],
});
assert.deepEqual(
	passkeyRelyingParty({
		APP_BASE_URL: "https://inboxies.app/",
		PASSKEY_EXTRA_ORIGINS: " android:apk-key-hash:abc , https://inboxies.app",
	}),
	{ rpID: "inboxies.app", origin: ["https://inboxies.app", "android:apk-key-hash:abc"] },
);
assert.deepEqual(passkeyRelyingParty({}), { origin: null }, "local dev: Better Auth falls back to localhost");
assert.deepEqual(passkeyRelyingParty({ APP_BASE_URL: "not a url" }), { origin: null });

const { env, d1, db, bucket, email } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email", password: "ada password 123" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email", password: "bob password 123" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "bob@inboxies.email", { owners: ["bob"] });

const login = (body) => authedRequest(env, { method: "POST", path: "/api/v1/auth/password", body });
const verify2fa = (body) => authedRequest(env, { method: "POST", path: "/api/v1/auth/two-factor/verify", body });
const sessionCount = (userId) => d1.prepare("select count(*) as n from session where user_id = ?").bind(userId).first("n");

// ── Routes: the plugins' routes are allowlisted, OTP-by-email isn't ──
{
	const { token } = await signIn(env, ada);
	for (const [method, path] of [
		["POST", "/api/auth/two-factor/send-otp"],
		["POST", "/api/auth/two-factor/verify-otp"],
		["GET", "/api/auth/passkey/verify-authentication"],
	]) {
		const res = await authedRequest(env, { method, path, token, body: method === "POST" ? {} : undefined });
		assert.equal(res.status, 404, `${method} ${path} is not routed`);
	}

	// Scoped (extension / AutoFill) sessions can't touch passkeys or 2FA.
	const scoped = await signIn(env, ada, { scope: "aliases", label: "Browser extension" });
	for (const [method, path] of [
		["GET", "/api/auth/passkey/generate-register-options"],
		["GET", "/api/auth/passkey/list-user-passkeys"],
		["POST", "/api/auth/two-factor/enable"],
	]) {
		const res = await authedRequest(env, {
			method,
			path,
			token: scoped.token,
			body: method === "POST" ? { password: "ada password 123" } : undefined,
		});
		assert.equal(res.status, 403, `${method} ${path} is refused to a scoped session`);
	}
}

// ── Passkeys ────────────────────────────────────────────────────
{
	const anon = await authedRequest(env, { path: "/api/auth/passkey/generate-register-options" });
	assert.equal(anon.status, 401, "registering a passkey needs a session (passkeys never create accounts)");

	const { token } = await signIn(env, ada);
	const reg = await authedRequest(env, { path: "/api/auth/passkey/generate-register-options", token });
	assert.equal(reg.status, 200);
	assert.equal(reg.payload.rp.id, "inboxies.test", "rpID is APP_BASE_URL's host");
	assert.equal(reg.payload.rp.name, "Inboxies");
	assert.equal(reg.payload.user.name, "ada@inboxies.email");
	assert.ok(reg.payload.challenge);
	assert.match(reg.headers.get("set-cookie") ?? "", /better-auth-passkey=/, "challenge rides in a signed cookie");

	const authOpts = await authedRequest(env, { path: "/api/auth/passkey/generate-authenticate-options" });
	assert.equal(authOpts.status, 200, "passkey sign-in starts signed out");
	assert.equal(authOpts.payload.rpId, "inboxies.test");

	const list = await authedRequest(env, { path: "/api/auth/passkey/list-user-passkeys", token });
	assert.equal(list.status, 200);
	assert.deepEqual(list.payload, []);

	// A forged assertion for an unknown credential is refused, no session.
	const before = await sessionCount("ada");
	const bad = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/passkey/verify-authentication",
		headers: { cookie: authOpts.headers.get("set-cookie").split(";")[0] },
		body: { response: { id: "nope", rawId: "nope", type: "public-key", response: {} } },
	});
	assert.ok(bad.status >= 400 && bad.status < 500);
	assert.equal(await sessionCount("ada"), before);
}

// ── Users without 2FA sign in as before ─────────────────────────
{
	const res = await login({ email: "bob@inboxies.email", password: "bob password 123" });
	assert.equal(res.status, 200);
	assert.ok(res.payload.token);
	const me = await authedRequest(env, { path: "/api/v1/me", token: res.payload.token });
	assert.equal(me.payload.twoFactorEnabled, false);
}

// ── Turning 2FA on ──────────────────────────────────────────────
let adaToken = (await login({ email: "ada@inboxies.email", password: "ada password 123" })).payload.token;
let totpSecret;
let backupCodes;
{
	const noPassword = await authedRequest(env, { method: "POST", path: "/api/auth/two-factor/enable", token: adaToken, body: {} });
	assert.equal(noPassword.status, 400);
	const wrongPassword = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/enable",
		token: adaToken,
		body: { password: "not my password" },
	});
	assert.equal(wrongPassword.status, 400);

	const enable = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/enable",
		token: adaToken,
		body: { password: "ada password 123" },
	});
	assert.equal(enable.status, 200);
	const uri = new URL(enable.payload.totpURI);
	assert.equal(uri.protocol, "otpauth:");
	assert.equal(uri.searchParams.get("issuer"), "Inboxies");
	totpSecret = uri.searchParams.get("secret");
	backupCodes = enable.payload.backupCodes;
	assert.ok(totpSecret);
	assert.equal(backupCodes.length, 10);

	// Stored encrypted: neither the secret nor any backup code is in the row.
	const row = await d1.prepare("select * from two_factor where user_id = 'ada'").first();
	assert.ok(row);
	assert.equal(row.verified, 0, "not on until a code is confirmed");
	for (const plain of [totpSecret, base32Decode(totpSecret).toString("utf8"), ...backupCodes]) {
		assert.equal(row.secret.includes(plain), false);
		assert.equal(row.backup_codes.includes(plain), false);
	}
	assert.equal(await d1.prepare("select two_factor_enabled as v from user where id = 'ada'").first("v"), 0);

	// Not on yet: password sign-in still answers with a session.
	const stillPlain = await login({ email: "ada@inboxies.email", password: "ada password 123" });
	assert.equal(stillPlain.status, 200);

	const confirmBad = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/verify-totp",
		token: adaToken,
		body: { code: wrongCode(totp(totpSecret)) },
	});
	assert.equal(confirmBad.status, 401);

	const confirm = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/verify-totp",
		token: adaToken,
		body: { code: totp(totpSecret) },
	});
	assert.equal(confirm.status, 200);
	assert.equal(await d1.prepare("select two_factor_enabled as v from user where id = 'ada'").first("v"), 1);
	assert.equal(await d1.prepare("select verified as v from two_factor where user_id = 'ada'").first("v"), 1);
	// Better Auth rotates the session when 2FA turns on; the bearer plugin
	// hands the replacement back in `set-auth-token`.
	const rotated = confirm.headers.get("set-auth-token");
	assert.ok(rotated);
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: adaToken })).status, 401);
	adaToken = rotated;
	const me = await authedRequest(env, { path: "/api/v1/me", token: adaToken });
	assert.equal(me.status, 200);
	assert.equal(me.payload.twoFactorEnabled, true);
}

// ── Password sign-in with 2FA on: a challenge, then a code ──────
{
	const before = await sessionCount("ada");
	const challenge = await login({ email: "Ada@Inboxies.email", password: "ada password 123" });
	assert.equal(challenge.status, 401, "builds that predate 2FA treat it like a failed sign-in");
	assert.equal(challenge.payload.code, "TWO_FACTOR_REQUIRED");
	assert.equal(challenge.payload.twoFactorRequired, true);
	assert.deepEqual(challenge.payload.twoFactorMethods, ["totp", "backup_code"]);
	assert.equal(challenge.payload.token, undefined, "no session before the second factor");
	assert.ok(challenge.payload.twoFactorToken);
	assert.match(challenge.headers.get("set-cookie") ?? "", /two_factor=/, "web gets the same challenge as a cookie");
	assert.equal(await sessionCount("ada"), before, "the password-only session was deleted");

	const wrongPassword = await login({ email: "ada@inboxies.email", password: "wrong wrong wrong" });
	assert.deepEqual(wrongPassword.payload, { error: "Invalid email or password" });

	const bad = await verify2fa({ twoFactorToken: challenge.payload.twoFactorToken, code: wrongCode(totp(totpSecret)) });
	assert.equal(bad.status, 401);
	assert.equal(bad.payload.code, "TWO_FACTOR_INVALID_CODE");
	assert.equal((await verify2fa({ twoFactorToken: "forged.token", code: totp(totpSecret) })).payload.code, "TWO_FACTOR_EXPIRED");
	assert.equal((await verify2fa({ twoFactorToken: "a; other=1", code: "123456" })).status, 400);

	const ok = await verify2fa({ twoFactorToken: challenge.payload.twoFactorToken, code: totp(totpSecret) });
	assert.equal(ok.status, 200);
	assert.ok(ok.payload.token);
	assert.ok(ok.payload.expiresAt);
	assert.equal(ok.payload.email, "ada@inboxies.email");
	assert.equal((await authedRequest(env, { path: "/api/v1/me", token: ok.payload.token })).status, 200);

	const replay = await verify2fa({ twoFactorToken: challenge.payload.twoFactorToken, code: totp(totpSecret) });
	assert.equal(replay.status, 401, "a challenge finishes one sign-in");
	assert.equal(replay.payload.code, "TWO_FACTOR_EXPIRED");
}

// ── Five wrong codes burn the challenge ─────────────────────────
{
	const challenge = await login({ email: "ada@inboxies.email", password: "ada password 123" });
	for (let i = 0; i < 5; i++) {
		const res = await verify2fa({ twoFactorToken: challenge.payload.twoFactorToken, code: wrongCode(totp(totpSecret)) });
		assert.equal(res.payload.code, "TWO_FACTOR_INVALID_CODE");
	}
	const sixth = await verify2fa({ twoFactorToken: challenge.payload.twoFactorToken, code: totp(totpSecret) });
	assert.equal(sixth.payload.code, "TWO_FACTOR_EXPIRED", "even the right code can't finish a burned challenge");
}

// ── Backup codes work once ──────────────────────────────────────
{
	const first = await login({ email: "ada@inboxies.email", password: "ada password 123" });
	const used = await verify2fa({ twoFactorToken: first.payload.twoFactorToken, code: backupCodes[0], method: "backup_code" });
	assert.equal(used.status, 200);
	assert.ok(used.payload.token);

	const second = await login({ email: "ada@inboxies.email", password: "ada password 123" });
	const reused = await verify2fa({ twoFactorToken: second.payload.twoFactorToken, code: backupCodes[0], method: "backup_code" });
	assert.equal(reused.status, 401);
	const next = await verify2fa({ twoFactorToken: second.payload.twoFactorToken, code: backupCodes[1], method: "backup_code" });
	assert.equal(next.status, 200);
}

// ── Better Auth's own sign-in route gets the challenge too (web) ─
{
	const res = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/sign-in/email",
		headers: { origin: "https://inboxies.test" },
		body: { email: "ada@inboxies.email", password: "ada password 123" },
	});
	assert.equal(res.status, 200);
	assert.equal(res.payload.twoFactorRedirect, true);
	assert.equal(res.headers.get("set-auth-token"), null, "no bearer session before the second factor");
	const cookie = res.headers
		.getSetCookie()
		.find((c) => /two_factor=/.test(c))
		.split(";")[0];
	const done = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/verify-totp",
		headers: { cookie, origin: "https://inboxies.test" },
		body: { code: totp(totpSecret) },
	});
	assert.equal(done.status, 200);
	assert.ok(done.payload.token);
}

// ── A password reset doesn't skip the second factor ─────────────
{
	await db.insert(schema.recoveryEmail).values({ userId: "ada", email: "ada.backup@gmail.com", verifiedAt: new Date() });
	await authedRequest(env, { method: "POST", path: "/api/v1/auth/password/forgot", body: { email: "ada@inboxies.email" } });
	const code = lastCodeSentTo(email, "ada.backup@gmail.com");
	assert.ok(code);
	const reset = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/auth/password/reset",
		body: { email: "ada@inboxies.email", code, newPassword: "ada new password 1" },
	});
	assert.equal(reset.status, 200);
	assert.equal(reset.payload.ok, true);
	assert.equal(reset.payload.token, undefined, "no session from the recovery email alone");
	assert.equal(reset.payload.twoFactorRequired, true);
	assert.equal(await sessionCount("ada"), 0, "reset revoked every session and minted none");
	const done = await verify2fa({ twoFactorToken: reset.payload.twoFactorToken, code: backupCodes[2], method: "backup_code" });
	assert.equal(done.status, 200);
	adaToken = done.payload.token;
}

// ── Turning 2FA off ─────────────────────────────────────────────
{
	const wrong = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/disable",
		token: adaToken,
		body: { password: "ada password 123" },
	});
	assert.equal(wrong.status, 400, "needs the current password");
	const off = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/disable",
		token: adaToken,
		body: { password: "ada new password 1" },
	});
	assert.equal(off.status, 200);
	assert.equal(await d1.prepare("select count(*) as n from two_factor where user_id = 'ada'").first("n"), 0);
	const plain = await login({ email: "ada@inboxies.email", password: "ada new password 1" });
	assert.equal(plain.status, 200);
	assert.ok(plain.payload.token);
}

// ── Deleting the user removes its 2FA and passkey rows ──────────
{
	const { token } = await signIn(env, bob);
	const enable = await authedRequest(env, {
		method: "POST",
		path: "/api/auth/two-factor/enable",
		token,
		body: { password: "bob password 123" },
	});
	assert.equal(enable.status, 200);
	await d1
		.prepare(
			"insert into passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up) values ('pk1', 'pub', 'bob', 'cred-1', 0, 'multiDevice', 1)",
		)
		.run();
	const del = await authedRequest(env, { method: "DELETE", path: "/api/v1/me", token, body: { confirm: "DELETE" } });
	assert.equal(del.status, 200);
	assert.equal(await d1.prepare("select count(*) as n from two_factor where user_id = 'bob'").first("n"), 0);
	assert.equal(await d1.prepare("select count(*) as n from passkey where user_id = 'bob'").first("n"), 0);
}

console.log("auth-passkey-two-factor: ok");
