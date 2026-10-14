/**
 * Mailbox access over HTTP after the auth cutover: membership rows in
 * AUTH_DB decide everything. Covers list/create/get/put/delete, owner-only
 * settings, `settings.acl` being display-only, id canonicalization, the
 * members routes, and push-token pruning.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mailbox-access-http.test.mjs
 */

import assert from "node:assert/strict";
import { authDb, authorizeMailboxAccess, listMailboxesForUser, mailboxRole } from "../auth/authz.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { mailboxIdFromAgentsUrl } from "../../shared/agent-conversations.ts";
import {
	addDomain,
	addMailbox,
	addUser,
	createAuthTestEnv,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const { env, db, bucket, mailboxes } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
const bob = await addUser(db, { id: "bob", email: "bob@gmail.com" });
const eve = await addUser(db, { id: "eve", email: "eve@inboxies.email" });
const [asAda, asBob, asEve] = [ada, bob, eve].map((u) => principalFor(u));

await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "shared@inboxies.email", { owners: ["ada"], members: ["bob"] });
await addMailbox(db, bucket, "secret@inboxies.email", { owners: ["eve"] });

// ── Signed out ──────────────────────────────────────────────────
assert.equal((await request(env, { path: "/api/v1/mailboxes" })).status, 401);
assert.equal((await request(env, { path: "/api/v1/mailboxes/ada@inboxies.email" })).status, 403);

// ── List: only member mailboxes, with role ─────────────────────
{
	const listed = await request(env, { path: "/api/v1/mailboxes", principal: asBob });
	assert.equal(listed.status, 200);
	assert.deepEqual(listed.payload, [
		{ id: "shared@inboxies.email", email: "shared@inboxies.email", name: "shared@inboxies.email", role: "member", canManage: false, readOnly: false },
	]);
}

// ── Get: role decides canManage; settings.acl is synthesized for display ──
{
	const res = await request(env, { path: "/api/v1/mailboxes/Shared@Inboxies.Email", principal: asAda });
	assert.equal(res.status, 200);
	assert.equal(res.payload.id, "shared@inboxies.email");
	assert.equal(res.payload.canManage, true);
	assert.deepEqual(res.payload.settings.acl, { owners: ["email:ada@inboxies.email"], members: ["email:bob@gmail.com"] });

	const asMember = await request(env, { path: "/api/v1/mailboxes/shared@inboxies.email", principal: asBob });
	assert.equal(asMember.payload.canManage, false);
	assert.equal(asMember.payload.role, "member");
}

// A stranger gets 403 for existing and missing mailboxes alike, and an
// email that matches the mailbox address claims nothing.
{
	assert.equal((await request(env, { path: "/api/v1/mailboxes/secret@inboxies.email", principal: asBob })).status, 403);
	assert.equal((await request(env, { path: "/api/v1/mailboxes/nobody@inboxies.email", principal: asBob })).status, 403);
	await bucket.put(mailboxMetadataKey("eve2@inboxies.email"), JSON.stringify({ fromName: "unclaimed" }));
	assert.equal(
		(await request(env, { path: "/api/v1/mailboxes/eve2@inboxies.email", principal: principalFor({ id: "eve", email: "eve2@inboxies.email" }) })).status,
		403,
		"no email-match auto-claim",
	);
}

// Encoded or bracketed ids never reach someone else's mailbox.
for (const raw of ["secret%40inboxies.email", "%3Csecret@inboxies.email%3E", "secret%2540inboxies.email", "a@b@inboxies.email", "secret%20@inboxies.email"]) {
	const res = await request(env, { path: `/api/v1/mailboxes/${raw}/emails`, principal: asBob });
	assert.ok([400, 403, 404].includes(res.status), `${raw} refused (${res.status})`);
	assert.notEqual(res.status, 200);
}
// A +tag canonicalizes to the base mailbox, which the caller must still be a member of.
assert.equal((await request(env, { path: "/api/v1/mailboxes/secret+x@inboxies.email", principal: asBob })).status, 403);

