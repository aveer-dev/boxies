/**
 * Notes to self (AVE-59): the `31_thread_notes_to_self` migration, the
 * author-scoped note SQL in lib/thread-notes.ts, list-row note fields, the
 * delete-with-email hook, and the HTTP routes (validation, privacy between
 * two members of a shared mailbox). Runs the real MailboxDO migrations on
 * node:sqlite; the HTTP part wires a mock mailbox stub to that same database.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/thread-notes.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	CreateThreadNoteSchema,
	UpdateThreadNoteSchema,
	createThreadNote,
	deleteThreadNote,
	deleteThreadNotesForDeletedEmail,
	listThreadNotes,
	stickyNoteSnippet,
	updateThreadNote,
	withThreadNoteFields,
} from "../lib/thread-notes.ts";
import { STICKY_NOTE_SNIPPET_MAX, THREAD_NOTE_BODY_MAX } from "../../shared/thread-notes.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const MIGRATION = "31_thread_notes_to_self";

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

function insertEmail(sql, id, threadId, date = "2026-01-01T00:00:00.000Z") {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id)
		 VALUES (?, 'inbox', 's', 'a@example.com', 'b@example.com', ?, ?)`,
		id,
		date,
		threadId,
	);
}

const count = (sql, query, ...b) => Number(Object.values(sql.exec(query, ...b)[0])[0]);

// ── Migration: last, additive, idempotent ────────────────────────
{
	const names = mailboxMigrations.map((m) => m.name);
	assert.ok(
		names.indexOf(MIGRATION) > names.indexOf("30_list_query_indexes"),
		"appended after the earlier migrations",
	);
	assert.equal(mailboxMigrations.filter((m) => m.name === MIGRATION).length, 1);

	// A mailbox from before this migration keeps its mail.
	const before = mailboxMigrations.filter((m) => m.name !== MIGRATION);
	const { sql } = mailboxDb(before);
	insertEmail(sql, "e1", "t1");
	assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE name = 'thread_notes'`), 0);

	applyMigrations(sql, mailboxMigrations);
	assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'thread_notes'`), 1);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails WHERE id = 'e1'`), 1, "existing rows untouched");
	for (const index of ["idx_thread_notes_thread_author", "idx_thread_notes_author_type", "idx_thread_notes_email"]) {
		assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, index), 1, index);
	}

	// The runner skips it by name, and the SQL itself is safe to replay.
	applyMigrations(sql, mailboxMigrations);
	assert.equal(count(sql, `SELECT COUNT(*) FROM d1_migrations WHERE name = ?`, MIGRATION), 1);
	sql.exec(mailboxMigrations.find((m) => m.name === MIGRATION).sql);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 1);

	// The table refuses an inline note without a message, and unknown types.
	assert.throws(() =>
		sql.exec(
			`INSERT INTO thread_notes (id, thread_id, note_type, body, author_user_id, created_at, updated_at)
			 VALUES ('x', 't1', 'inline', 'b', 'u', 'now', 'now')`,
		),
	);
	assert.throws(() =>
		sql.exec(
			`INSERT INTO thread_notes (id, thread_id, note_type, body, author_user_id, created_at, updated_at)
			 VALUES ('y', 't1', 'banner', 'b', 'u', 'now', 'now')`,
		),
	);
}

// ── Request validation ───────────────────────────────────────────
{
	const ok = CreateThreadNoteSchema.parse({ body: "**hi**", noteType: "sticky", posX: 0.5, posY: 12 });
	assert.equal(ok.body, "**hi**");
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "   \n", noteType: "sticky" }).success, false, "blank body");
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "", noteType: "sticky" }).success, false, "empty body");
	assert.equal(
		CreateThreadNoteSchema.safeParse({ body: "x".repeat(THREAD_NOTE_BODY_MAX + 1), noteType: "sticky" }).success,
		false,
		"body cap",
	);
	assert.equal(
		CreateThreadNoteSchema.safeParse({ body: "x".repeat(THREAD_NOTE_BODY_MAX), noteType: "sticky" }).success,
		true,
	);
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "x", noteType: "banner" }).success, false, "note type enum");
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "x", noteType: "inline" }).success, false, "inline needs emailId");
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "x", noteType: "inline", emailId: "  " }).success, false);
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "x", noteType: "sticky", posX: Infinity }).success, false);
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "x", noteType: "sticky", posY: Number.NaN }).success, false);
	assert.equal(CreateThreadNoteSchema.safeParse({ body: "x", noteType: "sticky", posX: "1" }).success, false);
	assert.equal(CreateThreadNoteSchema.safeParse({ body: 5, noteType: "sticky" }).success, false);

	assert.equal(UpdateThreadNoteSchema.safeParse({}).success, false, "nothing to update");
	assert.equal(UpdateThreadNoteSchema.safeParse({ posX: 3 }).success, true, "position only");
	assert.equal(UpdateThreadNoteSchema.safeParse({ posX: null, posY: null }).success, true, "clear position");
	assert.equal(UpdateThreadNoteSchema.safeParse({ body: " " }).success, false);
	assert.equal(UpdateThreadNoteSchema.safeParse({ posY: -Infinity }).success, false);
}

// ── CRUD, privacy and inline rules (lib) ─────────────────────────
{
	const { sql } = mailboxDb();
	insertEmail(sql, "a1", "thread-a", "2026-01-01T00:00:00.000Z");
	insertEmail(sql, "a2", "thread-a", "2026-01-02T00:00:00.000Z");
	insertEmail(sql, "b1", "thread-b");
	insertEmail(sql, "legacy", null); // stored without thread_id: its id is the key

	const sticky = createThreadNote(sql, "thread-a", "ada", { body: "Call **Bob**", noteType: "sticky", posX: 10, posY: 20 }, { id: "n1", now: "2026-02-01T00:00:00.000Z" });
	assert.equal(sticky.ok, true);
	assert.deepEqual(sticky.note, {
		id: "n1",
		threadId: "thread-a",
		emailId: null,
		noteType: "sticky",
		body: "Call **Bob**",
		posX: 10,
		posY: 20,
		createdAt: "2026-02-01T00:00:00.000Z",
		updatedAt: "2026-02-01T00:00:00.000Z",
	});
	const inline = createThreadNote(sql, "thread-a", "ada", { body: "this one", noteType: "inline", emailId: "a2" }, { id: "n2", now: "2026-02-02T00:00:00.000Z" });
	assert.equal(inline.ok, true);
	assert.equal(inline.note.emailId, "a2");
	assert.equal(inline.note.posX, null);

	// Inline notes need a message in that thread.
	assert.deepEqual(
		createThreadNote(sql, "thread-a", "ada", { body: "x", noteType: "inline", emailId: "b1" }),
		{ ok: false, error: "email_not_in_thread" },
	);
	assert.deepEqual(
		createThreadNote(sql, "thread-a", "ada", { body: "x", noteType: "inline", emailId: "missing" }),
		{ ok: false, error: "email_not_in_thread" },
	);
	assert.deepEqual(
		createThreadNote(sql, "thread-a", "ada", { body: "x", noteType: "inline" }),
		{ ok: false, error: "email_not_in_thread" },
		"the DO refuses an inline note without emailId even past the schema",
	);
	assert.deepEqual(
		createThreadNote(sql, "no-such-thread", "ada", { body: "x", noteType: "sticky" }),
		{ ok: false, error: "thread_not_found" },
	);
	// Mail stored without a thread_id is addressed by its own id.
	assert.equal(createThreadNote(sql, "legacy", "ada", { body: "old", noteType: "inline", emailId: "legacy" }).ok, true);

	// Bob shares the mailbox but sees none of Ada's notes, and can't touch them.
	const bobs = createThreadNote(sql, "thread-a", "bob", { body: "bob's", noteType: "sticky" }, { id: "n3", now: "2026-02-03T00:00:00.000Z" });
	assert.equal(bobs.ok, true);
	assert.deepEqual(listThreadNotes(sql, "thread-a", "ada").map((n) => n.id), ["n1", "n2"]);
	assert.deepEqual(listThreadNotes(sql, "thread-a", "bob").map((n) => n.id), ["n3"]);
	assert.equal(updateThreadNote(sql, "n1", "bob", { body: "hijack" }), null);
	assert.equal(deleteThreadNote(sql, "n1", "bob"), null);
	assert.equal(listThreadNotes(sql, "thread-a", "ada")[0].body, "Call **Bob**", "unchanged by Bob");

	// Update body only, then position only (null clears).
	const edited = updateThreadNote(sql, "n1", "ada", { body: "Call Bob _today_" }, { now: "2026-03-01T00:00:00.000Z" });
	assert.equal(edited.body, "Call Bob _today_");
	assert.equal(edited.posX, 10);
	assert.equal(edited.createdAt, "2026-02-01T00:00:00.000Z");
	assert.equal(edited.updatedAt, "2026-03-01T00:00:00.000Z");
	const moved = updateThreadNote(sql, "n1", "ada", { posX: 1.5, posY: null });
	assert.equal(moved.body, "Call Bob _today_");
	assert.equal(moved.posX, 1.5);
	assert.equal(moved.posY, null);
	assert.equal(updateThreadNote(sql, "missing", "ada", { body: "x" }), null);

	// Delete.
	assert.equal(deleteThreadNote(sql, "n2", "ada").id, "n2");
	assert.equal(deleteThreadNote(sql, "n2", "ada"), null, "already gone");
	assert.deepEqual(listThreadNotes(sql, "thread-a", "ada").map((n) => n.id), ["n1"]);
	assert.deepEqual(listThreadNotes(sql, "thread-a", "bob").map((n) => n.id), ["n3"]);
}

// ── List rows: sticky fields per requesting user ─────────────────
{
	const { sql } = mailboxDb();
	insertEmail(sql, "a1", "thread-a");
	insertEmail(sql, "a2", "thread-a");
	insertEmail(sql, "b1", "thread-b");
	insertEmail(sql, "solo", null);

	const make = (thread, user, input, id, now) =>
		assert.equal(createThreadNote(sql, thread, user, input, { id, now }).ok, true);
	make("thread-a", "ada", { body: "older sticky", noteType: "sticky" }, "s1", "2026-01-01T00:00:00.000Z");
	make("thread-a", "ada", { body: `  ${"é".repeat(300)}  `, noteType: "sticky" }, "s2", "2026-01-02T00:00:00.000Z");
	make("thread-a", "ada", { body: "i1", noteType: "inline", emailId: "a1" }, "i1", "2026-01-03T00:00:00.000Z");
	make("thread-a", "ada", { body: "i2", noteType: "inline", emailId: "a2" }, "i2", "2026-01-04T00:00:00.000Z");
	make("thread-a", "bob", { body: "bob sticky", noteType: "sticky" }, "s3", "2026-01-05T00:00:00.000Z");
	make("solo", "ada", { body: "  solo note ", noteType: "sticky" }, "s4", "2026-01-06T00:00:00.000Z");

	const listRows = [
		{ id: "a2", thread_id: "thread-a", subject: "A" },
		{ id: "b1", thread_id: "thread-b", subject: "B" },
		{ id: "solo", thread_id: null, subject: "S" },
	];
	const asAda = withThreadNoteFields(sql, listRows, "ada");
	assert.equal(asAda[0].subject, "A", "row fields kept");
	assert.equal(asAda[0].has_sticky_note, true);
	assert.equal(asAda[0].inline_note_count, 2);
	assert.equal(asAda[0].sticky_note_text.length, STICKY_NOTE_SNIPPET_MAX, "latest sticky, trimmed to a snippet");
	assert.ok(asAda[0].sticky_note_text.startsWith("éé"));
	assert.ok(asAda[0].sticky_note_text.endsWith("…"));
	assert.deepEqual(
		{ has: asAda[1].has_sticky_note, text: asAda[1].sticky_note_text, n: asAda[1].inline_note_count },
		{ has: false, text: null, n: 0 },
	);
	assert.equal(asAda[2].sticky_note_text, "solo note", "threadless row keyed by its id");

	const asBob = withThreadNoteFields(sql, listRows, "bob");
	assert.equal(asBob[0].has_sticky_note, true);
	assert.equal(asBob[0].sticky_note_text, "bob sticky", "only Bob's own sticky");
	assert.equal(asBob[0].inline_note_count, 0, "Ada's inline notes aren't counted for Bob");
	assert.equal(asBob[2].has_sticky_note, false);

	const asEve = withThreadNoteFields(sql, listRows, "eve");
	assert.ok(asEve.every((r) => !r.has_sticky_note && r.sticky_note_text === null && r.inline_note_count === 0));
	const anonymous = withThreadNoteFields(sql, listRows, undefined);
	assert.ok(anonymous.every((r) => r.has_sticky_note === false && r.inline_note_count === 0));
	assert.deepEqual(withThreadNoteFields(sql, [], "ada"), []);

	// A full page of keys goes in as one JSON parameter.
	const many = Array.from({ length: 150 }, (_, i) => ({ id: `x${i}`, thread_id: `tx${i}` }));
	assert.equal(withThreadNoteFields(sql, [...many, listRows[0]], "ada").at(-1).inline_note_count, 2);

	assert.equal(stickyNoteSnippet(null), null);
	assert.equal(stickyNoteSnippet("short"), "short");
	assert.equal(stickyNoteSnippet("😀".repeat(250)).length <= STICKY_NOTE_SNIPPET_MAX * 2, true, "cut on code points");
	assert.ok(!stickyNoteSnippet("😀".repeat(250)).includes("�"));
}

// ── Notes go with permanently deleted mail ───────────────────────
{
	const { sql } = mailboxDb();
	insertEmail(sql, "a1", "thread-a");
	insertEmail(sql, "a2", "thread-a");
	createThreadNote(sql, "thread-a", "ada", { body: "thread", noteType: "sticky" }, { id: "t" });
	createThreadNote(sql, "thread-a", "ada", { body: "on a1", noteType: "inline", emailId: "a1" }, { id: "i1" });
	createThreadNote(sql, "thread-a", "bob", { body: "on a2", noteType: "inline", emailId: "a2" }, { id: "i2" });

	sql.exec(`DELETE FROM emails WHERE id = 'a1'`);
	deleteThreadNotesForDeletedEmail(sql, "a1", "thread-a");
	assert.deepEqual(sql.exec(`SELECT id FROM thread_notes ORDER BY id`).map((r) => r.id), ["i2", "t"]);

	sql.exec(`DELETE FROM emails WHERE id = 'a2'`);
	deleteThreadNotesForDeletedEmail(sql, "a2", "thread-a");
	assert.equal(count(sql, `SELECT COUNT(*) FROM thread_notes`), 0, "last email gone: thread notes gone");
}

// ── HTTP routes ──────────────────────────────────────────────────
{
	const { sql } = mailboxDb();
	insertEmail(sql, "a1", "thread-a");
	insertEmail(sql, "a2", "thread-a");
	insertEmail(sql, "b1", "thread-b");

	// Stub methods mirror MailboxDO's, over the real note SQL.
	const stubCalls = [];
	const mailboxNamespace = mockMailboxNamespace({
		getThreadNotes: async (threadId, userId) => listThreadNotes(sql, threadId, userId),
		createThreadNote: async (threadId, userId, input) => createThreadNote(sql, threadId, userId, input),
		updateThreadNote: async (noteId, userId, input) => updateThreadNote(sql, noteId, userId, input),
		deleteThreadNote: async (noteId, userId) => deleteThreadNote(sql, noteId, userId) !== null,
		getThreadedEmails: async (options) => {
			stubCalls.push(options);
			return withThreadNoteFields(sql, [{ id: "a2", thread_id: "thread-a" }], options.userId);
		},
		countThreadedEmails: async () => 1,
	});
	const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mailboxNamespace });
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
	const bob = await addUser(db, { id: "bob", email: "bob@gmail.com" });
	const eve = await addUser(db, { id: "eve", email: "eve@inboxies.email" });
	await addMailbox(db, bucket, "shared@inboxies.email", { owners: ["ada"], members: ["bob"] });
	const [asAda, asBob, asEve] = [ada, bob, eve].map((u) => principalFor(u));
	const base = "/api/v1/mailboxes/shared@inboxies.email";

	const created = await request(env, {
		method: "POST",
		path: `${base}/threads/thread-a/notes`,
		principal: asAda,
		body: { body: "# Remember\n- invoice", noteType: "sticky", posX: 4, posY: 8 },
	});
	assert.equal(created.status, 201);
	assert.equal(created.payload.threadId, "thread-a");
	assert.equal(created.payload.noteType, "sticky");
	assert.equal(created.payload.posX, 4);
	assert.equal("author_user_id" in created.payload || "authorUserId" in created.payload, false);
	const noteId = created.payload.id;

	const inline = await request(env, {
		method: "POST",
		path: `${base}/threads/thread-a/notes`,
		principal: asAda,
		body: { body: "re: this", noteType: "inline", emailId: "a1" },
	});
	assert.equal(inline.status, 201);

	// Validation → 400; unknown thread → 404.
	for (const body of [
		{ body: "", noteType: "sticky" },
		{ body: "x", noteType: "banner" },
		{ body: "x", noteType: "inline" },
		{ body: "x".repeat(THREAD_NOTE_BODY_MAX + 1), noteType: "sticky" },
	]) {
		const res = await request(env, { method: "POST", path: `${base}/threads/thread-a/notes`, principal: asAda, body });
		assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
	}
	const crossThread = await request(env, {
		method: "POST",
		path: `${base}/threads/thread-a/notes`,
		principal: asAda,
		body: { body: "x", noteType: "inline", emailId: "b1" },
	});
	assert.equal(crossThread.status, 400);
	assert.match(crossThread.payload.error, /not in this thread/);
	const missingThread = await request(env, {
		method: "POST",
		path: `${base}/threads/nope/notes`,
		principal: asAda,
		body: { body: "x", noteType: "sticky" },
	});
	assert.equal(missingThread.status, 404);

	// GET: Ada sees hers; Bob (same mailbox) sees nothing.
	const adaList = await request(env, { path: `${base}/threads/thread-a/notes`, principal: asAda });
	assert.equal(adaList.status, 200);
	assert.deepEqual(adaList.payload.notes.map((n) => n.noteType), ["sticky", "inline"]);
	const bobList = await request(env, { path: `${base}/threads/thread-a/notes`, principal: asBob });
	assert.deepEqual(bobList.payload, { notes: [] });

	// Someone else's note is a 404 for update and delete.
	const bobPatch = await request(env, { method: "PATCH", path: `${base}/notes/${noteId}`, principal: asBob, body: { body: "mine now" } });
	assert.equal(bobPatch.status, 404);
	const bobDelete = await request(env, { method: "DELETE", path: `${base}/notes/${noteId}`, principal: asBob });
	assert.equal(bobDelete.status, 404);

	// A non-member can't reach the mailbox at all.
	assert.equal((await request(env, { path: `${base}/threads/thread-a/notes`, principal: asEve })).status, 403);
	assert.equal((await request(env, { path: `${base}/threads/thread-a/notes` })).status, 403);

	// PATCH: body and/or position; empty patch and bad numbers are 400.
	const patched = await request(env, { method: "PATCH", path: `${base}/notes/${noteId}`, principal: asAda, body: { posX: 100.25 } });
	assert.equal(patched.status, 200);
	assert.equal(patched.payload.posX, 100.25);
	assert.equal(patched.payload.body, "# Remember\n- invoice");
	assert.equal((await request(env, { method: "PATCH", path: `${base}/notes/${noteId}`, principal: asAda, body: {} })).status, 400);
	assert.equal(
		(await request(env, { method: "PATCH", path: `${base}/notes/${noteId}`, principal: asAda, body: { posX: "left" } })).status,
		400,
	);
	assert.equal(
		(await request(env, { method: "PATCH", path: `${base}/notes/missing`, principal: asAda, body: { body: "x" } })).status,
		404,
	);

	// Threaded list carries the caller's note fields.
	const listed = await request(env, { path: `${base}/emails?folder=inbox&threaded=true`, principal: asAda });
	assert.equal(listed.status, 200);
	assert.equal(stubCalls.at(-1).userId, "ada", "list query gets the requesting user");
	assert.equal(listed.payload.emails[0].has_sticky_note, true);
	assert.equal(listed.payload.emails[0].sticky_note_text, "# Remember\n- invoice");
	assert.equal(listed.payload.emails[0].inline_note_count, 1);
	const bobListed = await request(env, { path: `${base}/emails?folder=inbox&threaded=true`, principal: asBob });
	assert.equal(bobListed.payload.emails[0].has_sticky_note, false);
	assert.equal(bobListed.payload.emails[0].sticky_note_text, null);
	assert.equal(bobListed.payload.emails[0].inline_note_count, 0);

	// DELETE.
	assert.equal((await request(env, { method: "DELETE", path: `${base}/notes/${noteId}`, principal: asAda })).status, 204);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/notes/${noteId}`, principal: asAda })).status, 404);
	const after = await request(env, { path: `${base}/threads/thread-a/notes`, principal: asAda });
	assert.deepEqual(after.payload.notes.map((n) => n.noteType), ["inline"]);
}

console.log("thread-notes tests passed");
