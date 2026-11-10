// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tags in the mailbox Durable Object (AVE-240): the `tags` and `email_tags`
 * tables from migration `48_email_tags`. An email keeps its one folder and
 * can carry any number of tags. API shapes and the route table live in
 * shared/tags.ts.
 *
 * A thread is the conversation key the thread view uses: the emails'
 * `thread_id`, or the email's own id for mail stored without one
 * (`COALESCE(thread_id, id)`).
 */

import { Folders } from "../../shared/folders";
import {
	MAX_TAGS_PER_MAILBOX,
	normalizeTagName,
	type Tag,
	type TagRef,
} from "../../shared/tags";
import { PARTICIPANT_LABEL_SQL } from "./conversation-index";

type Sql = Pick<SqlStorage, "exec">;

const ID_MAX = 512;

/** Route path ids: non-empty and bounded, so junk never reaches SQL. */
export function isValidTagRouteId(id: string | undefined): id is string {
	return !!id && id.length <= ID_MAX;
}

function rows<T>(sql: Sql, query: string, ...bindings: unknown[]): T[] {
	return [...sql.exec(query, ...bindings)] as T[];
}

/** Folders a tag view and the tag counts leave out unless asked (as Reply Later does). */
const JUNK_FOLDERS_SQL = `('${Folders.TRASH}', '${Folders.SPAM}', '${Folders.DRAFT}')`;

// ── Tags ─────────────────────────────────────────────────────────

type TagRow = {
	id: string;
	name: string;
	created_at: string;
	updated_at: string;
	email_count: number;
	unread_count: number;
};

