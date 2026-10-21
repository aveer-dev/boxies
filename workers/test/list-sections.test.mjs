/**
 * Inbox New/Seen list helpers (shared + web UI builders).
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import {
	applyReadToEmails,
	buildInboxListItems,
	conversationIsNew,
	countListSections,
	folderUsesNewSeen,
	listSectionFor,
	patchEmailListCache,
	sortNewThenSeen,
	annotateListSections,
	INBOX_NEW_PREVIEW_LIMIT,
	inboxSectionFilterSql,
	inboxSectionTotal,
	parseInboxSectionQuery,
} from "../../shared/list-sections.ts";
import { DatabaseSync } from "node:sqlite";
import { Folders } from "../../shared/folders.ts";

assert.equal(folderUsesNewSeen(Folders.INBOX), true);
assert.equal(folderUsesNewSeen(Folders.PROMOTIONS), false);

assert.equal(conversationIsNew({ read: false }), true);
assert.equal(conversationIsNew({ read: true, thread_unread_count: 0 }), false);
assert.equal(conversationIsNew({ read: true, thread_unread_count: 2 }), true);
assert.equal(
	conversationIsNew({ read: false, folder_id: Folders.DRAFT }),
	false,
);

{
	const rows = [
		{ id: "a", read: true, date: "2026-01-03", thread_unread_count: 0 },
		{ id: "b", read: false, date: "2026-01-01", thread_unread_count: 1 },
		{ id: "c", read: false, date: "2026-01-02", thread_unread_count: 1 },
		{ id: "d", read: true, date: "2026-01-04", thread_unread_count: 0 },
	];
	const sorted = sortNewThenSeen(rows);
	assert.deepEqual(
		sorted.map((r) => r.id),
		["c", "b", "d", "a"],
	);
	const annotated = annotateListSections(sorted, true);
	assert.equal(annotated[0].list_section, "new");
	assert.equal(annotated[3].list_section, "seen");
	assert.deepEqual(countListSections(sorted), { newCount: 2, seenCount: 2 });
}

{
	const emails = [
		{
			id: "a",
			read: false,
			date: "2026-09-20",
			thread_unread_count: 1,
			list_section: "new",
		},
		{
			id: "b",
			read: true,
			date: "2026-09-19",
			thread_unread_count: 0,
			list_section: "seen",
		},
	];
	const items = buildInboxListItems(emails, { page: 1, newCount: 1, seenCount: 1 });
	assert.equal(items[0].type, "section");
	assert.equal(items[0].id, "new");
	assert.equal(items[1].type, "email");
	assert.equal(items[2].type, "section");
	assert.equal(items[2].id, "seen");
}

{
	const seenOnly = [
		{
			id: "b",
			read: true,
			date: "2026-09-19",
			thread_unread_count: 0,
			list_section: "seen",
		},
	];
	const items = buildInboxListItems(seenOnly, {
		page: 1,
		newCount: 0,
		seenCount: 1,
	});
	assert.equal(items[0].type, "section");
	assert.equal(items[0].id, "new");
	assert.equal(items[1].type, "empty-new");
	assert.equal(items[2].type, "section");
	assert.equal(items[2].id, "seen");
}

{
	const emails = [
		{
			id: "a",
			read: false,
			date: "2026-09-20",
			thread_id: "t1",
			thread_unread_count: 2,
			list_section: "new",
		},
		{
			id: "c",
			read: false,
			date: "2026-09-18",
			thread_unread_count: 1,
			list_section: "new",
		},
	];
	const patched = applyReadToEmails(emails, { threadId: "t1", read: true });
	assert.equal(patched[0].list_section, "seen");
	assert.equal(patched[1].list_section, "new");

	const cache = patchEmailListCache(
		{ emails, totalCount: 2, newCount: 2, seenCount: 0 },
		"inbox",
		{ id: "a", read: true },
	);
	assert.equal(cache.emails[0].id, "c");
	assert.equal(cache.emails[1].id, "a");
	assert.equal(cache.emails[1].list_section, "seen");
	assert.equal(cache.newCount, 1);
	assert.equal(cache.seenCount, 1);
	assert.equal(listSectionFor(cache.emails[1]), "seen");
}

// ── AVE-23: New capped, Seen always in view ─────────────────────
assert.equal(INBOX_NEW_PREVIEW_LIMIT, 5);
assert.deepEqual(parseInboxSectionQuery(undefined, undefined), {});
assert.deepEqual(parseInboxSectionQuery("new", undefined), { section: "new" });
assert.deepEqual(parseInboxSectionQuery("bogus", "5"), { newLimit: 5 });
assert.deepEqual(parseInboxSectionQuery(undefined, "-1"), {});
assert.deepEqual(parseInboxSectionQuery(undefined, "1; DROP"), { newLimit: 1 });
assert.deepEqual(parseInboxSectionQuery(undefined, "9999"), { newLimit: 100 });

{
	const counts = { newCount: 12, seenCount: 40 };
	assert.equal(inboxSectionTotal(counts, {}), 52);
	assert.equal(inboxSectionTotal(counts, { section: "new" }), 12);
	assert.equal(inboxSectionTotal(counts, { section: "seen" }), 40);
	assert.equal(inboxSectionTotal(counts, { newLimit: 5 }), 45);
	assert.equal(inboxSectionTotal({ newCount: 2, seenCount: 3 }, { newLimit: 5 }), 5);
}

// The window SQL the MailboxDO wraps around its threaded list.
{
	const db = new DatabaseSync(":memory:");
	db.exec(`CREATE TABLE rows (id TEXT, unread INTEGER, date TEXT)`);
	const insert = db.prepare(`INSERT INTO rows VALUES (?, ?, ?)`);
	for (let i = 0; i < 8; i++) insert.run(`n${i}`, 1, `2026-01-${String(20 - i).padStart(2, "0")}`);
	for (let i = 0; i < 4; i++) insert.run(`s${i}`, 0, `2026-01-${String(28 - i).padStart(2, "0")}`);
	const run = (query, limit = 25, offset = 0) =>
		db
			.prepare(
				`WITH listed AS (
					SELECT id, date,
						CASE WHEN unread > 0 THEN 1 ELSE 0 END as is_new,
						ROW_NUMBER() OVER (
							PARTITION BY CASE WHEN unread > 0 THEN 1 ELSE 0 END
							ORDER BY date DESC
						) as section_rank
					FROM rows
				)
				SELECT * FROM listed WHERE ${inboxSectionFilterSql(query)}
				ORDER BY is_new DESC, date DESC LIMIT ? OFFSET ?`,
			)
			.all(limit, offset)
			.map((r) => r.id);
	assert.deepEqual(run({}).length, 12);
	assert.deepEqual(run({ newLimit: 5 }), ["n0", "n1", "n2", "n3", "n4", "s0", "s1", "s2", "s3"]);
	assert.deepEqual(run({ newLimit: 5 }, 4, 4), ["n4", "s0", "s1", "s2"]);
	assert.deepEqual(run({ section: "new" }, 3, 3), ["n3", "n4", "n5"]);
	assert.deepEqual(run({ section: "seen" }), ["s0", "s1", "s2", "s3"]);
	assert.deepEqual(run({ newLimit: 0 }), ["s0", "s1", "s2", "s3"]);
}

// List builder: New capped with a "show more" row, Seen right after it.
{
	const newRows = Array.from({ length: 7 }, (_, i) => ({
		id: `n${i}`,
		read: false,
		thread_unread_count: 1,
		list_section: "new",
		date: `2026-02-${String(20 - i).padStart(2, "0")}`,
	}));
	const seenRows = [{ id: "s0", read: true, thread_unread_count: 0, list_section: "seen", date: "2026-02-01" }];

	// Server already capped New at 5 (new_limit), reports 12 New in total.
	const capped = buildInboxListItems([...newRows.slice(0, 5), ...seenRows], {
		page: 1,
		newCount: 12,
		seenCount: 1,
		newPreviewLimit: 5,
	});
	assert.deepEqual(
		capped.map((i) => i.type),
		["section", "email", "email", "email", "email", "email", "show-more-new", "section", "email"],
	);
	assert.equal(capped[6].hiddenCount, 7);
	assert.equal(capped[7].id, "seen");

	// An older server that ignored new_limit: still capped client-side.
	const uncapped = buildInboxListItems([...newRows, ...seenRows], {
		page: 1,
		newPreviewLimit: 5,
	});
	assert.equal(uncapped.filter((i) => i.type === "email" && i.email.list_section === "new").length, 5);
	assert.equal(uncapped.find((i) => i.type === "show-more-new").hiddenCount, 2);

	// At or under the cap: no "show more".
	const few = buildInboxListItems([...newRows.slice(0, 3), ...seenRows], {
		page: 1,
		newCount: 3,
		seenCount: 1,
		newPreviewLimit: 5,
	});
	assert.equal(few.some((i) => i.type === "show-more-new"), false);

	// Only New rows on the page: "show more" closes the list.
	const onlyNew = buildInboxListItems(newRows.slice(0, 5), { page: 1, newCount: 9, newPreviewLimit: 5 });
	assert.equal(onlyNew.at(-1).type, "show-more-new");

	// Later pages hold Seen only; no "show more" there.
	const page2 = buildInboxListItems(seenRows, { page: 2, newCount: 12, seenCount: 1, newPreviewLimit: 5 });
	assert.equal(page2.some((i) => i.type === "show-more-new"), false);
}

// Optimistic read keeps the server totals (page holds only part of New).
{
	const emails = [
		{ id: "a", read: false, thread_unread_count: 1, list_section: "new", date: "2026-03-02" },
		{ id: "b", read: true, thread_unread_count: 0, list_section: "seen", date: "2026-03-01" },
	];
	const cache = patchEmailListCache(
		{ emails, totalCount: 46, newCount: 12, seenCount: 41 },
		"inbox",
		{ id: "a", read: true },
	);
	assert.equal(cache.newCount, 11);
	assert.equal(cache.seenCount, 42);
	assert.equal(cache.totalCount, 46);
}

console.log("list-sections: ok");
