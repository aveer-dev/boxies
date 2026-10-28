// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-turn limits for EmailAgent chat (AVE-45), kept out of agent/index.ts
 * so they run under node tests without the Agents SDK.
 */

import {
	convertToModelMessages,
	createUIMessageStream,
	createUIMessageStreamResponse,
	type ModelMessage,
	type UIMessage,
} from "ai";
import type { AiQuotaExceededError } from "../../shared/ai-quota.ts";
import { capChatHistory, CHAT_HISTORY_LIMIT, tryConsumeAiQuota, type AiQuotaStub } from "./ai-quota.ts";

/** Model messages for a chat turn: the last CHAT_HISTORY_LIMIT messages only. */
export async function chatHistoryForModel(
	messages: readonly UIMessage[],
	max: number = CHAT_HISTORY_LIMIT,
): Promise<ModelMessage[]> {
	return convertToModelMessages(capChatHistory(messages, max));
}

/**
 * A chat reply that is only the typed quota error: one UI-message-stream
 * `error` chunk whose `errorText` is the JSON AiQuotaExceededError. The
 * agent persists nothing for it (no parts), and clients surface it as the
 * stream error.
 */
export function quotaExceededChatResponse(error: AiQuotaExceededError): Response {
	const stream = createUIMessageStream({
		execute: ({ writer }) => {
			writer.write({ type: "error", errorText: JSON.stringify(error) });
		},
	});
	return createUIMessageStreamResponse({ stream });
}

/**
 * Count this chat turn against the mailbox's daily chat quota. Returns the
 * typed-error response to send instead of calling the model, or null to go
 * ahead.
 */
export async function chatQuotaGate(stub: AiQuotaStub, mailboxId: string): Promise<Response | null> {
	const quota = await tryConsumeAiQuota(stub, mailboxId, "chat");
	if (quota && !quota.allowed) {
		console.warn(`AI chat quota reached for ${mailboxId}: ${quota.used}/${quota.limit}`);
		return quotaExceededChatResponse(quota.error);
	}
	return null;
}
