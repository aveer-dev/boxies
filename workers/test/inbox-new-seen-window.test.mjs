/**
 * AVE-23: Inbox New/Seen window on the real MailboxDO threaded list SQL
 * (node:sqlite + every mailbox migration). `new_limit` keeps the newest N New
 * conversations above every Seen one; `section` lists a single section.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/inbox-new-seen-window.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MailboxDO } from "../durableObject/index.ts";

const db = new DatabaseSync(":memory:");
const sql = {
	exec(query, ...bindings) {
		if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
			db.exec(query);
			return [];
		}
		const statement = db.prepare(query);
		if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /RETURNING/i.test(query)) {
			return statement.all(...bindings);
		}
		statement.run(...bindings);
		return [];
	},
	get databaseSize() {
		return 0;
	},
};
const storage = {
	sql,
	getAlarm: async () => null,
	setAlarm: async () => {},
	transactionSync: (fn) => fn(),
	get: async () => undefined,
	put: async () => {},
};
const mailbox = new MailboxDO({ storage, id: { toString: () => "test" } }, {});

const insert = db.prepare(
	`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id, read)
	 VALUES (?, 'inbox', ?, 'a@example.com', 'b@example.com', ?, ?, ?)`,
);
// 8 New (older) and 4 Seen (newer): without a window New fills the first page.
for (let i = 0; i < 8; i++) {
	insert.run(`n${i}`, `New ${i}`, `2026-01-${String(20 - i).padStart(2, "0")}T00:00:00Z`, `tn${i}`, 0);
}
for (let i = 0; i < 4; i++) {
	insert.run(`s${i}`, `Seen ${i}`, `2026-01-${String(28 - i).padStart(2, "0")}T00:00:00Z`, `ts${i}`, 1);
}

const list = (options) => mailbox.getThreadedEmails({ folder: "inbox", ...options });
const ids = async (options) => (await list(options)).map((row) => row.id);

// Default order is unchanged: every New, then Seen.
assert.deepEqual(await ids({}), ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "s0", "s1", "s2", "s3"]);

// new_limit=5: the newest five New, then all Seen, paginated over that window.
assert.deepEqual(await ids({ inboxSections: { newLimit: 5 } }), ["n0", "n1", "n2", "n3", "n4", "s0", "s1", "s2", "s3"]);
assert.deepEqual(await ids({ inboxSections: { newLimit: 5 }, limit: 4, page: 2 }), ["n4", "s0", "s1", "s2"]);

// section=new / section=seen: one section, date DESC, paginated.
assert.deepEqual(await ids({ inboxSections: { section: "new" }, limit: 3, page: 2 }), ["n3", "n4", "n5"]);
assert.deepEqual(await ids({ inboxSections: { section: "seen" } }), ["s0", "s1", "s2", "s3"]);

// Window helper columns never reach clients; sections stay annotated.
const [row] = await list({ inboxSections: { newLimit: 5 } });
assert.equal("is_new" in row, false);
assert.equal("section_rank" in row, false);
assert.equal(row.list_section, "new");

assert.deepEqual(await mailbox.countThreadedEmailSections("inbox"), { newCount: 8, seenCount: 4, totalCount: 12 });

// Other folders ignore the window.
insert.run("x0", "Archived", "2026-01-01T00:00:00Z", "tx0", 0);
db.prepare(`UPDATE emails SET folder_id = 'archive' WHERE id = 'x0'`).run();
assert.deepEqual(
	(await mailbox.getThreadedEmails({ folder: "archive", inboxSections: { section: "seen" } })).map((r) => r.id),
	["x0"],
);

console.log("inbox-new-seen-window: ok");
