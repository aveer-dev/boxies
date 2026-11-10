/**
 * Tags (AVE-240): the `48_email_tags` migration, the tag SQL in lib/tags.ts
 * (names, links, tag views, payload fields) and the HTTP routes in
 * routes/tags.ts. Runs the real MailboxDO migrations on node:sqlite; the HTTP
 * part wires a mock mailbox stub to that same database.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/tags.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	countTaggedEmails,
	createTag,
	deleteTag,
	getTag,
	listTaggedEmails,
	listTags,
	renameTag,
	setEmailTag,
	setThreadTag,
	tagExists,
	tagsForEmails,
	tagsForThreads,
	withTagFields,
} from "../lib/tags.ts";
import { MAILBOX_PURGE_TABLES } from "../lib/mailbox-purge.ts";
import { MAX_TAGS_PER_MAILBOX, TAG_NAME_MAX, normalizeTagName } from "../../shared/tags.ts";
import { MAILBOX_EVENT_TARGETS } from "../../app/lib/mailbox-events.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const MIGRATION = "48_email_tags";

/** `ctx.storage.sql` stand-in: multi-statement scripts via exec, else one prepared statement. */
function sqlStorage(db) {
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings);
		},
	};
}

function mailboxDb(migrations = mailboxMigrations) {
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, migrations);
	return { db, sql };
}

