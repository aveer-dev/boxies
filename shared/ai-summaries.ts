// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * AI summaries (AVE-20): wire types shared by the Worker, the web app and
 * (by shape) the native clients.
 *
 * Routes (all under /api/v1/mailboxes/:mailboxId):
 * - GET  /threads/:threadId/summary             cached, or generated on first open
 * - POST /threads/:threadId/summary/regenerate  always re-runs the model
 * - GET  /emails/:emailId/summary               cached quick summary only (never generates)
 * - POST /emails/:emailId/summary/generate      quick summary; body `{ regenerate?: boolean }`
 *
 * `threadId` is the thread key clients already use: `email.thread_id || email.id`.
 * A missing thread or email is a 404; a model failure is a 502.
 */

import { Folders } from "./folders";

export type AiSummaryTargetType = "thread" | "email";

export interface AiSummary {
	target_type: AiSummaryTargetType;
	/** Thread key for "thread", email id for "email". */
	target_id: string;
	/** One to three plain-text sentences. */
	summary: string;
	/** Up to a few action items / deadlines / questions. Often empty. */
	key_points: string[];
	model: string;
	/** Messages the summary covers (thread) or 1 (email). */
	message_count: number;
	/** Newest message the summary covers. */
	last_email_id: string;
	created_at: string;
	updated_at: string;
}

/**
 * Why there is no summary. Clients show nothing for any of these.
 * - folder: the mail is in Screener, Screened out, Spam, Trash or Drafts.
 * - screened_out_sender: the sender was rejected in the Screener.
 * - too_short: not enough text for a summary to add anything.
 * - single_message: quick summaries are only for messages in a multi-message thread.
 */
export type AiSummaryIneligibleReason =
	| "folder"
	| "screened_out_sender"
	| "too_short"
	| "single_message";

export type AiSummaryResponse =
	| { status: "ready"; summary: AiSummary; /** False when the model ran for this request. */ cached: boolean }
	| { status: "not_eligible"; reason: AiSummaryIneligibleReason }
	/** GET /emails/:id/summary only: eligible, but nothing generated yet (or it is out of date). */
	| { status: "missing" };

/**
 * Below this much body text (quoted history excluded) a summary adds
 * nothing and the API answers not_eligible / too_short.
 */
export const MIN_SUMMARY_CHARS = 500;

/**
 * Folders whose mail never gets a summary. Screener / Screened out / Spam
 * never reached the user's mailbox; Trash and Drafts are not mail to read.
 */
export const SUMMARY_EXCLUDED_FOLDER_IDS: readonly string[] = [
	Folders.SCREENER,
	Folders.SCREENED_OUT,
	Folders.SPAM,
	Folders.TRASH,
	Folders.DRAFT,
];

/** True when mail in this folder can be summarized (inbox, updates, promotions, archive, sent, custom). */
export function isSummaryFolderEligible(folderId: string | null | undefined): boolean {
	if (!folderId) return false;
	return !SUMMARY_EXCLUDED_FOLDER_IDS.includes(folderId);
}