function toTag(row: TagRow): Tag {
	return {
		id: row.id,
		name: row.name,
		emailCount: Number(row.email_count) || 0,
		unreadCount: Number(row.unread_count) || 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function selectTags(sql: Sql, where: string, ...bindings: unknown[]): Tag[] {
	return rows<TagRow>(
		sql,
		`SELECT t.id, t.name, t.created_at, t.updated_at,
			COUNT(e.id) AS email_count,
			COALESCE(SUM(CASE WHEN e.read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
		 FROM tags t
		 LEFT JOIN email_tags et ON et.tag_id = t.id
		 LEFT JOIN emails e ON e.id = et.email_id AND e.folder_id NOT IN ${JUNK_FOLDERS_SQL}
		 ${where}
		 GROUP BY t.id
		 ORDER BY t.name_key ASC, t.id ASC`,
		...bindings,
	).map(toTag);
}

/** Every tag in the mailbox, sorted by name, with message counts. */
export function listTags(sql: Sql): Tag[] {
	return selectTags(sql, "");
}

export function getTag(sql: Sql, tagId: string): Tag | null {
	return selectTags(sql, "WHERE t.id = ?1", tagId)[0] ?? null;
}

export function tagExists(sql: Sql, tagId: string): boolean {
	return rows(sql, `SELECT 1 FROM tags WHERE id = ?1`, tagId).length > 0;
}

export type CreateTagResult =
	| { ok: true; tag: Tag }
	| { ok: false; error: "invalid"; message: string }
	| { ok: false; error: "conflict" | "limit" };

export function createTag(
	sql: Sql,
	rawName: unknown,
	options: { id?: string; now?: string } = {},
): CreateTagResult {
	const name = normalizeTagName(rawName);
	if (!name.ok) return { ok: false, error: "invalid", message: name.error };
	if (rows(sql, `SELECT 1 FROM tags WHERE name_key = ?1`, name.key).length > 0) {
		return { ok: false, error: "conflict" };
	}
	const total = Number(rows<{ n: number }>(sql, `SELECT COUNT(*) AS n FROM tags`)[0]?.n ?? 0);
	if (total >= MAX_TAGS_PER_MAILBOX) return { ok: false, error: "limit" };

	const id = options.id ?? crypto.randomUUID();
	const now = options.now ?? new Date().toISOString();
	sql.exec(
		`INSERT INTO tags (id, name, name_key, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)`,
		id,
		name.name,
		name.key,
		now,
	);
	const tag = getTag(sql, id);
	if (!tag) throw new Error("tag insert failed");
	return { ok: true, tag };
}

export type RenameTagResult =
	| { ok: true; tag: Tag; changed: boolean }
	| { ok: false; error: "invalid"; message: string }
	| { ok: false; error: "not_found" | "conflict" };

/** Rename a tag. A new spelling of the same name (case) is allowed. */
export function renameTag(
	sql: Sql,
	tagId: string,
	rawName: unknown,
	options: { now?: string } = {},
): RenameTagResult {
	const name = normalizeTagName(rawName);
	if (!name.ok) return { ok: false, error: "invalid", message: name.error };
	const existing = rows<{ name: string }>(sql, `SELECT name FROM tags WHERE id = ?1`, tagId)[0];
	if (!existing) return { ok: false, error: "not_found" };
	if (rows(sql, `SELECT 1 FROM tags WHERE name_key = ?1 AND id != ?2`, name.key, tagId).length > 0) {
		return { ok: false, error: "conflict" };
	}
	const changed = existing.name !== name.name;
	if (changed) {
		sql.exec(
			`UPDATE tags SET name = ?1, name_key = ?2, updated_at = ?3 WHERE id = ?4`,
			name.name,
			name.key,
			options.now ?? new Date().toISOString(),
			tagId,
		);
	}
	const tag = getTag(sql, tagId);
	if (!tag) return { ok: false, error: "not_found" };
	return { ok: true, tag, changed };
}

/**
 * Delete a tag and its links. Emails are never touched. Returns the ids of
 * the emails that carried it, or null when the tag doesn't exist.
 */
export function deleteTag(sql: Sql, tagId: string): string[] | null {
	if (!tagExists(sql, tagId)) return null;
	const emailIds = rows<{ email_id: string }>(
		sql,
		`SELECT email_id FROM email_tags WHERE tag_id = ?1`,
		tagId,
	).map((r) => r.email_id);
	sql.exec(`DELETE FROM email_tags WHERE tag_id = ?1`, tagId);
	sql.exec(`DELETE FROM tags WHERE id = ?1`, tagId);
	return emailIds;
}

// ── Links ────────────────────────────────────────────────────────

/** Tags of each email, sorted by name. Emails without tags are absent. */
export function tagsForEmails(sql: Sql, emailIds: string[]): Map<string, TagRef[]> {
	const out = new Map<string, TagRef[]>();
	const unique = [...new Set(emailIds.filter(Boolean))];
	if (unique.length === 0) return out;
	const found = rows<{ email_id: string; id: string; name: string }>(
		sql,
		`SELECT et.email_id, t.id, t.name
		 FROM email_tags et
		 JOIN tags t ON t.id = et.tag_id
		 WHERE et.email_id IN (SELECT value FROM json_each(?1))
		 ORDER BY t.name_key ASC, t.id ASC`,
		JSON.stringify(unique),
	);
	for (const row of found) {
		const list = out.get(row.email_id) ?? [];
		list.push({ id: row.id, name: row.name });
		out.set(row.email_id, list);
	}
	return out;
}

/** Every tag on any message of each conversation, sorted by name. */
export function tagsForThreads(sql: Sql, threadKeys: string[]): Map<string, TagRef[]> {
	const out = new Map<string, TagRef[]>();
	const unique = [...new Set(threadKeys.filter(Boolean))];
	if (unique.length === 0) return out;
	const found = rows<{ thread_key: string; id: string; name: string }>(
		sql,
		`SELECT DISTINCT COALESCE(e.thread_id, e.id) AS thread_key, t.id, t.name, t.name_key
		 FROM emails e
		 JOIN email_tags et ON et.email_id = e.id
		 JOIN tags t ON t.id = et.tag_id
		 WHERE e.thread_id IN (SELECT value FROM json_each(?1))
		    OR (e.thread_id IS NULL AND e.id IN (SELECT value FROM json_each(?1)))
		 ORDER BY t.name_key ASC, t.id ASC`,
		JSON.stringify(unique),
	);
	for (const row of found) {
		const list = out.get(row.thread_key) ?? [];
		list.push({ id: row.id, name: row.name });
		out.set(row.thread_key, list);
	}
	return out;
}

/**
 * Add `tags` to list rows. `email`: each message's own tags (flat lists,
 * search, thread view). `thread`: every tag in the row's conversation
 * (threaded lists). A failed lookup leaves rows with empty tags.
 */
export function withTagFields<T extends { id: string; thread_id?: string | null }>(
	sql: Sql,
	listRows: T[],
	mode: "email" | "thread",
): (T & { tags: TagRef[] })[] {
	const keyOf = mode === "thread" ? (row: T) => row.thread_id || row.id : (row: T) => row.id;
	let found = new Map<string, TagRef[]>();
	if (listRows.length > 0) {
		try {
			const keys = listRows.map(keyOf);
			found = mode === "thread" ? tagsForThreads(sql, keys) : tagsForEmails(sql, keys);
		} catch (e) {
			console.error("tag lookup failed:", (e as Error).message);
		}
	}
	return listRows.map((row) => ({ ...row, tags: found.get(keyOf(row)) ?? [] }));
}

export type EmailTagResult =
	| { ok: true; id: string; tags: TagRef[]; changed: boolean }
	| { ok: false; error: "email_not_found" | "tag_not_found" };

/** Add (`on = true`) or remove a tag on one email. Idempotent. */
export function setEmailTag(
	sql: Sql,
	emailId: string,
	tagId: string,
	on: boolean,
	options: { now?: string } = {},
): EmailTagResult {
	if (rows(sql, `SELECT 1 FROM emails WHERE id = ?1`, emailId).length === 0) {
		return { ok: false, error: "email_not_found" };
	}
	if (!tagExists(sql, tagId)) return { ok: false, error: "tag_not_found" };
	const had = rows(sql, `SELECT 1 FROM email_tags WHERE email_id = ?1 AND tag_id = ?2`, emailId, tagId).length > 0;
	if (on && !had) {
		sql.exec(
			`INSERT OR IGNORE INTO email_tags (email_id, tag_id, created_at) VALUES (?1, ?2, ?3)`,
			emailId,
			tagId,
			options.now ?? new Date().toISOString(),
		);
	} else if (!on && had) {
		sql.exec(`DELETE FROM email_tags WHERE email_id = ?1 AND tag_id = ?2`, emailId, tagId);
	}
	return { ok: true, id: emailId, tags: tagsForEmails(sql, [emailId]).get(emailId) ?? [], changed: on !== had };
}

export type ThreadTagResult =
	| { ok: true; threadId: string; tags: TagRef[]; emailIds: string[] }
	| { ok: false; error: "thread_not_found" | "tag_not_found" };

/**
 * Add or remove a tag on every message of a conversation. `emailIds` are the
 * messages that changed. Idempotent.
 */
export function setThreadTag(
	sql: Sql,
	threadId: string,
	tagId: string,
	on: boolean,
	options: { now?: string } = {},
): ThreadTagResult {
	const members = rows<{ id: string; tagged: number }>(
		sql,
		`SELECT e.id,
			EXISTS (SELECT 1 FROM email_tags et WHERE et.email_id = e.id AND et.tag_id = ?2) AS tagged
		 FROM emails e
		 WHERE e.thread_id = ?1 OR (e.thread_id IS NULL AND e.id = ?1)`,
		threadId,
		tagId,
	);
	if (members.length === 0) return { ok: false, error: "thread_not_found" };
	if (!tagExists(sql, tagId)) return { ok: false, error: "tag_not_found" };

	const changing = members.filter((m) => Boolean(Number(m.tagged)) !== on).map((m) => m.id);
	if (changing.length > 0) {
		if (on) {
			sql.exec(
				`INSERT OR IGNORE INTO email_tags (email_id, tag_id, created_at)
				 SELECT value, ?2, ?3 FROM json_each(?1)`,
				JSON.stringify(changing),
				tagId,
				options.now ?? new Date().toISOString(),
			);
		} else {
			sql.exec(
				`DELETE FROM email_tags WHERE tag_id = ?2 AND email_id IN (SELECT value FROM json_each(?1))`,
				JSON.stringify(changing),
				tagId,
			);
		}
	}
	return {
		ok: true,
		threadId,
		tags: tagsForThreads(sql, [threadId]).get(threadId) ?? [],
		emailIds: changing,
	};
}

// ── Tag views ────────────────────────────────────────────────────

/** Columns of a list row, the same set `getEmails` returns. */
const LIST_COLUMNS = [
	"id", "subject", "sender", "sender_name", "recipient", "cc", "bcc", "date",
	"read", "starred", "reply_later", "reply_later_at", "reply_later_remind_at", "reply_later_reminded_at",
	"in_reply_to", "email_references", "thread_id", "folder_id",
	"provider_message_id", "delivery_status", "delivery_error", "snippet",
	"auth", "auth_tier", "classification_reason", "matched_rule_id", "alias_id",
];
const listColumns = (alias: string) => LIST_COLUMNS.map((c) => `${alias}.${c}`).join(", ");

export interface TaggedEmailsOptions {
	page?: number;
	limit?: number;
	threaded?: boolean;
	/** Keep Trash, Spam and Drafts (left out by default). */
	includeJunk?: boolean;
}

function paging(options: TaggedEmailsOptions) {
	const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25) || 25, 1), 100);
	const page = Math.max(Math.trunc(options.page ?? 1) || 1, 1);
	return { limit, offset: (page - 1) * limit };
}