function insertEmail(sql, id, threadId, { folder = "inbox", date = "2026-01-01T00:00:00.000Z", read = 0, sender = "a@example.com", senderName = null } = {}) {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, sender_name, recipient, date, thread_id, read)
		 VALUES (?, ?, 's', ?, ?, 'b@example.com', ?, ?, ?)`,
		id,
		folder,
		sender,
		senderName,
		date,
		threadId,
		read,
	);
}

const count = (sql, query, ...b) => Number(Object.values(sql.exec(query, ...b)[0])[0]);
const names = (tags) => tags.map((t) => t.name);

// ── Migration: ordered after 47, additive, idempotent ────────────
{
	const order = mailboxMigrations.map((m) => m.name);
	assert.ok(order.indexOf(MIGRATION) > order.indexOf("47_participants_unit_separator"), "appended after 47");
	assert.equal(mailboxMigrations.filter((m) => m.name === MIGRATION).length, 1);

	// A mailbox from before this migration keeps its mail and custom folders.
	const before = mailboxMigrations.filter((m) => m.name !== MIGRATION);
	const { sql } = mailboxDb(before);
	sql.exec(`INSERT INTO folders (id, name, is_deletable) VALUES ('receipts', 'Receipts', 1)`);
	insertEmail(sql, "e1", "t1", { folder: "receipts" });
	assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE name IN ('tags', 'email_tags')`), 0);

	applyMigrations(sql, mailboxMigrations);
	for (const table of ["tags", "email_tags"]) {
		assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table), 1, table);
	}
	assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_email_tags_tag'`), 1);
	assert.equal(count(sql, `SELECT COUNT(*) FROM tags`), 0, "tags start empty: folders are not converted");
	assert.equal(count(sql, `SELECT COUNT(*) FROM folders WHERE id = 'receipts'`), 1, "custom folder stays a folder");
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails WHERE id = 'e1' AND folder_id = 'receipts'`), 1, "mail untouched");

	// The runner skips it by name, and the SQL itself is safe to replay.
	applyMigrations(sql, mailboxMigrations);
	assert.equal(count(sql, `SELECT COUNT(*) FROM d1_migrations WHERE name = ?`, MIGRATION), 1);
	sql.exec(mailboxMigrations.find((m) => m.name === MIGRATION).sql);

	// A purge empties both tables.
	assert.ok(MAILBOX_PURGE_TABLES.includes("tags"));
	assert.ok(MAILBOX_PURGE_TABLES.includes("email_tags"));
}

// ── Name validation ──────────────────────────────────────────────
{
	assert.deepEqual(normalizeTagName("  Big   Clients \n"), { ok: true, name: "Big Clients", key: "big clients" });
	assert.equal(normalizeTagName("").ok, false);
	assert.equal(normalizeTagName("   ").ok, false);
	assert.equal(normalizeTagName(42).ok, false);
	assert.equal(normalizeTagName(undefined).ok, false);
	assert.equal(normalizeTagName("x".repeat(TAG_NAME_MAX)).ok, true);
	assert.equal(normalizeTagName("x".repeat(TAG_NAME_MAX + 1)).ok, false);
	assert.equal(normalizeTagName("🎉".repeat(TAG_NAME_MAX)).ok, true, "length counts characters, not UTF-16 units");
	assert.equal(normalizeTagName("evil‮eman").ok, false, "bidi override");
	assert.equal(normalizeTagName("a\u0000b").ok, false, "control character");
	assert.equal(normalizeTagName("👨‍👩‍👧").ok, true, "emoji ZWJ sequence");
}

// ── Tag CRUD: unique per mailbox ignoring case; delete keeps mail ─
{
	const { sql } = mailboxDb();
	insertEmail(sql, "e1", "t1");

	const work = createTag(sql, " Work ", { id: "tag-work", now: "2026-11-10T00:00:00.000Z" });
	assert.equal(work.ok, true);
	assert.deepEqual(work.tag, {
		id: "tag-work",
		name: "Work",
		emailCount: 0,
		unreadCount: 0,
		createdAt: "2026-11-10T00:00:00.000Z",
		updatedAt: "2026-11-10T00:00:00.000Z",
	});
	assert.deepEqual(createTag(sql, "WORK"), { ok: false, error: "conflict" });
	assert.equal(createTag(sql, "").error, "invalid");
	const travel = createTag(sql, "travel", { id: "tag-travel" });
	assert.equal(travel.ok, true);
	createTag(sql, "Alpha", { id: "tag-alpha" });
	assert.deepEqual(names(listTags(sql)), ["Alpha", "travel", "Work"], "sorted by name, ignoring case");

	// Rename: case-only change of its own name is fine; another tag's name is not.
	const recased = renameTag(sql, "tag-travel", "Travel", { now: "2026-11-11T00:00:00.000Z" });
	assert.equal(recased.ok, true);
	assert.equal(recased.changed, true);
	assert.equal(recased.tag.name, "Travel");
	assert.equal(recased.tag.updatedAt, "2026-11-11T00:00:00.000Z");
	assert.equal(renameTag(sql, "tag-travel", "Travel").changed, false, "same name: no change");
	assert.deepEqual(renameTag(sql, "tag-travel", "work"), { ok: false, error: "conflict" });
	assert.deepEqual(renameTag(sql, "missing", "x"), { ok: false, error: "not_found" });
	assert.equal(renameTag(sql, "tag-travel", " ").error, "invalid");

	// Delete removes links, never emails.
	assert.equal(setEmailTag(sql, "e1", "tag-work", true).ok, true);
	assert.deepEqual(deleteTag(sql, "tag-work"), ["e1"]);
	assert.equal(tagExists(sql, "tag-work"), false);
	assert.equal(count(sql, `SELECT COUNT(*) FROM email_tags WHERE tag_id = 'tag-work'`), 0);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails WHERE id = 'e1'`), 1, "email stays");
	assert.equal(deleteTag(sql, "tag-work"), null, "second delete: not found");
	assert.equal(createTag(sql, "work").ok, true, "a deleted tag's name is free again");
}

// ── Tag cap ──────────────────────────────────────────────────────
{
	const { sql } = mailboxDb();
	for (let i = 0; i < MAX_TAGS_PER_MAILBOX; i++) {
		sql.exec(
			`INSERT INTO tags (id, name, name_key, created_at, updated_at) VALUES (?1, ?2, ?2, 'now', 'now')`,
			`t${i}`,
			`tag ${i}`,
		);
	}
	assert.deepEqual(createTag(sql, "one more"), { ok: false, error: "limit" });
}

