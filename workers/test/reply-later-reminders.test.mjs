/**
 * Reply Later reminders (AVE-86): migration 43 on node:sqlite, input
 * validation, firing (unread + resurface + stays in the pile), dropping
 * reminders on Trash/Spam/Drafts, next-alarm lookup, due count, push copy.
 * Run: pnpm test:unit reply-later-reminders
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	REPLY_LATER_REMINDER_MAX_AHEAD_MS,
	countDueReplyLater,
	fireDueReplyLaterReminders,
	nextReplyLaterReminderAt,
	parseReminderInput,
	reminderPushCopy,
} from "../lib/reply-later-reminders.ts";

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

const sql = sqlStorage(new DatabaseSync(":memory:"));
applyMigrations(sql, mailboxMigrations);

// ── Migration is additive: columns + partial index exist ─────────
{
	const cols = sql.exec(`PRAGMA table_info(emails)`).map((c) => c.name);
	assert.ok(cols.includes("reply_later_remind_at"));
	assert.ok(cols.includes("reply_later_reminded_at"));
	const idx = sql.exec(`PRAGMA index_list(emails)`).map((i) => i.name);
	assert.ok(idx.includes("idx_emails_reply_later_remind_at"));
	// Re-running the migration list is a no-op.
	applyMigrations(sql, mailboxMigrations);
}

// ── Input validation ─────────────────────────────────────────────
{
	const now = Date.parse("2026-10-28T12:00:00.000Z");
	assert.deepEqual(parseReminderInput(null, now), { ok: true, remindAt: null });
	assert.deepEqual(parseReminderInput("2026-10-29T09:00:00-04:00", now), {
		ok: true,
		remindAt: "2026-10-29T13:00:00.000Z",
	});
	// Past times are accepted (offline replay) and fire on the next alarm.
	assert.equal(parseReminderInput("2026-10-27T09:00:00Z", now).ok, true);
	assert.equal(parseReminderInput("nope", now).ok, false);
	assert.equal(parseReminderInput("", now).ok, false);
	assert.equal(parseReminderInput(12345, now).ok, false);
	assert.equal(
		parseReminderInput(new Date(now + REPLY_LATER_REMINDER_MAX_AHEAD_MS + 60_000).toISOString(), now).ok,
		false,
	);
}

// ── Fixtures ─────────────────────────────────────────────────────
sql.exec(`INSERT OR IGNORE INTO folders (id, name) VALUES ('projects', 'Projects')`);
const insert = (id, folder, { read = 1, replyLater = 1, remindAt = null } = {}) =>
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, sender_name, date, read, reply_later, reply_later_at, reply_later_remind_at, thread_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		folder,
		`Subject ${id}`,
		`${id}@example.com`,
		id === "archived" ? "Ada Lovelace" : null,
		"2026-10-01T10:00:00.000Z",
		read,
		replyLater,
		replyLater ? "2026-10-20T10:00:00.000Z" : null,
		remindAt,
		`t-${id}`,
	);

insert("archived", "archive", { remindAt: "2026-10-28T11:00:00.000Z" });
insert("inboxed", "inbox", { remindAt: "2026-10-28T11:30:00.000Z" });
insert("custom", "projects", { remindAt: "2026-10-28T11:45:00.000Z" });
insert("sent", "sent", { remindAt: "2026-10-28T11:50:00.000Z" });
insert("trashed", "trash", { remindAt: "2026-10-28T11:00:00.000Z" });
insert("left-pile", "inbox", { replyLater: 0, remindAt: "2026-10-28T11:00:00.000Z" });
insert("future", "archive", { remindAt: "2026-10-30T13:00:00.000Z" });
insert("plain", "inbox");

const now = Date.parse("2026-10-28T12:00:00.000Z");
assert.equal(nextReplyLaterReminderAt(sql), Date.parse("2026-10-28T11:00:00.000Z"));
assert.equal(countDueReplyLater(sql), 0);

// ── Firing ───────────────────────────────────────────────────────
const result = fireDueReplyLaterReminders(sql, now);
assert.deepEqual(
	result.fired.map((r) => [r.id, r.from_folder_id, r.folder_id]),
	[
		["archived", "archive", "inbox"],
		["inboxed", "inbox", "inbox"],
		["custom", "projects", "inbox"],
		["sent", "sent", "sent"],
	],
);
assert.equal(result.dropped, 2);
assert.equal(result.more, false);

const row = (id) =>
	sql.exec(
		`SELECT folder_id, read, reply_later, reply_later_remind_at, reply_later_reminded_at FROM emails WHERE id = ?`,
		id,
	)[0];

// Fired: unread, stays in the pile, reminder consumed, stamped.
for (const id of ["archived", "inboxed", "custom"]) {
	const r = row(id);
	assert.equal(r.folder_id, "inbox", id);
	assert.equal(r.read, 0, id);
	assert.equal(r.reply_later, 1, id);
	assert.equal(r.reply_later_remind_at, null, id);
	assert.equal(r.reply_later_reminded_at, "2026-10-28T12:00:00.000Z", id);
}
// Trash / left the pile: dropped, never fired.
assert.equal(row("trashed").reply_later_remind_at, null);
assert.equal(row("trashed").reply_later_reminded_at, null);
assert.equal(row("left-pile").reply_later_reminded_at, null);
// Not yet due: untouched.
assert.equal(row("future").reply_later_remind_at, "2026-10-30T13:00:00.000Z");
assert.equal(row("future").folder_id, "archive");

// Fires exactly once.
assert.equal(fireDueReplyLaterReminders(sql, now + 60_000).fired.length, 0);
assert.equal(nextReplyLaterReminderAt(sql), Date.parse("2026-10-30T13:00:00.000Z"));

// Due = fired + unread + in the pile (outside Trash/Spam/Drafts).
assert.equal(countDueReplyLater(sql), 4);
sql.exec(`UPDATE emails SET read = 1 WHERE id = 'inboxed'`);
assert.equal(countDueReplyLater(sql), 3);

// Resurfaced mail outranks newer mail when sorted by max(date, reminded_at).
sql.exec(
	`INSERT INTO emails (id, folder_id, subject, date, read) VALUES ('newer', 'inbox', 'Newer', '2026-10-28T08:00:00.000Z', 0)`,
);
const order = sql
	.exec(
		`SELECT id FROM emails WHERE folder_id = 'inbox' AND read = 0
		  ORDER BY MAX(date, COALESCE(reply_later_reminded_at, date)) DESC, id`,
	)
	.map((r) => r.id);
assert.deepEqual(order.slice(0, 3), ["archived", "custom", "newer"]);

// Batch limit reports "more".
{
	const db2 = sqlStorage(new DatabaseSync(":memory:"));
	applyMigrations(db2, mailboxMigrations);
	for (let i = 0; i < 3; i++) {
		db2.exec(
			`INSERT INTO emails (id, folder_id, date, reply_later, reply_later_remind_at) VALUES (?, 'inbox', '2026-10-01T00:00:00.000Z', 1, '2026-10-28T00:00:00.000Z')`,
			`m${i}`,
		);
	}
	const first = fireDueReplyLaterReminders(db2, now, 2);
	assert.equal(first.fired.length, 2);
	assert.equal(first.more, true);
	assert.equal(fireDueReplyLaterReminders(db2, now, 2).fired.length, 1);
}

// ── Push copy ────────────────────────────────────────────────────
assert.deepEqual(reminderPushCopy({ subject: "Invoice", sender: "a@x.com", sender_name: "Ada" }), {
	title: "Reply Later reminder",
	subtitle: "Ada",
	body: "Invoice",
	fcmBody: "Ada\nInvoice",
});
assert.equal(reminderPushCopy({ subject: " ", sender: "a@x.com", sender_name: null }).body, "(No subject)");
assert.equal(reminderPushCopy({ subject: "x", sender: "a@x.com", sender_name: "" }).subtitle, "a@x.com");

console.log("reply-later-reminders: ok");
