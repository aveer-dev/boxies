/**
 * Identity links: Apple/Google sub ↔ Domain Admin / ACL emails.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/identity-links.test.mjs
 */

import assert from "node:assert/strict";
import {
	autoLinkSubIfAdminEmail,
	createIdentityLinkCode,
	expandPrincipalWithLinks,
	identityLinkCodeIsActive,
	ownerKeysForAssign,
	parseIdentityLink,
	resolveAdminLinkEmails,
	upsertIdentityLink,
} from "../lib/identity-links.ts";
import {
	aclFromOwnerKeys,
	canAccessMailbox,
	filterMailboxesForPrincipal,
	principalFromClaims,
	principalKeys,
} from "../lib/mailbox-acl.ts";
import { principalIsDomainAdmin, parseDomainAdminsEnv } from "../lib/domain-admin.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";

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
		async list({ prefix = "" } = {}) {
			return {
				objects: [...store.keys()]
					.filter((key) => key.startsWith(prefix))
					.map((key) => ({ key })),
			};
		},
		async delete(key) {
			store.delete(key);
		},
	};
}

// ── principalKeys includes linkedEmails ───────────────────────────

{
	const p = principalFromClaims({
		email: "relay@privaterelay.appleid.com",
		sub: "apple.sub.1",
	});
	p.linkedEmails = ["admin@example.com"];
	const keys = principalKeys(p);
	assert.ok(keys.includes("email:relay@privaterelay.appleid.com"));
	assert.ok(keys.includes("email:admin@example.com"));
	assert.ok(keys.includes("sub:apple.sub.1"));
}

// ── expand + Domain Admin match via link ──────────────────────────

{
	const bucket = mockBucket();
	await upsertIdentityLink(bucket, {
		sub: "apple.sub.2",
		provider: "apple",
		emails: ["admin@example.com"],
		linkedByKeys: ["test"],
	});
	const appleOnly = principalFromClaims({ sub: "apple.sub.2" });
	const expanded = await expandPrincipalWithLinks(bucket, appleOnly);
	assert.equal(expanded.email, "admin@example.com");
	assert.deepEqual(expanded.linkedEmails, ["admin@example.com"]);

	const allow = new Set(parseDomainAdminsEnv("admin@example.com"));
	assert.equal(principalIsDomainAdmin(appleOnly, allow), false);
	assert.equal(principalIsDomainAdmin(expanded, allow), true);
}

// ── list-as-admin / ACL: Access-owned mailbox visible after Apple expand ─

{
	const bucket = mockBucket({
		[mailboxMetadataKey("ops@inboxies.email")]: {
			fromName: "Ops",
			acl: {
				owners: ["email:admin@example.com"],
				members: [],
			},
		},
	});
	await upsertIdentityLink(bucket, {
		sub: "apple.sub.3",
		provider: "apple",
		emails: ["admin@example.com"],
	});
	const apple = await expandPrincipalWithLinks(
		bucket,
		principalFromClaims({ sub: "apple.sub.3" }),
	);
	assert.equal(
		canAccessMailbox(
			{
				acl: {
					owners: ["email:admin@example.com"],
					members: [],
				},
			},
			apple,
			"ops@inboxies.email",
		),
		true,
	);
	const listed = await filterMailboxesForPrincipal(
		bucket,
		[{ id: "ops@inboxies.email", email: "ops@inboxies.email" }],
		apple,
	);
	assert.deepEqual(
		listed.map((m) => m.id),
		["ops@inboxies.email"],
	);
}

// ── assign-to-me identity: reverse-linked Apple sub stamped on owners ─

{
	const bucket = mockBucket();
	await upsertIdentityLink(bucket, {
		sub: "apple.sub.4",
		provider: "apple",
		emails: ["admin@example.com"],
	});
	const access = principalFromClaims({
		email: "admin@example.com",
		sub: "access-sub",
	});
	const keys = await ownerKeysForAssign(bucket, access);
	assert.ok(keys.includes("email:admin@example.com"));
	assert.ok(keys.includes("sub:access-sub"));
	assert.ok(keys.includes("sub:apple.sub.4"));
	const acl = aclFromOwnerKeys(keys);
	assert.ok(acl.owners.includes("sub:apple.sub.4"));
}

// ── auto-link only when email is Domain Admin ─────────────────────

{
	const bucket = mockBucket();
	const env = { DOMAIN_ADMINS: "admin@example.com", BUCKET: bucket };
	const linked = await autoLinkSubIfAdminEmail(env, {
		sub: "apple.sub.5",
		email: "admin@example.com",
		provider: "apple",
	});
	assert.ok(linked);
	assert.deepEqual(linked.emails, ["admin@example.com"]);

	const skipped = await autoLinkSubIfAdminEmail(env, {
		sub: "apple.sub.6",
		email: "stranger@example.com",
		provider: "apple",
	});
	assert.equal(skipped, null);

	const noEmail = await autoLinkSubIfAdminEmail(env, {
		sub: "apple.sub.7",
		provider: "apple",
	});
	assert.equal(noEmail, null);
}

// ── link code lifecycle ───────────────────────────────────────────

{
	const code = createIdentityLinkCode({
		emails: ["Admin@Example.com"],
		createdByKeys: ["email:admin@example.com"],
		nowMs: 1_000_000,
	});
	assert.equal(code.emails[0], "admin@example.com");
	assert.equal(identityLinkCodeIsActive(code, 1_000_000), true);
	assert.equal(identityLinkCodeIsActive(code, 1_000_000 + 16 * 60 * 1000), false);
	const used = { ...code, usedAt: new Date().toISOString() };
	assert.equal(identityLinkCodeIsActive(used, 1_000_000), false);
}

{
	const bucket = mockBucket();
	const admin = principalFromClaims({
		email: "admin@example.com",
		sub: "access-sub",
	});
	const emails = await resolveAdminLinkEmails(
		{ DOMAIN_ADMINS: "admin@example.com", BUCKET: bucket },
		admin,
	);
	assert.ok(emails.includes("admin@example.com"));
}

{
	const parsed = parseIdentityLink({
		sub: "x",
		provider: "apple",
		emails: ["A@B.com"],
		linkedAt: "t",
		updatedAt: "t",
		linkedByKeys: [],
	});
	assert.ok(parsed);
	assert.equal(parsed.emails[0], "a@b.com");
}

console.log("identity-links: ok");
