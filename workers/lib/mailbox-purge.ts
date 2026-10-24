// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Mailbox purge ordering (MailboxDO.purgeMailbox).
 *
 * 1. Tombstone first: the deleted flag is stored before anything is wiped, so
 *    `createEmail`/`updateDraft` and inbound delivery are refused from then on
 *    and nothing new can land after the wipe.
 * 2. Rows: one `transactionSync` inventories every R2 key the rows point at,
 *    queues those keys in `pending_blob_deletes` and wipes the tables. Rows
 *    are gone if and only if their blobs are queued.
 * 3. Blobs: the queue is swept. Whatever R2 fails to delete stays queued and
 *    the DO alarm retries it until done.
 * 4. The mailbox metadata (`mailboxes/{id}.json`) is deleted last; it is what
 *    routes inbound mail here.
 *
 * Every step is safe to repeat, so a purge interrupted anywhere after the
 * tombstone completes when it is retried.
 */

import { collectMailboxPurgeR2Keys } from "./attachments.ts";
import { agentConversationIdsToPurge } from "./agent-conversation-tombstones.ts";
import { emailContentKeys } from "./email-content.ts";
import {
	blobDeleteRetryDelayMs,
	drainPendingBlobDeletes,
	enqueueBlobDeletes,
} from "./pending-blob-deletes.ts";

type Sql = Pick<SqlStorage, "exec">;
type Bucket = { delete(keys: string | string[]): Promise<unknown> };

/** Tables a purge empties. `pending_blob_deletes` and `d1_migrations` survive. */
export const MAILBOX_PURGE_TABLES = [
	"aliases",
	"send_log",
	"attachments",
	"emails",
	"folders",
	"agent_conversations",
	"device_tokens",
	"dismissed_todos",
	"auto_reply_receipts",
	"sender_triage",
	"sender_preferences",
	"sender_rules",
	"inbound_message_claims",
	"thread_notes",
] as const;

/**
 * Queue every blob the mailbox rows point at, then wipe the rows and reseed
 * the system folders. Run inside `transactionSync`.
 *
 * Live agent conversations become tombstones rather than vanishing, so a
 * retried purge still returns their ids for the EmailAgent purge.
 */
export function wipeMailboxRowsAndQueueBlobs(
	sql: Sql,
	systemFolders: { id: string; name: string }[],
	now = Date.now(),
): void {
	const emailIds = [...sql.exec(`SELECT id FROM emails`)].map((row) => String(row.id));
	const attachmentRows = [
		...sql.exec(`SELECT email_id, id, filename FROM attachments`),
	].map((row) => ({
		email_id: String(row.email_id),
		id: String(row.id),
		filename: String(row.filename),
	}));
	const aliasEmails = [...sql.exec(`SELECT alias_email FROM aliases`)].map((row) =>
		String(row.alias_email),
	);
	enqueueBlobDeletes(
		sql,
		collectMailboxPurgeR2Keys(emailIds, attachmentRows, emailContentKeys, aliasEmails),
		now,
	);

	const deletedAt = new Date(now).toISOString();
	sql.exec(
		`INSERT OR IGNORE INTO agent_conversation_tombstones (id, deleted_at)
		 SELECT id, ? FROM agent_conversations`,
		deletedAt,
	);
	for (const table of MAILBOX_PURGE_TABLES) {
		sql.exec(`DELETE FROM ${table}`);
	}
	for (const folder of systemFolders) {
		sql.exec(
			`INSERT INTO folders (id, name, is_deletable) VALUES (?, ?, 0)`,
			folder.id,
			folder.name,
		);
	}
}

export interface MailboxPurgeDeps {
	sql: Sql;
	transactionSync<T>(fn: () => T): T;
	bucket: Bucket;
	systemFolders: { id: string; name: string }[];
	/** R2 key of `mailboxes/{id}.json`. */
	metadataKey: string;
	/** Persist the deleted flag. Must complete before any row is touched. */
	markDeleted(): Promise<void>;
	/** Best-effort cleanup after the row wipe (FTS, KV flags). */
	afterWipe(): Promise<void>;
	/** Make sure the DO alarm fires within `delayMs` to sweep leftover blobs. */
	scheduleBlobSweep(delayMs: number): Promise<void>;
	now?: () => number;
}

export async function runMailboxPurge(
	deps: MailboxPurgeDeps,
): Promise<{ conversationIds: string[]; pendingBlobDeletes: number }> {
	await deps.markDeleted();

	deps.transactionSync(() =>
		wipeMailboxRowsAndQueueBlobs(deps.sql, deps.systemFolders, deps.now?.() ?? Date.now()),
	);
	// Includes deleted conversations whose agent purge never completed, and
	// those from an earlier, interrupted run of this purge.
	const conversationIds = agentConversationIdsToPurge(deps.sql);

	await deps.afterWipe();

	const drained = await drainPendingBlobDeletes(deps.sql, deps.bucket);
	if (drained.remaining > 0) {
		if (drained.error) {
			console.error("purgeMailbox blob delete failed, alarm will retry:", drained.error.message);
		}
		await deps.scheduleBlobSweep(blobDeleteRetryDelayMs(deps.sql));
	}

	await deps.bucket.delete(deps.metadataKey);
	return { conversationIds, pendingBlobDeletes: drained.remaining };
}
