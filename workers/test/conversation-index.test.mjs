/**
 * AVE-105: the threaded list reads a denormalized `conversations` table.
 * Equivalence: on a varied mailbox (threads spanning folders, legacy
 * unthreaded mail grouped by subject, unread mixes, drafts, Spam / Trash,
 * Screener, Reply Later), and after every round of random writes (insert,
 * move, delete, read / unread, star, subject / date / thread changes), the
 * index returns exactly the rows, order and counts of the original scan.
 * Also: the 42_conversation_index migration backfill, and partial flushes.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/conversation-index.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	conversationIndexIsClean,
	countConversationsFromIndex,
	countThreadedByScan,
	countThreadedSectionsByScan,
	flushConversationIndex,
	readThreadedListByScan,
	readThreadedListFromIndex,
} from "../lib/conversation-index.ts";
import { inboxSectionFilterSql } from "../../shared/list-sections.ts";

/** `ctx.storage.sql` stand-in with a statement cache, like the DO runtime. */
function sqlStorage(db) {
	const cache = new Map();
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			let statement = cache.get(query);
			if (!statement) {
				statement = db.prepare(query);
				cache.set(query, statement);
			}
			return statement.all(...bindings);
		},
	};
}

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const LIST_FOLDERS = [
	"inbox", "Inbox", "sent", "archive", "trash", "spam", "screener", "promotions", "projects", "nope",
];
const strip = ({ is_new: _n, section_rank: _r, sort_date: _s, ...row }) => ({ ...row });

function compareFolder(sql, folder, label) {
	const [folderRow] = sql.exec(`SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1`, folder);
	const folderId = folderRow?.id ?? null;
	const useNewSeen = folderId === "inbox" && folder === "inbox";
	const windows = useNewSeen
		? [{}, { section: "new" }, { section: "seen" }, { newLimit: 0 }, { newLimit: 3 }, { newLimit: 100 }]
		: [{}];
	for (const sections of windows) {
		for (const [limit, offset] of [[100, 0], [7, 0], [7, 7], [5, 3], [25, 50]]) {
			const scan = readThreadedListByScan(sql, folder, {
				limit,
				offset,
				useNewSeen,
				sectionFilter: useNewSeen ? inboxSectionFilterSql(sections) : "1 = 1",
			}).map(strip);
			const index =
				folderId === null
					? []
					: readThreadedListFromIndex(sql, folderId, {
							limit,
							offset,
							useNewSeen,
							section: sections.section,
							newLimit: sections.newLimit,
						}).map(strip);
			assert.deepEqual(
				index,
				scan,
				`${label}: ${folder} ${JSON.stringify(sections)} limit=${limit} offset=${offset}`,
			);
		}
	}

	// Counts: Inbox New / Seen are unchanged; the folder total equals the
	// number of conversations the list shows.
	const everything = readThreadedListByScan(sql, folder, {
		limit: 100000,
		offset: 0,
		useNewSeen: false,
		sectionFilter: "1 = 1",
	});
	const counts = folderId === null ? { totalCount: 0, newCount: 0, seenCount: 0 } : countConversationsFromIndex(sql, folderId);
	assert.equal(counts.totalCount, everything.length, `${label}: ${folder} total`);
	if (useNewSeen) {
		assert.deepEqual(counts, countThreadedSectionsByScan(sql, folder), `${label}: ${folder} sections`);
	}
	return { counts, scanCount: countThreadedByScan(sql, folder) };
}

function compareAll(sql, label) {
	assert.ok(conversationIndexIsClean(sql), `${label}: flushed`);
	const out = {};
	for (const folder of LIST_FOLDERS) out[folder] = compareFolder(sql, folder, label);
	return out;
}

function flushAll(sql, budget) {
	let rounds = 0;
	while (!flushConversationIndex(sql, budget)) {
		rounds++;
		assert.ok(rounds < 10000, "flush terminates");
	}
	return rounds + 1;
}

// ── Mailbox fixture ───────────────────────────────────────────────

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
const sql = sqlStorage(db);
applyMigrations(sql, mailboxMigrations);
db.exec(`INSERT INTO folders (id, name, is_deletable) VALUES ('projects', 'Projects', 1)`);

