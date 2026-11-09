// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * AI summaries count against the mailbox's daily AI quota (AVE-215). Over
 * it, the summary routes answer 429 with an AiQuotaExceededError body; the
 * reader shows a calm note instead of a "Couldn't summarize" error, and
 * doesn't offer (or auto-run) a retry that can't succeed until the reset.
 */

import { asAiQuotaError, formatAiUsageReset, type AiQuotaExceededError } from "../../shared/ai-quota";

/** The typed quota error behind a failed summary request (an ApiError), or null. */
export function summaryQuotaError(error: unknown): AiQuotaExceededError | null {
	const candidate = error as { status?: unknown; body?: unknown } | null;
	if (!candidate || typeof candidate !== "object" || candidate.status !== 429) return null;
	return asAiQuotaError(candidate.body);
}

/** "Daily AI limit reached. Resets in 6h." */
export function summaryQuotaText(quota: AiQuotaExceededError, now: number = Date.now()): string {
	return `Daily AI limit reached. ${formatAiUsageReset(quota.resetsAt, now)}.`;
}

/** React Query `retry`: one quiet retry for a model failure, none at the quota limit. */
export function retrySummaryOnce(failureCount: number, error: unknown): boolean {
	return failureCount < 1 && summaryQuotaError(error) === null;
}
