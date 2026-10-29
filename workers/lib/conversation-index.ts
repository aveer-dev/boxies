// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Denormalized conversation index for the threaded mailbox list (AVE-105).
 *
 * The threaded list used to group every email in the mailbox into
 * conversations on each page load (`readThreadedListByScan` below, kept as
 * the fallback). That scan is O(mailbox) and blocks the single-threaded
 * Durable Object. This module keeps one `conversations` row per (folder,
 * conversation) instead, so a list page is an index range read.
 *
 * Grouping rules (unchanged from the scan, per listed folder F):
 * - raw key of an email: `COALESCE(thread_id, id)`.
 * - a threaded email's raw key maps to itself; an unthreaded email in F maps
 *   to the smallest raw key among F's emails with the same normalized subject
 *   (legacy subject threading). A raw key's conversation is the MIN of those.
 * - a conversation's stats (count, unread, participants, has_draft,
 *   needs_reply) span every folder; the row shown is its newest email in F.
 *
 * Tables (migration 42_conversation_index):
 * - `conversation_members (folder_id, raw_key, conversation_id)`: the raw key
 *   → conversation map for each folder holding mail with that raw key.
 * - `conversations`: one row per (folder_id, conversation_id) with the list
 *   fields and the id of the email to show. `latest_date` is the sort key:
 *   the newest email in the folder, or, when later, the time a Reply Later
 *   reminder fired on the conversation (AVE-86, migration 43 adds the
 *   trigger that marks those changes dirty).
 * - `conversation_dirty`: (raw_key, folder_id, normalized_subject) marks that
 *   SQLite triggers on `emails` append on every insert / delete / relevant
 *   update, in the same transaction as the write. Every write path (Drizzle,
 *   raw SQL, cascades, retention, purge) is covered without opting in.
 *
 * `flushConversationIndex` recomputes the rows that the dirty marks can
 * affect, straight from `emails` (no incremental arithmetic, so nothing can
 * drift), then clears those marks. The list reads the index only when no
 * marks are left; otherwise it falls back to the scan. The migration seeds a
 * mark for every (thread, folder), so the backfill is the same flush, run in
 * batches by the DO alarm and by list reads.
 */

import { Folders } from "../../shared/folders.ts";

type Sql = Pick<SqlStorage, "exec">;
type Row = Record<string, SqlStorageValue>;

/**
 * Normalized subject used for legacy subject threading: lower-case, with
 * common reply / forward prefixes removed.
 *
 * Migration 42 builds expression indexes on `normalizedSubjectSql("subject")`;
 * SQLite only uses them when a query repeats the expression exactly, so any
 * change here needs a new migration that rebuilds those indexes.
 */
