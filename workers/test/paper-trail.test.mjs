/**
 * Paper Trail, a quiet receipts folder (AVE-192): the folder and its place
 * among Screener destinations and purpose boxes, which folders stay quiet,
 * the `51_paper_trail_folder` migration, and the month grouping the list uses
 * on web (iOS / Android mirror it).
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
import { DatabaseSync } from "node:sqlite";
import {
	FOLDER_DISPLAY_NAMES,
	Folders,
	PRIMARY_FOLDER_IDS,
	PURPOSE_FOLDER_IDS,
	SCREENER_DESTINATION_IDS,
	SYSTEM_FOLDER_IDS,
	getFolderDisplayName,
	isPurposeFolderId,
} from "../../shared/folders.ts";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { purposeFoldersSqlList, senderPreferenceUpsertError } from "../lib/sender-preferences.ts";
import { isScreenerDestination } from "../lib/sender-triage.ts";

// Its own folder, next to Updates; Updates is a normal folder again.
assert.equal(Folders.PAPER_TRAIL, "paper_trail");
assert.equal(FOLDER_DISPLAY_NAMES[Folders.PAPER_TRAIL], "Paper Trail");
assert.equal(getFolderDisplayName("paper_trail"), "Paper Trail");
assert.equal(SYSTEM_FOLDER_IDS.indexOf(Folders.PAPER_TRAIL), SYSTEM_FOLDER_IDS.indexOf(Folders.UPDATES) + 1);
assert.ok(PRIMARY_FOLDER_IDS.includes(Folders.PAPER_TRAIL));
assert.equal(folderIsPaperTrail(Folders.PAPER_TRAIL), true);
assert.equal(folderIsPaperTrail(Folders.UPDATES), false);
assert.equal(folderIsPaperTrail(Folders.INBOX), false);
assert.equal(folderIsPaperTrail(Folders.PROMOTIONS), false);
assert.equal(folderIsPaperTrail(null), false);
assert.equal(folderIsQuiet(Folders.PAPER_TRAIL), true);
assert.equal(folderIsQuiet(Folders.UPDATES), false);
assert.equal(folderIsQuiet(Folders.INBOX), false);
assert.equal(folderIsQuiet(undefined), false);

// You send senders there: a Screener destination and a sender default.
assert.deepEqual([...SCREENER_DESTINATION_IDS], ["inbox", "promotions", "updates", "paper_trail"]);
assert.deepEqual([...PURPOSE_FOLDER_IDS], ["inbox", "promotions", "updates", "paper_trail"]);
assert.equal(isScreenerDestination(Folders.PAPER_TRAIL), true);
assert.equal(isPurposeFolderId(Folders.PAPER_TRAIL), true);
assert.equal(senderPreferenceUpsertError({ address: "orders@shop.example", folderId: "paper_trail" }), null);
assert.match(purposeFoldersSqlList(), /'paper_trail'/);

// ── Migration 51: the folder exists, can't be deleted, replays safely ──
{
	const MIGRATION = "51_paper_trail_folder";
	const sqlStorage = (db) => ({
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings);
		},
	});
	const order = mailboxMigrations.map((m) => m.name);
	assert.ok(order.indexOf(MIGRATION) > order.indexOf("49_piles"), "appended after 49");
	assert.equal(order.filter((name) => name === MIGRATION).length, 1);

	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, mailboxMigrations.filter((m) => m.name !== MIGRATION));
	// A custom folder someone already called "Paper Trail" keeps its id and mail.
	sql.exec(`INSERT INTO folders (id, name, is_deletable) VALUES ('paper-trail', 'Paper Trail', 1)`);
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date) VALUES ('e1', 'paper-trail', 's', 'a@x.example', 'b@x.example', '2026-01-01')`,
	);
	applyMigrations(sql, mailboxMigrations);
	const folders = sql.exec(`SELECT id, name, is_deletable FROM folders WHERE id IN ('paper_trail', 'paper-trail') ORDER BY id`);
	assert.deepEqual(
		folders.map((f) => ({ ...f })),
		[
			{ id: "paper-trail", name: "Paper Trail (custom)", is_deletable: 1 },
			{ id: "paper_trail", name: "Paper Trail", is_deletable: 0 },
		],
	);
	assert.equal(sql.exec(`SELECT folder_id FROM emails WHERE id = 'e1'`)[0].folder_id, "paper-trail");
	applyMigrations(sql, mailboxMigrations);
	sql.exec(mailboxMigrations.find((m) => m.name === MIGRATION).sql);
	assert.equal(Number(sql.exec(`SELECT COUNT(*) AS n FROM folders WHERE id = 'paper_trail'`)[0].n), 1);
	assert.equal(Number(sql.exec(`SELECT COUNT(*) AS n FROM d1_migrations WHERE name = ?`, MIGRATION)[0].n), 1);

	// Every system folder has a row, so mail can be filed to any of them.
	const ids = new Set(sql.exec(`SELECT id FROM folders`).map((r) => r.id));
	for (const id of SYSTEM_FOLDER_IDS) assert.ok(ids.has(id), `folder row for ${id}`);
}

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
