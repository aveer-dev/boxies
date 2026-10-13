/**
 * R2 → AUTH_DB migration (workers/auth/migrate.ts) on fixtures covering every
 * legacy key kind, the cases that must be reported instead of guessed, dry
 * runs, re-runs, and sign-in with a migrated password.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-migrate.test.mjs
 */

import assert from "node:assert/strict";
import { authDb, isDomainAdmin, listMailboxesForUser, mailboxRole } from "../auth/authz.ts";
import { createAuth } from "../auth/index.ts";
import { migrateAuthFromR2 } from "../auth/migrate.ts";
import { hashPassword } from "../lib/password-auth.ts";
import { createTestD1 } from "./d1-shim.mjs";

const NOW = new Date("2026-10-13T12:00:00Z");

/** R2 stand-in whose list() pages two objects at a time, to exercise cursors. */
function pagedBucket(entries) {
	const store = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
	return {
		async get(key) {
			return store.has(key) ? { json: async () => JSON.parse(store.get(key)) } : null;
		},
		async list({ prefix = "", cursor } = {}) {
			const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const objects = keys.slice(start, start + 2).map((key) => ({ key }));
			const next = start + 2;
			return next < keys.length
				? { objects, truncated: true, cursor: String(next) }
				: { objects, truncated: false };
		},
	};
}

const adaHash = await hashPassword("ada password 123");
const bucket = pagedBucket({
	// Ada: password login on her mailbox + Apple, joined in one identity account.
	"platform/identity/passwords/pu-ada.json": {
		id: "pu-ada",
		contactEmail: "ada@gmail.com",
		mailboxEmail: "ada@inboxies.email",
		passwordHash: adaHash,
		linkedSubs: [],
	},
	"platform/identity/accounts/acct-ada.json": {
		id: "acct-ada",
		principals: ["email:ada@inboxies.email", "user:pu-ada", "sub:user:pu-ada", "sub:apple.ada"],
		providers: { "apple.ada": "apple" },
		primaryEmail: "ada@inboxies.email",
	},
	// Bob: invited member, logs in with his contact email (never verified).
	"platform/users/pu-bob.json": {
		id: "pu-bob",
		contactEmail: "bob@gmail.com",
		passwordHash: await hashPassword("bob password 123"),
		linkedSubs: [],
	},
	// Ops: Access-only account; Access stops being a user login.
	"platform/identity-accounts/acct-ops.json": {
		id: "acct-ops",
		principals: ["email:ops@acme.com", "sub:access-ops"],
		providers: { "access-ops": "access" },
		primaryEmail: "ops@acme.com",
	},
	// Legacy Google link with no account.
	"platform/identity-links/by-sub/google.carol.json": {
		sub: "google.carol",
		provider: "google",
		emails: ["carol@gmail.com"],
	},
	// Mallory claimed bob@gmail.com as an unverified contact too.
	"platform/identity/passwords/pu-mallory.json": {
		id: "pu-mallory",
		contactEmail: "bob@gmail.com",
		passwordHash: await hashPassword("mallory password 1"),
		linkedSubs: [],
	},

	"mailboxes/ada@inboxies.email.json": { acl: { owners: ["account:acct-ada"], members: [] } },
	"mailboxes/team@acme.com.json": {
		acl: {
			owners: ["user:pu-ada"],
			members: ["sub:user:pu-bob", "sub:google.carol", "email:ops@acme.com"],
		},
	},
	// Never claimed: the login for this address owns it, as the old auto-claim did.
	"mailboxes/solo@inboxies.email.json": { fromName: "Solo" },
	"platform/identity/passwords/pu-solo.json": {
		id: "pu-solo",
		mailboxEmail: "solo@inboxies.email",
		contactEmail: "solo@inboxies.email",
		passwordHash: await hashPassword("solo password 12"),
		linkedSubs: [],
	},
	// An email key alone never grants anything.
	"mailboxes/orphan@inboxies.email.json": { acl: { owners: ["email:someone@else.com"], members: [] } },

	"platform/domains/acme.com.json": {
		domain: "acme.com",
		ownerUserId: "pu-ada",
		adminUserIds: ["pu-ada", "pu-bob", "ops@acme.com", null],
		status: "active",
		createdAt: "2026-09-01T00:00:00Z",
	},
	"platform/domains/bought.com.json": {
		domain: "bought.com",
		ownerUserId: "registrar_owner",
		adminUserIds: ["registrar_owner"],
		status: "pending_nameservers",
	},

	"platform/invites/tok-live.json": {
		token: "tok-live",
		mailboxId: "team@acme.com",
		role: "member",
		inviteeEmail: "dave@gmail.com",
		createdByKeys: ["account:acct-ada"],
		createdAt: "2026-10-10T00:00:00Z",
		expiresAt: "2026-10-20T00:00:00Z",
		status: "pending",
	},
	"platform/invites/tok-old.json": {
		token: "tok-old",
		mailboxId: "team@acme.com",
		role: "member",
		inviteeEmail: "erin@gmail.com",
		createdByKeys: [],
		createdAt: "2026-09-01T00:00:00Z",
		expiresAt: "2026-09-15T00:00:00Z",
		status: "pending",
	},
	"platform/invites-by-mailbox/team@acme.com/tok-live.json": { token: "tok-live" },
});

