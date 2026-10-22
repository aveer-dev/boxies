// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Notes to self on mail threads (API shapes shared by the Worker and the web
 * app). Notes are private to their author: nobody else in a shared mailbox
 * sees or changes them.
 *
 * - `sticky`: pinned to a thread (or to one message when `emailId` is set);
 *   shown as a sticker on the list row and at the top of the detail view.
 *   `posX` / `posY` hold where the user dragged it.
 * - `inline`: attached to one message (`emailId` required); shown in line
 *   with the thread's messages.
 */

export const THREAD_NOTE_TYPES = ["sticky", "inline"] as const;
export type ThreadNoteType = (typeof THREAD_NOTE_TYPES)[number];

/** Maximum markdown body length, in characters. */
export const THREAD_NOTE_BODY_MAX = 10_000;
/** Maximum length of `sticky_note_text` on list rows, in characters. */
export const STICKY_NOTE_SNIPPET_MAX = 200;

/** A note as returned by the notes API. */
export interface ThreadNote {
	id: string;
	/** Conversation key: the emails' `thread_id`, or the email id for mail without one. */
	threadId: string;
	/** Message the note is attached to; null for a whole-thread sticky note. */
	emailId: string | null;
	noteType: ThreadNoteType;
	/** Markdown. */
	body: string;
	posX: number | null;
	posY: number | null;
	createdAt: string;
	updatedAt: string;
}

/** `POST /api/v1/mailboxes/:mailboxId/threads/:threadId/notes` body. */
export interface CreateThreadNoteRequest {
	body: string;
	noteType: ThreadNoteType;
	emailId?: string | null;
	posX?: number | null;
	posY?: number | null;
}

/** `PATCH /api/v1/mailboxes/:mailboxId/notes/:noteId` body (at least one field). */
export interface UpdateThreadNoteRequest {
	body?: string;
	posX?: number | null;
	posY?: number | null;
}

/** Per-row note summary on threaded list rows, for the requesting user only. */
export interface ThreadNoteListFields {
	has_sticky_note: boolean;
	/** Latest sticky note's body, trimmed to STICKY_NOTE_SNIPPET_MAX characters. */
	sticky_note_text: string | null;
	inline_note_count: number;
}