// ── PUT: owner-only settings, and acl never changes access ─────
{
	const memberForward = await request(env, {
		method: "PUT",
		path: "/api/v1/mailboxes/shared@inboxies.email",
		principal: asBob,
		body: { settings: { forwarding: { enabled: true, email: "bob@gmail.com" } } },
	});
	assert.equal(memberForward.status, 403);
	assert.match(memberForward.payload.error, /forwarding/);

	const memberSignature = await request(env, {
		method: "PUT",
		path: "/api/v1/mailboxes/shared@inboxies.email",
		principal: asBob,
		body: { settings: { signature: { enabled: true, text: "— Bob" } } },
	});
	assert.equal(memberSignature.status, 200, "members may change their non-sensitive settings");

	// Clients send their cached acl back on every save: it neither grants nor removes.
	const smuggle = await request(env, {
		method: "PUT",
		path: "/api/v1/mailboxes/shared@inboxies.email",
		principal: asBob,
		body: { settings: { acl: { owners: ["email:bob@gmail.com"], members: ["email:eve@inboxies.email"] } } },
	});
	assert.equal(smuggle.status, 200);
	assert.equal(await mailboxRole(db, "bob", "shared@inboxies.email"), "member");
	assert.equal(await mailboxRole(db, "eve", "shared@inboxies.email"), null);

	const ownerDrop = await request(env, {
		method: "PUT",
		path: "/api/v1/mailboxes/shared@inboxies.email",
		principal: asAda,
		body: { settings: { fromName: "Shared Team", acl: { owners: ["email:ada@inboxies.email"], members: [] } } },
	});
	assert.equal(ownerDrop.status, 200);
	assert.equal(await mailboxRole(db, "bob", "shared@inboxies.email"), "member", "a stale/edited acl doesn't remove members");
	const stored = JSON.parse(bucket.store.get(mailboxMetadataKey("shared@inboxies.email")));
	assert.equal(stored.fromName, "Shared Team");
	assert.equal(stored.acl, undefined, "acl is never stored in R2");
}

// ── POST /mailboxes ─────────────────────────────────────────────
{
	const created = await request(env, {
		method: "POST",
		path: "/api/v1/mailboxes",
		principal: asBob,
		body: { email: "Bobby@Inboxies.Email", name: "Bobby", settings: { acl: { owners: ["email:eve@inboxies.email"] } } },
	});
	assert.equal(created.status, 201);
	assert.equal(created.payload.id, "bobby@inboxies.email");
	assert.equal(await mailboxRole(db, "bob", "bobby@inboxies.email"), "owner");
	assert.equal(await mailboxRole(db, "eve", "bobby@inboxies.email"), null, "settings.acl on create grants nothing");
	assert.ok(mailboxes.calls.some(([id, m]) => id === "bobby@inboxies.email" && m === "reviveMailbox"));

	const dup = await request(env, { method: "POST", path: "/api/v1/mailboxes", principal: asEve, body: { email: "bobby@inboxies.email", name: "x" } });
	assert.equal(dup.status, 409);

	const reserved = await request(env, { method: "POST", path: "/api/v1/mailboxes", principal: asBob, body: { email: "postmaster@inboxies.email", name: "x" } });
	assert.equal(reserved.status, 400);

	await addDomain(db, bucket, { domain: "acme.com", ownerUserId: "eve" });
	const foreign = await request(env, { method: "POST", path: "/api/v1/mailboxes", principal: asBob, body: { email: "ceo@acme.com", name: "x" } });
	assert.equal(foreign.status, 403, "another tenant's domain");
	const own = await request(env, { method: "POST", path: "/api/v1/mailboxes", principal: asEve, body: { email: "ceo@acme.com", name: "CEO" } });
	assert.equal(own.status, 201);

	const closedEnv = { ...env, MAILBOX_CREATE_POLICY: "admin_only" };
	const closed = await request(closedEnv, { method: "POST", path: "/api/v1/mailboxes", principal: asBob, body: { email: "another@inboxies.email", name: "x" } });
	assert.equal(closed.status, 403, "admin_only keeps the platform domain closed");
}

