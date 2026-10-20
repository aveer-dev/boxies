// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Spam / Trash retention (AVE-42).
 *
 * A message's retention clock (`emails.retention_since`) starts when it enters
 * Spam or Trash and is cleared when it leaves; SQLite triggers from migration
 * 34 keep it current on every write path. Once the clock is older than
 * `FOLDER_RETENTION_DAYS`, the MailboxDO alarm deletes the message for good.
 *
 * Deletes use the AVE-46 order: rows (and their attachment rows) are deleted
 * in the same transaction that queues their R2 keys in `pending_blob_deletes`;
 * the caller then sweeps the queue, and anything R2 fails to delete stays
 * queued for the alarm to retry.
 */

import { FOLDER_RETENTION_DAYS, RETENTION_FOLDER_IDS } from "../../shared/folders.ts";
import { attachmentKey } from "./attachments.ts";
import { emailContentKeys } from "./email-content.ts";
import { enqueueBlobDeletes } from "./pending-blob-deletes.ts";
import { deleteThreadNotesForDeletedEmail } from "./thread-notes.ts";

type Sql = Pick<SqlStorage, "exec">;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const FOLDER_RETENTION_MS = FOLDER_RETENTION_DAYS * DAY_MS;
/** Messages deleted per alarm run; a full batch re-arms the alarm right away. */
export const RETENTION_PURGE_BATCH_SIZE = 100;
/** Delay before the next batch when a run hit the batch limit. */
export const RETENTION_CONTINUE_DELAY_MS = 1_000;
/** Earliest and latest the next sweep is scheduled (it re-checks at least daily). */
export const RETENTION_MIN_DELAY_MS = 60_000;
export const RETENTION_MAX_DELAY_MS = DAY_MS;

const RETENTION_FOLDERS_SQL = RETENTION_FOLDER_IDS.map((id) => `'${id}'`).join(", ");

/** Rows whose clock started before this ISO time are expired. */
export function retentionCutoffIso(now: number, retentionMs = FOLDER_RETENTION_MS): string {
	return new Date(now - retentionMs).toISOString();
}

export interface RetentionPurgeResult {
	/** Ids of the deleted emails (for change events). */
	deletedIds: string[];
	/** R2 keys queued for deletion; sweep them after the transaction. */
	blobKeys: string[];
	/** True when the batch was full, so more expired mail may remain. */
	more: boolean;
}

/**
 * Delete one batch of Spam / Trash mail whose retention clock is older than
 * the retention period. Selection and delete run in one transaction, so a
 * message moved out of Spam / Trash concurrently is never deleted.
 */
export function purgeExpiredRetentionEmails(options: {
	sql: Sql;
	transactionSync: <T>(fn: () => T) => T;
	now?: number;
	retentionMs?: number;
	batchSize?: number;
}): RetentionPurgeResult {
	const { sql, transactionSync } = options;
	const now = options.now ?? Date.now();
	const batchSize = options.batchSize ?? RETENTION_PURGE_BATCH_SIZE;
	const cutoff = retentionCutoffIso(now, options.retentionMs);

	return transactionSync(() => {
		const rows = [
			...sql.exec(
				`SELECT id, thread_id FROM emails
				 WHERE retention_since IS NOT NULL
				   AND retention_since < ?1
				   AND folder_id IN (${RETENTION_FOLDERS_SQL})
				 ORDER BY retention_since
				 LIMIT ?2`,
				cutoff,
				batchSize,
			),
		] as { id: string; thread_id: string | null }[];

		const blobKeys: string[] = [];
		for (const row of rows) {
			const attachments = [
				...sql.exec(`SELECT id, filename FROM attachments WHERE email_id = ?1`, row.id),
			] as { id: string; filename: string }[];
			blobKeys.push(
				...emailContentKeys(row.id),
				...attachments.map((att) => attachmentKey(row.id, att.id, att.filename)),
			);
			sql.exec(`DELETE FROM attachments WHERE email_id = ?1`, row.id);
			sql.exec(`DELETE FROM emails WHERE id = ?1`, row.id);
			sql.exec(`DELETE FROM emails_fts WHERE id = ?1`, row.id);
			deleteThreadNotesForDeletedEmail(sql, row.id, row.thread_id || row.id);
		}
		enqueueBlobDeletes(sql, blobKeys, now);

		return {
			deletedIds: rows.map((row) => row.id),
			blobKeys,
			more: rows.length >= batchSize,
		};
	});
}

/**
 * Delay until the next retention sweep, or null when Spam and Trash are empty
 * (moving mail in re-arms it). Due when the oldest clock expires, clamped to
 * [RETENTION_MIN_DELAY_MS, RETENTION_MAX_DELAY_MS] so it re-checks daily.
 */
export function nextRetentionSweepDelayMs(
	sql: Sql,
	now = Date.now(),
	retentionMs = FOLDER_RETENTION_MS,
): number | null {
	const row = [
		...sql.exec(
			`SELECT MIN(retention_since) AS oldest FROM emails
			 WHERE retention_since IS NOT NULL
			   AND folder_id IN (${RETENTION_FOLDERS_SQL})`,
		),
	][0] as { oldest: string | null } | undefined;
	if (!row?.oldest) return null;
	const startedAt = Date.parse(row.oldest);
	const dueIn = Number.isFinite(startedAt) ? startedAt + retentionMs - now : 0;
	return Math.min(Math.max(dueIn, RETENTION_MIN_DELAY_MS), RETENTION_MAX_DELAY_MS);
}