const MAIL_FOLDERS = ["inbox", "inbox", "inbox", "sent", "archive", "trash", "spam", "screener", "promotions", "draft", "projects"];
const SUBJECTS = [
	"Lunch?", "Re: Lunch?", "RE: lunch?", "Fwd: Lunch?", "Quarterly report", "Re: Quarterly report",
	"", "  ", null, "AW: Plan", "Plan", "SV: Plan", "Invoice", "Fw: Invoice", "Hello",
];
const NAMES = ["Alice", "", "  ", null, "Bob", "Carol", "alice"];
// AVE-173 needs_reply: direct mail (1), not direct (0), not computed yet (NULL).
const DIRECT_FLAGS = [1, 1, 0, null];
const SENDERS = ["alice@example.com", "bob@example.com", "carol@example.com", "me@example.com"];

const random = rng(Number(process.env.CONVERSATION_INDEX_SEED ?? 105));
const pick = (list) => list[Math.floor(random() * list.length)];
let seq = 0;
let clock = Date.UTC(2026, 0, 1);
const nextDate = () => new Date((clock += 60_000 + Math.floor(random() * 1000))).toISOString();
const ids = () => db.prepare(`SELECT id FROM emails ORDER BY id`).all().map((r) => r.id);
const threadKeys = () =>
	db.prepare(`SELECT DISTINCT COALESCE(thread_id, id) AS k FROM emails`).all().map((r) => r.k);

const insertEmail = db.prepare(
	`INSERT INTO emails (id, folder_id, subject, sender, sender_name, recipient, date, read, starred, reply_later, thread_id, snippet, direct_mail)
	 VALUES (?, ?, ?, ?, ?, 'me@example.com', ?, ?, ?, ?, ?, ?, ?)`,
);

function addEmail({ threadId } = {}) {
	const id = `m${String(seq++).padStart(4, "0")}${pick(["", "a", "z"])}`;
	const keys = threadKeys();
	let thread;
	if (threadId !== undefined) thread = threadId;
	else {
		const r = random();
		// Unthreaded (legacy / fresh compose), a new thread, or a reply in an
		// existing conversation (including one rooted at an unthreaded id).
		thread = r < 0.3 ? null : r < 0.5 || keys.length === 0 ? `${pick(["a", "m", "t"])}${seq}` : pick(keys);
	}
	insertEmail.run(
		id,
		pick(MAIL_FOLDERS),
		pick(SUBJECTS),
		pick(SENDERS),
		pick(NAMES),
		nextDate(),
		random() < 0.4 ? 0 : 1,
		random() < 0.1 ? 1 : 0,
		random() < 0.1 ? 1 : 0,
		thread,
		`snippet ${id}`,
		pick(DIRECT_FLAGS),
	);
	return id;
}

for (let i = 0; i < 400; i++) addEmail();
// A thread whose root is unthreaded mail, replies threaded on its id.
const root = addEmail({ threadId: null });
for (let i = 0; i < 3; i++) addEmail({ threadId: root });

// ── Backfill via the migration seed ───────────────────────────────

// Mail inserted after the migration is already marked; the seeded backfill
// covers mail that predates it (tested in isolation below).
assert.equal(conversationIndexIsClean(sql), false, "writes leave dirty marks");
flushAll(sql, 37);
const initial = compareAll(sql, "initial");
assert.ok(initial.inbox.counts.totalCount > 20, "fixture lists a real inbox");
assert.ok(initial.inbox.counts.newCount > 0 && initial.inbox.counts.seenCount > 0, "inbox has New and Seen");
{
	const tagged = db.prepare(`SELECT needs_reply, COUNT(*) AS n FROM conversations GROUP BY needs_reply`).all();
	assert.equal(tagged.length, 2, "fixture has conversations with and without needs_reply");
}

// ── Random writes, compared after each round ──────────────────────

