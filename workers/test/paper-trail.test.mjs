/**
 * Updates as a quiet receipts view (AVE-192): which folders stay quiet and
 * the month grouping the list uses on web (iOS / Android mirror it).
 * Run: pnpm test:unit paper-trail
 */

import assert from "node:assert/strict";
import {
	buildMonthListItems,
	folderIsPaperTrail,
	folderIsQuiet,
	monthSectionId,
	monthSectionLabel,
} from "../../shared/paper-trail.ts";
import { Folders } from "../../shared/folders.ts";

assert.equal(folderIsPaperTrail(Folders.UPDATES), true);
assert.equal(folderIsPaperTrail(Folders.INBOX), false);
assert.equal(folderIsPaperTrail(Folders.PROMOTIONS), false);
assert.equal(folderIsPaperTrail(null), false);
assert.equal(folderIsQuiet(Folders.UPDATES), true);
assert.equal(folderIsQuiet(Folders.INBOX), false);
assert.equal(folderIsQuiet(undefined), false);

// Mid-month local times, so the test holds in any time zone.
const now = new Date(2026, 10, 10, 12);
const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();

assert.equal(monthSectionId(at(2026, 11, 3)), "2026-11");
assert.equal(monthSectionId(at(2025, 2, 14)), "2025-02");
assert.equal(monthSectionId("not a date"), "undated");
assert.equal(monthSectionId(null), "undated");

assert.equal(monthSectionLabel(at(2026, 11, 3), now), "November");
assert.equal(monthSectionLabel(at(2026, 1, 15), now), "January");
assert.equal(monthSectionLabel(at(2025, 12, 15), now), "December 2025");
assert.equal(monthSectionLabel("", now), "Earlier");

{
	const rows = [
		{ id: "a", date: at(2026, 11, 9) },
		{ id: "b", date: at(2026, 11, 2) },
		{ id: "c", date: at(2026, 10, 30) },
		{ id: "d", date: at(2025, 10, 15) },
		{ id: "e", date: at(2025, 10, 1) },
	];
	const items = buildMonthListItems(rows, now);
	assert.deepEqual(
		items.map((item) => (item.type === "section" ? `# ${item.label}` : item.email.id)),
		["# November", "a", "b", "# October", "c", "# October 2025", "d", "e"],
	);
	// Section ids are unique across years, so they work as list keys.
	const ids = items.filter((item) => item.type === "section").map((item) => item.id);
	assert.deepEqual(ids, ["month-2026-11", "month-2026-10", "month-2025-10"]);
}

assert.deepEqual(buildMonthListItems([], now), []);

console.log("paper trail tests passed");
