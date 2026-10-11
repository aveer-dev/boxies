// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * EmailAgent stub helpers for Worker-side callers (inbound auto-draft,
 * mailbox delete).
 *
 * Always address agents through `getAgentByName`: it tells partyserver the
 * instance name before any request lands. A bare `idFromName` + `fetch`
 * throws "Missing namespace or room headers" on instances no client has
 * connected to yet (e.g. a fresh mailbox's `auto` conversation).
 */
import { getAgentByName } from "agents";
import { agentInstanceName } from "../../shared/agent-conversations";
import type { Env } from "../types";

/** Named EmailAgent stub (`mailboxId` or `mailboxId::conversationId`). */
export function getEmailAgent(env: Env, name: string) {
	return getAgentByName(env.EMAIL_AGENT, name);
}

/**
 * Best-effort chat wipe for a deleted mailbox: the legacy single-chat
 * instance plus every multi-chat conversation the MailboxDO knew about.
 */
export async function purgeEmailAgents(
	env: Env,
	mailboxId: string,
	conversationIds: string[],
): Promise<void> {
	const names = new Set<string>([
		mailboxId, // legacy single-chat EmailAgent name
		...conversationIds.map((id) => agentInstanceName(mailboxId, id)),
	]);
	for (const name of names) {
		try {
			const agent = await getEmailAgent(env, name);
			await agent.purge();
		} catch (e) {
			// Best-effort: conversation ids are already captured; chat storage
			// orphans are lower impact than blocking mailbox delete.
			console.error(`EmailAgent purge failed for ${name}:`, (e as Error).message);
		}
	}
}
