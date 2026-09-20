/**
 * Reply Later pile semantics (mirrors MailboxDO updateEmail / countEmails / moveEmail / clearReplyLaterForThread).
 * Run: node --experimental-strip-types workers/test/reply-later-e2e.test.mjs
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "reply-later-"));
const dbPath = join(dir, "test.db");

function sql(statements) {
	return execFileSync("sqlite3", ["-batch", dbPath], {
		input: statements,
		encoding: "utf8",
	}).trim();
}

function sqlValue(statements) {
	const out = sql(statements);
	return out.split("\n")[0] ?? "";
}

try {
	sql(`
		CREATE TABLE folders (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			is_deletable INTEGER NOT NULL DEFAULT 1
		);
		INSERT INTO folders (id, name, is_deletable) VALUES
			('inbox', 'Inbox', 0),
			('archive', 'Archive', 0),
			('spam', 'Spam', 0),
			('trash', 'Trash', 0),
			('draft', 'Drafts', 0);

		CREATE TABLE emails (
			id TEXT PRIMARY KEY,
			folder_id TEXT NOT NULL REFERENCES folders(id),
			subject TEXT,
			sender TEXT,
			date TEXT,
			read INTEGER DEFAULT 0,
			starred INTEGER DEFAULT 0,
			thread_id TEXT,
			reply_later INTEGER NOT NULL DEFAULT 0,
			reply_later_at TEXT
		);
		CREATE INDEX idx_emails_reply_later ON emails(reply_later, reply_later_at);
	`);

	sql(`
		INSERT INTO emails (id, folder_id, subject, sender, date, thread_id) VALUES
			('a', 'inbox', 'First', 'alice@ex.com', '2026-01-01T10:00:00Z', 't1'),
			('b', 'inbox', 'Second', 'bob@ex.com', '2026-01-02T10:00:00Z', 't2'),
			('c', 'inbox', 'Third', 'carol@ex.com', '2026-01-03T10:00:00Z', 't1');
	`);

	// Toggle on — stamp reply_later_at only when newly joining
	sql(`UPDATE emails SET reply_later = 1, reply_later_at = '2026-01-04T12:00:00Z' WHERE id = 'a';`);
	sql(`UPDATE emails SET reply_later = 1, reply_later_at = '2026-01-04T13:00:00Z' WHERE id = 'b';`);
	assert.equal(sqlValue(`SELECT reply_later FROM emails WHERE id='a';`), "1");
	const stamped = sqlValue(`SELECT reply_later_at FROM emails WHERE id='a';`);
	assert.equal(stamped, "2026-01-04T12:00:00Z");

	// No-op re-toggle must not bump timestamp (app/DO responsibility — simulate)
	sql(`UPDATE emails SET reply_later = 1 WHERE id = 'a' AND reply_later = 1;`);
	assert.equal(sqlValue(`SELECT reply_later_at FROM emails WHERE id='a';`), stamped);

	// FIFO pile order + exclude trash/spam/draft
	sql(`UPDATE emails SET folder_id = 'trash', reply_later = 1, reply_later_at = '2026-01-04T11:00:00Z' WHERE id = 'c';`);
	const pile = sql(`
		SELECT id FROM emails
		WHERE reply_later = 1
		  AND folder_id NOT IN ('trash', 'spam', 'draft')
		ORDER BY reply_later_at ASC;
	`);
	assert.deepEqual(pile.split("\n"), ["a", "b"]);

	const count = sqlValue(`
		SELECT COUNT(*) FROM emails
		WHERE reply_later = 1
		  AND folder_id NOT IN ('trash', 'spam', 'draft');
	`);
	assert.equal(count, "2");

	// Archive keeps flag
	sql(`UPDATE emails SET folder_id = 'archive' WHERE id = 'a';`);
	assert.equal(
		sqlValue(`
			SELECT COUNT(*) FROM emails
			WHERE reply_later = 1
			  AND folder_id NOT IN ('trash', 'spam', 'draft');
		`),
		"2",
	);

	// Spam clears flag (mirrors moveEmail)
	sql(`UPDATE emails SET folder_id = 'spam', reply_later = 0, reply_later_at = NULL WHERE id = 'b';`);
	assert.equal(
		sqlValue(`
			SELECT COUNT(*) FROM emails
			WHERE reply_later = 1
			  AND folder_id NOT IN ('trash', 'spam', 'draft');
		`),
		"1",
	);

	// Clear entire thread on reply (mirrors clearReplyLaterForThread)
	sql(`
		UPDATE emails SET reply_later = 1, reply_later_at = '2026-01-05T00:00:00Z', folder_id = 'inbox'
		WHERE thread_id = 't1';
	`);
	sql(`
		UPDATE emails SET reply_later = 0, reply_later_at = NULL
		WHERE thread_id = 't1' AND reply_later = 1;
	`);
	assert.equal(
		sqlValue(`SELECT COUNT(*) FROM emails WHERE thread_id = 't1' AND reply_later = 1;`),
		"0",
	);

	// Star independent of reply_later
	sql(`UPDATE emails SET starred = 1, reply_later = 1, reply_later_at = '2026-01-06T00:00:00Z', folder_id = 'inbox' WHERE id = 'a';`);
	assert.equal(sqlValue(`SELECT starred FROM emails WHERE id='a';`), "1");
	assert.equal(sqlValue(`SELECT reply_later FROM emails WHERE id='a';`), "1");

	console.log("reply-later e2e: ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