// ── Members ─────────────────────────────────────────────────────
{
	const list = await request(env, { path: "/api/v1/mailboxes/shared@inboxies.email/members", principal: asBob });
	assert.equal(list.status, 200);
	assert.deepEqual(
		list.payload.map((m) => [m.userId, m.role, m.you]),
		[["ada", "owner", false], ["bob", "member", true]],
	);

	// Members can't change roles or remove others; strangers can't even look.
	assert.equal((await request(env, { method: "PATCH", path: "/api/v1/mailboxes/shared@inboxies.email/members/bob", principal: asBob, body: { role: "owner" } })).status, 403);
	assert.equal((await request(env, { method: "DELETE", path: "/api/v1/mailboxes/shared@inboxies.email/members/ada", principal: asBob })).status, 403);
	assert.equal((await request(env, { path: "/api/v1/mailboxes/shared@inboxies.email/members", principal: asEve })).status, 403);

	// The last owner can't be demoted or removed.
	const demote = await request(env, { method: "PATCH", path: "/api/v1/mailboxes/shared@inboxies.email/members/ada", principal: asAda, body: { role: "member" } });
	assert.equal(demote.status, 400);
	assert.equal((await request(env, { method: "DELETE", path: "/api/v1/mailboxes/shared@inboxies.email/members/ada", principal: asAda })).status, 400);

	// Promote, then the former sole owner can step down.
	assert.equal((await request(env, { method: "PATCH", path: "/api/v1/mailboxes/shared@inboxies.email/members/bob", principal: asAda, body: { role: "owner" } })).status, 200);
	assert.equal(await mailboxRole(db, "bob", "shared@inboxies.email"), "owner");
	assert.equal((await request(env, { method: "PATCH", path: "/api/v1/mailboxes/shared@inboxies.email/members/ada", principal: asAda, body: { role: "member" } })).status, 200);

	// Removing someone drops their push tokens for this mailbox.
	const stub = mailboxes.get("shared@inboxies.email");
	const reg = await request(env, {
		method: "POST",
		path: "/api/v1/mailboxes/shared@inboxies.email/device-token",
		principal: asAda,
		body: { token: "ada-phone", platform: "ios" },
	});
	assert.equal(reg.status, 200);
	assert.deepEqual(mailboxes.deviceTokens.get("shared@inboxies.email").get("ada-phone"), ["user:ada", "session:sess-ada"]);
	await stub.registerDeviceToken("bob-phone", "ios", ["user:bob", "session:b"]);

	const leave = await request(env, { method: "DELETE", path: "/api/v1/mailboxes/shared@inboxies.email/members/ada", principal: asAda });
	assert.equal(leave.status, 200, "a member may leave");
	assert.equal(await mailboxRole(db, "ada", "shared@inboxies.email"), null);
	assert.deepEqual([...mailboxes.deviceTokens.get("shared@inboxies.email").keys()], ["bob-phone"]);
	assert.equal((await request(env, { path: "/api/v1/mailboxes/shared@inboxies.email", principal: asAda })).status, 403);
}

// ── Delete ──────────────────────────────────────────────────────
{
	await addMailbox(db, bucket, "team@inboxies.email", { owners: ["ada"], members: ["bob"] });
	assert.equal((await request(env, { method: "DELETE", path: "/api/v1/mailboxes/team@inboxies.email", principal: asBob })).status, 403);
	assert.equal((await request(env, { method: "DELETE", path: "/api/v1/mailboxes/team@inboxies.email", principal: asAda })).status, 204);
	assert.ok(mailboxes.calls.some(([id, m]) => id === "team@inboxies.email" && m === "purgeMailbox"));
	assert.deepEqual(
		(await listMailboxesForUser(db, "bob")).map((m) => m.mailboxId).includes("team@inboxies.email"),
		false,
		"rows and memberships are gone",
	);
}

// ── /agents gate: the raw id must already be canonical, then membership decides ──
{
	const id = mailboxIdFromAgentsUrl("https://inboxies.test/agents/email-agent/ada@inboxies.email");
	assert.equal(id, "ada@inboxies.email");
	assert.equal((await authorizeMailboxAccess(authDb(env.AUTH_DB), "ada", id)).ok, true);
	assert.equal((await authorizeMailboxAccess(authDb(env.AUTH_DB), "bob", id)).ok, false);
}

console.log("mailbox-access-http: ok");
