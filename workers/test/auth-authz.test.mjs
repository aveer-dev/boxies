/**
 * AUTH_DB permission checks (workers/auth/authz.ts) against a real SQLite
 * database with the generated migrations applied.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-authz.test.mjs
 */

import assert from "node:assert/strict";
import {
	authDb,
	authorizeMailboxAccess,
	canCreateMailbox,
	isDomainAdmin,
	listMailboxesForUser,
	mailboxRole,
} from "../auth/authz.ts";
import * as schema from "../auth/schema.ts";
import { createTestD1 } from "./d1-shim.mjs";

const d1 = createTestD1();
const db = authDb(d1);

const users = ["ada", "bob", "eve"].map((id) => ({
	id,
	name: id,
	email: `${id}@example.com`,
	emailVerified: true,
}));
await db.insert(schema.user).values(users);
await db.insert(schema.mailbox).values([
	{ id: "ada@inboxies.email", domain: "inboxies.email" },
	{ id: "team@acme.com", domain: "acme.com" },
	{ id: "gone@inboxies.email", domain: "inboxies.email", deletedAt: new Date() },
]);
await db.insert(schema.mailboxMember).values([
	{ mailboxId: "ada@inboxies.email", userId: "ada", role: "owner" },
	{ mailboxId: "team@acme.com", userId: "ada", role: "owner" },
	{ mailboxId: "team@acme.com", userId: "bob", role: "member" },
	{ mailboxId: "gone@inboxies.email", userId: "ada", role: "owner" },
]);
await db.insert(schema.domain).values([
	{ domain: "acme.com", ownerUserId: "ada", status: "active" },
	{ domain: "pending.com", ownerUserId: "eve", status: "pending" },
]);
await db.insert(schema.domainAdmin).values([{ domain: "acme.com", userId: "bob" }]);
await db.insert(schema.domain).values({ domain: "gone.com", ownerUserId: "ada", status: "decommissioned" });

// ── Roles ─────────────────────────────────────────────────────────
assert.equal(await mailboxRole(db, "ada", "team@acme.com"), "owner");
assert.equal(await mailboxRole(db, "bob", "team@acme.com"), "member");
assert.equal(await mailboxRole(db, "eve", "team@acme.com"), null);
assert.equal(await mailboxRole(db, "ada", "gone@inboxies.email"), null, "deleted mailboxes grant nothing");

{
	const ok = await authorizeMailboxAccess(db, "bob", "TEAM@acme.com");
	assert.deepEqual(ok, { ok: true, mailboxId: "team@acme.com", role: "member" });
	const notOwner = await authorizeMailboxAccess(db, "bob", "team@acme.com", "owner");
	assert.equal(notOwner.ok, false);
	const stranger = await authorizeMailboxAccess(db, "eve", "team@acme.com");
	assert.deepEqual(stranger, { ok: false, status: 403, error: "Forbidden" });
	const missing = await authorizeMailboxAccess(db, "eve", "nobody@acme.com");
	assert.deepEqual(missing, stranger, "a missing mailbox looks the same as a forbidden one");
	const anon = await authorizeMailboxAccess(db, null, "team@acme.com");
	assert.equal(anon.ok, false);
}

// Ids that could canonicalize to a different mailbox than they name are refused.
for (const trick of [
	"eve+%3Cada@inboxies.email%3E@inboxies.email",
	"eve+<ada@inboxies.email>@inboxies.email",
	"ada%40inboxies.email",
	"ada@inboxies.email@evil.com",
	"Ada <ada@inboxies.email>",
]) {
	const res = await authorizeMailboxAccess(db, "ada", trick);
	assert.equal(res.ok, false, `refused: ${trick}`);
	assert.equal(res.status, 400);
}

// ── Listing ───────────────────────────────────────────────────────
assert.deepEqual(await listMailboxesForUser(db, "ada"), [
	{ mailboxId: "ada@inboxies.email", role: "owner" },
	{ mailboxId: "team@acme.com", role: "owner" },
]);
assert.deepEqual(await listMailboxesForUser(db, "eve"), []);

// ── Domain admins ─────────────────────────────────────────────────
assert.equal(await isDomainAdmin(db, "ada", "acme.com"), true, "owner");
assert.equal(await isDomainAdmin(db, "bob", "ACME.com"), true, "listed admin");
assert.equal(await isDomainAdmin(db, "eve", "acme.com"), false);
assert.equal(await isDomainAdmin(db, "ada", "cme.com"), false, "no suffix matching");
assert.equal(await isDomainAdmin(db, "eve", "pending.com"), true, "pending domains can be managed");
assert.equal(await isDomainAdmin(db, "ada", "gone.com"), false, "decommissioned domains grant nothing");

// ── Creating mailboxes ────────────────────────────────────────────
const platformDomains = ["inboxies.email"];
{
	const ok = await canCreateMailbox(db, { userId: "eve", address: "eve@inboxies.email", platformDomains });
	assert.deepEqual(ok, { ok: true, mailboxId: "eve@inboxies.email", domain: "inboxies.email" });

	for (const reserved of ["postmaster", "Admin", "noreply", "security", "webmaster"]) {
		const res = await canCreateMailbox(db, {
			userId: "eve",
			address: `${reserved}@inboxies.email`,
			platformDomains,
		});
		assert.equal(res.ok, false, `${reserved} is reserved`);
	}

	const taken = await canCreateMailbox(db, { userId: "eve", address: "ada@inboxies.email", platformDomains });
	assert.equal(taken.status, 409);
	const tombstone = await canCreateMailbox(db, { userId: "eve", address: "gone@inboxies.email", platformDomains });
	assert.equal(tombstone.status, 409, "a deleted address isn't immediately reusable");

	const foreign = await canCreateMailbox(db, { userId: "eve", address: "ceo@acme.com", platformDomains });
	assert.equal(foreign.status, 403, "no mailboxes on someone else's domain");
	const asAdmin = await canCreateMailbox(db, { userId: "bob", address: "ceo@acme.com", platformDomains });
	assert.equal(asAdmin.ok, true);
	const byo = await canCreateMailbox(db, { userId: "eve", address: "me@pending.com", platformDomains });
	assert.equal(byo.ok, true, "a claimed bring-your-own domain is usable while its nameservers are pending");
	const notAdmin = await canCreateMailbox(db, { userId: "ada", address: "me@pending.com", platformDomains });
	assert.equal(notAdmin.status, 403);
}

// ── Integrity ─────────────────────────────────────────────────────
await assert.rejects(
	() => db.insert(schema.mailboxMember).values({ mailboxId: "ada@inboxies.email", userId: "ghost", role: "member" }),
	"memberships must reference a real user",
);
await db.delete(schema.user).where((await import("drizzle-orm")).eq(schema.user.id, "bob"));
assert.equal(await mailboxRole(db, "bob", "team@acme.com"), null, "deleting a user removes their access");
assert.equal(await isDomainAdmin(db, "bob", "acme.com"), false);

console.log("auth-authz: ok");
