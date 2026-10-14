/**
 * SQL behaviour behind MailboxDO fixes (mirrors the queries in durableObject/index.ts):
 * send rate-limit window, folder delete vs ON DELETE CASCADE, provider Message-ID
 * threading, and thread counts when a subject changes mid-thread.
 * Run: node --experimental-strip-types workers/test/mailbox-sql-fixes.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mailbox-sql-"));
const dbPath = join(dir, "test.db");

function sql(statements) {
	return execFileSync("sqlite3", ["-batch", dbPath], {
		// Durable Object SQLite enforces foreign keys.
		input: `PRAGMA foreign_keys = ON;\n${statements}`,
		encoding: "utf8",
	}).trim();
}

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 60 * 60 * 1000;

try {
	// ── Send rate limit: ISO text vs datetime() ────────────────────
	sql(`CREATE TABLE send_log (id INTEGER PRIMARY KEY AUTOINCREMENT, sent_at TEXT NOT NULL);`);
	// 20 sends 3–4 hours ago, i.e. well outside the last hour.
	const old = Array.from({ length: 20 }, (_, i) => `('${iso(3 * HOUR + i * 60_000)}')`).join(",");
	sql(`INSERT INTO send_log (sent_at) VALUES ${old};`);

	// The old query compared ISO strings ('…T…') to datetime() ('… …'); 'T' > ' '
	// so every send from the cutoff's calendar day counted as "last hour".
	const buggy = Number(
		sql(`SELECT COUNT(*) FROM send_log WHERE sent_at >= datetime('now', '-1 hour');`),
	);
	const fixed = Number(sql(`SELECT COUNT(*) FROM send_log WHERE sent_at >= '${iso(HOUR)}';`));
	assert.equal(fixed, 0, "sends from 3h ago are outside the hourly window");
	// (The buggy count depends on the time of day; just show it differs when it bites.)
	if (new Date(Date.now() - 4 * HOUR).getUTCDate() === new Date(Date.now() - HOUR).getUTCDate()) {
		assert.equal(buggy, 20, "old comparison counted the whole day");
	}

	// ── Folder delete: move mail out before deleting the folder ───
	sql(`
		CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_deletable INTEGER NOT NULL DEFAULT 1);
		INSERT INTO folders VALUES ('inbox','Inbox',0), ('receipts','Receipts',1), ('work','Work',1);
		CREATE TABLE emails (
			id TEXT PRIMARY KEY,
			folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
			subject TEXT, date TEXT, thread_id TEXT, message_id TEXT, provider_message_id TEXT, read INTEGER DEFAULT 0
		);
		INSERT INTO emails (id, folder_id, subject) VALUES ('r1','receipts','A'), ('r2','receipts','B'), ('w1','work','C');
	`);

	// Old behaviour: deleting the folder cascades and destroys its mail.
	sql(`DELETE FROM folders WHERE id = 'work';`);
	assert.equal(sql(`SELECT COUNT(*) FROM emails WHERE id = 'w1';`), "0", "cascade wiped the mail");

	// New behaviour (deleteFolder): move to Inbox, then delete, in one transaction.
	sql(`
		BEGIN;
		UPDATE emails SET folder_id = 'inbox' WHERE folder_id = 'receipts';
		DELETE FROM folders WHERE id = 'receipts';
		COMMIT;
	`);
	assert.equal(sql(`SELECT COUNT(*) FROM emails WHERE folder_id = 'inbox';`), "2", "mail survives in Inbox");

	// ── Threading by provider Message-ID ──────────────────────────
	sql(`
		INSERT INTO emails (id, folder_id, subject, date, thread_id, message_id, provider_message_id)
		VALUES ('s1', 'inbox', 'Quote', '2026-01-01T00:00:00Z', 'thread-1', 'ours-123@inboxies.email', '<cf-abc@mail.cloudflare.net>');
	`);
	// An external reply's In-Reply-To carries the id that was actually on the wire.
	const ref = "cf-abc@mail.cloudflare.net";
	const match = sql(`
		SELECT thread_id FROM emails
		WHERE message_id IN ('${ref}') OR id IN ('${ref}') OR TRIM(provider_message_id, '<>') IN ('${ref}')
		LIMIT 1;
	`);
	assert.equal(match, "thread-1");

	// ── Thread counts with a subject change ───────────────────────
	sql(`
		INSERT INTO emails (id, folder_id, subject, date, thread_id) VALUES
			('t1', 'inbox', 'Plans', '2026-01-02T00:00:00Z', 'thread-2'),
			('t2', 'inbox', 'Plans (updated)', '2026-01-03T00:00:00Z', 'thread-2');
	`);
	const counts = (joinTarget) =>
		sql(`
			WITH thread_to_conversation AS (
				SELECT COALESCE(thread_id, id) AS raw_thread_id, LOWER(subject) AS normalized_subject,
				       COALESCE(thread_id, id) AS conversation_id
				FROM emails GROUP BY raw_thread_id, normalized_subject, thread_id
			)
			SELECT COUNT(*) FROM emails e
			LEFT JOIN ${joinTarget} tc ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			WHERE e.thread_id = 'thread-2';
		`);
	assert.equal(counts("thread_to_conversation"), "4", "old join doubled the thread");
	assert.equal(
		counts(
			"(SELECT raw_thread_id, MIN(conversation_id) AS conversation_id FROM thread_to_conversation GROUP BY raw_thread_id)",
		),
		"2",
		"deduped join counts each message once",
	);

	console.log("mailbox SQL fix tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