const d1 = createTestD1();
const count = (table) => d1.prepare(`select count(*) as n from ${table}`).first("n");
const row = async (sql) => ({ ...(await d1.prepare(sql).first()) });

// ── Dry run reports and writes nothing ────────────────────────────
const dry = await migrateAuthFromR2(bucket, d1, { dryRun: true, now: NOW });
assert.equal(dry.dryRun, true);
assert.equal(await count("user"), 0);
assert.equal(dry.counts.users, 6, "ada, ops, bob, mallory, solo, carol");
assert.equal(dry.counts.credentialAccounts, 4, "ada, bob, mallory, solo");
assert.equal(dry.counts.providerAccounts, 2, "apple.ada, google.carol");
assert.equal(dry.counts.mailboxes, 4);
assert.equal(dry.counts.domains, 2);
assert.equal(dry.counts.invites, 1, "expired invites are not copied");

const kinds = (kind) => dry.issues.filter((i) => i.kind === kind).map((i) => i.detail).join("\n");
assert.match(kinds("sign-in dropped"), /access sign-in access-ops/);
assert.match(kinds("email conflict"), /bob@gmail\.com/);
assert.match(kinds("unresolved access"), /email:ops@acme\.com/, "Access emails don't silently keep mailbox access");
assert.match(kinds("orphaned mailbox"), /orphan@inboxies\.email/);
assert.match(kinds("domain without owner"), /bought\.com: owner registrar_owner/);
assert.match(kinds("unresolved domain admin"), /ops@acme\.com/);

// ── Real run ──────────────────────────────────────────────────────
const real = await migrateAuthFromR2(bucket, d1, { dryRun: false, now: NOW });
assert.deepEqual(real.counts, dry.counts);
assert.equal(await count("user"), 6);

const db = authDb(d1);
assert.deepEqual(await listMailboxesForUser(db, "acct-ada"), [
	{ mailboxId: "ada@inboxies.email", role: "owner" },
	{ mailboxId: "team@acme.com", role: "owner" },
]);
assert.equal(await mailboxRole(db, "pu-bob", "team@acme.com"), "member");
assert.equal(await mailboxRole(db, "legacy_google_google.carol", "team@acme.com"), "member");
assert.equal(await mailboxRole(db, "acct-ops", "team@acme.com"), null);
assert.equal(await mailboxRole(db, "pu-solo", "solo@inboxies.email"), "owner");
assert.equal(await count("mailbox_member where mailbox_id = 'orphan@inboxies.email'"), 0);

assert.equal(await isDomainAdmin(db, "acct-ada", "acme.com"), true, "owner via platform user id");
assert.equal(await isDomainAdmin(db, "pu-bob", "acme.com"), true);
assert.equal(await isDomainAdmin(db, "acct-ops", "acme.com"), false);
const bought = await row("select owner_user_id, status, verified_at from domain where domain = 'bought.com'");
assert.deepEqual(bought, { owner_user_id: null, status: "pending", verified_at: null });

const adaUser = await row("select email, email_verified from user where id = 'acct-ada'");
assert.deepEqual(adaUser, { email: "ada@inboxies.email", email_verified: 1 });
const bobUser = await row("select email, email_verified from user where id = 'pu-bob'");
assert.deepEqual(bobUser, { email: "bob@gmail.com", email_verified: 0 });
const mallory = await d1.prepare("select email from user where id = 'pu-mallory'").first("email");
assert.equal(mallory, "pu-mallory@no-email.invalid", "an email can only belong to one user");

const invite = await d1.prepare("select token_hash, created_by from invite").first();
assert.notEqual(invite.token_hash, "tok-live", "tokens are stored hashed");
assert.equal(invite.created_by, "acct-ada");

// ── Re-running changes nothing ────────────────────────────────────
await migrateAuthFromR2(bucket, d1, { dryRun: false, now: NOW });
assert.equal(await count("user"), 6);
assert.equal(await count("account"), 6);
assert.equal(await count("mailbox_member"), 5);

// ── A migrated password signs in through Better Auth ──────────────
{
	const auth = createAuth({
		AUTH_DB: d1,
		BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
		APP_BASE_URL: "https://inboxies.test",
	});
	const res = await auth.handler(
		new Request("https://inboxies.test/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json", origin: "https://inboxies.test" },
			body: JSON.stringify({ email: "ada@inboxies.email", password: "ada password 123" }),
		}),
	);
	assert.equal(res.status, 200);
	assert.equal((await res.json()).user.id, "acct-ada");
}

console.log("auth-migrate: ok");
