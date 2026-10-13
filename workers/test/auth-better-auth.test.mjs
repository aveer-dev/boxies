/**
 * Better Auth wiring (workers/auth/index.ts) end to end on a real SQLite
 * AUTH_DB: legacy PBKDF2 hashes sign in, sessions are bearer tokens, and
 * signing out revokes them server-side.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-better-auth.test.mjs
 */

import assert from "node:assert/strict";
import { createAuth, isBetterAuthEnabled } from "../auth/index.ts";
import * as schema from "../auth/schema.ts";
import { authDb } from "../auth/authz.ts";
import { hashPassword } from "../lib/password-auth.ts";
import { createTestD1 } from "./d1-shim.mjs";

const d1 = createTestD1();
const env = {
	AUTH_DB: d1,
	BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
	BETTER_AUTH_ENABLED: "true",
	APP_BASE_URL: "https://inboxies.test",
};
assert.equal(isBetterAuthEnabled(env), true);
assert.equal(isBetterAuthEnabled({ ...env, BETTER_AUTH_ENABLED: undefined }), false, "dark by default");

// A user as the R2 migration writes them: legacy hash on a credential account.
const db = authDb(d1);
await db.insert(schema.user).values({
	id: "u-ada",
	name: "Ada",
	email: "ada@inboxies.email",
	emailVerified: true,
});
await db.insert(schema.account).values({
	id: "acc-ada",
	accountId: "u-ada",
	providerId: "credential",
	userId: "u-ada",
	password: await hashPassword("correct horse battery"),
});

const auth = createAuth(env);
const call = (path, { method = "GET", body, token } = {}) =>
	auth.handler(
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
const signIn = await call("/sign-in/email", {
	method: "POST",
	body: { email: "ada@inboxies.email", password: "correct horse battery" },
});
assert.equal(signIn.status, 200);
const token = signIn.headers.get("set-auth-token");
assert.ok(token, "bearer plugin returns the session token");

const session = await (await call("/get-session", { token })).json();
assert.equal(session?.user?.id, "u-ada");
assert.equal(session?.user?.email, "ada@inboxies.email");

// Public sign-up is closed: accounts come from our onboarding routes.
{
	const res = await call("/sign-up/email", {
		method: "POST",
		body: { email: "mallory@inboxies.email", password: "mallory password 1", name: "M" },
	});
	assert.notEqual(res.status, 200);
	const rows = await d1.prepare("select count(*) as n from user").first("n");
	assert.equal(rows, 1, "no user was created");
}

// Signing out deletes the session row, so the same token stops working.
{
	const out = await call("/sign-out", { method: "POST", token });
	assert.equal(out.status, 200);
	const after = await (await call("/get-session", { token })).json();
	assert.equal(after, null, "revoked token has no session");
	const remaining = await d1.prepare("select count(*) as n from session").first("n");
	assert.equal(remaining, 0);
}

console.log("auth-better-auth: ok");
