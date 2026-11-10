/**
 * Piles (AVE-201): migration 48 on node:sqlite (seeded built-in piles,
 * Reply Later backfill, the two mirror triggers), setEmailPile semantics
 * (one pile per message and per thread, stamp only on join), replying
 * clearing only Reply Later, and Trash/Spam dropping piles.
 * Run: pnpm test:unit piles
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	PILE_REPLY_LATER,
	PILE_SET_ASIDE,
	countPile,
	isPileId,
	listPiles,
	setEmailPile,
} from "../lib/piles.ts";

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

const insert = (sql, id, { folder = "inbox", thread = id, replyLater = 0, replyLaterAt = null, remindAt = null } = {}) =>
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, date, read, reply_later, reply_later_at, reply_later_remind_at, thread_id)
		 VALUES (?, ?, ?, 'a@example.com', '2026-11-01T10:00:00.000Z', 1, ?, ?, ?, ?)`,
		id,
		folder,
		`subject ${id}`,
		replyLater,
		replyLaterAt,
		remindAt,
		thread,
	);
const row = (sql, id) =>
	sql.exec(
		`SELECT reply_later, reply_later_at, reply_later_remind_at, pile_id, pile_at FROM emails WHERE id = ?`,
		id,
	)[0];

// ── Backfill: Reply Later mail from before 48 keeps its pile and join time ──
{
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	const before = mailboxMigrations.filter((m) => m.name !== "48_piles");
	applyMigrations(sql, before);
	insert(sql, "old-rl", { replyLater: 1, replyLaterAt: "2026-10-01T09:00:00.000Z", remindAt: "2026-12-01T09:00:00.000Z" });
	insert(sql, "old-plain");
	applyMigrations(sql, mailboxMigrations);
	assert.deepEqual(
		{ ...row(sql, "old-rl") },
		{
			reply_later: 1,
			reply_later_at: "2026-10-01T09:00:00.000Z",
			reply_later_remind_at: "2026-12-01T09:00:00.000Z",
			pile_id: "reply_later",
			pile_at: "2026-10-01T09:00:00.000Z",
		},
	);
	assert.equal(row(sql, "old-plain").pile_id, null);
	// Re-running is a no-op.
	applyMigrations(sql, mailboxMigrations);
	assert.equal(countPile(sql, PILE_REPLY_LATER), 1);
}

const sql = sqlStorage(new DatabaseSync(":memory:"));
applyMigrations(sql, mailboxMigrations);

// ── Built-in piles, in order ─────────────────────────────────────
{
	const piles = listPiles(sql);
	assert.deepEqual(
		piles.map((p) => [p.id, p.name, p.builtin, p.clears_on_reply]),
		[
			["reply_later", "Reply Later", true, true],
			["set_aside", "Set Aside", true, false],
		],
	);
	assert.equal(isPileId(sql, PILE_SET_ASIDE), true);
	assert.equal(isPileId(sql, "nope"), false);
	assert.equal(isPileId(sql, ""), false);
	assert.equal(isPileId(sql, 3), false);
}

// ── Legacy Reply Later writes mirror into pile_id ────────────────
{
	insert(sql, "a");
	sql.exec(`UPDATE emails SET reply_later = 1, reply_later_at = '2026-11-02T08:00:00.000Z' WHERE id = 'a'`);
	assert.equal(row(sql, "a").pile_id, "reply_later");
	assert.equal(row(sql, "a").pile_at, "2026-11-02T08:00:00.000Z");
	sql.exec(`UPDATE emails SET reply_later = 0, reply_later_at = NULL WHERE id = 'a'`);
	assert.equal(row(sql, "a").pile_id, null);
	assert.equal(row(sql, "a").pile_at, null);
}

// ── Set Aside: stamps on join, keeps the stamp when already there ─
{
	insert(sql, "b");
	assert.deepEqual(setEmailPile(sql, "b", PILE_SET_ASIDE, "2026-11-03T00:00:00.000Z"), [
		{ id: "b", pile_id: "set_aside" },
	]);
	assert.deepEqual(setEmailPile(sql, "b", PILE_SET_ASIDE, "2026-11-04T00:00:00.000Z"), []);
	assert.equal(row(sql, "b").pile_at, "2026-11-03T00:00:00.000Z");
	assert.equal(row(sql, "b").reply_later, 0);
	assert.equal(countPile(sql, PILE_SET_ASIDE), 1);
	assert.equal(setEmailPile(sql, "missing", PILE_SET_ASIDE), null);
}

// ── One pile at a time: Set Aside moves Reply Later mail and drops its reminder ──
{
	insert(sql, "c", { replyLater: 1, replyLaterAt: "2026-11-01T00:00:00.000Z", remindAt: "2026-12-01T00:00:00.000Z" });
	// Insert doesn't fire the update trigger; set pile_id the way 48's backfill would.
	sql.exec(`UPDATE emails SET pile_id = 'reply_later', pile_at = reply_later_at WHERE id = 'c'`);
	assert.equal(row(sql, "c").reply_later, 1, "joining Reply Later via pile_id keeps reply_later on");
	assert.equal(row(sql, "c").reply_later_remind_at, "2026-12-01T00:00:00.000Z");
	setEmailPile(sql, "c", PILE_SET_ASIDE, "2026-11-05T00:00:00.000Z");
	assert.deepEqual(
		{ ...row(sql, "c") },
		{
			reply_later: 0,
			reply_later_at: null,
			reply_later_remind_at: null,
			pile_id: "set_aside",
			pile_at: "2026-11-05T00:00:00.000Z",
		},
	);
	// And back: Reply Later via pile_id turns the legacy flag on.
	setEmailPile(sql, "c", PILE_REPLY_LATER, "2026-11-06T00:00:00.000Z");
	assert.equal(row(sql, "c").reply_later, 1);
	assert.equal(row(sql, "c").reply_later_at, "2026-11-06T00:00:00.000Z");
	// Legacy reply_later = 0 takes it out of the pile.
	sql.exec(`UPDATE emails SET reply_later = 0, reply_later_at = NULL WHERE id = 'c'`);
	assert.equal(row(sql, "c").pile_id, null);
	// Legacy reply_later = 0 on Set Aside mail leaves it set aside.
	setEmailPile(sql, "c", PILE_SET_ASIDE);
	sql.exec(`UPDATE emails SET reply_later = 0, reply_later_at = NULL, reply_later_remind_at = NULL WHERE id = 'c'`);
	assert.equal(row(sql, "c").pile_id, "set_aside");
	setEmailPile(sql, "c", null);
	assert.equal(row(sql, "c").pile_id, null);
	assert.equal(row(sql, "c").reply_later, 0);
}

// ── One pile per thread: setting aside one message takes its thread out of Reply Later ──
{
	insert(sql, "t1-a", { thread: "t1" });
	insert(sql, "t1-b", { thread: "t1" });
	insert(sql, "t1-c", { thread: "t1" });
	sql.exec(`UPDATE emails SET reply_later = 1, reply_later_at = '2026-11-01T00:00:00.000Z' WHERE id = 't1-a'`);
	const changes = setEmailPile(sql, "t1-c", PILE_SET_ASIDE);
	assert.deepEqual(changes, [{ id: "t1-c", pile_id: "set_aside" }, { id: "t1-a", pile_id: null }]);
	assert.equal(row(sql, "t1-a").reply_later, 0);
	assert.deepEqual(setEmailPile(sql, "t1-b", PILE_SET_ASIDE), [{ id: "t1-b", pile_id: "set_aside" }]);
	assert.equal(row(sql, "t1-c").pile_id, "set_aside", "same pile on the same thread stays");
}

// ── Replying clears Reply Later only (mirrors MailboxDO.clearReplyLaterForThread) ──
{
	insert(sql, "t2-a", { thread: "t2" });
	insert(sql, "t2-b", { thread: "t2" });
	sql.exec(`UPDATE emails SET reply_later = 1, reply_later_at = '2026-11-01T00:00:00.000Z' WHERE id = 't2-a'`);
	insert(sql, "t3-a", { thread: "t3" });
	setEmailPile(sql, "t3-a", PILE_SET_ASIDE);
	for (const thread of ["t2", "t3"]) {
		sql.exec(
			`UPDATE emails SET reply_later = 0, reply_later_at = NULL,
			        reply_later_remind_at = NULL, reply_later_reminded_at = NULL
			  WHERE thread_id = ?1 AND reply_later = 1`,
			thread,
		);
	}
	assert.equal(row(sql, "t2-a").pile_id, null, "reply takes the thread out of Reply Later");
	assert.equal(row(sql, "t3-a").pile_id, "set_aside", "reply leaves Set Aside alone");
}

// ── Pile counts skip Trash / Spam / Drafts ───────────────────────
{
	const before = countPile(sql, PILE_SET_ASIDE);
	insert(sql, "spam-1", { folder: "spam" });
	setEmailPile(sql, "spam-1", PILE_SET_ASIDE);
	assert.equal(countPile(sql, PILE_SET_ASIDE), before);
	// Moving to Trash drops the pile (mirrors MailboxDO.moveEmail).
	sql.exec(`UPDATE emails SET folder_id = 'trash', reply_later = 0, pile_id = NULL, pile_at = NULL WHERE id = 'b'`);
	assert.equal(row(sql, "b").pile_id, null);
}

console.log("piles: ok");
