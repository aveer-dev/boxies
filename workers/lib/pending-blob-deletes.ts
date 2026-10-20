// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Durable R2 delete queue inside MailboxDO SQLite.
 *
 * Deleting mail always goes row first, then blob: the SQLite row (and its
 * attachment rows) is deleted in the same `transactionSync` that records the
 * row's R2 keys here. The blobs are deleted afterwards, and a key leaves this
 * table only once R2 has confirmed the delete. If the R2 call fails, or the
 * isolate dies mid-way, the keys stay queued and the DO alarm sweeps them
 * until they are gone. R2 deletes of missing keys succeed, so every step is
 * safe to repeat.
 *
 * Only keys recorded here are swept; there is no bucket-wide scan.
 */

import { deleteR2Keys } from "./attachments.ts";

type Sql = Pick<SqlStorage, "exec">;
type Bucket = { delete(keys: string | string[]): Promise<unknown> };

/** Keys deleted per sweep round (each round is one or more R2 delete calls). */
export const PENDING_BLOB_DELETE_BATCH_SIZE = 500;
/** First alarm retry after a failed sweep; doubles per failed attempt. */
export const BLOB_DELETE_RETRY_BASE_MS = 30_000;
/** Retry backoff ceiling. The sweep never gives up. */
export const BLOB_DELETE_RETRY_MAX_MS = 60 * 60 * 1000;

/** Record R2 keys to delete. Run in the same `transactionSync` as the row delete. */
export function enqueueBlobDeletes(sql: Sql, keys: string[], now = Date.now()): void {
	for (const key of keys) {
		sql.exec(
			`INSERT OR IGNORE INTO pending_blob_deletes (key, created_at, attempts) VALUES (?, ?, 0)`,
			key,
			now,
		);
	}
}

/**
 * Drop keys from the queue without deleting them: a new owner is about to
 * write that key (e.g. an alias address recreated after a purge).
 */
export function forgetPendingBlobDeletes(sql: Sql, keys: string[]): void {
	for (const key of keys) {
		sql.exec(`DELETE FROM pending_blob_deletes WHERE key = ?`, key);
	}
}

export function countPendingBlobDeletes(sql: Sql): number {
	const row = [...sql.exec(`SELECT COUNT(*) AS n FROM pending_blob_deletes`)][0] as
		| { n: number }
		| undefined;
	return Number(row?.n ?? 0);
}

/** Alarm delay for the next sweep, backing off by the most-failed key. */
export function blobDeleteRetryDelayMs(sql: Sql): number {
	const row = [...sql.exec(`SELECT MAX(attempts) AS a FROM pending_blob_deletes`)][0] as
		| { a: number | null }
		| undefined;
	const attempts = Math.max(0, Math.min(Number(row?.a ?? 0), 20));
	return Math.min(BLOB_DELETE_RETRY_BASE_MS * 2 ** attempts, BLOB_DELETE_RETRY_MAX_MS);
}

export interface BlobDrainResult {
	deleted: number;
	remaining: number;
	error: Error | null;
}

/**
 * Delete queued blobs from R2, then forget them. With `keys`, only those
 * queued keys are swept (the caller's own delete); otherwise the whole queue,
 * batch by batch, until it is empty or R2 fails. Never throws: a failure
 * bumps the keys' attempt count, leaves them queued and is returned.
 */
export async function drainPendingBlobDeletes(
	sql: Sql,
	bucket: Bucket,
	options: { keys?: string[]; batchSize?: number } = {},
): Promise<BlobDrainResult> {
	const batchSize = options.batchSize ?? PENDING_BLOB_DELETE_BATCH_SIZE;
	let deleted = 0;
	let error: Error | null = null;
	// A scoped drain is one round; a full drain loops until the queue is empty.
	const scoped = options.keys ? [...new Set(options.keys)] : null;

	while (true) {
		let batch: string[];
		if (scoped) {
			batch = scoped.filter(
				(key) => [...sql.exec(`SELECT 1 FROM pending_blob_deletes WHERE key = ?`, key)].length > 0,
			);
		} else {
			batch = [
				...sql.exec(
					`SELECT key FROM pending_blob_deletes ORDER BY created_at, key LIMIT ?`,
					batchSize,
				),
			].map((row) => String((row as { key: string }).key));
		}
		if (batch.length === 0) break;

		try {
			await deleteR2Keys(bucket as Parameters<typeof deleteR2Keys>[0], batch);
		} catch (e) {
			error = e instanceof Error ? e : new Error(String(e));
			for (const key of batch) {
				sql.exec(`UPDATE pending_blob_deletes SET attempts = attempts + 1 WHERE key = ?`, key);
			}
			break;
		}
		forgetPendingBlobDeletes(sql, batch);
		deleted += batch.length;
		if (scoped) break;
	}

	return { deleted, remaining: countPendingBlobDeletes(sql), error };
}
