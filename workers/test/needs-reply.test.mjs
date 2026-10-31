/**
 * AVE-173: "Needs reply" only on direct mail that is still waiting on the user.
 * The rule (workers/lib/conversation-index.ts needsReplySql): the newest
 * non-draft message of the conversation is in Inbox and carries
 * emails.direct_mail = 1 (workers/lib/direct-mail.ts directMailFlag). Read
 * state plays no part. Covers the flag, the migration 45 backfill, and the
 * index and scan agreeing on every case.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/needs-reply.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	conversationIndexIsClean,
	flushConversationIndex,
	readThreadedListByScan,
	readThreadedListFromIndex,
} from "../lib/conversation-index.ts";
import { directMailFlag, directMailFlagForStoredRow } from "../lib/direct-mail.ts";
import { backfillDirectMailBatch, hasPendingDirectMail } from "../lib/direct-mail-backfill.ts";

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

const ME = "me@example.com";
const headers = (...pairs) => JSON.stringify(pairs.map(([key, value]) => ({ key, value })));
const personal = headers(["From", "Alice <alice@friend.org>"], ["To", ME], ["Subject", "Dinner?"]);
const newsletter = headers(
	["From", "Weekly <news@brand.example>"],
	["List-Unsubscribe", "<https://brand.example/u>"],
	["List-Id", "<weekly.brand.example>"],
);
const notification = headers(["From", "GitHub <notifications@github.com>"], ["To", ME]);
const viaNoReplyReplyTo = headers(["From", "Shop <orders@shop.example>"], ["Reply-To", "Shop <no-reply@shop.example>"]);

// ── The per-message flag ──────────────────────────────────────────

const base = { headers: personal, sender: "alice@friend.org", recipients: [ME], ownAddresses: [ME] };
assert.equal(directMailFlag(base), 1, "personal mail is direct");
assert.equal(directMailFlag({ ...base, headers: newsletter }), 0, "newsletter");
assert.equal(directMailFlag({ ...base, sender: "notifications@github.com", headers: notification }), 0, "notification");
assert.equal(directMailFlag({ ...base, replyTo: ["no-reply@shop.example"] }), 0, "no-reply Reply-To");
assert.equal(directMailFlag({ ...base, recipients: ["team@lists.example"] }), 0, "Bcc / list delivery");
assert.equal(directMailFlag({ ...base, sender: "Me+x@Example.com" }), 0, "from the user themself");
assert.equal(directMailFlag({ ...base, folderId: "spam" }), 1, "folder is applied at read time, not stored");

assert.equal(directMailFlagForStoredRow({ raw_headers: personal, sender: "alice@friend.org" }, [ME]), 1);
assert.equal(directMailFlagForStoredRow({ raw_headers: newsletter, sender: "news@brand.example" }, [ME]), 0);
assert.equal(
	directMailFlagForStoredRow({ raw_headers: viaNoReplyReplyTo, sender: "orders@shop.example" }, [ME]),
	0,
	"stored Reply-To header is checked",
);
assert.equal(directMailFlagForStoredRow({ raw_headers: personal, sender: ME }, [ME]), 0, "own mail");
assert.equal(directMailFlagForStoredRow({ raw_headers: null, sender: "bob@friend.org" }, [null]), 1, "no headers, unknown mailbox");

// ── Mailbox: one conversation per case ────────────────────────────

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
const sql = sqlStorage(db);
applyMigrations(sql, mailboxMigrations);

let clock = Date.UTC(2026, 9, 1);
const insert = db.prepare(
	`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, read, thread_id, raw_headers, direct_mail)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
function mail(id, { folder = "inbox", thread = id, sender = "alice@friend.org", raw = personal, read = 1, direct = null }) {
	insert.run(id, folder, `Subject ${thread}`, sender, ME, new Date((clock += 60_000)).toISOString(), read, thread, raw, direct);
}

// Stored before migration 45 ran (flag NULL): the backfill computes it.
mail("direct", {});
mail("direct-unread", { read: 0 });
mail("newsletter", { sender: "news@brand.example", raw: newsletter });
mail("notification", { sender: "notifications@github.com", raw: notification });
mail("spam", { folder: "spam" });
mail("promo", { folder: "promotions" });
mail("replied-1", { thread: "replied" });
mail("replied-2", { thread: "replied", folder: "sent", sender: ME, raw: null });
mail("answered-back-1", { thread: "answered-back" });
mail("answered-back-2", { thread: "answered-back", folder: "sent", sender: ME, raw: null });
mail("answered-back-3", { thread: "answered-back" }); // they wrote again
mail("drafting-1", { thread: "drafting" });
mail("drafting-2", { thread: "drafting", folder: "draft", sender: ME, raw: null });
mail("own-sent", { folder: "sent", sender: ME, raw: null });
// Set at receive time (inbound path), e.g. Bcc delivery only the receiver can see.
mail("bcc", { direct: 0 });

const expected = {
	direct: true,
	"direct-unread": true,
	newsletter: false,
	notification: false,
	spam: false,
	promo: false,
	replied: false,
	"answered-back": true,
	drafting: true,
	"own-sent": false,
	bcc: false,
};

function flushAll() {
	let n = 0;
	while (!flushConversationIndex(sql, 3)) assert.ok(++n < 1000);
}

function needsReplyByConversation(read) {
	const out = {};
	for (const folder of ["inbox", "sent", "spam", "promotions"]) {
		for (const row of read(folder)) out[row.thread_id] = !!row.needs_reply;
	}
	return out;
}
const fromIndex = () =>
	needsReplyByConversation((folder) =>
		readThreadedListFromIndex(sql, folder, { limit: 100, offset: 0, useNewSeen: false }),
	);
const fromScan = () =>
	needsReplyByConversation((folder) =>
		readThreadedListByScan(sql, folder, { limit: 100, offset: 0, useNewSeen: false, sectionFilter: "1 = 1" }),
	);

// Before the backfill nothing is tagged: an unknown flag never needs a reply.
flushAll();
assert.ok(Object.values(fromIndex()).every((v) => v === false), "NULL flags are not tagged");
assert.deepEqual(fromScan(), fromIndex());

// Backfill in batches, as the alarm runs it.
assert.equal(hasPendingDirectMail(sql), true);
let batches = 0;
while (backfillDirectMailBatch(sql, [ME], 4)) batches++;
assert.ok(batches >= 2, "backfill ran in several batches");
assert.equal(hasPendingDirectMail(sql), false);
assert.equal(db.prepare(`SELECT direct_mail FROM emails WHERE id = 'replied-2'`).get().direct_mail, 0, "Sent is 0");
assert.equal(db.prepare(`SELECT direct_mail FROM emails WHERE id = 'bcc'`).get().direct_mail, 0, "kept as received");
assert.equal(conversationIndexIsClean(sql), false, "flag changes mark conversations dirty");
flushAll();
assert.deepEqual(fromIndex(), expected);
assert.deepEqual(fromScan(), expected, "scan fallback agrees");

// Replying clears it; moving out of Inbox clears it; moving back restores it.
mail("direct-reply", { thread: "direct", folder: "sent", sender: ME, raw: null, direct: 0 });
db.prepare(`UPDATE emails SET folder_id = 'archive' WHERE id = 'direct-unread'`).run();
db.prepare(`UPDATE emails SET folder_id = 'inbox' WHERE id = 'spam'`).run();
flushAll();
const after = { ...expected, direct: false, spam: true };
delete after["direct-unread"]; // now listed in Archive only
assert.deepEqual(fromIndex(), after);
assert.deepEqual(fromScan(), after);

// Reading mail does not change it (it used to be the trigger).
db.prepare(`UPDATE emails SET read = 0 WHERE id = 'answered-back-3'`).run();
db.prepare(`UPDATE emails SET read = 1`).run();
flushAll();
assert.deepEqual(fromIndex(), after);

// ── Migration 45 ──────────────────────────────────────────────────

{
	const migration = mailboxMigrations.find((m) => m.name === "45_direct_mail");
	assert.ok(migration, "45_direct_mail is registered");
	assert.equal(mailboxMigrations.at(-1), migration, "numbered last");
	assert.doesNotMatch(migration.sql, /\bUPDATE\s+emails\b|\bDELETE\s+FROM\b|\bDROP\b/i, "additive only");

	const legacy = new DatabaseSync(":memory:");
	const lsql = sqlStorage(legacy);
	applyMigrations(lsql, mailboxMigrations.slice(0, -1));
	legacy.exec(`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, read, raw_headers)
		VALUES ('old', 'inbox', 'Hi', 'alice@friend.org', '${ME}', '2026-01-01T00:00:00Z', 1, '${personal}')`);
	applyMigrations(lsql, mailboxMigrations);
	assert.equal(conversationIndexIsClean(lsql), false, "migration re-seeds every conversation");
	while (!flushConversationIndex(lsql, 100));
	assert.equal(legacy.prepare(`SELECT needs_reply FROM conversations`).get().needs_reply, 0, "untagged until computed");
	backfillDirectMailBatch(lsql, [ME]);
	while (!flushConversationIndex(lsql, 100));
	assert.equal(legacy.prepare(`SELECT needs_reply FROM conversations`).get().needs_reply, 1, "tagged after backfill");
}

console.log("needs-reply: ok");
