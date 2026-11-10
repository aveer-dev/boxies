/**
 * AVE-228: one definition per count label.
 * - Inbox "New" = conversations listed in the Inbox New section (the
 *   threaded list's `section=new` rows, its `newCount`).
 * - A folder's "unread" (`unreadThreadCount` on GET /folders) = conversations
 *   in that folder's threaded list that still hold unread mail. For the Inbox
 *   it is the New total, so the header, the New section, "All new" and the
 *   widget all read the same number.
 * The old `unreadCount` (unread messages) is kept for older clients and is
 * what made "7 unread" sit above "5 new".
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/unread-counts.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	countConversationsFromIndex,
	countThreadedSectionsByScan,
	countUnreadConversationsByFolder,
	flushConversationIndex,
	readThreadedListFromIndex,
} from "../lib/conversation-index.ts";
import { INBOX_NEW_PREVIEW_LIMIT, conversationIsNew } from "../../shared/list-sections.ts";

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

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");
const sql = sqlStorage(db);
applyMigrations(sql, mailboxMigrations);

const insert = db.prepare(
	`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, read, reply_later, thread_id)
	 VALUES (?, ?, ?, ?, 'me@example.com', ?, ?, ?, ?)`,
);
let day = 1;
function mail(id, folder, { read = false, thread = id, replyLater = false, subject = id } = {}) {
	const date = `2026-11-${String(day++).padStart(2, "0")}T09:00:00Z`;
	insert.run(id, folder, subject, `${id}@example.com`, date, read ? 1 : 0, replyLater ? 1 : 0, thread);
}

// Inbox: five New conversations holding seven unread messages.
mail("a1", "inbox", { thread: "A" });
mail("a2", "inbox", { thread: "A" });
mail("a3", "inbox", { thread: "A" }); // A: three unread messages, one conversation
mail("b1", "inbox", { thread: "B" });
mail("b2", "inbox", { thread: "B", read: true });
mail("c1", "inbox", { thread: "C" });
mail("d1", "inbox", { thread: "D", replyLater: true }); // Reply Later stays in the Inbox list
mail("e1", "inbox", { thread: "E" });
// Seen conversations.
mail("f1", "inbox", { thread: "F", read: true });
mail("g1", "inbox", { thread: "G", read: true });
// Not Inbox: Screener-pending, Spam, Screened out, Archive. None of these is New.
mail("s1", "screener", { thread: "S" });
mail("s2", "screener", { thread: "S2" });
mail("x1", "spam", { thread: "X" });
mail("o1", "screened_out", { thread: "O" });
mail("r1", "archive", { thread: "R" });
// A draft reply never makes a conversation New.
mail("g2", "draft", { thread: "G" });

while (!flushConversationIndex(sql, 50)) {
	/* drain */
}

const unreadMessages = (folder) =>
	Number(db.prepare(`SELECT COUNT(*) AS n FROM emails WHERE folder_id = ? AND read = 0`).get(folder).n);
const listNew = readThreadedListFromIndex(sql, "inbox", {
	limit: 100,
	offset: 0,
	useNewSeen: true,
	section: "new",
}).map((row) => ({ ...row, read: !!row.read }));
const preview = readThreadedListFromIndex(sql, "inbox", {
	limit: 25,
	offset: 0,
	useNewSeen: true,
	newLimit: INBOX_NEW_PREVIEW_LIMIT,
}).map((row) => ({ ...row, read: !!row.read }));
const byFolder = countUnreadConversationsByFolder(sql);
const inboxCounts = countConversationsFromIndex(sql, "inbox");

// The bug: messages vs conversations.
assert.equal(unreadMessages("inbox"), 7, "seven unread messages sit in the Inbox");
assert.equal(listNew.length, 5, "the All new page lists five conversations");

// One New number everywhere.
assert.equal(inboxCounts.newCount, 5, "list newCount");
assert.equal(byFolder.get("inbox"), 5, "Inbox unreadThreadCount equals New");
assert.equal(countThreadedSectionsByScan(sql, "inbox").newCount, 5, "scan fallback agrees");
assert.ok(listNew.every(conversationIsNew), "every All new row is New");
const previewNew = preview.filter(conversationIsNew);
assert.equal(previewNew.length, Math.min(5, INBOX_NEW_PREVIEW_LIMIT), "Inbox preview shows the cap");
assert.equal(
	previewNew.length + (inboxCounts.newCount - previewNew.length),
	byFolder.get("inbox"),
	"preview + 'N more' adds up to the same total",
);
assert.ok(listNew.some((row) => row.thread_id === "D"), "Reply Later mail still counts as New in the Inbox");
assert.ok(!listNew.some((row) => ["S", "S2", "X", "O", "R"].includes(row.thread_id)), "other folders never leak into New");

// Other folders count conversations too, matching their lists.
assert.equal(byFolder.get("screener"), 2, "Screener: two conversations");
assert.equal(byFolder.get("spam"), 1);
assert.equal(byFolder.get("archive"), 1);
assert.equal(byFolder.get("draft") ?? 0, 0, "drafts are never unread");
for (const folder of ["inbox", "screener", "spam", "archive", "screened_out", "sent", "trash"]) {
	assert.equal(
		byFolder.get(folder) ?? 0,
		countThreadedSectionsByScan(sql, folder).newCount,
		`${folder}: index and scan agree`,
	);
}

// Reading a whole conversation drops New and unread by exactly one.
db.exec(`UPDATE emails SET read = 1 WHERE thread_id = 'A'`);
while (!flushConversationIndex(sql, 50)) {
	/* drain */
}
assert.equal(countConversationsFromIndex(sql, "inbox").newCount, 4);
assert.equal(countUnreadConversationsByFolder(sql).get("inbox"), 4);
assert.equal(unreadMessages("inbox"), 4, "messages fell by three, which is why per-message math drifted");

// Accepting a Screener sender moves the conversation into the Inbox: New rises by one.
db.exec(`UPDATE emails SET folder_id = 'inbox' WHERE thread_id = 'S'`);
while (!flushConversationIndex(sql, 50)) {
	/* drain */
}
assert.equal(countConversationsFromIndex(sql, "inbox").newCount, 5);
assert.equal(countUnreadConversationsByFolder(sql).get("inbox"), 5);
assert.equal(countUnreadConversationsByFolder(sql).get("screener"), 1);

console.log("unread-counts: ok");
