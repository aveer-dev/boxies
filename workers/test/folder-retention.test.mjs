/**
 * Spam / Trash retention (AVE-42): the retention clock (`retention_since`) is
 * set when mail enters Spam or Trash on every write path and cleared when it
 * leaves; the purge deletes only Spam / Trash mail whose clock is older than
 * 30 days, rows and R2 blobs, through the AVE-46 queue. Runs the real
 * MailboxDO migrations on node:sqlite against a fake R2 bucket.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/folder-retention.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { attachmentKey } from "../lib/attachments.ts";
import { emailBodyKey, emailRawKey } from "../lib/email-content.ts";
import {
	DAY_MS,
	FOLDER_RETENTION_MS,
	RETENTION_MAX_DELAY_MS,
	RETENTION_MIN_DELAY_MS,
	nextRetentionSweepDelayMs,
	purgeExpiredRetentionEmails,
} from "../lib/folder-retention.ts";
import { countPendingBlobDeletes, drainPendingBlobDeletes } from "../lib/pending-blob-deletes.ts";
import { FOLDER_RETENTION_DAYS, folderRetentionNotice } from "../../shared/folders.ts";

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

const FOLDERS = ["inbox", "archive", "spam", "trash", "sent", "draft"];

function mailboxDb(migrations = mailboxMigrations) {
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, migrations);
	for (const id of FOLDERS) {
		sql.exec(`INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES (?, ?, 0)`, id, id);
	}
	const transactionSync = (fn) => {
		db.exec("BEGIN");
		try {
			const result = fn();
			db.exec("COMMIT");
			return result;
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
	};
	return { db, sql, transactionSync };
}

function createBucket() {
	const store = new Map();
	return {
		store,
		async put(key, value) {
			store.set(key, value);
		},
		async delete(keys) {
			for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
		},
	};
}

function insertEmail(sql, id, folder, date = "2020-01-01T00:00:00.000Z") {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id)
		 VALUES (?, ?, 's', 'x@example.com', 'me@example.com', ?, ?)`,
		id,
		folder,
		date,
		id,
	);
}

const since = (sql, id) =>
	sql.exec(`SELECT retention_since AS s FROM emails WHERE id = ?`, id)[0]?.s ?? null;
const exists = (sql, id) => sql.exec(`SELECT 1 FROM emails WHERE id = ?`, id).length > 0;
const setSince = (sql, id, iso) =>
	sql.exec(`UPDATE emails SET retention_since = ? WHERE id = ?`, iso, id);

// ── Constants and notice copy ───────────────────────────────────
{
	assert.equal(FOLDER_RETENTION_DAYS, 30);
	assert.equal(FOLDER_RETENTION_MS, 30 * DAY_MS);
	assert.equal(folderRetentionNotice("spam"), "Messages in Spam are deleted after 30 days.");
	assert.equal(folderRetentionNotice("trash"), "Messages in Trash are deleted after 30 days.");
	assert.equal(folderRetentionNotice("inbox"), null);
	assert.equal(folderRetentionNotice("archive"), null);
}

// ── retention_since is set on the way in and cleared on the way out ─
{
	const { sql } = mailboxDb();
	const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

	// Inbound spam classification inserts straight into Spam.
	insertEmail(sql, "inbound-spam", "spam");
	assert.match(since(sql, "inbound-spam"), iso, "insert into Spam starts the clock");
	insertEmail(sql, "inbound-trash", "trash");
	assert.match(since(sql, "inbound-trash"), iso, "insert into Trash starts the clock");
	insertEmail(sql, "inbox-mail", "inbox");
	assert.equal(since(sql, "inbox-mail"), null, "inbox mail has no clock");

	// The clock counts from the move, not the (old) message date.
	const before = Date.now();
	sql.exec(`UPDATE emails SET folder_id = 'trash', reply_later = 0 WHERE id = 'inbox-mail'`);
	const started = Date.parse(since(sql, "inbox-mail"));
	assert.ok(started >= before - 1000 && started <= Date.now() + 1000, "move into Trash stamps now");

	// Moving out clears it.
	sql.exec(`UPDATE emails SET folder_id = 'inbox' WHERE id = 'inbox-mail'`);
	assert.equal(since(sql, "inbox-mail"), null, "restore from Trash clears the clock");

	// Spam → Trash restarts the clock (it entered Trash now).
	setSince(sql, "inbound-spam", "2000-01-01T00:00:00.000Z");
	sql.exec(`UPDATE emails SET folder_id = 'trash' WHERE id = 'inbound-spam'`);
	assert.notEqual(since(sql, "inbound-spam"), "2000-01-01T00:00:00.000Z", "Spam → Trash restarts");

	// Updates that don't change folder_id leave the clock alone.
	setSince(sql, "inbound-trash", "2000-01-01T00:00:00.000Z");
	sql.exec(`UPDATE emails SET read = 1, starred = 1 WHERE id = 'inbound-trash'`);
	sql.exec(`UPDATE emails SET folder_id = 'trash' WHERE id = 'inbound-trash'`);
	assert.equal(since(sql, "inbound-trash"), "2000-01-01T00:00:00.000Z", "same-folder update keeps clock");

	// Bulk paths (refile by sender, deleteFolder) go through the same trigger.
	insertEmail(sql, "bulk-1", "inbox");
	insertEmail(sql, "bulk-2", "inbox");
	sql.exec(`UPDATE emails SET folder_id = 'spam' WHERE id IN ('bulk-1', 'bulk-2')`);
	assert.match(since(sql, "bulk-1"), iso);
	assert.match(since(sql, "bulk-2"), iso);
	sql.exec(`UPDATE emails SET folder_id = 'archive' WHERE folder_id = 'spam'`);
	assert.equal(since(sql, "bulk-1"), null, "bulk move out of Spam clears");
	assert.equal(since(sql, "bulk-2"), null);
}

// ── Migration: mail already in Spam / Trash starts its clock at migration time ─
{
	const idx = mailboxMigrations.findIndex((m) => m.name === "34_spam_trash_retention");
	assert.ok(idx > 0, "retention migration registered");
	const { sql } = mailboxDb(mailboxMigrations.slice(0, idx));
	insertEmail(sql, "old-spam", "spam", "2019-01-01T00:00:00.000Z");
	insertEmail(sql, "old-trash", "trash", "2019-01-01T00:00:00.000Z");
	insertEmail(sql, "old-inbox", "inbox", "2019-01-01T00:00:00.000Z");
	const before = Date.now();
	applyMigrations(sql, mailboxMigrations);
	for (const id of ["old-spam", "old-trash"]) {
		const t = Date.parse(since(sql, id));
		assert.ok(t >= before - 1000, `${id} clock starts at migration time, not message date`);
	}
	assert.equal(since(sql, "old-inbox"), null);
	// Nothing existing is purged right after deploy, however old the message.
	const result = purgeExpiredRetentionEmails({ sql, transactionSync: (fn) => fn() });
	assert.deepEqual(result.deletedIds, [], "no purge on deploy day");
	assert.ok(exists(sql, "old-spam") && exists(sql, "old-trash"));
}

// ── Purge: old Spam / Trash deleted with blobs; new and other folders kept ─
{
	const { sql, transactionSync } = mailboxDb();
	const bucket = createBucket();
	const now = Date.UTC(2026, 9, 20);
	const old = new Date(now - 31 * DAY_MS).toISOString();
	const recent = new Date(now - 29 * DAY_MS).toISOString();

	const seed = async (id, folder, clock) => {
		insertEmail(sql, id, folder);
		if (clock !== undefined) setSince(sql, id, clock);
		await bucket.put(emailBodyKey(id), "body");
		await bucket.put(emailRawKey(id), "raw");
	};
	await seed("old-spam", "spam", old);
	await seed("old-trash", "trash", old);
	await seed("new-spam", "spam", recent);
	await seed("new-trash", "trash", recent);
	await seed("archive-old", "archive"); // old message date, never in Spam/Trash
	// Defensive: a stale clock on a non-retention folder must never purge.
	await seed("inbox-stale-clock", "inbox");
	sql.exec(`UPDATE emails SET retention_since = ? WHERE id = 'inbox-stale-clock'`, old);

	sql.exec(
		`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('att-1', 'old-trash', 'q3.csv', 'text/csv', 3)`,
	);
	await bucket.put(attachmentKey("old-trash", "att-1", "q3.csv"), "csv");
	sql.exec(
		`INSERT INTO emails_fts(id, subject, sender, sender_name, recipients, body_text) VALUES ('old-spam', 's', 'x', '', '', 'b')`,
	);

	// Next sweep: the oldest clock is overdue, so the minimum delay.
	assert.equal(nextRetentionSweepDelayMs(sql, now), RETENTION_MIN_DELAY_MS);

	const result = purgeExpiredRetentionEmails({ sql, transactionSync, now });
	assert.deepEqual([...result.deletedIds].sort(), ["old-spam", "old-trash"]);
	assert.equal(result.more, false);

	// Rows gone, blobs queued (row-first, AVE-46 order).
	assert.ok(!exists(sql, "old-spam") && !exists(sql, "old-trash"));
	assert.equal(sql.exec(`SELECT 1 FROM attachments WHERE email_id = 'old-trash'`).length, 0);
	assert.equal(sql.exec(`SELECT 1 FROM emails_fts WHERE id = 'old-spam'`).length, 0);
	assert.equal(countPendingBlobDeletes(sql), 5, "body + raw ×2 and one attachment queued");
	assert.ok(bucket.store.has(emailBodyKey("old-spam")), "blobs outlive rows until swept");

	const drained = await drainPendingBlobDeletes(sql, bucket);
	assert.equal(drained.error, null);
	assert.equal(countPendingBlobDeletes(sql), 0);
	for (const key of [
		emailBodyKey("old-spam"),
		emailRawKey("old-spam"),
		emailBodyKey("old-trash"),
		emailRawKey("old-trash"),
		attachmentKey("old-trash", "att-1", "q3.csv"),
	]) {
		assert.ok(!bucket.store.has(key), `${key} deleted from R2`);
	}

	// Newer Spam / Trash and other folders are kept, blobs included.
	for (const id of ["new-spam", "new-trash", "archive-old", "inbox-stale-clock"]) {
		assert.ok(exists(sql, id), `${id} kept`);
		assert.ok(bucket.store.has(emailBodyKey(id)), `${id} body kept`);
	}

	// Next sweep: when the newest-remaining clock expires (1 day), capped daily.
	const delay = nextRetentionSweepDelayMs(sql, now);
	assert.ok(delay > 0 && delay <= RETENTION_MAX_DELAY_MS);
	assert.equal(delay, RETENTION_MAX_DELAY_MS, "29-day-old clock: due in 1 day = daily cap");

	// A day later they expire too.
	const later = purgeExpiredRetentionEmails({ sql, transactionSync, now: now + 2 * DAY_MS });
	assert.deepEqual([...later.deletedIds].sort(), ["new-spam", "new-trash"]);
	assert.ok(exists(sql, "archive-old") && exists(sql, "inbox-stale-clock"));

	// Spam / Trash empty: no retention alarm needed.
	assert.equal(nextRetentionSweepDelayMs(sql, now), null);
}

// ── A message restored from Trash before expiry is never purged ──
{
	const { sql, transactionSync } = mailboxDb();
	const now = Date.now();
	insertEmail(sql, "restored", "trash");
	setSince(sql, "restored", new Date(now - 40 * DAY_MS).toISOString());
	sql.exec(`UPDATE emails SET folder_id = 'inbox' WHERE id = 'restored'`);
	const result = purgeExpiredRetentionEmails({ sql, transactionSync, now });
	assert.deepEqual(result.deletedIds, []);
	assert.ok(exists(sql, "restored"));
}

// ── Batching: a full batch reports more; repeated runs drain the backlog ─
{
	const { sql, transactionSync } = mailboxDb();
	const now = Date.now();
	const old = new Date(now - 60 * DAY_MS).toISOString();
	for (let i = 0; i < 5; i++) {
		insertEmail(sql, `bulk-${i}`, i % 2 ? "spam" : "trash");
		setSince(sql, `bulk-${i}`, old);
	}
	const first = purgeExpiredRetentionEmails({ sql, transactionSync, now, batchSize: 2 });
	assert.equal(first.deletedIds.length, 2);
	assert.equal(first.more, true);
	let total = first.deletedIds.length;
	let more = first.more;
	while (more) {
		const next = purgeExpiredRetentionEmails({ sql, transactionSync, now, batchSize: 2 });
		total += next.deletedIds.length;
		more = next.more;
	}
	assert.equal(total, 5);
	assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM emails`)[0].n, 0);
}

console.log("folder-retention tests passed");
