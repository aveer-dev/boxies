/**
 * Password reset: token/code generation, R2 persistence, expiry, user-bound codes,
 * attempt limits, forgot-password email, and reset auth.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/password-reset.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import {
	createPasswordReset,
	verifyPasswordReset,
	consumePasswordReset,
	PASSWORD_RESET_MAX_CODE_ATTEMPTS,
	PASSWORD_RESET_MAX_ISSUES_PER_WINDOW,
} from "../lib/password-reset.ts";
import {
	hashPassword,
	verifyPassword,
} from "../lib/password-auth.ts";
import {
	savePlatformUser,
	loadPlatformUser,
} from "../lib/platform-users.ts";
import { registerAdminAndInviteRoutes } from "../routes/admin-invites.ts";
import { isPublicAuthPath } from "../lib/auth-paths.ts";

function mockBucket(initial = {}, { readLatency = false } = {}) {
	const store = new Map(
		Object.entries(initial).map(([key, value]) => [
			key,
			typeof value === "string" ? value : JSON.stringify(value),
		]),
	);
	// R2-style etags so `onlyIf: { etagMatches }` compare-and-swap behaves.
	const etags = new Map();
	let version = 0;
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			const etag = etags.get(key) ?? "initial";
			// Optionally yield after the snapshot so concurrent read-modify-writes see stale state.
			if (readLatency) await new Promise((resolve) => setImmediate(resolve));
			return { etag, json: async () => JSON.parse(text) };
		},
		async put(key, value, options) {
			const expected = options?.onlyIf?.etagMatches;
			if (expected !== undefined && (etags.get(key) ?? "initial") !== expected) {
				return null;
			}
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
			const etag = `v${++version}`;
			etags.set(key, etag);
			return { key, etag };
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async delete(key) {
			store.delete(key);
			etags.delete(key);
		},
		async list({ prefix = "" } = {}) {
			const keys = [];
			for (const k of store.keys()) {
				if (k.startsWith(prefix)) keys.push({ key: k });
			}
			return { objects: keys, truncated: false };
		},
	};
}

const CODE_KEY = "platform/password-resets/codes/user-123.json";

async function testPasswordResetDirect() {
	const bucket = mockBucket();
	const reset = await createPasswordReset(bucket, "user-123", "alex@example.com");

	assert.ok(reset.token.length >= 20, "Token should be random string");
	assert.match(reset.code, /^\d{6}$/, "Code should be 6 digits");
	for (const [key, value] of bucket.store) {
		assert.ok(!value.includes(`"${reset.code}"`), `Plaintext code must not be stored (${key})`);
	}

	// Verify by token
	const byToken = await verifyPasswordReset(bucket, { token: reset.token });
	assert.ok(byToken, "Should find record by token");
	assert.equal(byToken.userId, "user-123");

	// Code alone, or bound to the wrong user, never resolves
	assert.equal(await verifyPasswordReset(bucket, { code: reset.code }), null);
	assert.equal(await verifyPasswordReset(bucket, { userId: "", code: reset.code }), null);
	assert.equal(await verifyPasswordReset(bucket, { userId: "user-999", code: reset.code }), null);

	// Verify by code bound to the right user; the code is claimed on success
	const byCode = await verifyPasswordReset(bucket, { userId: "user-123", code: reset.code });
	assert.ok(byCode, "Should find record by userId + code");
	assert.equal(byCode.userId, "user-123");
	assert.equal(byCode.token, reset.token);
	assert.equal(
		await verifyPasswordReset(bucket, { userId: "user-123", code: reset.code }),
		null,
		"A code is single-use",
	);

	// Consume
	await consumePasswordReset(bucket, byCode);
	const afterToken = await verifyPasswordReset(bucket, { token: reset.token });
	assert.equal(afterToken, null, "Token should be consumed");
	assert.equal(bucket.store.has(CODE_KEY), false, "Code record should be consumed");

	console.log("testPasswordResetDirect: ok");
}

function wrongCode(code) {
	return code === "999999" ? "999998" : "999999";
}

async function testCodeAttemptLimit() {
	// Wrong guesses up to the cap leave the code usable…
	const bucket = mockBucket();
	const reset = await createPasswordReset(bucket, "user-123", "alex@example.com");
	for (let i = 0; i < PASSWORD_RESET_MAX_CODE_ATTEMPTS - 1; i++) {
		assert.equal(
			await verifyPasswordReset(bucket, { userId: "user-123", code: wrongCode(reset.code) }),
			null,
		);
	}
	assert.ok(
		await verifyPasswordReset(bucket, { userId: "user-123", code: reset.code }),
		"Code still works below the attempt cap",
	);

	// …and the cap-th wrong guess invalidates it, while the link still works.
	const locked = await createPasswordReset(bucket, "user-123", "alex@example.com");
	for (let i = 0; i < PASSWORD_RESET_MAX_CODE_ATTEMPTS; i++) {
		await verifyPasswordReset(bucket, { userId: "user-123", code: wrongCode(locked.code) });
	}
	assert.equal(
		await verifyPasswordReset(bucket, { userId: "user-123", code: locked.code }),
		null,
		"Correct code must be rejected once the attempt cap is hit",
	);
	assert.ok(
		await verifyPasswordReset(bucket, { token: locked.token }),
		"Link token keeps working after the code is locked",
	);

	// Parallel guesses cannot exceed the cap (etag compare-and-swap).
	const slowBucket = mockBucket({}, { readLatency: true });
	const raced = await createPasswordReset(slowBucket, "user-123", "alex@example.com");
	const results = await Promise.all(
		Array.from({ length: 20 }, () =>
			verifyPasswordReset(slowBucket, { userId: "user-123", code: wrongCode(raced.code) }),
		),
	);
	assert.ok(results.every((r) => r === null));
	const stored = JSON.parse(slowBucket.store.get(CODE_KEY));
	assert.equal(stored.failedAttempts, PASSWORD_RESET_MAX_CODE_ATTEMPTS);
	assert.equal(stored.codeHash, null);
	assert.equal(
		await verifyPasswordReset(slowBucket, { userId: "user-123", code: raced.code }),
		null,
		"Concurrent wrong guesses must still lock the code",
	);

	console.log("testCodeAttemptLimit: ok");
}

async function testIssuanceCap() {
	const bucket = mockBucket();
	for (let i = 0; i < PASSWORD_RESET_MAX_ISSUES_PER_WINDOW; i++) {
		assert.ok(await createPasswordReset(bucket, "user-123", "alex@example.com"));
	}
	assert.equal(
		await createPasswordReset(bucket, "user-123", "alex@example.com"),
		null,
		"Issuance is capped per user per window",
	);
	assert.ok(
		await createPasswordReset(bucket, "user-456", "sam@example.com"),
		"Cap is per user",
	);
	console.log("testIssuanceCap: ok");
}

function resetFromEmail(msg) {
	const code = msg.text.match(/reset code is:\n(\d{6})/)?.[1];
	const token = msg.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
	assert.ok(code && token, "Reset email must include code and link");
	return { code, token };
}

function postJson(app, env, path, body, headers = {}) {
	return app.request(
		`http://localhost${path}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify(body),
		},
		env,
	);
}

async function setupHttp(envOverrides = {}) {
	const bucket = mockBucket();
	const sentEmails = [];
	const env = {
		BUCKET: bucket,
		MOBILE_JWT_SECRET: "test-secret-must-be-long-enough-for-jwt",
		EMAIL: {
			async send(msg) {
				sentEmails.push(msg);
				return { messageId: "msg-123" };
			},
		},
		MAIL_DOMAIN: "inboxies.email",
		...envOverrides,
	};

	const now = new Date().toISOString();
	await savePlatformUser(bucket, {
		id: "user-abc",
		contactEmail: "recovery@example.com",
		mailboxEmail: "alex@inboxies.email",
		passwordHash: await hashPassword("OldPassword123!"),
		linkedSubs: [],
		createdAt: now,
		updatedAt: now,
	});
	await savePlatformUser(bucket, {
		id: "user-other",
		contactEmail: "sam@example.com",
		mailboxEmail: "sam@inboxies.email",
		passwordHash: await hashPassword("SamPassword123!"),
		linkedSubs: [],
		createdAt: now,
		updatedAt: now,
	});

	const app = new Hono();
	registerAdminAndInviteRoutes(app);

	const forgot = async (email) => {
		sentEmails.length = 0;
		const res = await postJson(app, env, "/api/v1/auth/password/forgot", { email });
		assert.equal(res.status, 200);
		assert.equal((await res.json()).ok, true);
		return sentEmails.length ? resetFromEmail(sentEmails[0]) : null;
	};
	const reset = (body, headers) =>
		postJson(app, env, "/api/v1/auth/password/reset", body, headers);

	return { app, env, bucket, sentEmails, forgot, reset };
}

async function testPasswordResetHttpRoutes() {
	const { app, env, bucket, sentEmails, forgot, reset } = await setupHttp();

	// 1. Forgot password request for non-existent user returns ok (prevents enumeration)
	assert.equal(await forgot("doesnotexist@example.com"), null);

	// 2. Forgot password request for existing user sends email
	const { code } = await forgot("alex@inboxies.email");
	assert.equal(sentEmails.length, 2);
	const recipients = sentEmails.map((m) => m.to);
	assert.ok(recipients.includes("recovery@example.com"));
	assert.ok(recipients.includes("alex@inboxies.email"));
	assert.match(sentEmails[0].subject, /Reset your Inboxies password/);

	// 3. Reset with weak password fails (< 10 chars)
	const weakRes = await reset({ email: "alex@inboxies.email", code, newPassword: "short" });
	assert.equal(weakRes.status, 400);

	// 4. Code without the account identifier is rejected
	const noEmailRes = await reset({ code, newPassword: "NewValidPassword456!" });
	assert.equal(noEmailRes.status, 400);

	// 5. Correct code under another (or unknown) account is rejected
	for (const email of ["sam@inboxies.email", "nobody@inboxies.email"]) {
		const wrongIdRes = await reset({ email, code, newPassword: "NewValidPassword456!" });
		assert.equal(wrongIdRes.status, 400, `code must not work for ${email}`);
	}

	// 6. Reset with invalid code fails
	const invalidRes = await reset({
		email: "alex@inboxies.email",
		code: code === "000000" ? "000001" : "000000",
		newPassword: "NewValidPassword456!",
	});
	assert.equal(invalidRes.status, 400);

	// 7. Reset with valid code + any of the account's login emails succeeds
	const resetRes = await reset({
		email: "Recovery@Example.com",
		code,
		newPassword: "NewValidPassword456!",
	});
	assert.equal(resetRes.status, 200);
	const resetJson = await resetRes.json();
	assert.equal(resetJson.ok, true);
	assert.ok(resetJson.token, "Must return session token");

	// 8. Code is now consumed, second attempt fails
	const reuseRes = await reset({
		email: "alex@inboxies.email",
		code,
		newPassword: "AnotherPassword789!",
	});
	assert.equal(reuseRes.status, 400);

	// 9. Verify updated user can sign in with new password
	const updatedUser = await loadPlatformUser(bucket, "user-abc");
	assert.ok(updatedUser);
	const isOldValid = await verifyPassword("OldPassword123!", updatedUser.passwordHash);
	const isNewValid = await verifyPassword("NewValidPassword456!", updatedUser.passwordHash);
	assert.equal(isOldValid, false, "Old password must not work");
	assert.equal(isNewValid, true, "New password must work");

	// 10. Test password login route with new password
	const loginRes = await postJson(app, env, "/api/v1/auth/password", {
		email: "alex@inboxies.email",
		password: "NewValidPassword456!",
	});
	assert.equal(loginRes.status, 200);
	const loginJson = await loginRes.json();
	assert.ok(loginJson.token, "Login should succeed with new password");

	// 11. Other users are untouched
	const sam = await loadPlatformUser(bucket, "user-other");
	assert.equal(await verifyPassword("SamPassword123!", sam.passwordHash), true);

	console.log("testPasswordResetHttpRoutes: ok");
}

async function testHttpAttemptLimitAndTokenPath() {
	const { reset, forgot, bucket } = await setupHttp();
	const { code, token } = await forgot("alex@inboxies.email");
	const bad = code === "000000" ? "000001" : "000000";

	for (let i = 0; i < PASSWORD_RESET_MAX_CODE_ATTEMPTS; i++) {
		const res = await reset({ email: "alex@inboxies.email", code: bad, newPassword: "NewValidPassword456!" });
		assert.equal(res.status, 400);
	}
	const lockedRes = await reset({
		email: "alex@inboxies.email",
		code,
		newPassword: "NewValidPassword456!",
	});
	assert.equal(lockedRes.status, 400, "Correct code is rejected after the attempt cap");

	// Token (link) path is unchanged: no email needed, still valid after the code locks.
	const tokenRes = await reset({ token, newPassword: "LinkPassword456!" });
	assert.equal(tokenRes.status, 200);
	const tokenJson = await tokenRes.json();
	assert.equal(tokenJson.ok, true);
	assert.ok(tokenJson.token, "Token reset must return session token");
	const user = await loadPlatformUser(bucket, "user-abc");
	assert.equal(await verifyPassword("LinkPassword456!", user.passwordHash), true);

	const reuseRes = await reset({ token, newPassword: "AnotherPassword789!" });
	assert.equal(reuseRes.status, 400, "Token is single-use");

	console.log("testHttpAttemptLimitAndTokenPath: ok");
}

async function testHttpPerIpRateLimit() {
	const seenKeys = [];
	let calls = 0;
	const { reset, forgot } = await setupHttp({
		PASSWORD_RESET_LIMITER: {
			async limit({ key }) {
				seenKeys.push(key);
				return { success: ++calls <= 2 };
			},
		},
	});
	const { code, token } = await forgot("alex@inboxies.email");
	const headers = { "CF-Connecting-IP": "203.0.113.7" };
	const bad = code === "000000" ? "000001" : "000000";

	for (let i = 0; i < 2; i++) {
		const res = await reset({ email: "alex@inboxies.email", code: bad, newPassword: "NewValidPassword456!" }, headers);
		assert.equal(res.status, 400);
	}
	const limited = await reset({ email: "alex@inboxies.email", code, newPassword: "NewValidPassword456!" }, headers);
	assert.equal(limited.status, 429, "Per-IP limit blocks further code guesses");
	assert.ok(seenKeys.every((k) => k.endsWith("203.0.113.7")), "Limiter is keyed by client IP");

	// Token path is not subject to the code-guess limiter.
	const tokenRes = await reset({ token, newPassword: "LinkPassword456!" }, headers);
	assert.equal(tokenRes.status, 200);
	assert.equal(calls, 3);

	console.log("testHttpPerIpRateLimit: ok");
}

async function main() {
	assert.equal(isPublicAuthPath("/api/v1/auth/password/forgot"), true, "forgot endpoint must bypass auth");
	assert.equal(isPublicAuthPath("/api/v1/auth/password/reset"), true, "reset endpoint must bypass auth");
	assert.equal(isPublicAuthPath("/reset-password"), true, "reset-password SPA path must bypass auth");
	assert.equal(isPublicAuthPath("/reset-password/sub"), true, "reset-password subpaths must bypass auth");

	await testPasswordResetDirect();
	await testCodeAttemptLimit();
	await testIssuanceCap();
	await testPasswordResetHttpRoutes();
	await testHttpAttemptLimitAndTokenPath();
	await testHttpPerIpRateLimit();
	console.log("All password reset tests passed!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