export function normalizedSubjectSql(column: string): string {
	return `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(${column}),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;
}

export const NORMALIZED_SUBJECT_SQL = normalizedSubjectSql("subject");

/** Resolve a system folder by id or name (`name = 'draft'` alone misses 'Drafts'). */
export const folderIdSql = (id: string) =>
	`(SELECT id FROM folders WHERE name = '${id}' OR id = '${id}' LIMIT 1)`;
export const DRAFT_FOLDER_ID_SQL = folderIdSql(Folders.DRAFT);
export const SENT_FOLDER_ID_SQL = folderIdSql(Folders.SENT);

/** Distinct raw keys a list read may flush before it falls back to the scan. */
export const CONVERSATION_FLUSH_READ_BUDGET = 200;
/** Distinct raw keys per alarm batch (backfill / large bulk changes). */
export const CONVERSATION_FLUSH_ALARM_BUDGET = 500;
/** Delay before the next alarm batch while changes are pending. */
export const CONVERSATION_FLUSH_CONTINUE_DELAY_MS = 250;

function rows(sql: Sql, query: string, ...bindings: unknown[]): Row[] {
	return [...sql.exec(query, ...bindings)] as Row[];
}

const str = (value: SqlStorageValue | undefined): string | null =>
	value == null ? null : String(value);

/** True when list reads can use the index (no pending dirty marks). */
export function conversationIndexIsClean(sql: Sql): boolean {
	return rows(sql, `SELECT 1 AS x FROM conversation_dirty LIMIT 1`).length === 0;
}

/**
 * Recompute the conversations that the oldest dirty marks (up to `maxKeys`
 * distinct raw keys) can affect, then clear those marks. Returns true when no
 * marks are left. Run inside a transaction: the map updates and the row
 * recomputes must commit together with the cleared marks.
 */
export function flushConversationIndex(sql: Sql, maxKeys: number): boolean {
	const keys = rows(
		sql,
		`SELECT raw_key FROM conversation_dirty GROUP BY raw_key LIMIT ?1`,
		Math.max(1, Math.floor(maxKeys)),
	).map((row) => String(row.raw_key));
	if (keys.length === 0) return true;
	const keysJson = JSON.stringify(keys);

	const seeds = new Map<string, { keys: Set<string>; subjects: Set<string | null> }>();
	const seed = (folderId: string) => {
		let entry = seeds.get(folderId);
		if (!entry) {
			entry = { keys: new Set(), subjects: new Set() };
			seeds.set(folderId, entry);
		}
		return entry;
	};

	// Where the mail was (or is): the folder it left and the subject bucket
	// it left are only known from the marks.
	for (const row of rows(
		sql,
		`SELECT DISTINCT raw_key, folder_id, normalized_subject
		 FROM conversation_dirty
		 WHERE raw_key IN (SELECT value FROM json_each(?1))`,
		keysJson,
	)) {
		const entry = seed(String(row.folder_id));
		entry.keys.add(String(row.raw_key));
		entry.subjects.add(str(row.normalized_subject));
	}
	// Conversation stats span folders: every folder that lists (or now holds)
	// one of these threads needs its row recomputed too.
	for (const row of rows(
		sql,
		`SELECT folder_id, raw_key FROM conversation_members
		 WHERE raw_key IN (SELECT value FROM json_each(?1))`,
		keysJson,
	)) {
		seed(String(row.folder_id)).keys.add(String(row.raw_key));
	}
	for (const row of rows(
		sql,
		`SELECT DISTINCT folder_id, thread_id AS raw_key FROM emails
		 WHERE thread_id IN (SELECT value FROM json_each(?1))
		 UNION
		 SELECT folder_id, id AS raw_key FROM emails
		 WHERE id IN (SELECT value FROM json_each(?1)) AND +thread_id IS NULL`,
		keysJson,
	)) {
		seed(String(row.folder_id)).keys.add(String(row.raw_key));
	}

	for (const [folderId, entry] of seeds) {
		refreshFolder(sql, folderId, entry.keys, entry.subjects);
	}

	sql.exec(
		`DELETE FROM conversation_dirty WHERE raw_key IN (SELECT value FROM json_each(?1))`,
		keysJson,
	);
	return conversationIndexIsClean(sql);
}

/** Recompute folder `folderId`'s map entries for `seedKeys` and the subject buckets they touch, then the rows. */
function refreshFolder(
	sql: Sql,
	folderId: string,
	seedKeys: Set<string>,
	seedSubjects: Set<string | null>,
): void {
	const keysJson = JSON.stringify([...seedKeys]);
	const subjects = new Set(seedSubjects);
	// The subjects this folder's mail in these threads has now: a raw key
	// entering or leaving a bucket can change that bucket's MIN.
	// (`+folder_id` keeps the planner on the thread_id / primary key index.)
	for (const row of rows(
		sql,
		`SELECT ${NORMALIZED_SUBJECT_SQL} AS ns FROM emails
		 WHERE thread_id IN (SELECT value FROM json_each(?1)) AND +folder_id = ?2
		 UNION
		 SELECT ${NORMALIZED_SUBJECT_SQL} AS ns FROM emails
		 WHERE id IN (SELECT value FROM json_each(?1)) AND +thread_id IS NULL AND +folder_id = ?2`,
		keysJson,
		folderId,
	)) {
		subjects.add(str(row.ns));
	}

	// Unthreaded mail in those buckets may map to a different MIN now.
	const affected = new Set(seedKeys);
	for (const subject of subjects) {
		const unthreaded =
			subject === null
				? rows(
						sql,
						`SELECT id FROM emails
						 WHERE folder_id = ?1 AND ${NORMALIZED_SUBJECT_SQL} IS NULL AND thread_id IS NULL`,
						folderId,
					)
				: rows(
						sql,
						`SELECT id FROM emails
						 WHERE folder_id = ?1 AND ${NORMALIZED_SUBJECT_SQL} = ?2 AND thread_id IS NULL`,
						folderId,
						subject,
					);
		for (const row of unthreaded) affected.add(String(row.id));
	}

	const bucketMins = new Map<string | null, string | null>();
	const bucketMin = (subject: string | null): string | null => {
		if (bucketMins.has(subject)) return bucketMins.get(subject) ?? null;
		const [row] =
			subject === null
				? rows(
						sql,
						`SELECT MIN(COALESCE(thread_id, id)) AS m FROM emails
						 WHERE folder_id = ?1 AND ${NORMALIZED_SUBJECT_SQL} IS NULL`,
						folderId,
					)
				: rows(
						sql,
						`SELECT MIN(COALESCE(thread_id, id)) AS m FROM emails
						 WHERE folder_id = ?1 AND ${NORMALIZED_SUBJECT_SQL} = ?2`,
						folderId,
						subject,
					);
		const value = str(row?.m);
		bucketMins.set(subject, value);
		return value;
	};

	const conversations = new Set<string>();
	for (const rawKey of affected) {
		const [current] = rows(
			sql,
			`SELECT conversation_id FROM conversation_members WHERE folder_id = ?1 AND raw_key = ?2`,
			folderId,
			rawKey,
		);
		const before = str(current?.conversation_id);

		let after: string | null = null;
		const [unthreaded] = rows(
			sql,
			`SELECT ${NORMALIZED_SUBJECT_SQL} AS ns FROM emails
			 WHERE id = ?1 AND +thread_id IS NULL AND +folder_id = ?2`,
			rawKey,
			folderId,
		);
		if (unthreaded) {
			// The bucket includes this raw key, so its MIN is never above it
			// (and never null); threaded mail on the same key maps to itself,
			// which can't be smaller.
			after = bucketMin(str(unthreaded.ns)) ?? rawKey;
		} else if (
			rows(
				sql,
				`SELECT 1 AS x FROM emails WHERE thread_id = ?1 AND +folder_id = ?2 LIMIT 1`,
				rawKey,
				folderId,
			).length > 0
		) {
			after = rawKey;
		}

		if (after !== before) {
			if (after === null) {
				sql.exec(
					`DELETE FROM conversation_members WHERE folder_id = ?1 AND raw_key = ?2`,
					folderId,
					rawKey,
				);
			} else {
				sql.exec(
					`INSERT INTO conversation_members (folder_id, raw_key, conversation_id)
					 VALUES (?1, ?2, ?3)
					 ON CONFLICT (folder_id, raw_key) DO UPDATE SET conversation_id = excluded.conversation_id`,
					folderId,
					rawKey,
					after,
				);
			}
		}
		if (before !== null) conversations.add(before);
		if (after !== null) conversations.add(after);
	}

	for (const conversationId of conversations) {
		recomputeConversation(sql, folderId, conversationId);
	}
}

/** Rebuild one (folder, conversation) row from its member emails, or drop it. */
function recomputeConversation(sql: Sql, folderId: string, conversationId: string): void {
	// `ce AS MATERIALIZED`: inlined into the scalar subqueries, the planner
	// walks the whole folder by date instead of the few member rows.
	const [row] = rows(
		sql,
		`WITH
		members AS (
			SELECT raw_key FROM conversation_members WHERE folder_id = ?1 AND conversation_id = ?2
		),
		ce AS MATERIALIZED (
			SELECT rowid AS rid, id, folder_id, read, date, sender, sender_name, reply_later, reply_later_reminded_at
			FROM emails WHERE thread_id IN (SELECT raw_key FROM members)
			UNION ALL
			SELECT rowid AS rid, id, folder_id, read, date, sender, sender_name, reply_later, reply_later_reminded_at
			FROM emails WHERE id IN (SELECT raw_key FROM members) AND +thread_id IS NULL
		),
		stats AS (
			SELECT
				COUNT(*) AS thread_count,
				SUM(CASE WHEN read = 0 AND folder_id != ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) AS thread_unread_count,
				SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) AS thread_read_count,
				SUM(CASE WHEN folder_id = ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) AS has_draft,
				MAX(CASE WHEN reply_later = 1 THEN reply_later_reminded_at END) AS resurfaced_at
			FROM ce
		)
		SELECT
			(SELECT id FROM ce WHERE folder_id = ?1 ORDER BY date DESC LIMIT 1) AS latest_email_id,
			(SELECT date FROM ce WHERE folder_id = ?1 ORDER BY date DESC LIMIT 1) AS latest_date,
			(SELECT folder_id FROM ce ORDER BY date DESC LIMIT 1) AS latest_folder_id,
			stats.thread_count, stats.thread_unread_count, stats.thread_read_count, stats.has_draft,
			stats.resurfaced_at,
			(SELECT GROUP_CONCAT(DISTINCT p) FROM (
				SELECT COALESCE(NULLIF(TRIM(sender_name), ''), sender) AS p FROM ce ORDER BY rid
			)) AS participants
		FROM stats`,
		folderId,
		conversationId,
	);

	if (!row || row.latest_email_id == null) {
		sql.exec(
			`DELETE FROM conversations WHERE folder_id = ?1 AND conversation_id = ?2`,
			folderId,
			conversationId,
		);
		return;
	}

	// A fired Reply Later reminder lifts the conversation as if mail arrived
	// then (AVE-86); same rule as the scan's `sort_date`.
	const latestDate = str(row.latest_date);
	const resurfacedAt = str(row.resurfaced_at);
	const sortDate =
		resurfacedAt !== null && latestDate !== null && resurfacedAt > latestDate ? resurfacedAt : latestDate;

	sql.exec(
		`INSERT INTO conversations (
			folder_id, conversation_id, latest_email_id, latest_date,
			thread_count, thread_unread_count, participants, needs_reply, has_draft, is_new
		)
		VALUES (
			?1, ?2, ?3, ?4, ?5, ?6, ?7,
			CASE WHEN ?8 != ${SENT_FOLDER_ID_SQL} AND ?8 != ${DRAFT_FOLDER_ID_SQL} AND ?9 > 0 THEN 1 ELSE 0 END,
			CASE WHEN ?10 > 0 THEN 1 ELSE 0 END,
			CASE WHEN ?6 > 0 THEN 1 ELSE 0 END
		)
		ON CONFLICT (folder_id, conversation_id) DO UPDATE SET
			latest_email_id = excluded.latest_email_id,
			latest_date = excluded.latest_date,
			thread_count = excluded.thread_count,
			thread_unread_count = excluded.thread_unread_count,
			participants = excluded.participants,
			needs_reply = excluded.needs_reply,
			has_draft = excluded.has_draft,
			is_new = excluded.is_new`,
		folderId,
		conversationId,
		row.latest_email_id,
		sortDate,
		Number(row.thread_count ?? 0),
		Number(row.thread_unread_count ?? 0),
		row.participants ?? null,
		row.latest_folder_id ?? null,
		Number(row.thread_read_count ?? 0),
		Number(row.has_draft ?? 0),
	);
}

// ── Reads ──────────────────────────────────────────────────────────

/** Email columns of a threaded list row, in the order the scan returns them. */
const LIST_EMAIL_COLUMNS = [
	"id", "subject", "sender", "sender_name", "recipient", "date",
	"read", "starred", "reply_later", "reply_later_at", "reply_later_remind_at", "reply_later_reminded_at",
	"thread_id", "folder_id",
	"in_reply_to", "email_references",
	"provider_message_id", "delivery_status", "delivery_error",
	"snippet",
	"auth", "auth_tier", "classification_reason", "matched_rule_id",
];

export interface ThreadedListWindow {
	limit: number;
	offset: number;
	/** Inbox New/Seen ordering (New first). */
	useNewSeen: boolean;
	section?: "new" | "seen";
	newLimit?: number;
}

/** Resolve a folder name or id the way the list always has. */
export function resolveFolderId(sql: Sql, folder: string): string | null {
	const [row] = rows(sql, `SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1`, folder);
	return str(row?.id);
}

/**
 * One threaded list page from the conversation index. Same columns as the
 * scan (minus its internal `is_new` / `section_rank` / `sort_date`). Call only when
 * `conversationIndexIsClean`.
 */
export function readThreadedListFromIndex(
	sql: Sql,
	folderId: string,
	window: ThreadedListWindow,
): Row[] {
	const slice = (isNew: 0 | 1 | null, limit: number, offset: number): Row[] => {
		if (limit <= 0) return [];
		const newClause = isNew === null ? "" : `AND is_new = ${isNew}`;
		return rows(
			sql,
			`SELECT ${LIST_EMAIL_COLUMNS.map((c) => `e.${c}`).join(", ")},
				c.thread_count, c.thread_unread_count, c.participants, c.needs_reply, c.has_draft
			FROM (
				SELECT * FROM conversations
				WHERE folder_id = ?1 ${newClause}
				ORDER BY latest_date DESC, conversation_id DESC
				LIMIT ?2 OFFSET ?3
			) c
			JOIN emails e ON e.id = c.latest_email_id
			ORDER BY c.latest_date DESC, c.conversation_id DESC`,
			folderId,
			limit,
			offset,
		);
	};

	const { limit, offset } = window;
	if (!window.useNewSeen) return slice(null, limit, offset);
	if (window.section === "new") return slice(1, limit, offset);
	if (window.section === "seen") return slice(0, limit, offset);

	// New first (all of it, or the newest `newLimit`), then every Seen row.
	const { newCount } = countConversationsFromIndex(sql, folderId);
	const newWindow =
		window.newLimit !== undefined ? Math.min(newCount, Math.max(0, Math.floor(window.newLimit))) : newCount;
	const out = offset < newWindow ? slice(1, Math.min(limit, newWindow - offset), offset) : [];
	return out.concat(slice(0, limit - out.length, Math.max(0, offset - newWindow)));
}

/** Conversation totals for a folder from the index. */
export function countConversationsFromIndex(
	sql: Sql,
	folderId: string,
): { totalCount: number; newCount: number; seenCount: number } {
	const [row] = rows(
		sql,
		`SELECT COUNT(*) AS total, COALESCE(SUM(is_new), 0) AS fresh FROM conversations WHERE folder_id = ?1`,
		folderId,
	);
	const totalCount = Number(row?.total ?? 0);
	const newCount = Number(row?.fresh ?? 0);
	return { totalCount, newCount, seenCount: totalCount - newCount };
}

// ── Scan fallback (pre-AVE-105 SQL, plus AVE-86 resurfacing) ────────

/**
 * The original threaded list query: groups every email in the mailbox on
 * each call. Used while the index has pending dirty marks (backfill, a large
 * bulk change) and as the reference in the equivalence tests.
 */
export function readThreadedListByScan(
	sql: Sql,
	folder: string,
	window: { limit: number; offset: number; useNewSeen: boolean; sectionFilter: string },
): Row[] {
	return rows(
		sql,
		`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(thread_id, id) as raw_thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					normalized_subject,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			),
			all_emails_with_conversation AS (
				SELECT
					e.*,
					COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
				FROM emails e
				LEFT JOIN (SELECT raw_thread_id, MIN(conversation_id) AS conversation_id FROM thread_to_conversation GROUP BY raw_thread_id) tc
					ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			),
			conversation_stats AS (
				SELECT
					conversation_id,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 AND folder_id != ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
					GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(sender_name), ''), sender)) as participants,
					SUM(CASE WHEN folder_id = ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) as has_draft,
					MAX(CASE WHEN reply_later = 1 THEN reply_later_reminded_at END) as resurfaced_at
				FROM all_emails_with_conversation
				WHERE conversation_id IN (
					SELECT DISTINCT conversation_id FROM all_emails_with_conversation
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				)
				GROUP BY conversation_id
			),
			latest_message_per_conversation AS (
				SELECT
					conversation_id,
					folder_id,
					ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
				FROM all_emails_with_conversation
			),
			latest_in_folder AS (
				SELECT
					fe.*,
					COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
					ROW_NUMBER() OVER (
						PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
				LEFT JOIN (SELECT raw_thread_id, MIN(conversation_id) AS conversation_id FROM thread_to_conversation GROUP BY raw_thread_id) tc
					ON fe.raw_thread_id = tc.raw_thread_id
			),
			listed AS (
			SELECT
				lif.id, lif.subject, lif.sender, lif.sender_name, lif.recipient, lif.date,
				lif.read, lif.starred, lif.reply_later, lif.reply_later_at, lif.reply_later_remind_at, lif.reply_later_reminded_at, lif.thread_id, lif.folder_id,
				lif.in_reply_to, lif.email_references,
				lif.provider_message_id, lif.delivery_status, lif.delivery_error,
				lif.snippet as snippet,
				lif.auth, lif.auth_tier, lif.classification_reason, lif.matched_rule_id,
				cs.thread_count, cs.thread_unread_count, cs.participants,
				CASE WHEN lmc.folder_id != ${SENT_FOLDER_ID_SQL}
					AND lmc.folder_id != ${DRAFT_FOLDER_ID_SQL}
					AND cs.thread_read_count > 0
					THEN 1 ELSE 0 END as needs_reply,
				CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft,
				CASE WHEN cs.thread_unread_count > 0 THEN 1 ELSE 0 END as is_new,
				-- A fired Reply Later reminder lifts the conversation as if mail arrived then (AVE-86).
				MAX(lif.date, COALESCE(cs.resurfaced_at, lif.date)) as sort_date,
				ROW_NUMBER() OVER (
					PARTITION BY CASE WHEN cs.thread_unread_count > 0 THEN 1 ELSE 0 END
					ORDER BY MAX(lif.date, COALESCE(cs.resurfaced_at, lif.date)) DESC
				) as section_rank
			FROM latest_in_folder lif
			JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
			LEFT JOIN latest_message_per_conversation lmc
				ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
			WHERE lif.rn = 1
			)
			SELECT * FROM listed
			WHERE ${window.sectionFilter}
			ORDER BY ${window.useNewSeen ? `is_new DESC, sort_date DESC` : `sort_date DESC`}
			LIMIT ?2 OFFSET ?3`,
		folder,
		window.limit,
		window.offset,
	);
}

/** The original non-Inbox conversation count (scan). */
export function countThreadedByScan(sql: Sql, folder: string): number {
	const [row] = rows(
		sql,
		`WITH
		folder_emails AS (
			SELECT
				COALESCE(thread_id, id) as raw_thread_id,
				thread_id,
			${NORMALIZED_SUBJECT_SQL} as normalized_subject
			FROM emails
			WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
		),
		thread_to_conversation AS (
			SELECT
				raw_thread_id,
				CASE
					WHEN thread_id IS NOT NULL THEN raw_thread_id
					WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					ELSE raw_thread_id
				END as conversation_id
			FROM folder_emails
			GROUP BY raw_thread_id, normalized_subject, thread_id
		)
		SELECT COUNT(DISTINCT conversation_id) as total
		FROM thread_to_conversation`,
		folder,
	);
	return Number(row?.total ?? 0);
}

/** The original Inbox New / Seen counts (scan). */
export function countThreadedSectionsByScan(
	sql: Sql,
	folder: string,
): { newCount: number; seenCount: number; totalCount: number } {
	const [row] = rows(
		sql,
		`WITH
		folder_emails AS (
			SELECT *,
				COALESCE(thread_id, id) as raw_thread_id,
				${NORMALIZED_SUBJECT_SQL} as normalized_subject
			FROM emails
			WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
		),
		thread_to_conversation AS (
			SELECT
				raw_thread_id,
				normalized_subject,
				CASE
					WHEN thread_id IS NOT NULL THEN raw_thread_id
					ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
				END as conversation_id
			FROM folder_emails
			GROUP BY raw_thread_id, normalized_subject, thread_id
		),
		all_emails_with_conversation AS (
			SELECT
				e.*,
				COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
			FROM emails e
			LEFT JOIN (SELECT raw_thread_id, MIN(conversation_id) AS conversation_id FROM thread_to_conversation GROUP BY raw_thread_id) tc
				ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
		),
		conversation_stats AS (
			SELECT
				conversation_id,
				SUM(CASE WHEN read = 0 AND folder_id != ${DRAFT_FOLDER_ID_SQL} THEN 1 ELSE 0 END) as thread_unread_count
			FROM all_emails_with_conversation
			WHERE conversation_id IN (
				SELECT DISTINCT conversation_id FROM all_emails_with_conversation
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			)
			GROUP BY conversation_id
		)
		SELECT
			COALESCE(SUM(CASE WHEN thread_unread_count > 0 THEN 1 ELSE 0 END), 0) as new_count,
			COALESCE(SUM(CASE WHEN thread_unread_count = 0 THEN 1 ELSE 0 END), 0) as seen_count,
			COUNT(*) as total_count
		FROM conversation_stats`,
		folder,
	);
	return {
		newCount: Number(row?.new_count ?? 0),
		seenCount: Number(row?.seen_count ?? 0),
		totalCount: Number(row?.total_count ?? 0),
	};
}
