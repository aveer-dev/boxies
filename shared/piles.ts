// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Piles (AVE-201 / AVE-194): lists of mail you want back, next to folders.
 * Reply Later and Set Aside are built in; people add their own named piles
 * ("Waiting on", "To pay", "Hiring"). A message, and a thread, is in at most
 * one pile at a time. Replying takes a thread out of Reply Later only.
 *
 * Piles belong to a mailbox and are shared by everyone who can open it.
 *
 * ## API (all under `/api/v1/mailboxes/:mailboxId`, any mailbox member)
 *
 * | Route | Body | Response |
 * | --- | --- | --- |
 * | `GET /workflow-piles` | | `{ piles: WorkflowPile[] }`: built-in first, then custom piles in the order made |
 * | `POST /piles` | `{ name }` | `201 WorkflowPile`; `409` name taken; `400` invalid / too many piles |
 * | `PATCH /piles/:pileId` | `{ name }` | `WorkflowPile`; `404`; `409` name taken; `400` built-in pile |
 * | `DELETE /piles/:pileId` | | `204`; `404`; `400` built-in pile. Mail comes out of the pile, nothing else changes |
 * | `GET /emails?pile=<id>` | `&page=&limit=` | `{ emails, totalCount }`, oldest added first |
 * | `PUT /emails/:id` | `{ pile: id \| null }` | the email. Joining a pile takes the rest of the thread out of any other |
 *
 * Built-in piles can't be renamed or deleted. Names are unique per mailbox,
 * ignoring case.
 *
 * ## Live events (`GET /events`)
 *
 * - `email_updated` `{ id, pile_id, reply_later }` for each message whose pile changed.
 * - `piles_changed` `{}` after a pile is created, renamed or deleted.
 */

export const PILE_REPLY_LATER = "reply_later";
export const PILE_SET_ASIDE = "set_aside";

/** Longest pile name, in characters (code points), after trimming. */
export const PILE_NAME_MAX = 40;
/** Most custom piles one mailbox can hold (built-in piles don't count). */
export const MAX_CUSTOM_PILES = 20;

/** A pile as `GET /workflow-piles` lists it. */
export interface WorkflowPile {
	id: string;
	name: string;
	builtin: boolean;
	/** Replying to the thread takes it out of this pile (Reply Later only). */
	clears_on_reply: boolean;
	/** Messages in the pile outside Trash, Spam and Drafts. */
	count: number;
	/** Reply Later mail whose reminder fired and is still unread; 0 elsewhere. */
	due_count: number;
}

export type PileNameResult = { ok: true; name: string; key: string } | { ok: false; error: string };

/**
 * Trim, fold runs of whitespace to one space, and check length and content.
 * `key` is the case-insensitive form that must be unique per mailbox.
 */
export function normalizePileName(raw: unknown): PileNameResult {
	if (typeof raw !== "string") return { ok: false, error: "Pile name is required" };
	const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
	if (!name) return { ok: false, error: "Pile name is required" };
	// Control characters and bidi overrides don't belong in a label (zero-width
	// joiners stay: emoji sequences use them).
	if (/[\p{Cc}‎‏‪-‮⁦-⁩]/u.test(name)) {
		return { ok: false, error: "Pile name contains invalid characters" };
	}
	if (Array.from(name).length > PILE_NAME_MAX) {
		return { ok: false, error: `Pile name must be at most ${PILE_NAME_MAX} characters` };
	}
	return { ok: true, name, key: name.toLowerCase() };
}