const ops = {
	insert: () => addEmail(),
	move: () => db.prepare(`UPDATE emails SET folder_id = ? WHERE id = ?`).run(pick(MAIL_FOLDERS), pick(ids())),
	moveThread: () =>
		db.prepare(`UPDATE emails SET folder_id = ? WHERE COALESCE(thread_id, id) = ?`).run(pick(MAIL_FOLDERS), pick(threadKeys())),
	delete: () => db.prepare(`DELETE FROM emails WHERE id = ?`).run(pick(ids())),
	read: () => db.prepare(`UPDATE emails SET read = 1 - COALESCE(read, 0) WHERE id = ?`).run(pick(ids())),
	readThread: () => db.prepare(`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`).run(pick(threadKeys())),
	star: () => db.prepare(`UPDATE emails SET starred = 1 - COALESCE(starred, 0) WHERE id = ?`).run(pick(ids())),
	replyLater: () =>
		db.prepare(`UPDATE emails SET reply_later = 1, reply_later_at = ? WHERE id = ?`).run(nextDate(), pick(ids())),
	// AVE-86: a fired reminder (unread, back to Inbox, stamped) lifts the
	// conversation's sort date; clearing Reply Later drops it again.
	remindFire: () =>
		db
			.prepare(`UPDATE emails SET reply_later = 1, read = 0, folder_id = 'inbox', reply_later_reminded_at = ? WHERE id = ?`)
			.run(nextDate(), pick(ids())),
	remindFireInPlace: () =>
		db.prepare(`UPDATE emails SET reply_later = 1, reply_later_reminded_at = ? WHERE id = ?`).run(nextDate(), pick(ids())),
	clearReplyLater: () =>
		db
			.prepare(`UPDATE emails SET reply_later = 0, reply_later_at = NULL, reply_later_remind_at = NULL, reply_later_reminded_at = NULL WHERE id = ?`)
			.run(pick(ids())),
	subject: () => db.prepare(`UPDATE emails SET subject = ? WHERE id = ?`).run(pick(SUBJECTS), pick(ids())),
	sender: () => db.prepare(`UPDATE emails SET sender_name = ? WHERE id = ?`).run(pick(NAMES), pick(ids())),
	date: () => db.prepare(`UPDATE emails SET date = ? WHERE id = ?`).run(nextDate(), pick(ids())),
	mergeThreads: () => db.prepare(`UPDATE emails SET thread_id = ? WHERE thread_id = ?`).run(pick(threadKeys()), pick(threadKeys())),
	unthread: () => db.prepare(`UPDATE emails SET thread_id = NULL WHERE id = ?`).run(pick(ids())),
	snippet: () => db.prepare(`UPDATE emails SET snippet = 'changed' WHERE id = ?`).run(pick(ids())),
	direct: () => db.prepare(`UPDATE emails SET direct_mail = ? WHERE id = ?`).run(pick(DIRECT_FLAGS), pick(ids())),
	emptyTrash: () => db.prepare(`DELETE FROM emails WHERE folder_id = 'trash'`).run(),
	deleteFolder: () => {
		db.prepare(`DELETE FROM folders WHERE id = 'projects'`).run(); // cascades to its mail
		db.prepare(`INSERT INTO folders (id, name, is_deletable) VALUES ('projects', 'Projects', 1)`).run();
	},
};
const opNames = Object.keys(ops);
for (let round = 0; round < 48; round++) {
	const n = 1 + Math.floor(random() * 6);
	const applied = [];
	for (let i = 0; i < n; i++) {
		const name = round < opNames.length && i === 0 ? opNames[round] : pick(opNames);
		ops[name]();
		applied.push(name);
	}
	flushAll(sql, 1 + Math.floor(random() * 5));
	compareAll(sql, `round ${round} (${applied.join(", ")})`);
}

// The index stays consistent with a full rebuild from scratch.
const snapshot = () => ({
	conversations: db.prepare(`SELECT * FROM conversations ORDER BY folder_id, conversation_id`).all(),
	members: db.prepare(`SELECT * FROM conversation_members ORDER BY folder_id, raw_key`).all(),
});
const incremental = snapshot();
db.exec(`DELETE FROM conversations; DELETE FROM conversation_members;`);
db.exec(`INSERT INTO conversation_dirty (raw_key, folder_id, normalized_subject)
         SELECT DISTINCT COALESCE(thread_id, id), folder_id, NULL FROM emails`);
