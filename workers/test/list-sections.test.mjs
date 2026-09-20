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
} from "../../shared/list-sections.ts";
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

console.log("list-sections: ok");
