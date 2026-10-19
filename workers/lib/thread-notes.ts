// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Notes to self on mail threads, stored in the mailbox Durable Object's
 * `thread_notes` table (migration `31_thread_notes_to_self`).
 *
 * Every read and write is scoped to the author: a shared mailbox's other
 * members never see, count, change or delete someone else's notes, and a note
 * that isn't yours looks exactly like a note that doesn't exist.
 *
 * A note's `thread_id` is the conversation key the thread view uses: the
 * emails' `thread_id`, or the email's own id for mail stored without one
 * (`COALESCE(thread_id, id)`, as the threaded list groups them).
 */

import { z } from "zod";
import {
	STICKY_NOTE_SNIPPET_MAX,
	THREAD_NOTE_BODY_MAX,
	THREAD_NOTE_TYPES,
	type ThreadNote,
	type ThreadNoteListFields,
	type ThreadNoteType,
} from "../../shared/thread-notes";

type Sql = Pick<SqlStorage, "exec">;

const ID_MAX = 512;

// ── Request validation ───────────────────────────────────────────

const noteBody = z
	.string()
	.max(THREAD_NOTE_BODY_MAX, `Note body must be at most ${THREAD_NOTE_BODY_MAX} characters`)
	.refine((body) => body.trim().length > 0, "Note body cannot be empty");

const position = z.number().finite().nullable().optional();

export const CreateThreadNoteSchema = z
	.object({
		body: noteBody,
		noteType: z.enum(THREAD_NOTE_TYPES),
		emailId: z.string().trim().min(1).max(ID_MAX).nullable().optional(),
		posX: position,
		posY: position,
	})
	.superRefine((value, ctx) => {
		if (value.noteType === "inline" && !value.emailId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["emailId"],
				message: "Inline notes need the message they belong to",
			});
		}
	});

export const UpdateThreadNoteSchema = z
	.object({
		body: noteBody.optional(),
		posX: position,
		posY: position,
	})
	.refine(
		(value) => value.body !== undefined || value.posX !== undefined || value.posY !== undefined,
		"Nothing to update",
	);

export type CreateThreadNoteInput = z.infer<typeof CreateThreadNoteSchema>;
export type UpdateThreadNoteInput = z.infer<typeof UpdateThreadNoteSchema>;

/** Route path ids: non-empty and bounded, so junk never reaches SQL. */
export function isValidNoteRouteId(id: string | undefined): id is string {
	return !!id && id.length <= ID_MAX;
}

// ── Storage ──────────────────────────────────────────────────────

type NoteRow = {
	id: string;
	thread_id: string;
	email_id: string | null;
	note_type: string;
	body: string;
	pos_x: number | null;
	pos_y: number | null;
	created_at: string;
	updated_at: string;
};

const NOTE_COLUMNS = `id, thread_id, email_id, note_type, body, pos_x, pos_y, created_at, updated_at`;

function rows<T>(sql: Sql, query: string, ...bindings: unknown[]): T[] {
	return [...sql.exec(query, ...bindings)] as T[];
}

