// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-recipient delivery state (AVE-41, migration 36_delivery_recipients).
 *
 * `emails.delivery_status` is one value per message, so with several
 * recipients it can't say which one bounced. Each Email Sending event names
 * one recipient; we keep the latest meaningful status per (email, address).
 *
 * Queue delivery is at-least-once and unordered, so a late event must not
 * undo a later one: an update only lands when its status ranks at least as
 * high as the stored one (deferred < delivered < failed / bounced <
 * complained). A complaint arrives after delivery, so it wins; a stray
 * deferred after a bounce is ignored.
 */

type Sql = Pick<SqlStorage, "exec">;

export type RecipientDeliveryStatus =
	| "deferred"
	| "delivered"
	| "failed"
	| "bounced"
	| "complained";

export interface DeliveryRecipient {
	address: string;
	status: RecipientDeliveryStatus;
	error: string | null;
	updated_at: string;
}

export interface RecipientDeliveryUpdate {
	address: string;
	status: RecipientDeliveryStatus;
	error?: string | null;
}

const STATUS_RANK: Record<RecipientDeliveryStatus, number> = {
	deferred: 0,
	delivered: 1,
	failed: 2,
	bounced: 2,
	complained: 3,
};

export function recipientStatusRank(status: string): number {
	return STATUS_RANK[status as RecipientDeliveryStatus] ?? 0;
}

/** Whether `next` should replace `existing` (undefined: no row yet). */
export function shouldReplaceRecipientStatus(
	existing: string | undefined,
	next: RecipientDeliveryStatus,
): boolean {
	if (existing === undefined) return true;
	return recipientStatusRank(next) >= recipientStatusRank(existing);
}

/** Lowercased, trimmed address; null when it can't be an address. */
export function normalizeRecipientAddress(address: string | null | undefined): string | null {
	const cleaned = address?.trim().toLowerCase();
	if (!cleaned || !cleaned.includes("@") || cleaned.length > 320) return null;
	return cleaned;
}

/**
 * Record one recipient's status for an email. Returns whether the stored row
 * changed. The caller has already found `emailId`.
 */
export function upsertDeliveryRecipient(
	sql: Sql,
	emailId: string,
	update: RecipientDeliveryUpdate,
	now: Date = new Date(),
): boolean {
	const address = normalizeRecipientAddress(update.address);
	if (!address) return false;
	const existing = [
		...sql.exec(
			`SELECT status, error FROM delivery_recipients WHERE email_id = ?1 AND address = ?2`,
			emailId,
			address,
		),
	][0] as { status: string; error: string | null } | undefined;
	if (!shouldReplaceRecipientStatus(existing?.status, update.status)) return false;
	const error = update.error ?? null;
	if (existing && existing.status === update.status && existing.error === error) return false;
	// Check-then-write is safe: a DO runs this synchronously, no await between.
	sql.exec(
		`INSERT INTO delivery_recipients (email_id, address, status, error, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5)
		 ON CONFLICT(email_id, address) DO UPDATE SET
		   status = excluded.status,
		   error = excluded.error,
		   updated_at = excluded.updated_at`,
		emailId,
		address,
		update.status,
		error,
		now.toISOString(),
	);
	return true;
}

/** Per-recipient rows for each email id (emails without rows are absent). */
export function listDeliveryRecipients(
	sql: Sql,
	emailIds: readonly string[],
): Map<string, DeliveryRecipient[]> {
	const byEmail = new Map<string, DeliveryRecipient[]>();
	if (emailIds.length === 0) return byEmail;
	// SQLite's bound-parameter limit is well above a thread's size, but chunk anyway.
	for (let i = 0; i < emailIds.length; i += 90) {
		const chunk = emailIds.slice(i, i + 90);
		const placeholders = chunk.map((_, j) => `?${j + 1}`).join(",");
		const rows = [
			...sql.exec(
				`SELECT email_id, address, status, error, updated_at
				   FROM delivery_recipients
				  WHERE email_id IN (${placeholders})
				  ORDER BY address`,
				...chunk,
			),
		] as unknown as Array<DeliveryRecipient & { email_id: string }>;
		for (const { email_id, ...row } of rows) {
			const list = byEmail.get(email_id) ?? [];
			list.push(row);
			byEmail.set(email_id, list);
		}
	}
	return byEmail;
}
