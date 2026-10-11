// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbound auto-draft trigger: hands a new ham email to the mailbox's
 * EmailAgent `auto` conversation.
 */

import type { getAgentByName } from "agents";
import type { Env } from "../types";

/** Path EmailAgent.onRequest intercepts to start an auto-draft. */
export const NEW_EMAIL_PATH = "/onNewEmail";

export interface NewEmailPayload {
	mailboxId: string;
	emailId: string;
	sender: string;
	subject: string;
	threadId: string | null;
}

/**
 * `getAgentByName` from `agents`, injected by the Worker entry so this module
 * stays importable in Node tests. A raw `namespace.get(namespace.idFromName())`
 * stub is not enough: partyserver rejects fetches to a never-named instance
 * with "Missing namespace or room headers" (logged as `EmailAgent:<unnamed>`).
 */
export type AgentResolver = typeof getAgentByName;

export async function triggerAutoDraft(
	namespace: Env["EMAIL_AGENT"],
	agentName: string,
	payload: NewEmailPayload,
	getAgent: AgentResolver,
): Promise<void> {
	const agent = await getAgent(namespace, agentName);
	const response = await agent.fetch(
		new Request(`https://agents${NEW_EMAIL_PATH}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}),
	);
	// The agent answers errors with a 500 instead of throwing; surface them.
	if (!response.ok) {
		const detail = (await response.text()).slice(0, 500);
		throw new Error(`EmailAgent ${NEW_EMAIL_PATH} returned ${response.status}: ${detail}`);
	}
}
