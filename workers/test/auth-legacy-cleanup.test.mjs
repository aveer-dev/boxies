/**
 * Legacy R2 identity records (contact/recovery emails, password hashes,
 * sign-in links, invites) after the AUTH_DB migration: account deletion
 * removes the user's own records, and the bulk cleanup deletes the rest only
 * once every legacy user is in AUTH_DB.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-legacy-cleanup.test.mjs
 */

import assert from "node:assert/strict";
import { cleanupLegacyIdentity, LEGACY_IDENTITY_PREFIXES, migrateAuthFromR2 } from "../auth/migrate.ts";
import { hashPassword } from "../lib/password-auth.ts";
import { deleteUserAccount } from "../routes/account.ts";
import { createAuthTestEnv, mockBucket } from "./auth-fixtures.mjs";

const legacy = {
	// Ada: password login + Apple, joined in one identity account.
	"platform/identity/passwords/pu-ada.json": {
		id: "pu-ada",
		contactEmail: "ada@gmail.com",
		mailboxEmail: "ada@inboxies.email",
		recoveryEmail: "ada.backup@example.com",
		passwordHash: await hashPassword("ada password 123"),
		linkedSubs: ["apple.ada.linked"],
	},
	"platform/identity/accounts/acct-ada.json": {
		id: "acct-ada",
		principals: ["email:ada@inboxies.email", "user:pu-ada", "sub:apple.ada"],
		providers: { "apple.ada": "apple" },
	},
	"platform/identity-links/by-sub/apple.ada.json": { sub: "apple.ada", provider: "apple", emails: ["ada@icloud.com"], accountId: "acct-ada" },
	"platform/identity-links/by-sub/apple.ada.linked.json": { sub: "apple.ada.linked", provider: "apple", emails: [] },
	// Bob: password user that never joined an account.
	"platform/users/pu-bob.json": {
		id: "pu-bob",
		contactEmail: "bob@gmail.com",
		recoveryEmail: "bob.backup@example.com",
		passwordHash: await hashPassword("bob password 123"),
	},
	"platform/invites/tok-1.json": {
		token: "tok-1",
		mailboxId: "team@inboxies.email",
		role: "member",
		inviteeEmail: "carol@example.com",
		expiresAt: "2020-01-01T00:00:00Z",
		status: "pending",
	},
	// Not identity data: the live domain registry and mailbox settings.
	"platform/domains/inboxies.email.json": { domain: "inboxies.email", status: "active" },
	"mailboxes/bob@inboxies.email.json": { fromName: "Bob" },
};

const bucket = mockBucket(legacy);
const { env, d1 } = createAuthTestEnv({ BUCKET: bucket });
const has = (key) => bucket.store.has(key);
const legacyKeys = () => [...bucket.store.keys()].filter((k) => LEGACY_IDENTITY_PREFIXES.some((p) => k.startsWith(p)));

// ── Cleanup refuses before the migration has run ────────────────
{
	const early = await cleanupLegacyIdentity(bucket, d1, { dryRun: false });
	assert.deepEqual(early.unmigratedUserIds, ["acct-ada", "pu-bob"]);
	assert.equal(early.deleted, false);
	assert.equal(legacyKeys().length, 6, "nothing deleted");
}

await migrateAuthFromR2(bucket, d1, { dryRun: false });
const users = async () => (await d1.prepare("select id from user order by id").all()).results.map((r) => r.id);
assert.deepEqual(await users(), ["acct-ada", "pu-bob"]);

// ── Account deletion removes the user's legacy records ──────────
{
	await deleteUserAccount(env, "acct-ada");
	for (const key of [
		"platform/identity/accounts/acct-ada.json",
		"platform/identity/passwords/pu-ada.json",
		"platform/identity-links/by-sub/apple.ada.json",
		"platform/identity-links/by-sub/apple.ada.linked.json",
	]) {
		assert.equal(has(key), false, `${key} deleted with the account`);
	}
	assert.ok(has("platform/users/pu-bob.json"), "other users' records stay");
	const audit = await d1.prepare("select detail from audit_log where action = 'user.delete' and target = 'acct-ada'").first("detail");
	assert.equal(JSON.parse(audit).legacyIdentityRecords, 4);
}

// ── Bulk cleanup: blocked by an unmigrated user, then deletes ───
{
	await bucket.put("platform/users/pu-late.json", JSON.stringify({ id: "pu-late", contactEmail: "late@example.com", passwordHash: "x" }));
	const blocked = await cleanupLegacyIdentity(bucket, d1, { dryRun: false });
	assert.deepEqual(blocked.unmigratedUserIds, ["pu-late"], "deleted ada counts as migrated; the newcomer does not");
	assert.equal(blocked.deleted, false);
	assert.ok(has("platform/users/pu-late.json"));
	await bucket.delete("platform/users/pu-late.json");

	const dry = await cleanupLegacyIdentity(bucket, d1, { dryRun: true });
	assert.deepEqual(dry.unmigratedUserIds, []);
	assert.equal(dry.keys, 2, "bob's password record and the old invite");
	assert.equal(dry.deleted, false);
	assert.equal(legacyKeys().length, 2);

	const real = await cleanupLegacyIdentity(bucket, d1, { dryRun: false });
	assert.equal(real.deleted, true);
	assert.deepEqual(legacyKeys(), [], "no legacy identity records left");
	assert.ok(has("platform/domains/inboxies.email.json"), "domain registry untouched");
	assert.ok(has("mailboxes/bob@inboxies.email.json"), "mailbox settings untouched");
	assert.deepEqual(await users(), ["pu-bob"], "AUTH_DB untouched");
}

console.log("auth-legacy-cleanup: ok");