function toNote(row: NoteRow): ThreadNote {
	return {
		id: row.id,
		threadId: row.thread_id,
		emailId: row.email_id ?? null,
		noteType: row.note_type as ThreadNoteType,
		body: row.body,
		posX: row.pos_x ?? null,
		posY: row.pos_y ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function getOwnNote(sql: Sql, noteId: string, userId: string): NoteRow | undefined {
	return rows<NoteRow>(
		sql,
		`SELECT ${NOTE_COLUMNS} FROM thread_notes WHERE id = ?1 AND author_user_id = ?2`,
		noteId,
		userId,
	)[0];
}

/** The caller's notes on a thread, oldest first. */
export function listThreadNotes(sql: Sql, threadId: string, userId: string): ThreadNote[] {
	return rows<NoteRow>(
		sql,
		`SELECT ${NOTE_COLUMNS} FROM thread_notes
		 WHERE thread_id = ?1 AND author_user_id = ?2
		 ORDER BY created_at ASC, id ASC`,
		threadId,
		userId,
	).map(toNote);
}

/** True when any stored email belongs to this conversation key. */
export function threadExists(sql: Sql, threadId: string): boolean {
	return (
		rows(
			sql,
			`SELECT 1 FROM emails WHERE thread_id = ?1 OR (thread_id IS NULL AND id = ?1) LIMIT 1`,
			threadId,
		).length > 0
	);
}

/** True when the email exists and belongs to this conversation key. */
export function emailInThread(sql: Sql, emailId: string, threadId: string): boolean {
	return (
		rows(
			sql,
			`SELECT 1 FROM emails WHERE id = ?1 AND COALESCE(thread_id, id) = ?2 LIMIT 1`,
			emailId,
			threadId,
		).length > 0
	);
}

export type CreateThreadNoteResult =
	| { ok: true; note: ThreadNote }
	| { ok: false; error: "thread_not_found" | "email_not_in_thread" };

export function createThreadNote(
	sql: Sql,
	threadId: string,
	userId: string,
	input: CreateThreadNoteInput,
	options: { id?: string; now?: string } = {},
): CreateThreadNoteResult {
	if (!threadExists(sql, threadId)) return { ok: false, error: "thread_not_found" };
	const emailId = input.emailId ?? null;
	if (emailId && !emailInThread(sql, emailId, threadId)) {
		return { ok: false, error: "email_not_in_thread" };
	}
	if (input.noteType === "inline" && !emailId) {
		return { ok: false, error: "email_not_in_thread" };
	}

	const id = options.id ?? crypto.randomUUID();
	const now = options.now ?? new Date().toISOString();
	sql.exec(
		`INSERT INTO thread_notes
			(id, thread_id, email_id, note_type, body, pos_x, pos_y, author_user_id, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
		id,
		threadId,
		emailId,
		input.noteType,
		input.body,
		input.posX ?? null,
		input.posY ?? null,
		userId,
		now,
	);
	const row = getOwnNote(sql, id, userId);
	if (!row) throw new Error("thread note insert failed");
	return { ok: true, note: toNote(row) };
}

/** Update the caller's note. Null when it doesn't exist or isn't theirs. */
export function updateThreadNote(
	sql: Sql,
	noteId: string,
	userId: string,
	input: UpdateThreadNoteInput,
	options: { now?: string } = {},
): ThreadNote | null {
	const existing = getOwnNote(sql, noteId, userId);
	if (!existing) return null;

	const body = input.body !== undefined ? input.body : existing.body;
	const posX = input.posX !== undefined ? input.posX : existing.pos_x;
	const posY = input.posY !== undefined ? input.posY : existing.pos_y;
	const now = options.now ?? new Date().toISOString();
	sql.exec(
		`UPDATE thread_notes SET body = ?1, pos_x = ?2, pos_y = ?3, updated_at = ?4
		 WHERE id = ?5 AND author_user_id = ?6`,
		body,
		posX,
		posY,
		now,
		noteId,
		userId,
	);
	const row = getOwnNote(sql, noteId, userId);
	return row ? toNote(row) : null;
}

/** Delete the caller's note. Returns the deleted note (for events), or null. */
export function deleteThreadNote(sql: Sql, noteId: string, userId: string): ThreadNote | null {
	const existing = getOwnNote(sql, noteId, userId);
	if (!existing) return null;
	sql.exec(`DELETE FROM thread_notes WHERE id = ?1 AND author_user_id = ?2`, noteId, userId);
	return toNote(existing);
}

/**
 * After an email is permanently deleted: drop notes attached to it, and every
 * note on its conversation once no email of that conversation is left.
 */
export function deleteThreadNotesForDeletedEmail(
	sql: Sql,
	emailId: string,
	threadKey: string,
): void {
	sql.exec(`DELETE FROM thread_notes WHERE email_id = ?1`, emailId);
	if (!threadExists(sql, threadKey)) {
		sql.exec(`DELETE FROM thread_notes WHERE thread_id = ?1`, threadKey);
	}
}

// ── List rows ────────────────────────────────────────────────────

/** Trimmed sticky body, at most STICKY_NOTE_SNIPPET_MAX characters (code points). */
export function stickyNoteSnippet(body: string | null | undefined): string | null {
	if (body == null) return null;
	const chars = Array.from(body.trim());
	if (chars.length <= STICKY_NOTE_SNIPPET_MAX) return chars.join("");
	return `${chars.slice(0, STICKY_NOTE_SNIPPET_MAX - 1).join("").trimEnd()}…`;
}

const EMPTY_NOTE_FIELDS: ThreadNoteListFields = {
	has_sticky_note: false,
	sticky_note_text: null,
	inline_note_count: 0,
};

/**
 * The caller's note summary per conversation key: whether there is a sticky
 * note, the latest one's snippet, and how many inline notes. Thread keys are
 * passed as one JSON parameter so a full page never hits bound-parameter limits.
 */
export function threadNoteSummaries(
	sql: Sql,
	userId: string,
	threadKeys: string[],
): Map<string, ThreadNoteListFields> {
	const summaries = new Map<string, ThreadNoteListFields>();
	const unique = [...new Set(threadKeys.filter(Boolean))];
	if (!userId || unique.length === 0) return summaries;

	const found = rows<{
		thread_id: string;
		sticky_count: number;
		inline_count: number;
		sticky_body: string | null;
	}>(
		sql,
		`WITH
		user_notes AS (
			SELECT id, thread_id, note_type, body, created_at
			FROM thread_notes
			WHERE author_user_id = ?1
			  AND thread_id IN (SELECT value FROM json_each(?2))
		),
		latest_sticky AS (
			SELECT thread_id, body,
				ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at DESC, id DESC) AS rn
			FROM user_notes
			WHERE note_type = 'sticky'
		),
		counts AS (
			SELECT thread_id,
				SUM(CASE WHEN note_type = 'sticky' THEN 1 ELSE 0 END) AS sticky_count,
				SUM(CASE WHEN note_type = 'inline' THEN 1 ELSE 0 END) AS inline_count
			FROM user_notes
			GROUP BY thread_id
		)
		SELECT c.thread_id, c.sticky_count, c.inline_count, ls.body AS sticky_body
		FROM counts c
		LEFT JOIN latest_sticky ls ON ls.thread_id = c.thread_id AND ls.rn = 1`,
		userId,
		JSON.stringify(unique),
	);

	for (const row of found) {
		const stickyCount = Number(row.sticky_count) || 0;
		summaries.set(row.thread_id, {
			has_sticky_note: stickyCount > 0,
			sticky_note_text: stickyCount > 0 ? stickyNoteSnippet(row.sticky_body) : null,
			inline_note_count: Number(row.inline_count) || 0,
		});
	}
	return summaries;
}

/** Add the caller's note fields to list rows (defaults when no user is known). */
export function withThreadNoteFields<T extends { id: string; thread_id?: string | null }>(
	sql: Sql,
	listRows: T[],
	userId: string | null | undefined,
): (T & ThreadNoteListFields)[] {
	const keyOf = (row: T) => row.thread_id || row.id;
	let summaries = new Map<string, ThreadNoteListFields>();
	if (userId && listRows.length > 0) {
		try {
			summaries = threadNoteSummaries(sql, userId, listRows.map(keyOf));
		} catch (e) {
			console.error("thread note summary lookup failed:", (e as Error).message);
		}
	}
	return listRows.map((row) => ({ ...row, ...(summaries.get(keyOf(row)) ?? EMPTY_NOTE_FIELDS) }));
}
