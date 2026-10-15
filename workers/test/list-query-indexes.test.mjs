/**
 * AVE-52: list-query indexes. Builds the real MailboxDO schema (every migration,
 * through the real runner) on node:sqlite, seeds a mailbox, and checks with
 * EXPLAIN QUERY PLAN that the attachment / unread-count queries in
 * durableObject/index.ts use an index instead of scanning a table.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/list-query-indexes.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";

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

const MIGRATION = "30_list_query_indexes";

// ── The migration is additive only ─────────────────────────────
const migration = mailboxMigrations.find((m) => m.name === MIGRATION);
assert.ok(migration, `${MIGRATION} is registered`);
const statements = migration.sql
	.replace(/BEGIN TRANSACTION;|COMMIT;/g, "")
	.split(";")
	.map((s) => s.trim())
	.filter(Boolean);
assert.ok(statements.length > 0);
for (const s of statements) {
	assert.match(s, /^CREATE INDEX IF NOT EXISTS \w+ ON \w+\([\w, ]+\)$/, `additive only: ${s}`);
}
assert.equal(
	mailboxMigrations.filter((m) => m.name === MIGRATION).length,
	1,
	"migration name is unique",
);

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
const sql = sqlStorage(db);
applyMigrations(sql, mailboxMigrations);
// Runner is idempotent: re-applying is a no-op.
applyMigrations(sql, mailboxMigrations);
assert.equal(
	sql.exec(`SELECT COUNT(*) AS n FROM d1_migrations WHERE name = ?`, MIGRATION)[0].n,
	1,
);

// ── Seed a large-ish mailbox (no ANALYZE, like a Durable Object) ─
const folders = ["inbox", "sent", "archive", "trash", "spam"];
const insertEmail = db.prepare(
	`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, read, starred, thread_id, snippet)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const insertAttachment = db.prepare(
	`INSERT INTO attachments (id, email_id, filename, mimetype, size, disposition) VALUES (?, ?, ?, ?, ?, ?)`,
);
db.exec("BEGIN");
for (let i = 0; i < 5000; i++) {
	const thread = Math.floor(i / 3);
	insertEmail.run(
		`e${i}`,
		i % 10 < 6 ? "inbox" : folders[i % 5],
		`Subject ${thread}`,
		`s${i % 200}@example.com`,
		"me@example.com",
		new Date(1.7e12 + i * 60_000).toISOString(),
		i % 7 === 0 ? 0 : 1,
		i % 50 === 0 ? 1 : 0,
		i % 20 === 0 ? null : `t${thread}`,
		"snippet",
	);
	if (i % 8 === 0) {
		insertAttachment.run(`a${i}`, `e${i}`, "f.pdf", "application/pdf", 10, i % 16 === 0 ? "inline" : "attachment");
	}
}
db.exec("COMMIT");

function plan(query, ...params) {
	return db
		.prepare(`EXPLAIN QUERY PLAN ${query}`)
		.all(...params)
		.map((r) => r.detail);
}

function assertNoScan(details, table, label) {
	for (const d of details) {
		assert.ok(
			!new RegExp(`^SCAN ${table}\\b`).test(d),
			`${label}: unexpected full scan "${d}"\n${details.join("\n")}`,
		);
	}
}

function assertUses(details, index, label) {
	assert.ok(
		details.some((d) => d.includes(`INDEX ${index}`)),
		`${label}: expected ${index}\n${details.join("\n")}`,
	);
}

const ph = (n, offset = 0) => Array.from({ length: n }, (_, i) => `?${i + 1 + offset}`).join(",");
const ids = Array.from({ length: 25 }, (_, i) => `e${i * 3}`);
const threadIds = Array.from({ length: 25 }, (_, i) => `t${i}`);

// getThreadEmails: batch attachment fetch for a thread.
{
	const d = plan(`SELECT * FROM attachments WHERE email_id IN (${ph(3)})`, "e0", "e1", "e2");
	assertNoScan(d, "attachments", "getThreadEmails attachments");
	assertUses(d, "idx_attachments_email_id", "getThreadEmails attachments");
}

// getEmail: Drizzle select of one email's attachments.
{
	const d = plan(`select * from "attachments" where "attachments"."email_id" = ?`, "e0");
	assertNoScan(d, "attachments", "getEmail attachments");
	assertUses(d, "idx_attachments_email_id", "getEmail attachments");
}

// #attachmentCountsForEmails
{
	const d = plan(
		`SELECT email_id, COUNT(*) as count
		 FROM attachments
		 WHERE email_id IN (${ph(25)})
		   AND COALESCE(disposition, '') != 'inline'
		 GROUP BY email_id`,
		...ids,
	);
	assertNoScan(d, "attachments", "attachment counts");
	assertUses(d, "idx_attachments_email_id", "attachment counts");
}

// #withFileAttachmentFlag: runs after every list page.
{
	const d = plan(
		`SELECT DISTINCT e.id as email_id, e.thread_id as thread_id
		 FROM emails e
		 INNER JOIN attachments a ON a.email_id = e.id
		 WHERE COALESCE(a.disposition, '') != 'inline'
		   AND (e.id IN (${ph(25)}) OR e.thread_id IN (${ph(25, 25)}))`,
		...ids,
		...threadIds,
	);
	assertNoScan(d, "a", "has_attachment flag");
	assertNoScan(d, "e", "has_attachment flag");
	assertUses(d, "idx_attachments_email_id", "has_attachment flag");
}

// deleteEmail: ON DELETE CASCADE into attachments.
{
	const d = plan(`DELETE FROM emails WHERE id = ?`, "e5");
	assertNoScan(d, "attachments", "delete cascade");
	assertUses(d, "idx_attachments_email_id", "delete cascade");
}

// getFolders: per-folder unread badge (Drizzle left join + SUM).
{
	const d = plan(
		`select "folders"."id", "folders"."name", COALESCE(SUM(CASE WHEN "emails"."read" = 0 THEN 1 ELSE 0 END), 0)
		 from "folders" left join "emails" on "emails"."folder_id" = "folders"."id"
		 group by "folders"."id", "folders"."name"`,
	);
	assertNoScan(d, "emails", "getFolders unread");
	assert.ok(
		d.some((x) => x.includes("COVERING INDEX idx_emails_folder_read")),
		`getFolders reads unread state from the index alone\n${d.join("\n")}`,
	);
}

// Unread count for one folder.
{
	const d = plan(`SELECT COUNT(*) FROM emails WHERE folder_id = ?1 AND read = 0`, "inbox");
	assertNoScan(d, "emails", "folder unread count");
	assert.ok(
		d.some((x) => x.includes("COVERING INDEX idx_emails_folder_read (folder_id=? AND read=?)")),
		`folder unread count\n${d.join("\n")}`,
	);
}

// markThreadRead
{
	const d = plan(`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`, "t1");
	assertNoScan(d, "emails", "markThreadRead");
	assert.ok(
		d.some((x) => x.includes("idx_emails_thread_read (thread_id=? AND read=?)")),
		`markThreadRead\n${d.join("\n")}`,
	);
}

// Sanity: the queries still return the right rows with the indexes in place.
assert.equal(
	sql.exec(`SELECT COUNT(*) AS n FROM emails WHERE folder_id = 'inbox' AND read = 0`)[0].n,
	sql.exec(`SELECT COUNT(*) AS n FROM emails NOT INDEXED WHERE folder_id = 'inbox' AND read = 0`)[0].n,
);
sql.exec(`DELETE FROM emails WHERE id = ?`, "e8");
assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM attachments WHERE email_id = 'e8'`)[0].n, 0, "cascade still deletes");

console.log("list-query-indexes: ok");
