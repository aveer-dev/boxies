/**
 * Better Auth wiring (workers/auth/index.ts) through the /api/auth router
 * (workers/routes/better-auth.ts) on a real SQLite AUTH_DB: legacy PBKDF2
 * hashes sign in, sessions are bearer tokens, only allowlisted routes exist,
 * scoped sessions can't manage the account, signing out revokes the session
 * and its push tokens, and social sign-up can't claim a hosted address.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-better-auth.test.mjs
 */

import assert from "node:assert/strict";
import { createAuth, isBetterAuthEnabled, PLACEHOLDER_EMAIL_DOMAIN } from "../auth/index.ts";
import { handleBetterAuthRequest } from "../routes/better-auth.ts";
import { addDomain, addMailbox, addUser, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

const { env, d1, db, bucket, mailboxes } = createAuthTestEnv();
assert.equal(isBetterAuthEnabled(env), true);
assert.equal(isBetterAuthEnabled({ ...env, BETTER_AUTH_SECRET: undefined }), false);

// A user as the R2 migration writes them: legacy hash on a credential account.
const ada = await addUser(db, { id: "u-ada", email: "ada@inboxies.email", password: "correct horse battery" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: [ada.id] });

const call = (path, { method = "GET", body, token } = {}) =>
	handleBetterAuthRequest(
		env,
		new Request(`https://inboxies.test/api/auth${path}`, {
			method,
			headers: {
				...(body ? { "content-type": "application/json" } : {}),
				...(token ? { authorization: `Bearer ${token}` } : {}),
				origin: "https://inboxies.test",
			},
			body: body ? JSON.stringify(body) : undefined,
		}),
	);

// Wrong password.
{
	const res = await call("/sign-in/email", {
		method: "POST",
		body: { email: "ada@inboxies.email", password: "wrong password!!" },
	});
	assert.equal(res.status, 401);
}

// Legacy PBKDF2 hash signs in and yields a bearer session token.
const signInRes = await call("/sign-in/email", {
	method: "POST",
	body: { email: "ada@inboxies.email", password: "correct horse battery" },
});
assert.equal(signInRes.status, 200);
const token = signInRes.headers.get("set-auth-token");
assert.ok(token, "bearer plugin returns the session token");

const session = await (await call("/get-session", { token })).json();
assert.equal(session?.user?.id, "u-ada");
assert.equal(session?.user?.email, "ada@inboxies.email");

// Only allowlisted routes exist: sign-up creates mailboxes (ours), Better
// Auth's reset routes would mail user.email (maybe a shared mailbox), and the
// rest (email change, deletion, OAuth redirects, email OTP) are ours or unused.
for (const [method, path] of [
	["POST", "/sign-up/email"],
	["POST", "/request-password-reset"],
	["POST", "/reset-password"],
	["GET", "/reset-password/abc"],
	["POST", "/change-email"],
	["POST", "/delete-user"],
	["GET", "/callback/apple"],
	["POST", "/email-otp/send-verification-otp"],
	["POST", "/email-otp/request-password-reset"],
	["POST", "/sign-in/email-otp"],
	["POST", "/update-session"],
	["GET", "/sign-in/email"],
]) {
	const res = await call(path, { method, token, body: method === "POST" ? { email: "ada@inboxies.email" } : undefined });
	assert.equal(res.status, 404, `${method} ${path} is not routed`);
}
assert.equal(await d1.prepare("select count(*) as n from user").first("n"), 1, "no user was created");

// The OAuth redirect flow isn't offered: social sign-in and linking need a native ID token.
{
	const res = await call("/sign-in/social", { method: "POST", body: { provider: "google", callbackURL: "/" } });
	assert.equal(res.status, 400);
	const link = await call("/link-social", { method: "POST", token, body: { provider: "google" } });
	assert.equal(link.status, 400);
}

// Scoped (extension / AutoFill) sessions can see themselves and sign out, nothing else.
{
	const scoped = await signIn(env, ada, { scope: "aliases", label: "Browser extension" });
	assert.equal((await call("/get-session", { token: scoped.token })).status, 200);
	for (const path of ["/list-sessions", "/list-accounts"]) {
		assert.equal((await call(path, { token: scoped.token })).status, 403, `${path} refused for a scoped session`);
	}
	assert.equal((await call("/revoke-other-sessions", { method: "POST", token: scoped.token, body: {} })).status, 403);
	assert.equal((await call("/change-password", { method: "POST", token: scoped.token, body: {} })).status, 403);
	const stored = await d1.prepare("select scope, label from session where id = ?").bind(scoped.sessionId).first();
	assert.deepEqual({ ...stored }, { scope: "aliases", label: "Browser extension" });
}

// Signing out deletes the session row (so the token stops working) and the
// push tokens that session registered.
{
	// set-auth-token is the signed cookie value: `<token>.<signature>`.
	const rawToken = decodeURIComponent(token).split(".")[0];
	const sessionId = await d1.prepare("select id from session where token = ?").bind(rawToken).first("id");
	assert.ok(sessionId);
	const stub = mailboxes.get("ada@inboxies.email");
	await stub.registerDeviceToken("apns-1", "ios", [`user:${ada.id}`, `session:${sessionId}`]);
	await stub.registerDeviceToken("apns-2", "ios", [`user:${ada.id}`, "session:other"]);

	const out = await call("/sign-out", { method: "POST", token });
	assert.equal(out.status, 200);
	const after = await (await call("/get-session", { token })).json();
	assert.equal(after, null, "revoked token has no session");
	assert.equal(await d1.prepare("select count(*) as n from session where token = ?").bind(rawToken).first("n"), 0);
	assert.deepEqual(
		(await stub.getDeviceTokens()).map((t) => t.token),
		["apns-2"],
		"only the signed-out session's push token is dropped",
	);
}

// Social sign-in: never links by email; may sign up, but not as an address we host.
{
	await addDomain(db, bucket, { domain: "acme.com", ownerUserId: ada.id });
	const social = createAuth({ ...env, GOOGLE_CLIENT_ID: "web.apps.googleusercontent.com", APPLE_CLIENT_ID: "co.inboxies.app" });
	assert.equal(social.options.account.accountLinking.disableImplicitLinking, true);
	// R1 relied on disableImplicitSignUp, which a `requestSignUp: true` body bypasses;
	// sign-up is allowed now and guarded by the create hook below.
	const before = social.options.databaseHooks.user.create.before;
	for (const hosted of ["bob@inboxies.email", "ceo@acme.com", "x@ACME.com"]) {
		const { data } = await before({ email: hosted, emailVerified: true, name: "x" });
		assert.match(data.email, new RegExp(`@${PLACEHOLDER_EMAIL_DOMAIN.replace(/\./g, "\\.")}$`), `${hosted} is not claimed`);
		assert.equal(data.emailVerified, false);
	}
	const { data } = await before({ email: "bob@gmail.com", emailVerified: true, name: "Bob" });
	assert.equal(data.email, "bob@gmail.com", "outside addresses are kept");
}

console.log("auth-better-auth: ok");
