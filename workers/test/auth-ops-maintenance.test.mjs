/**
 * Operator routes (/ops/*, Cloudflare Access only), the hourly maintenance
 * job (workers/lib/maintenance.ts) and Sign in with Apple token revocation
 * (workers/auth/apple.ts).
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-ops-maintenance.test.mjs
 */

import assert from "node:assert/strict";
import { generateKeyPair, exportPKCS8, decodeJwt, decodeProtectedHeader } from "jose";
import { mailboxRole, isDomainAdmin } from "../auth/authz.ts";
import { revokeAppleTokens, storeAppleRefreshToken } from "../auth/apple.ts";
import { issueOtp } from "../auth/otp.ts";
import * as schema from "../auth/schema.ts";
import { runScheduledMaintenance } from "../lib/maintenance.ts";
import { setDevRuntimeForTesting } from "../lib/dev-runtime.ts";
import { getDomainMetadata } from "../lib/domain-registry.ts";
import { addDomain, addMailbox, addUser, authedRequest, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

// ── /ops: Access only ───────────────────────────────────────────
{
	const { env, db, bucket } = createAuthTestEnv();
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
	await addDomain(db, bucket, { domain: "acme.com", ownerUserId: "ada" });

	// Without Access config, /ops is closed to everyone, app sessions included.
	const session = await signIn(env, ada);
	for (const [method, path] of [["GET", "/ops/domains"], ["GET", "/ops/audit"], ["POST", "/ops/mailboxes"]]) {
		const res = await authedRequest(env, { method, path, token: session.token, body: method === "POST" ? {} : undefined });
		assert.equal(res.status, 403, `${path} needs Access`);
	}
	const forged = await authedRequest(env, {
		path: "/ops/domains",
		headers: { "cf-access-jwt-assertion": "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6Im9wc0BleC5jb20ifQ.c2ln" },
	});
	assert.equal(forged.status, 403);
	const configured = { ...env, POLICY_AUD: "aud", TEAM_DOMAIN: "https://team.cloudflareaccess.com" };
	const badJwt = await authedRequest(configured, {
		path: "/ops/domains",
		headers: { "cf-access-jwt-assertion": "not.a.jwt" },
	});
	assert.equal(badJwt.status, 403);

	// An Access JWT is not an app login anywhere else.
	const accessOnApi = await authedRequest(configured, {
		path: "/api/v1/mailboxes",
		headers: { "cf-access-jwt-assertion": "anything" },
	});
	assert.equal(accessOnApi.status, 401);
}

// ── Maintenance ─────────────────────────────────────────────────
{
	setDevRuntimeForTesting(true); // mock Cloudflare zones (no CF credentials)
	const { env, d1, db, bucket, mailboxes } = createAuthTestEnv();
	const now = new Date();
	const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });

	// Pending domains: one whose zone went active, one stale claim with no
	// mailboxes, one stale claim with mailboxes (left for an operator).
	await addDomain(db, bucket, { domain: "live.com", ownerUserId: "ada", status: "pending" });
	await addDomain(db, bucket, { domain: "stale.com", ownerUserId: "ada", status: "pending", meta: { zoneId: "mock-zone-stale-com" } });
	await addDomain(db, bucket, { domain: "busy.com", ownerUserId: "ada", status: "pending", meta: { zoneId: "mock-zone-busy-com" } });
	await addMailbox(db, bucket, "team@busy.com", { owners: ["ada"] });
	await d1.prepare("update domain set created_at = ? where domain in ('stale.com', 'busy.com')").bind(old.getTime()).run();
	// The mock Cloudflare client reports unknown zones as active and created ones as pending.
	const { createZone } = await import("../lib/cloudflare-client.ts");
	await createZone(env, "stale.com");
	await createZone(env, "busy.com");

	// Sessions: one expired with a push token, one live.
	await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
	const expired = await signIn(env, ada);
	const live = await signIn(env, ada);
	await d1.prepare("update session set expires_at = ? where id = ?").bind(old.getTime(), expired.sessionId).run();
	await mailboxes.get("ada@inboxies.email").registerDeviceToken("old-phone", "ios", ["user:ada", `session:${expired.sessionId}`]);
	await mailboxes.get("ada@inboxies.email").registerDeviceToken("new-phone", "ios", ["user:ada", `session:${live.sessionId}`]);

	// Codes: one expired.
	await issueOtp(db, "recovery-email", "ada", "a@gmail.com", old.getTime());

	// Exports: one expired, one current.
	const job = (id, expiresAt) => ({ id, targetType: "mailbox", targetId: "ada@inboxies.email", status: "completed", progress: 100, totalEmails: 1, processedEmails: 1, downloadKey: `exports/data/${id}.mbox`, createdAt: old.toISOString(), expiresAt });
	await bucket.put("exports/jobs/exp_old.json", JSON.stringify(job("exp_old", old.toISOString())));
	await bucket.put("exports/data/exp_old.mbox", "From x");
	await bucket.put("exports/jobs/exp_new.json", JSON.stringify(job("exp_new", new Date(now.getTime() + 86400000).toISOString())));

	const report = await runScheduledMaintenance(env, now);
	assert.deepEqual(report.errors, []);
	assert.deepEqual(report.domainsActivated, ["live.com"]);
	assert.deepEqual(report.claimsReleased, ["stale.com"]);
	assert.deepEqual(report.staleClaims, ["busy.com"]);
	assert.equal(await isDomainAdmin(db, "ada", "live.com"), true);
	assert.equal((await getDomainMetadata(bucket, "live.com")).status, "active");
	assert.equal(await d1.prepare("select count(*) as n from domain where domain = 'stale.com'").first("n"), 0);
	assert.equal(await getDomainMetadata(bucket, "stale.com"), null, "a released claim can be claimed again");
	assert.equal(await mailboxRole(db, "ada", "team@busy.com"), "owner", "claims with mailboxes are never purged automatically");

	assert.equal(report.sessionsDeleted, 1);
	assert.equal(await d1.prepare("select count(*) as n from session where user_id = 'ada'").first("n"), 1);
	assert.deepEqual([...mailboxes.deviceTokens.get("ada@inboxies.email").keys()], ["new-phone"], "an expired session's push token goes too");
	assert.equal(await d1.prepare("select count(*) as n from verification").first("n"), 0);

	assert.equal(report.exportsDeleted, 1);
	assert.equal(bucket.store.has("exports/jobs/exp_old.json"), false);
	assert.equal(bucket.store.has("exports/data/exp_old.mbox"), false);
	assert.equal(bucket.store.has("exports/jobs/exp_new.json"), true);
	setDevRuntimeForTesting(undefined);
}

