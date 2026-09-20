/**
 * Inbox New vs Seen list-section helpers.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	annotateListSections,
	conversationIsNew,
	countListSections,
	folderUsesNewSeen,
	listSectionFor,
	sortNewThenSeen,
} from "../../shared/list-sections.ts";

assert.equal(folderUsesNewSeen(Folders.INBOX), true);
assert.equal(folderUsesNewSeen(Folders.PROMOTIONS), false);
assert.equal(folderUsesNewSeen(Folders.UPDATES), false);

assert.equal(conversationIsNew({ read: false }), true);
assert.equal(conversationIsNew({ read: true, thread_unread_count: 0 }), false);
assert.equal(conversationIsNew({ read: true, thread_unread_count: 2 }), true);
assert.equal(
	conversationIsNew({ read: false, folder_id: Folders.DRAFT }),
	false,
);

assert.equal(listSectionFor({ read: false }), "new");
assert.equal(listSectionFor({ read: true, thread_unread_count: 0 }), "seen");

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
		"New (date DESC) then Seen (date DESC)",
	);

	const annotated = annotateListSections(sorted, true);
	assert.equal(annotated[0].list_section, "new");
	assert.equal(annotated[1].list_section, "new");
	assert.equal(annotated[2].list_section, "seen");
	assert.equal(annotated[3].list_section, "seen");

	assert.deepEqual(countListSections(sorted), { newCount: 2, seenCount: 2 });
}

{
	const plain = annotateListSections([{ read: false }], false);
	assert.equal(plain[0].list_section, undefined);
}

console.log("list-sections: ok");