flushAll(sql, 1000);
assert.deepEqual(snapshot(), incremental, "incremental index equals a rebuild");

// ── Count semantics ───────────────────────────────────────────────

// The folder total is the number of listed conversations. The old non-Inbox
// count disagreed with its own list only when two unthreaded messages with an
// empty subject (or a mixed threaded / unthreaded key) sat in one folder.
{
	const quirk = new DatabaseSync(":memory:");
	const qsql = sqlStorage(quirk);
	applyMigrations(qsql, mailboxMigrations);
	quirk.exec(`INSERT INTO emails (id, folder_id, subject, date) VALUES
		('q1', 'sent', '', '2026-01-01T00:00:00Z'),
		('q2', 'sent', '', '2026-01-02T00:00:00Z'),
		('q3', 'sent', 'Lunch', '2026-01-03T00:00:00Z')`);
	flushAll(qsql, 10);
	const listed = readThreadedListByScan(qsql, "sent", { limit: 100, offset: 0, useNewSeen: false, sectionFilter: "1 = 1" });
	assert.equal(listed.length, 2, "the list merges the empty-subject pair");
	assert.equal(countThreadedByScan(qsql, "sent"), 3, "the old count did not");
	assert.equal(countConversationsFromIndex(qsql, "sent").totalCount, 2, "the index count matches the list");
	compareFolder(qsql, "sent", "quirk");
}

// ── Migration backfill ────────────────────────────────────────────

