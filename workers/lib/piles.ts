// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Piles (AVE-201): lists of mail you want back, next to folders. Reply Later
 * (you owe a reply; replying clears it) and Set Aside (keep it handy until
 * you take it out) are built in; custom piles (AVE-194) add rows to `piles`.
 *
 * Storage (migration 49_piles): `piles` holds definitions, `emails.pile_id`
 * / `pile_at` hold membership. A message is in at most one pile, and a
 * thread too: putting one message in a pile takes the rest of its thread
 * out of any other pile. Reply Later also keeps its legacy `reply_later`
 * columns, mirrored by triggers, so writes to either side stay in step.
 */

import {
	MAX_CUSTOM_PILES,
	PILE_REPLY_LATER,
	PILE_SET_ASIDE,
	normalizePileName,
} from "../../shared/piles";

export { PILE_REPLY_LATER, PILE_SET_ASIDE };

/** Thrown by MailboxDO.updateEmail for a pile id that doesn't exist (route answers 400). */
export const UNKNOWN_PILE_ERROR = "Unknown pile";

export interface Pile {
	id: string;
	name: string;
	position: number;
	builtin: boolean;
	/** Replying to the thread takes it out of this pile (Reply Later only). */
	clears_on_reply: boolean;
}

/** Folders whose mail never counts or lists in a pile. */
export const PILE_EXCLUDED_FOLDERS_SQL = "('trash', 'spam', 'draft')";

interface SqlLike {
	exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): Iterable<T>;
}

function rows<T>(sql: SqlLike, query: string, ...bindings: unknown[]): T[] {
	return [...sql.exec<T>(query, ...bindings)];
}

export function listPiles(sql: SqlLike): Pile[] {
	return rows<{ id: string; name: string; position: number; builtin: number; clears_on_reply: number }>(
		sql,
		`SELECT id, name, position, builtin, clears_on_reply FROM piles ORDER BY position, created_at, id`,
	).map((row) => ({
		id: row.id,
		name: row.name,
		position: Number(row.position),
		builtin: Boolean(row.builtin),
		clears_on_reply: Boolean(row.clears_on_reply),
	}));
}

export function isPileId(sql: SqlLike, id: unknown): id is string {
	if (typeof id !== "string" || id.length === 0 || id.length > 64) return false;
	return rows(sql, `SELECT 1 FROM piles WHERE id = ?`, id).length > 0;
}

/** Messages in a pile, outside Trash / Spam / Drafts. */
export function countPile(sql: SqlLike, pileId: string): number {
	const row = rows<{ total: number }>(
		sql,
		`SELECT COUNT(*) AS total FROM emails
		  WHERE pile_id = ? AND folder_id NOT IN ${PILE_EXCLUDED_FOLDERS_SQL}`,
		pileId,
	)[0];
	return Number(row?.total ?? 0);
}

export interface PileChange {
	id: string;
	pile_id: string | null;
}

/**
 * Take the rest of a message's thread out of every pile but `keepPileId`.
 * Returns the messages that changed.
 */
export function clearOtherPilesInThread(
	sql: SqlLike,
	emailId: string,
	keepPileId: string,
): PileChange[] {
	const row = rows<{ thread_id: string | null }>(sql, `SELECT thread_id FROM emails WHERE id = ?`, emailId)[0];
	if (!row?.thread_id) return [];
	const others = rows<{ id: string }>(
		sql,
		`SELECT id FROM emails
		  WHERE thread_id = ?1 AND id != ?2 AND pile_id IS NOT NULL AND pile_id != ?3`,
		row.thread_id,
		emailId,
		keepPileId,
	);
	if (others.length === 0) return [];
	sql.exec(
		`UPDATE emails SET pile_id = NULL, pile_at = NULL
		  WHERE thread_id = ?1 AND id != ?2 AND pile_id IS NOT NULL AND pile_id != ?3`,
		row.thread_id,
		emailId,
		keepPileId,
	);
	return others.map(({ id }) => ({ id, pile_id: null }));
}

/**
 * Put a message in `pileId`, or take it out of its pile with null. Joining
 * stamps `pile_at` only when the message wasn't already in that pile, and
 * takes the rest of the thread out of any other pile. Returns null when the
 * message doesn't exist, else every message whose pile changed.
 */