/**
 * Mail with a tag, newest first. Flat: one row per tagged message. Threaded:
 * one row per conversation with a tagged message (its newest tagged message)
 * plus `thread_count`, `thread_unread_count` and `participants` over the
 * conversation's listed messages. Raw rows: callers decode flags and auth.
 */
export function listTaggedEmails(
	sql: Sql,
	tagId: string,
	options: TaggedEmailsOptions = {},
): Record<string, unknown>[] {
	const { limit, offset } = paging(options);
	const junk = options.includeJunk ? 1 : 0;

	if (!options.threaded) {
		return rows(
			sql,
			`SELECT ${listColumns("e")}
			 FROM email_tags et
			 JOIN emails e ON e.id = et.email_id
			 WHERE et.tag_id = ?1 AND (?2 = 1 OR e.folder_id NOT IN ${JUNK_FOLDERS_SQL})
			 ORDER BY e.date DESC, e.id DESC
			 LIMIT ?3 OFFSET ?4`,
			tagId,
			junk,
			limit,
			offset,
		);
	}

	return rows(
		sql,
		`WITH
		tagged AS (
			SELECT e.id, e.date, COALESCE(e.thread_id, e.id) AS conv_key
			FROM email_tags et
			JOIN emails e ON e.id = et.email_id
			WHERE et.tag_id = ?1 AND (?2 = 1 OR e.folder_id NOT IN ${JUNK_FOLDERS_SQL})
		),
		ranked AS (
			SELECT id, date, conv_key,
				ROW_NUMBER() OVER (PARTITION BY conv_key ORDER BY date DESC, id DESC) AS rn
			FROM tagged
		),
		page AS (
			SELECT id, date, conv_key FROM ranked WHERE rn = 1
			ORDER BY date DESC, id DESC
			LIMIT ?3 OFFSET ?4
		),
		members AS (
			SELECT p.conv_key, m.read, m.sender, m.sender_name, m.rowid AS rid
			FROM page p
			JOIN emails m ON m.thread_id = p.conv_key OR (m.thread_id IS NULL AND m.id = p.conv_key)
			WHERE ?2 = 1 OR m.folder_id NOT IN ${JUNK_FOLDERS_SQL}
		),
		stats AS (
			SELECT conv_key,
				COUNT(*) AS thread_count,
				SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS thread_unread_count
			FROM members
			GROUP BY conv_key
		),
		parts AS (
			SELECT conv_key, GROUP_CONCAT(p, char(31)) AS participants
			FROM (
				SELECT conv_key, ${PARTICIPANT_LABEL_SQL} AS p
				FROM members
				GROUP BY conv_key, p
				ORDER BY conv_key, MIN(rid)
			)
			GROUP BY conv_key
		)
		SELECT ${listColumns("e")},
			s.thread_count, s.thread_unread_count, pa.participants
		FROM page p
		JOIN emails e ON e.id = p.id
		LEFT JOIN stats s ON s.conv_key = p.conv_key
		LEFT JOIN parts pa ON pa.conv_key = p.conv_key
		ORDER BY p.date DESC, p.id DESC`,
		tagId,
		junk,
		limit,
		offset,
	);
}

/** Rows `listTaggedEmails` can return, in the same unit (messages or conversations). */
export function countTaggedEmails(
	sql: Sql,
	tagId: string,
	options: Pick<TaggedEmailsOptions, "threaded" | "includeJunk"> = {},
): number {
	const unit = options.threaded ? "COUNT(DISTINCT COALESCE(e.thread_id, e.id))" : "COUNT(*)";
	const row = rows<{ n: number }>(
		sql,
		`SELECT ${unit} AS n
		 FROM email_tags et
		 JOIN emails e ON e.id = et.email_id
		 WHERE et.tag_id = ?1 AND (?2 = 1 OR e.folder_id NOT IN ${JUNK_FOLDERS_SQL})`,
		tagId,
		options.includeJunk ? 1 : 0,
	)[0];
	return Number(row?.n ?? 0);
}
