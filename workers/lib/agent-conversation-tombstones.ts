// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Ask AI conversation bookkeeping inside MailboxDO SQLite.
 *
 * Each conversation's chat lives in its own EmailAgent DO
 * (`mailboxId::conversationId`), found only through this mailbox's
 * `agent_conversations` registry. Deleting a conversation swaps its registry
 * row for a tombstone, so the chat can still be found and wiped if the agent
 * purge fails or never runs; mailbox purge sweeps both.
 */

type Sql = Pick<SqlStorage, "exec">;

/** Remove the registry row and tombstone it. Run inside `transactionSync`. */
export function tombstoneAgentConversation(sql: Sql, id: string, now = new Date()): void {
	sql.exec(`DELETE FROM agent_conversations WHERE id = ?`, id);
	sql.exec(
		`INSERT OR REPLACE INTO agent_conversation_tombstones (id, deleted_at) VALUES (?, ?)`,
		id,
		now.toISOString(),
	);
}

/** The conversation's EmailAgent storage is gone; forget it. */
export function clearAgentConversationTombstone(sql: Sql, id: string): void {
	sql.exec(`DELETE FROM agent_conversation_tombstones WHERE id = ?`, id);
}

/** Every conversation whose EmailAgent may hold chat: live and tombstoned. */
export function agentConversationIdsToPurge(sql: Sql): string[] {
	const rows = [
		...sql.exec(
			`SELECT id FROM agent_conversations UNION SELECT id FROM agent_conversation_tombstones`,
		),
	];
	return rows.map((row) => String(row.id));
}
