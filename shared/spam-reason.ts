// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Why an inbound message was filed where it was (docs/spam-management-plan.md
 * §5 Explainability). The Worker stores a stable machine code in
 * `emails.classification_reason`; clients map it to one line of copy.
 * iOS (`SpamReason.swift`) and Android (`SpamReason.kt`) mirror this table —
 * `android/test/spam-reason-parity.test.mjs` keeps the copy in sync.
 */

import { Folders } from "./folders.ts";

export const ClassificationReasons = {
	/** Upstream `X-Spam-Flag` / `X-Spam-Status: yes` / `Precedence: junk`. */
	SPAM_HEADERS: "spam-headers",
	/** Auth tier `failed`: enforced DMARC fail, or SPF hard-fail with no DKIM pass. */
	AUTH_FAILED: "auth-failed",
	/** The Workers AI spam/ham check said spam. */
	AI_SPAM: "ai-spam",
	/** The sender is rejected (declined in Screener, or reported as spam). */
	SENDER_REJECTED: "sender-rejected",
	AI_HAM: "ai-ham",
	AI_FAIL_OPEN: "ai-fail-open",
	AI_SPAM_OVERRIDDEN: "ai-spam-overridden",
	PERSONAL_HAM: "personal-ham",
	BULK_TRANSACTIONAL: "bulk-transactional",
	BULK_LIST_HEADERS: "bulk-list-headers",
	/** A bounce report (DSN) filed into the original message's thread. */
	DELIVERY_REPORT: "delivery-report",
} as const;

export type ClassificationReason =
	(typeof ClassificationReasons)[keyof typeof ClassificationReasons];

export type AuthTierValue = "verified" | "unverified" | "failed";

const SPAM_REASON_COPY: Record<string, string> = {
	[ClassificationReasons.AUTH_FAILED]: "Failed sender authentication",
	[ClassificationReasons.SPAM_HEADERS]: "Flagged by spam filter",
	[ClassificationReasons.AI_SPAM]: "Marked as spam by AI check",
	[ClassificationReasons.SENDER_REJECTED]: "You blocked this sender",
};

/**
 * One-line reason shown in the Spam and Screened out readers, or null when
 * the message isn't there or the stored code doesn't explain the folder
 * (e.g. the user moved ham into Spam by hand).
 */
export function spamReasonLine(
	reason: string | null | undefined,
	folderId: string | null | undefined,
): string | null {
	if (folderId !== Folders.SPAM && folderId !== Folders.SCREENED_OUT) return null;
	if (!reason) return null;
	return SPAM_REASON_COPY[reason] ?? null;
}

export const UNVERIFIED_SENDER_TITLE = "Unverified sender";

/** Banner detail; names the From domain when we have it. */
export function unverifiedSenderDetail(sender: string | null | undefined): string {
	const at = sender?.lastIndexOf("@") ?? -1;
	const domain = sender && at >= 0 ? sender.slice(at + 1).trim().replace(/>$/, "") : "";
	return domain
		? `We couldn’t confirm this message really came from ${domain}.`
		: "We couldn’t confirm who sent this message.";
}

/** Show the "Unverified sender" banner (any folder, allowed senders included). */
export function showsUnverifiedBanner(
	authTier: string | null | undefined,
): boolean {
	return authTier === "unverified";
}
