// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Piles (AVE-201): lists of mail you want back, next to folders. Reply Later
 * (you owe a reply; replying clears it) and Set Aside (keep it handy until
 * you take it out) are built in; custom piles (AVE-194) add rows to `piles`.
 *
 * Storage (migration 48_piles): `piles` holds definitions, `emails.pile_id`
 * / `pile_at` hold membership. A message is in at most one pile, and a
 * thread too: putting one message in a pile takes the rest of its thread
 * out of any other pile. Reply Later also keeps its legacy `reply_later`
 * columns, mirrored by triggers, so writes to either side stay in step.
 */

export const PILE_REPLY_LATER = "reply_later";
export const PILE_SET_ASIDE = "set_aside";

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
