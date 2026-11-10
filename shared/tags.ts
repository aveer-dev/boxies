// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tags (AVE-188 / AVE-240): labels an email can carry any number of, on top
 * of the one folder it lives in. Tags are their own layer: moving an email
 * between folders keeps its tags, and deleting a tag never deletes mail.
 * Custom folders stay folders (some clients call them "tags" in their UI,
 * AVE-158; those are folder ids, never the ids below).
 *
 * Tags belong to a mailbox and are shared by everyone who can open it.
 *
 * ## API (all under `/api/v1/mailboxes/:mailboxId`, any mailbox member)
 *
 * | Route | Body | Response |
 * | --- | --- | --- |
 * | `GET /tags` | | `{ tags: Tag[] }`, sorted by name |
 * | `POST /tags` | `{ name }` | `201 Tag`; `409` name taken; `400` invalid / too many tags |
 * | `PATCH /tags/:tagId` | `{ name }` | `Tag`; `404`; `409` name taken |
 * | `DELETE /tags/:tagId` | | `204`; `404`. Links go, emails stay |
 * | `GET /tags/:tagId/emails` | `?threaded=true&page=&limit=&include_junk=` | `{ emails, totalCount }`; `404` |
 * | `PUT /emails/:id/tags/:tagId` | | `EmailTagsResponse`; `404` email or tag |
 * | `DELETE /emails/:id/tags/:tagId` | | `EmailTagsResponse`; `404` email or tag |
 * | `PUT /threads/:threadId/tags/:tagId` | | `ThreadTagsResponse`; `404` thread or tag |
 * | `DELETE /threads/:threadId/tags/:tagId` | | `ThreadTagsResponse`; `404` thread or tag |
 *
 * Adding a tag that is already there, or removing one that isn't, succeeds
 * and changes nothing (PUT / DELETE are idempotent).
 *
 * A thread is the conversation key the thread view uses: the emails'
 * `thread_id`, or the email's own id for mail stored without one. Tagging a
 * thread tags every message in it; untagging removes the tag from every
 * message. Replies that arrive later start untagged, but the thread still
 * shows the tag, because a thread carries the tags of all its messages.
 *
 * `GET /tags/:tagId/emails` lists mail with the tag outside Trash, Spam and
 * Drafts (`include_junk=true` keeps them). Flat by default: one row per
 * tagged message, newest first, like `GET /emails?reply_later=true`. With
 * `threaded=true`: one row per conversation that has a tagged message — the
 * newest tagged message, with `thread_count`, `thread_unread_count` and
 * `participants` counted over the conversation's listed messages — like a
 * threaded folder list. `totalCount` counts rows in the same unit.
 *
 * ## Payloads
 *
 * - Email detail (`GET /emails/:id`) and every message of
 *   `GET /threads/:threadId` carry `tags: TagRef[]`: that message's tags.
 * - Flat list and search rows carry `tags`: that message's tags.
 * - Threaded list rows (`GET /emails?threaded=true`, threaded tag lists)
 *   carry `tags`: every tag on any message in the conversation.
 *
 * `tags` is always present (an empty array when untagged) and sorted by name.
 *
 * ## Live events (`GET /events`)
 *
 * - `email_updated` `{ id, tags }` for each message whose tags changed.
 * - `tags_changed` `{}` after a tag is created, renamed or deleted (rows
 *   showing that tag need a refresh).
 */

/** Longest tag name, in characters (code points), after trimming. */
export const TAG_NAME_MAX = 64;
/** Most tags one mailbox can hold. */
export const MAX_TAGS_PER_MAILBOX = 500;

/** A tag as listed and returned by the tag routes. */
export interface Tag {
	id: string;
	name: string;
	/** Tagged messages outside Trash, Spam and Drafts. */
	emailCount: number;
	/** Unread tagged messages outside Trash, Spam and Drafts. */
	unreadCount: number;
	createdAt: string;
	updatedAt: string;
}

/** The short form carried on email and thread payloads. */
export interface TagRef {
	id: string;
	name: string;
}

/** `POST /tags` and `PATCH /tags/:tagId` body. */
export interface TagNameRequest {
	name: string;
}

/** `PUT` / `DELETE /emails/:id/tags/:tagId` response. */
export interface EmailTagsResponse {
	id: string;
	tags: TagRef[];
}

/** `PUT` / `DELETE /threads/:threadId/tags/:tagId` response. */
export interface ThreadTagsResponse {
	threadId: string;
	/** Every tag on any message of the thread, after the change. */
	tags: TagRef[];
	/** Messages whose tags changed. */
	emailIds: string[];
}

export type TagNameResult = { ok: true; name: string; key: string } | { ok: false; error: string };

/**
 * Trim, fold runs of whitespace to one space, and check length and content.
 * `key` is the case-insensitive form that must be unique per mailbox.
 */
export function normalizeTagName(raw: unknown): TagNameResult {
	if (typeof raw !== "string") return { ok: false, error: "Tag name is required" };
	const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
	if (!name) return { ok: false, error: "Tag name is required" };
	// Control characters and bidi overrides don't belong in a label (zero-width
	// joiners stay: emoji sequences use them).
	if (/[\p{Cc}‎‏‪-‮⁦-⁩]/u.test(name)) {
		return { ok: false, error: "Tag name contains invalid characters" };
	}
	if (Array.from(name).length > TAG_NAME_MAX) {
		return { ok: false, error: `Tag name must be at most ${TAG_NAME_MAX} characters` };
	}
	return { ok: true, name, key: name.toLowerCase() };
}