export function setEmailPile(
	sql: SqlLike,
	emailId: string,
	pileId: string | null,
	now: string = new Date().toISOString(),
): PileChange[] | null {
	const row = rows<{ pile_id: string | null }>(sql, `SELECT pile_id FROM emails WHERE id = ?`, emailId)[0];
	if (!row) return null;
	const changes: PileChange[] = [];
	if (pileId === null) {
		if (row.pile_id !== null) {
			sql.exec(`UPDATE emails SET pile_id = NULL, pile_at = NULL WHERE id = ?`, emailId);
			changes.push({ id: emailId, pile_id: null });
		}
		return changes;
	}
	if (row.pile_id !== pileId) {
		sql.exec(`UPDATE emails SET pile_id = ?1, pile_at = ?2 WHERE id = ?3`, pileId, now, emailId);
		changes.push({ id: emailId, pile_id: pileId });
	}
	changes.push(...clearOtherPilesInThread(sql, emailId, pileId));
	return changes;
}

// ── Custom piles (AVE-194) ───────────────────────────────────────

export type CreatePileResult =
	| { ok: true; pile: Pile }
	| { ok: false; error: "invalid"; message: string }
	| { ok: false; error: "conflict" | "limit" };

export type RenamePileResult =
	| { ok: true; pile: Pile; changed: boolean }
	| { ok: false; error: "invalid"; message: string }
	| { ok: false; error: "not_found" | "conflict" | "builtin" };

export type DeletePileResult =
	| { ok: true; emailIds: string[] }
	| { ok: false; error: "not_found" | "builtin" };

/** Custom pile ids: `p_` + 32 hex, inside the `[a-z0-9_]{1,64}` the list route accepts. */
export function newCustomPileId(): string {
	return `p_${crypto.randomUUID().replace(/-/g, "")}`;
}

function nameTaken(sql: SqlLike, key: string, exceptId?: string): boolean {
	return listPiles(sql).some((p) => p.id !== exceptId && p.name.toLowerCase() === key);
}

function getPile(sql: SqlLike, id: string): Pile | null {
	return listPiles(sql).find((p) => p.id === id) ?? null;
}

/** Make a named pile at the end of the list. Names are unique ignoring case (built-ins included). */
export function createPile(
	sql: SqlLike,
	rawName: unknown,
	options: { id?: string; now?: string } = {},
): CreatePileResult {
	const name = normalizePileName(rawName);
	if (!name.ok) return { ok: false, error: "invalid", message: name.error };
	if (nameTaken(sql, name.key)) return { ok: false, error: "conflict" };
	const custom = Number(
		rows<{ n: number }>(sql, `SELECT COUNT(*) AS n FROM piles WHERE builtin = 0`)[0]?.n ?? 0,
	);
	if (custom >= MAX_CUSTOM_PILES) return { ok: false, error: "limit" };
	const position =
		Number(rows<{ p: number | null }>(sql, `SELECT MAX(position) AS p FROM piles`)[0]?.p ?? 0) + 1;
	const id = options.id ?? newCustomPileId();
	sql.exec(
		`INSERT INTO piles (id, name, position, builtin, clears_on_reply, created_at) VALUES (?1, ?2, ?3, 0, 0, ?4)`,
		id,
		name.name,
		position,
		options.now ?? new Date().toISOString(),
	);
	const pile = getPile(sql, id);
	if (!pile) throw new Error("pile insert failed");
	return { ok: true, pile };
}

/** Rename a custom pile. A new spelling of the same name (case) is allowed. */
export function renamePile(sql: SqlLike, pileId: string, rawName: unknown): RenamePileResult {
	const existing = getPile(sql, pileId);
	if (!existing) return { ok: false, error: "not_found" };
	if (existing.builtin) return { ok: false, error: "builtin" };
	const name = normalizePileName(rawName);
	if (!name.ok) return { ok: false, error: "invalid", message: name.error };
	if (nameTaken(sql, name.key, pileId)) return { ok: false, error: "conflict" };
	const changed = existing.name !== name.name;
	if (changed) sql.exec(`UPDATE piles SET name = ?1 WHERE id = ?2`, name.name, pileId);
	return { ok: true, pile: { ...existing, name: name.name }, changed };
}

/**
 * Delete a custom pile. Its mail only comes out of the pile: folders, read
 * state and everything else stay. Returns the messages that were in it.
 */
export function deletePile(sql: SqlLike, pileId: string): DeletePileResult {
	const existing = getPile(sql, pileId);
	if (!existing) return { ok: false, error: "not_found" };
	if (existing.builtin) return { ok: false, error: "builtin" };
	const emailIds = rows<{ id: string }>(sql, `SELECT id FROM emails WHERE pile_id = ?1`, pileId).map(
		(r) => r.id,
	);
	sql.exec(`UPDATE emails SET pile_id = NULL, pile_at = NULL WHERE pile_id = ?1`, pileId);
	sql.exec(`DELETE FROM piles WHERE id = ?1`, pileId);
	return { ok: true, emailIds };
}
