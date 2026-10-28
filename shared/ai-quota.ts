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
