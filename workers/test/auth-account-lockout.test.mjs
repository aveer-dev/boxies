/**
 * Per-account password throttle (AVE-124, workers/auth/rate-limit.ts): wrong
 * passwords count per login across IPs, on /api/v1/auth/password, Better
 * Auth's /api/auth/sign-in/email and the change-password routes; after 10 the
 * login answers the same 429 as the per-IP limit for 15 minutes, whether or
 * not the account exists. The per-IP limit is unchanged.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-account-lockout.test.mjs
 */

import assert from "node:assert/strict";
import {
	ACCOUNT_FAILURE_LIMIT,
	ACCOUNT_LOCK_MS,
	TOO_MANY,
	isAccountLocked,
	recordPasswordFailure,
} from "../auth/rate-limit.ts";
import { addUser, authedRequest, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

/** Workers Rate Limiting stand-in: `limit` calls per key, no expiry. */
function mockLimiter(limit = 10) {
	const counts = new Map();
	return {
		counts,
		async limit({ key }) {
			const n = (counts.get(key) ?? 0) + 1;
			counts.set(key, n);
			return { success: n <= limit };
		},
	};
}

const AUTH_LIMITER = mockLimiter(10);
const { env, d1, db } = createAuthTestEnv({ AUTH_LIMITER });
await addUser(db, { id: "ada", email: "ada@inboxies.email", password: "ada password 123" });
await addUser(db, { id: "bob", email: "bob@inboxies.email", password: "bob password 123" });
const cat = await addUser(db, { id: "cat", email: "cat@inboxies.email", password: "cat password 123" });
const dan = await addUser(db, { id: "dan", email: "dan@inboxies.email", password: "dan password 123" });
await addUser(db, { id: "eve", email: "eve@inboxies.email", password: "eve password 123" });

let ipCounter = 0;
const freshIp = () => `198.18.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

const login = (body, ip = freshIp()) =>
	authedRequest(env, {
		method: "POST",
		path: "/api/v1/auth/password",
		body,
		headers: { "cf-connecting-ip": ip },
	});

const baLogin = (body, ip = freshIp()) =>
	authedRequest(env, {
		method: "POST",
		path: "/api/auth/sign-in/email",
		body,
		headers: { "cf-connecting-ip": ip, origin: "https://inboxies.test" },
	});

/** Expire every lock / count as if the cool-down had passed. */
const expireCounts = () =>
	d1.prepare("UPDATE verification SET expires_at = ? WHERE id LIKE 'password-failures:%'").bind(Date.now() - 1).run();

// ── Same account, a new IP each time ────────────────────────────
{
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) {
		const res = await login({ email: "ada@inboxies.email", password: `wrong ${i}` });
		assert.equal(res.status, 401, `attempt ${i + 1} is a plain failure`);
	}
	const blocked = await login({ email: "ada@inboxies.email", password: "wrong again" });
	assert.equal(blocked.status, 429);
	assert.deepEqual(blocked.payload, TOO_MANY);
	// The right password doesn't get through during the cool-down either.
	const right = await login({ email: "ada@inboxies.email", password: "ada password 123" });
	assert.equal(right.status, 429);
	// Case, whitespace and plus-tags name the same login.
	assert.equal((await login({ email: "  ADA+x@Inboxies.Email ", password: "wrong" })).status, 429);
	// Better Auth's email sign-in shares the count.
	assert.equal((await baLogin({ email: "ada@inboxies.email", password: "ada password 123" })).status, 429);
	// Other accounts are unaffected.
	assert.equal((await login({ email: "bob@inboxies.email", password: "bob password 123" })).status, 200);
	// No IP was over its own limit.
	assert.ok([...AUTH_LIMITER.counts.values()].every((n) => n <= 10));
}

// ── A nonexistent account answers exactly the same ──────────────
{
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) {
		const res = await login({ email: "nobody@inboxies.email", password: `wrong ${i}` });
		assert.equal(res.status, 401);
		assert.deepEqual(res.payload, { error: "Invalid email or password" });
	}
	const blocked = await login({ email: "nobody@inboxies.email", password: "wrong again" });
	assert.equal(blocked.status, 429);
	assert.deepEqual(blocked.payload, TOO_MANY);
}

// ── Better Auth's /api/auth/sign-in/email counts per account too ─
{
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) {
		assert.equal((await baLogin({ email: "cat@inboxies.email", password: `wrong ${i}` })).status, 401);
	}
	const blocked = await baLogin({ email: "cat@inboxies.email", password: "cat password 123" });
	assert.equal(blocked.status, 429);
	assert.deepEqual(blocked.payload, TOO_MANY);
	assert.equal((await login({ email: "cat@inboxies.email", password: "cat password 123" })).status, 429);
	// Passkey sign-in isn't behind the account key.
	const passkey = await authedRequest(env, {
		path: "/api/auth/passkey/generate-authenticate-options",
		headers: { "cf-connecting-ip": freshIp(), origin: "https://inboxies.test" },
	});
	assert.notEqual(passkey.status, 429);
}

// ── The cool-down ends; a fresh window starts over ──────────────
{
	await expireCounts();
	assert.equal((await login({ email: "ada@inboxies.email", password: "ada password 123" })).status, 200);
	assert.equal((await baLogin({ email: "cat@inboxies.email", password: "cat password 123" })).status, 200);
	// One failure after expiry is just one.
	assert.equal((await login({ email: "ada@inboxies.email", password: "wrong" })).status, 401);
	assert.equal(await isAccountLocked(env, "ada@inboxies.email"), false);
}

// ── Correct sign-ins don't reset the count (it ages out) ────────
{
	for (let i = 0; i < 5; i++) await login({ email: "eve@inboxies.email", password: `wrong ${i}` });
	assert.equal((await login({ email: "eve@inboxies.email", password: "eve password 123" })).status, 200);
	for (let i = 0; i < 5; i++) await login({ email: "eve@inboxies.email", password: `wrong ${i}` });
	assert.equal((await login({ email: "eve@inboxies.email", password: "eve password 123" })).status, 429);
}

// ── Window and cool-down timing (helpers, explicit clock) ───────
{
	const t0 = 1_000_000_000_000;
	const who = "timing@example.com";
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT - 1; i++) await recordPasswordFailure(env, who, t0 + i);
	assert.equal(await isAccountLocked(env, who, t0 + 100), false);
	await recordPasswordFailure(env, who, t0 + 1000);
	assert.equal(await isAccountLocked(env, who, t0 + 1001), true);
	assert.equal(await isAccountLocked(env, who, t0 + 1000 + ACCOUNT_LOCK_MS - 1), true);
	assert.equal(await isAccountLocked(env, who, t0 + 1000 + ACCOUNT_LOCK_MS), false);
	// After the window, counting starts at 1 again.
	await recordPasswordFailure(env, who, t0 + 1000 + ACCOUNT_LOCK_MS);
	const row = await d1.prepare("SELECT value FROM verification WHERE id LIKE 'password-failures:%' AND expires_at > ?")
		.bind(t0 + 1000 + ACCOUNT_LOCK_MS)
		.all();
	assert.ok(row.results.some((r) => r.value === "1"));
	// The stored key is hashed, not the address.
	const ids = await d1.prepare("SELECT id, identifier FROM verification WHERE id LIKE 'password-failures:%'").all();
	assert.ok(ids.results.every((r) => !r.id.includes("@") && !r.identifier.includes("@")));
}

// ── Change password (signed in) counts against the same account ─
{
	const { token } = await signIn(env, dan);
	const change = (currentPassword) =>
		authedRequest(env, {
			method: "POST",
			path: "/api/v1/me/identities/password",
			token,
			body: { currentPassword, newPassword: "a brand new password 1" },
		});
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) assert.equal((await change(`wrong ${i}`)).status, 403);
	assert.equal(await isAccountLocked(env, "dan@inboxies.email"), true);
	assert.equal((await change("dan password 123")).status, 429);
	assert.equal((await login({ email: "dan@inboxies.email", password: "dan password 123" })).status, 429);
}

// ── Better Auth /change-password counts too ─────────────────────
{
	await expireCounts();
	const { token } = await signIn(env, cat);
	const change = (currentPassword) =>
		authedRequest(env, {
			method: "POST",
			path: "/api/auth/change-password",
			token,
			body: { currentPassword, newPassword: "a brand new password 1" },
			headers: { "cf-connecting-ip": freshIp(), origin: "https://inboxies.test" },
		});
	for (let i = 0; i < ACCOUNT_FAILURE_LIMIT; i++) assert.equal((await change(`wrong ${i}`)).status, 400);
	assert.equal((await change("cat password 123")).status, 429);
	assert.equal(await isAccountLocked(env, "cat@inboxies.email"), true);
}

// ── Per-IP limit unchanged: one IP, many accounts → 429 after 10 ─
{
	await expireCounts();
	const ip = "198.51.100.7";
	for (let i = 0; i < 10; i++) {
		assert.equal((await login({ email: `user${i}@example.com`, password: "wrong" }, ip)).status, 401);
	}
	const blocked = await login({ email: "bob@inboxies.email", password: "bob password 123" }, ip);
	assert.equal(blocked.status, 429);
	assert.deepEqual(blocked.payload, TOO_MANY);
	// None of those accounts is locked: one failure each.
	assert.equal(await isAccountLocked(env, "user0@example.com"), false);
}

console.log("auth-account-lockout tests passed");