// ── Apple: code exchange stores the refresh token; deletion revokes it ──
{
	const { env, db } = createAuthTestEnv();
	const { privateKey } = await generateKeyPair("ES256", { extractable: true });
	const appleEnv = {
		...env,
		APPLE_CLIENT_ID: "co.inboxies.app",
		APPLE_TEAM_ID: "TEAM123456",
		APPLE_SIGNIN_KEY_ID: "KEY1234567",
		APPLE_SIGNIN_PRIVATE_KEY: await exportPKCS8(privateKey),
	};
	const ada = await addUser(db, { id: "ada", email: "ada@icloud.com" });
	await db.insert(schema.account).values({ id: "apple_1", accountId: "000123.abc.0001", providerId: "apple", userId: ada.id });

	const calls = [];
	const fakeFetch = async (url, init) => {
		const body = new URLSearchParams(init.body);
		calls.push({ url, body });
		if (url.endsWith("/auth/token")) return new Response(JSON.stringify({ refresh_token: "apple-refresh-1" }), { status: 200 });
		return new Response("", { status: 200 });
	};

	assert.equal(await storeAppleRefreshToken(appleEnv, db, { userId: ada.id, authorizationCode: "code-1" }, fakeFetch), true);
	const exchange = calls[0];
	assert.equal(exchange.url, "https://appleid.apple.com/auth/token");
	assert.equal(exchange.body.get("code"), "code-1");
	assert.equal(exchange.body.get("client_id"), "co.inboxies.app");
	const secret = exchange.body.get("client_secret");
	assert.deepEqual(
		{ alg: decodeProtectedHeader(secret).alg, kid: decodeProtectedHeader(secret).kid },
		{ alg: "ES256", kid: "KEY1234567" },
	);
	assert.deepEqual(
		{ iss: decodeJwt(secret).iss, sub: decodeJwt(secret).sub, aud: decodeJwt(secret).aud },
		{ iss: "TEAM123456", sub: "co.inboxies.app", aud: "https://appleid.apple.com" },
	);

	assert.equal(await revokeAppleTokens(appleEnv, db, ada.id, fakeFetch), 1);
	const revoke = calls[1];
	assert.equal(revoke.url, "https://appleid.apple.com/auth/revoke");
	assert.equal(revoke.body.get("token"), "apple-refresh-1");
	assert.equal(revoke.body.get("token_type_hint"), "refresh_token");

	// Without a key configured nothing is sent (and sign-in isn't blocked).
	assert.equal(await storeAppleRefreshToken(env, db, { userId: ada.id, authorizationCode: "c" }, fakeFetch), false);
	assert.equal(calls.length, 2);
}

console.log("auth-ops-maintenance: ok");