{
	const MIGRATION = "42_conversation_index";
	const migration = mailboxMigrations.find((m) => m.name === MIGRATION);
	assert.ok(migration, `${MIGRATION} is registered`);
	assert.equal(mailboxMigrations.filter((m) => m.name === MIGRATION).length, 1, "unique name");
	// Later migrations (43_reply_later_reminders) follow it; the DO in this
	// block predates 42 and is brought fully up to date.
	const migrationIndex = mailboxMigrations.indexOf(migration);
	// Additive only: no DROP, ALTER, UPDATE, or DELETE outside trigger bodies
	// (which only append dirty marks).
	assert.doesNotMatch(migration.sql, /\b(DROP|ALTER)\b/i);
	assert.doesNotMatch(migration.sql, /\bUPDATE\s+emails\b|\bDELETE\s+FROM\b/i);

	const before = mailboxMigrations.slice(0, migrationIndex);
	const legacy = new DatabaseSync(":memory:");
	legacy.exec("PRAGMA foreign_keys = ON");
	const lsql = sqlStorage(legacy);
	applyMigrations(lsql, before);
	legacy.exec(`INSERT INTO folders (id, name, is_deletable) VALUES ('projects', 'Projects', 1)`);
	// Copy the random mailbox into a DO that predates the migration.
	const rowsToCopy = db.prepare(`SELECT id, folder_id, subject, sender, sender_name, recipient, date, read, starred, reply_later, reply_later_at, thread_id, snippet FROM emails ORDER BY rowid`).all();
	const copy = legacy.prepare(`INSERT INTO emails (id, folder_id, subject, sender, sender_name, recipient, date, read, starred, reply_later, reply_later_at, thread_id, snippet)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
	for (const r of rowsToCopy) {
		copy.run(r.id, r.folder_id, r.subject, r.sender, r.sender_name, r.recipient, r.date, r.read, r.starred, r.reply_later, r.reply_later_at, r.thread_id, r.snippet);
	}
	const emailCount = legacy.prepare(`SELECT COUNT(*) AS n FROM emails`).get().n;
	const emailsBefore = legacy.prepare(`SELECT * FROM emails ORDER BY id`).all();
	const legacyColumns = Object.keys(emailsBefore[0]).join(", ");

	applyMigrations(lsql, mailboxMigrations);
	assert.equal(lsql.exec(`SELECT COUNT(*) AS n FROM d1_migrations WHERE name = ?`, MIGRATION)[0].n, 1);
	assert.equal(legacy.prepare(`SELECT COUNT(*) AS n FROM conversations`).get().n, 0, "rows come from the backfill");
	assert.equal(conversationIndexIsClean(lsql), false, "migration seeds the backfill");
	assert.deepEqual(legacy.prepare(`SELECT ${legacyColumns} FROM emails ORDER BY id`).all(), emailsBefore, "no email data changes");
	// Columns added after 42 (AVE-86 reminders) carry over as the mail syncs.
	const copyReminder = legacy.prepare(
		`UPDATE emails SET reply_later_remind_at = ?, reply_later_reminded_at = ? WHERE id = ?`,
	);
	for (const r of db
		.prepare(`SELECT id, reply_later_remind_at, reply_later_reminded_at FROM emails
		          WHERE reply_later_remind_at IS NOT NULL OR reply_later_reminded_at IS NOT NULL`)
		.all()) {
		copyReminder.run(r.reply_later_remind_at, r.reply_later_reminded_at, r.id);
	}
	// AVE-173's direct-mail flag (migration 45) likewise.
	const copyDirect = legacy.prepare(`UPDATE emails SET direct_mail = ? WHERE id = ?`);
	for (const r of db.prepare(`SELECT id, direct_mail FROM emails WHERE direct_mail IS NOT NULL`).all()) {
		copyDirect.run(r.direct_mail, r.id);
	}

	// Batched backfill (as the alarm runs it), with a write between batches.
	assert.equal(flushConversationIndex(lsql, 25), false, "first batch leaves work");
	legacy.prepare(`UPDATE emails SET read = 0 WHERE id = (SELECT MIN(id) FROM emails)`).run();
	db.prepare(`UPDATE emails SET read = 0 WHERE id = (SELECT MIN(id) FROM emails)`).run();
	const rounds = flushAll(lsql, 25);
	assert.ok(rounds > 1, "backfill ran in several batches");
	compareAll(lsql, "after backfill");
	assert.equal(legacy.prepare(`SELECT COUNT(*) AS n FROM emails`).get().n, emailCount);

	// Idempotent: the runner skips it, and re-seeding rebuilds the same index.
	const built = {
		conversations: legacy.prepare(`SELECT * FROM conversations ORDER BY folder_id, conversation_id`).all(),
		members: legacy.prepare(`SELECT * FROM conversation_members ORDER BY folder_id, raw_key`).all(),
	};
	applyMigrations(lsql, mailboxMigrations);
	assert.equal(conversationIndexIsClean(lsql), true, "runner does not re-apply");
	legacy.exec(migration.sql.replace(/^\s*BEGIN TRANSACTION;|COMMIT;\s*$/g, ""));
	assert.equal(conversationIndexIsClean(lsql), false);
	flushAll(lsql, 500);
	assert.deepEqual(
		{
			conversations: legacy.prepare(`SELECT * FROM conversations ORDER BY folder_id, conversation_id`).all(),
			members: legacy.prepare(`SELECT * FROM conversation_members ORDER BY folder_id, raw_key`).all(),
		},
		built,
		"re-running the backfill is a no-op",
	);

	// Both mailboxes hold the same mail now, so the indexes match too.
	flushAll(sql, 500);
	assert.deepEqual(built.conversations, db.prepare(`SELECT * FROM conversations ORDER BY folder_id, conversation_id`).all());
}

// ── Mailbox purge empties the index ───────────────────────────────

{
	const { MAILBOX_PURGE_TABLES } = await import("../lib/mailbox-purge.ts");
	for (const table of ["conversations", "conversation_members", "conversation_dirty"]) {
		assert.ok(MAILBOX_PURGE_TABLES.includes(table), `purge empties ${table}`);
	}
	assert.ok(
		MAILBOX_PURGE_TABLES.indexOf("conversation_dirty") > MAILBOX_PURGE_TABLES.indexOf("emails"),
		"dirty marks are cleared after the emails that create them",
	);
}

console.log("conversation-index: ok");
