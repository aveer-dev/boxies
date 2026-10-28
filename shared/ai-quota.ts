// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The typed "AI quota reached" error the EmailAgent sends to chat clients
 * (AVE-45). It travels as the `errorText` of a UI-message-stream `error`
 * chunk, JSON-encoded, so web, iOS and Android can tell it apart from other
 * stream errors and still show `message` as-is.
 */

export type AiQuotaBucket = "chat" | "inbound";

export interface AiQuotaExceededError {
	type: "ai_quota_exceeded";
	bucket: AiQuotaBucket;
	/** Requests allowed per UTC day for this bucket and plan tier. */
	limit: number;
	/** ISO timestamp of the next UTC midnight, when the counter resets. */
	resetsAt: string;
	/** Human-readable text clients can show without formatting their own. */
	message: string;
}

export function aiQuotaExceededError(
	bucket: AiQuotaBucket,
	limit: number,
	resetsAt: string,
): AiQuotaExceededError {
	const what = bucket === "chat" ? "AI chat messages" : "inbound AI checks";
	return {
		type: "ai_quota_exceeded",
		bucket,
		limit,
		resetsAt,
		message: `You've used today's ${limit} ${what} for this mailbox. The limit resets at midnight UTC.`,
	};
}

/** Parse a stream error's text; null unless it is an AI quota error. */
export function parseAiQuotaError(text: string | null | undefined): AiQuotaExceededError | null {
	if (!text || text[0] !== "{") return null;
	try {
		const value = JSON.parse(text) as Partial<AiQuotaExceededError>;
		if (value?.type !== "ai_quota_exceeded" || typeof value.message !== "string") return null;
		return value as AiQuotaExceededError;
	} catch {
		return null;
	}
}

/**
 * Today's AI usage for a mailbox (GET /api/v1/mailboxes/:id/ai-usage), so
 * clients can show a usage meter before the limit is hit.
 */
export interface AiUsageMeter {
	used: number;
	limit: number;
}

export interface AiUsageSnapshot {
	tier: "free" | "paid";
	/** UTC day the counters cover, `YYYY-MM-DD`. */
	day: string;
	/** ISO timestamp of the next UTC midnight, when both counters reset. */
	resetsAt: string;
	chat: AiUsageMeter;
	inbound: AiUsageMeter;
}

/** Fraction of the meter at which clients switch to the warning tint. */
export const AI_USAGE_WARNING_RATIO = 0.8;

export type AiUsageLevel = "normal" | "warning" | "exhausted";

export function aiUsageLevel(meter: AiUsageMeter): AiUsageLevel {
	if (meter.limit <= 0 || meter.used >= meter.limit) return "exhausted";
	return meter.used / meter.limit >= AI_USAGE_WARNING_RATIO ? "warning" : "normal";
}

/** "Resets in 6h" / "Resets in 42m" / "Resets in under a minute". */
export function formatAiUsageReset(resetsAt: string, now: number = Date.now()): string {
	const ms = Date.parse(resetsAt) - now;
	if (!Number.isFinite(ms) || ms <= 60_000) return "Resets in under a minute";
	const minutes = Math.ceil(ms / 60_000);
	if (minutes < 60) return `Resets in ${minutes}m`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 || hours >= 3 ? `Resets in ${hours}h` : `Resets in ${hours}h ${rest}m`;
}