// ── Links: email and thread, idempotent; folders untouched ───────
{
	const { sql } = mailboxDb();
	insertEmail(sql, "a1", "thread-a", { date: "2026-01-01T00:00:00.000Z" });
	insertEmail(sql, "a2", "thread-a", { date: "2026-01-02T00:00:00.000Z", read: 1 });
	insertEmail(sql, "solo", null, { date: "2026-01-03T00:00:00.000Z" });
	createTag(sql, "Work", { id: "work" });
	createTag(sql, "Clients", { id: "clients" });

	assert.deepEqual(setEmailTag(sql, "missing", "work", true), { ok: false, error: "email_not_found" });
	assert.deepEqual(setEmailTag(sql, "a1", "missing", true), { ok: false, error: "tag_not_found" });

	const added = setEmailTag(sql, "a1", "work", true);
	assert.deepEqual(added, { ok: true, id: "a1", tags: [{ id: "work", name: "Work" }], changed: true });
	assert.equal(setEmailTag(sql, "a1", "work", true).changed, false, "adding twice changes nothing");
	setEmailTag(sql, "a1", "clients", true);
	assert.deepEqual(names(tagsForEmails(sql, ["a1"]).get("a1")), ["Clients", "Work"], "many tags on one email");
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails WHERE id = 'a1' AND folder_id = 'inbox'`), 1, "folder kept");

	const removed = setEmailTag(sql, "a1", "clients", false);
	assert.deepEqual(names(removed.tags), ["Work"]);
	assert.equal(removed.changed, true);
	assert.equal(setEmailTag(sql, "a1", "clients", false).changed, false, "removing twice changes nothing");

	// Thread: tags every message; the response names only the ones that changed.
	assert.deepEqual(setThreadTag(sql, "nope", "work", true), { ok: false, error: "thread_not_found" });
	assert.deepEqual(setThreadTag(sql, "thread-a", "nope", true), { ok: false, error: "tag_not_found" });
	const threadAdd = setThreadTag(sql, "thread-a", "work", true);
	assert.deepEqual(threadAdd, { ok: true, threadId: "thread-a", tags: [{ id: "work", name: "Work" }], emailIds: ["a2"] });
	assert.deepEqual(setThreadTag(sql, "thread-a", "work", true).emailIds, []);
	// Mail stored without a thread_id is its own thread.
	assert.deepEqual(setThreadTag(sql, "solo", "clients", true).emailIds, ["solo"]);

	// Thread rows carry every tag in the conversation; email rows their own.
	setEmailTag(sql, "a2", "clients", true);
	assert.deepEqual(names(tagsForThreads(sql, ["thread-a"]).get("thread-a")), ["Clients", "Work"]);
	const threadRows = withTagFields(sql, [{ id: "a2", thread_id: "thread-a" }, { id: "solo", thread_id: null }], "thread");
	assert.deepEqual(names(threadRows[0].tags), ["Clients", "Work"]);
	assert.deepEqual(names(threadRows[1].tags), ["Clients"]);
	const emailRows = withTagFields(sql, [{ id: "a1", thread_id: "thread-a" }, { id: "x", thread_id: null }], "email");
	assert.deepEqual(names(emailRows[0].tags), ["Work"]);
	assert.deepEqual(emailRows[1].tags, [], "untagged rows get an empty array");
	assert.deepEqual(withTagFields(sql, [], "thread"), []);

	// Moving between folders keeps tags.
	sql.exec(`UPDATE emails SET folder_id = 'archive' WHERE id = 'a1'`);
	assert.deepEqual(names(tagsForEmails(sql, ["a1"]).get("a1")), ["Work"]);

	const threadRemove = setThreadTag(sql, "thread-a", "work", false);
	assert.deepEqual(threadRemove.emailIds.sort(), ["a1", "a2"]);
	assert.deepEqual(names(threadRemove.tags), ["Clients"]);

	// A permanently deleted email takes its links with it (ON DELETE CASCADE).
	sql.exec(`DELETE FROM emails WHERE id = 'a2'`);
	assert.equal(count(sql, `SELECT COUNT(*) FROM email_tags WHERE email_id = 'a2'`), 0);
	assert.equal(tagExists(sql, "clients"), true, "the tag itself stays");
}

// ── Tag views: flat and threaded, junk left out, counts ──────────
{
	const { sql } = mailboxDb();
	createTag(sql, "Work", { id: "work" });
	insertEmail(sql, "t1-old", "t1", { date: "2026-01-01T00:00:00.000Z", sender: "ann@example.com", senderName: "Ann" });
	insertEmail(sql, "t1-new", "t1", { date: "2026-01-05T00:00:00.000Z", sender: "bo@example.com", senderName: "Bo", read: 1 });
	insertEmail(sql, "t1-reply", "t1", { date: "2026-01-06T00:00:00.000Z", sender: "ann@example.com", senderName: "Ann" });
	insertEmail(sql, "t2", "t2", { date: "2026-01-03T00:00:00.000Z" });
	insertEmail(sql, "binned", "t3", { date: "2026-01-09T00:00:00.000Z", folder: "trash" });
	insertEmail(sql, "spammy", null, { date: "2026-01-08T00:00:00.000Z", folder: "spam" });
	for (const id of ["t1-old", "t1-new", "t2", "binned", "spammy"]) setEmailTag(sql, id, "work", true);

	const flat = listTaggedEmails(sql, "work");
	assert.deepEqual(flat.map((r) => r.id), ["t1-new", "t2", "t1-old"], "newest first, no Trash/Spam");
	assert.equal(countTaggedEmails(sql, "work"), 3);
	assert.ok("folder_id" in flat[0] && "snippet" in flat[0] && "auth_tier" in flat[0], "same columns as getEmails");
	assert.deepEqual(
		listTaggedEmails(sql, "work", { includeJunk: true }).map((r) => r.id),
		["binned", "spammy", "t1-new", "t2", "t1-old"],
	);
	assert.equal(countTaggedEmails(sql, "work", { includeJunk: true }), 5);
	assert.deepEqual(listTaggedEmails(sql, "work", { limit: 2, page: 2 }).map((r) => r.id), ["t1-old"]);

	const threaded = listTaggedEmails(sql, "work", { threaded: true });
	assert.deepEqual(threaded.map((r) => r.id), ["t1-new", "t2"], "one row per conversation: its newest tagged message");
	assert.equal(threaded[0].thread_count, 3, "counts every listed message in the conversation");
	assert.equal(threaded[0].thread_unread_count, 2);
	assert.deepEqual(threaded[0].participants.split("\u001f"), ["Ann", "Bo"]);
	assert.equal(countTaggedEmails(sql, "work", { threaded: true }), 2);
	assert.equal(countTaggedEmails(sql, "work", { threaded: true, includeJunk: true }), 4);

	// Tag counts leave junk out too.
	assert.deepEqual(
		{ emailCount: getTag(sql, "work").emailCount, unreadCount: getTag(sql, "work").unreadCount },
		{ emailCount: 3, unreadCount: 2 },
	);
}

// ── Web: the new event refreshes lists ───────────────────────────
assert.deepEqual(MAILBOX_EVENT_TARGETS.tags_changed, ["emails"]);

// ── HTTP routes ──────────────────────────────────────────────────
{
	const { sql } = mailboxDb();
	insertEmail(sql, "a1", "thread-a", { date: "2026-01-01T00:00:00.000Z" });
	insertEmail(sql, "a2", "thread-a", { date: "2026-01-02T00:00:00.000Z" });
	insertEmail(sql, "b1", "thread-b", { date: "2026-01-03T00:00:00.000Z" });

	// Stub methods mirror MailboxDO's, over the real tag SQL.
	const listCalls = [];
	const mailboxNamespace = mockMailboxNamespace({
		listTags: async () => listTags(sql),
		createTag: async (name) => createTag(sql, name),
		renameTag: async (id, name) => renameTag(sql, id, name),
		deleteTag: async (id) => deleteTag(sql, id) !== null,
		setEmailTag: async (emailId, tagId, on) => setEmailTag(sql, emailId, tagId, on),
		setThreadTag: async (threadId, tagId, on) => setThreadTag(sql, threadId, tagId, on),
		getTaggedEmails: async (tagId, options) => {
			listCalls.push(options);
			if (!tagExists(sql, tagId)) return null;
			const rows = listTaggedEmails(sql, tagId, options);
			return {
				emails: withTagFields(sql, rows, options.threaded ? "thread" : "email"),
				totalCount: countTaggedEmails(sql, tagId, options),
			};
		},
	});
	const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mailboxNamespace });
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
	const bob = await addUser(db, { id: "bob", email: "bob@gmail.com" });
	const eve = await addUser(db, { id: "eve", email: "eve@inboxies.email" });
	await addMailbox(db, bucket, "shared@inboxies.email", { owners: ["ada"], members: ["bob"] });
	const [asAda, asBob, asEve] = [ada, bob, eve].map((u) => principalFor(u));
	const base = "/api/v1/mailboxes/shared@inboxies.email";

	// Create: 201; same name in another case 409; bad names 400.
	const created = await request(env, { method: "POST", path: `${base}/tags`, principal: asAda, body: { name: "  Work " } });
	assert.equal(created.status, 201);
	assert.equal(created.payload.name, "Work");
	assert.equal(created.payload.emailCount, 0);
	const workId = created.payload.id;
	assert.equal((await request(env, { method: "POST", path: `${base}/tags`, principal: asBob, body: { name: "work" } })).status, 409);
	for (const body of [{}, { name: "" }, { name: 7 }, { name: "x".repeat(TAG_NAME_MAX + 1) }, ["Work"]]) {
		const res = await request(env, { method: "POST", path: `${base}/tags`, principal: asAda, body });
		assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
		assert.ok(res.payload.error);
	}
	const clients = await request(env, { method: "POST", path: `${base}/tags`, principal: asBob, body: { name: "Clients" } });
	assert.equal(clients.status, 201, "any member can create tags");
	const clientsId = clients.payload.id;

	// List: shared by the mailbox's members, sorted by name.
	const listed = await request(env, { path: `${base}/tags`, principal: asBob });
	assert.equal(listed.status, 200);
	assert.deepEqual(names(listed.payload.tags), ["Clients", "Work"]);

	// Not a member (or signed out): no access to any tag route.
	for (const [method, path] of [
		["GET", `${base}/tags`],
		["POST", `${base}/tags`],
		["PATCH", `${base}/tags/${workId}`],
		["DELETE", `${base}/tags/${workId}`],
		["GET", `${base}/tags/${workId}/emails`],
		["PUT", `${base}/emails/a1/tags/${workId}`],
		["DELETE", `${base}/threads/thread-a/tags/${workId}`],
	]) {
		const body = method === "POST" || method === "PATCH" ? { name: "Mine" } : undefined;
		assert.equal((await request(env, { method, path, principal: asEve, body })).status, 403, `${method} ${path}`);
		assert.equal((await request(env, { method, path, body })).status, 403, `${method} ${path} signed out`);
	}
	assert.deepEqual(names(listTags(sql)), ["Clients", "Work"], "nothing changed by outsiders");

	// Email: add, idempotent add, many tags, remove.
	const put = await request(env, { method: "PUT", path: `${base}/emails/a1/tags/${workId}`, principal: asAda });
	assert.equal(put.status, 200);
	assert.deepEqual(put.payload, { id: "a1", tags: [{ id: workId, name: "Work" }] });
	assert.equal((await request(env, { method: "PUT", path: `${base}/emails/a1/tags/${workId}`, principal: asAda })).status, 200);
	const both = await request(env, { method: "PUT", path: `${base}/emails/a1/tags/${clientsId}`, principal: asAda });
	assert.deepEqual(names(both.payload.tags), ["Clients", "Work"]);
	const less = await request(env, { method: "DELETE", path: `${base}/emails/a1/tags/${clientsId}`, principal: asAda });
	assert.equal(less.status, 200);
	assert.deepEqual(names(less.payload.tags), ["Work"]);
	assert.equal((await request(env, { method: "PUT", path: `${base}/emails/nope/tags/${workId}`, principal: asAda })).payload.error, "Email not found");
	const noTag = await request(env, { method: "PUT", path: `${base}/emails/a1/tags/nope`, principal: asAda });
	assert.equal(noTag.status, 404);
	assert.equal(noTag.payload.error, "Tag not found");

	// Thread: every message.
	const threadPut = await request(env, { method: "PUT", path: `${base}/threads/thread-a/tags/${clientsId}`, principal: asBob });
	assert.equal(threadPut.status, 200);
	assert.equal(threadPut.payload.threadId, "thread-a");
	assert.deepEqual(names(threadPut.payload.tags), ["Clients", "Work"]);
	assert.deepEqual(threadPut.payload.emailIds.sort(), ["a1", "a2"]);
	assert.equal((await request(env, { method: "PUT", path: `${base}/threads/nope/tags/${clientsId}`, principal: asBob })).status, 404);
	assert.equal((await request(env, { method: "PUT", path: `${base}/threads/thread-a/tags/nope`, principal: asBob })).status, 404);

	// Tag view: flat by default, threaded on request; 404 for an unknown tag.
	const flat = await request(env, { path: `${base}/tags/${clientsId}/emails`, principal: asAda });
	assert.equal(flat.status, 200);
	assert.deepEqual(flat.payload.emails.map((e) => e.id), ["a2", "a1"]);
	assert.equal(flat.payload.totalCount, 2);
	assert.deepEqual(names(flat.payload.emails[1].tags), ["Clients", "Work"]);
	assert.deepEqual(listCalls.at(-1), { threaded: false, includeJunk: false, page: undefined, limit: undefined, userId: "ada" });
	const threaded = await request(env, { path: `${base}/tags/${clientsId}/emails?threaded=true&limit=10&page=1`, principal: asAda });
	assert.deepEqual(threaded.payload.emails.map((e) => e.id), ["a2"]);
	assert.equal(threaded.payload.totalCount, 1);
	assert.equal(threaded.payload.emails[0].thread_count, 2);
	assert.deepEqual(listCalls.at(-1), { threaded: true, includeJunk: false, page: 1, limit: 10, userId: "ada" });
	assert.equal((await request(env, { path: `${base}/tags/nope/emails`, principal: asAda })).status, 404);

	// Rename: 200; another tag's name 409; unknown 404; blank 400.
	const renamed = await request(env, { method: "PATCH", path: `${base}/tags/${clientsId}`, principal: asAda, body: { name: "Key clients" } });
	assert.equal(renamed.status, 200);
	assert.equal(renamed.payload.name, "Key clients");
	assert.equal(renamed.payload.emailCount, 2);
	assert.equal((await request(env, { method: "PATCH", path: `${base}/tags/${clientsId}`, principal: asAda, body: { name: "WORK" } })).status, 409);
	assert.equal((await request(env, { method: "PATCH", path: `${base}/tags/nope`, principal: asAda, body: { name: "x" } })).status, 404);
	assert.equal((await request(env, { method: "PATCH", path: `${base}/tags/${clientsId}`, principal: asAda, body: { name: " " } })).status, 400);

	// Thread untag, then delete: links go, emails stay.
	const threadDel = await request(env, { method: "DELETE", path: `${base}/threads/thread-a/tags/${clientsId}`, principal: asAda });
	assert.deepEqual(names(threadDel.payload.tags), ["Work"]);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/tags/${workId}`, principal: asAda })).status, 204);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/tags/${workId}`, principal: asAda })).status, 404);
	assert.equal(count(sql, `SELECT COUNT(*) FROM email_tags`), 0);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 3, "no email deleted");
	assert.deepEqual(names((await request(env, { path: `${base}/tags`, principal: asAda })).payload.tags), ["Key clients"]);
}

console.log("tags tests passed");
