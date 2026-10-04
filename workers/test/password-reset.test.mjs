/**
 * Password reset: token/code generation, R2 persistence, expiry, forgot-password email, and reset auth.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/password-reset.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import {
	createPasswordReset,
	verifyPasswordReset,
	consumePasswordReset,
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

function mockBucket(initial = {}) {
	const store = new Map(
		Object.entries(initial).map(([key, value]) => [
			key,
			typeof value === "string" ? value : JSON.stringify(value),
		]),
	);
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { json: async () => JSON.parse(text) };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async delete(key) {
			store.delete(key);
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

async function testPasswordResetDirect() {
	const bucket = mockBucket();
	const reset = await createPasswordReset(bucket, "user-123", "alex@example.com");

	assert.ok(reset.token.length >= 20, "Token should be random string");
	assert.match(reset.code, /^\d{6}$/, "Code should be 6 digits");

	// Verify by token
	const byToken = await verifyPasswordReset(bucket, { token: reset.token });
	assert.ok(byToken, "Should find record by token");
	assert.equal(byToken.userId, "user-123");

	// Verify by code
	const byCode = await verifyPasswordReset(bucket, { code: reset.code });
	assert.ok(byCode, "Should find record by code");
	assert.equal(byCode.userId, "user-123");

	// Consume
	await consumePasswordReset(bucket, reset);
	const afterToken = await verifyPasswordReset(bucket, { token: reset.token });
	const afterCode = await verifyPasswordReset(bucket, { code: reset.code });
	assert.equal(afterToken, null, "Token should be consumed");
	assert.equal(afterCode, null, "Code should be consumed");

	console.log("testPasswordResetDirect: ok");
}

async function testPasswordResetHttpRoutes() {
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
	};

	// Create an existing user
	const initialHash = await hashPassword("OldPassword123!");
	const user = {
		id: "user-abc",
		contactEmail: "recovery@example.com",
		mailboxEmail: "alex@inboxies.email",
		passwordHash: initialHash,
		linkedSubs: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	await savePlatformUser(bucket, user);

	const app = new Hono();
	registerAdminAndInviteRoutes(app);

	// 1. Forgot password request for non-existent user returns ok (prevents enumeration)
	const notFoundRes = await app.request(
		"http://localhost/api/v1/auth/password/forgot",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "doesnotexist@example.com" }),
		},
		env,
	);
	assert.equal(notFoundRes.status, 200);
	const notFoundJson = await notFoundRes.json();
	assert.equal(notFoundJson.ok, true);

	// 2. Forgot password request for existing user sends email
	const forgotRes = await app.request(
		"http://localhost/api/v1/auth/password/forgot",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "alex@inboxies.email" }),
		},
		env,
	);
	assert.equal(forgotRes.status, 200);
	const forgotJson = await forgotRes.json();
	assert.equal(sentEmails.length, 2);
	const recipients = sentEmails.map((m) => m.to);
	assert.ok(recipients.includes("recovery@example.com"));
	assert.ok(recipients.includes("alex@inboxies.email"));
	assert.match(sentEmails[0].subject, /Reset your Inboxies password/);

	// Find the generated reset code from bucket
	let code = "";
	let token = "";
	for (const [k, v] of bucket.store.entries()) {
		if (k.startsWith("platform/password-resets/codes/")) {
			const rec = JSON.parse(v);
			code = rec.code;
			token = rec.token;
			break;
		}
	}
	assert.ok(code, "Reset code must be stored in R2");

	// 3. Reset with weak password fails (< 10 chars)
	const weakRes = await app.request(
		"http://localhost/api/v1/auth/password/reset",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, newPassword: "short" }),
		},
		env,
	);
	assert.equal(weakRes.status, 400);

	// 4. Reset with invalid code fails
	const invalidRes = await app.request(
		"http://localhost/api/v1/auth/password/reset",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: "000000", newPassword: "NewValidPassword456!" }),
		},
		env,
	);
	assert.equal(invalidRes.status, 400);

	// 5. Reset with valid code succeeds and updates user's password
	const resetRes = await app.request(
		"http://localhost/api/v1/auth/password/reset",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, newPassword: "NewValidPassword456!" }),
		},
		env,
	);
	assert.equal(resetRes.status, 200);
	const resetJson = await resetRes.json();
	assert.equal(resetJson.ok, true);
	assert.ok(resetJson.token, "Must return session token");

	// 6. Code is now consumed, second attempt fails
	const reuseRes = await app.request(
		"http://localhost/api/v1/auth/password/reset",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, newPassword: "AnotherPassword789!" }),
		},
		env,
	);
	assert.equal(reuseRes.status, 400);

	// 7. Verify updated user can sign in with new password
	const updatedUser = await loadPlatformUser(bucket, "user-abc");
	assert.ok(updatedUser);
	const isOldValid = await verifyPassword("OldPassword123!", updatedUser.passwordHash);
	const isNewValid = await verifyPassword("NewValidPassword456!", updatedUser.passwordHash);
	assert.equal(isOldValid, false, "Old password must not work");
	assert.equal(isNewValid, true, "New password must work");

	// 8. Test password login route with new password
	const loginRes = await app.request(
		"http://localhost/api/v1/auth/password",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "alex@inboxies.email", password: "NewValidPassword456!" }),
		},
		env,
	);
	assert.equal(loginRes.status, 200);
	const loginJson = await loginRes.json();
	assert.ok(loginJson.token, "Login should succeed with new password");

	console.log("testPasswordResetHttpRoutes: ok");
}

async function main() {
	assert.equal(isPublicAuthPath("/api/v1/auth/password/forgot"), true, "forgot endpoint must bypass auth");
	assert.equal(isPublicAuthPath("/api/v1/auth/password/reset"), true, "reset endpoint must bypass auth");
	assert.equal(isPublicAuthPath("/reset-password"), true, "reset-password SPA path must bypass auth");
	assert.equal(isPublicAuthPath("/reset-password/sub"), true, "reset-password subpaths must bypass auth");

	await testPasswordResetDirect();
	await testPasswordResetHttpRoutes();
	console.log("All password reset tests passed!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
