// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * `Idempotency-Key` for send / reply / forward (AVE-63).
 *
 * A client that retries a send (flaky network, app killed mid-request) sends
 * the same key again. The key is stored on the Sent row, unique per mailbox
 * (each mailbox is its own Durable Object), so a replay returns the original
 * row instead of creating a second one and sending again.
 *
 * Atomicity: `MailboxDO.createEmail` checks for the key and inserts the row
 * synchronously, with no await in between, so of two concurrent requests with
 * the same key only one inserts (and only that one is handed to delivery).
 * The partial UNIQUE index on `emails.idempotency_key` is the backstop.
 *
 * The key is scoped to the mailbox, not to the route: reusing a key from a
 * send on a reply or forward returns the original send's row.
 */

import type { Context } from "hono";
import { deleteEmailAttachments } from "./attachments";

type Sql = Pick<SqlStorage, "exec">;

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
/** Set on a replayed response (same name Stripe uses). */
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";

export type IdempotencyKeyParse =
	| { ok: true; key: string | null }
	| { ok: false; error: string };

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/;

/**
 * Validate the header value. Absent → `{ ok: true, key: null }` (behave as
 * before). Present but empty, too long, or not printable ASCII → error (400).
 */
export function parseIdempotencyKey(raw: string | null | undefined): IdempotencyKeyParse {
	if (raw === undefined || raw === null) return { ok: true, key: null };
	const key = raw.trim();
	if (
		key.length === 0 ||
		key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
		!PRINTABLE_ASCII.test(key)
	) {
		return {
			ok: false,
			error: `${IDEMPOTENCY_KEY_HEADER} must be 1-${IDEMPOTENCY_KEY_MAX_LENGTH} printable ASCII characters`,
		};
	}
	return { ok: true, key };
}

/** Id of the row already stored with this key, if any. Synchronous. */
export function findEmailIdByIdempotencyKey(sql: Sql, key: string): string | null {
	const row = [
		...sql.exec(`SELECT id FROM emails WHERE idempotency_key = ? LIMIT 1`, key),
	][0] as { id: string } | undefined;
	return row ? String(row.id) : null;
}

/** SQLite's error when a second row tries to take an existing key. */
export function isIdempotencyKeyConflict(error: unknown): boolean {
	const message = String((error as { message?: unknown })?.message ?? error ?? "");
	return /UNIQUE constraint failed: emails\.idempotency_key/i.test(message);
}

/** What `createEmail` reports: the row id, and whether it already existed. */
export interface CreateEmailResult {
	id: string;
	replayed: boolean;
}

/**
 * The atomic step of `createEmail`: if a row already holds `key`, return it
 * (nothing inserted); otherwise run `insert` (synchronous) for row `id`.
 * Must be called with no await between it and nothing awaited inside, so
 * the check and the insert can't interleave with another request. A UNIQUE
 * violation on the key (the index backstop) also resolves to the winner.
 * With no key it just inserts.
 */
export function insertOrReplay(
	sql: Sql,
	key: string | null,
	id: string,
	insert: () => void,
): CreateEmailResult {
	if (key) {
		const existing = findEmailIdByIdempotencyKey(sql, key);
		if (existing) return { id: existing, replayed: true };
	}
	try {
		insert();
	} catch (error) {
		const winner = key && isIdempotencyKeyConflict(error)
			? findEmailIdByIdempotencyKey(sql, key)
			: null;
		if (!winner) throw error;
		return { id: winner, replayed: true };
	}
	return { id, replayed: false };
}

/**
 * The response a replay gets: the same 202 + `{ id, status }` the original
 * send returned, pointing at the original row, plus `Idempotent-Replayed`.
 */
export function idempotentReplayResponse(
	c: Context,
	id: string,
): Response {
	return c.json({ id, status: "sent" }, 202, { [IDEMPOTENT_REPLAYED_HEADER]: "true" });
}

/**
 * Read and validate the request's key, and short-circuit a replay of a send
 * that is already stored. Returns a Response to send back (400 or replay),
 * or the key (null when absent) to pass to `createEmail`.
 */
export async function checkIdempotencyKey(
	c: Context,
	stub: { findEmailIdByIdempotencyKey: (key: string) => Promise<string | null> },
): Promise<{ response: Response } | { key: string | null }> {
	const parsed = parseIdempotencyKey(c.req.header(IDEMPOTENCY_KEY_HEADER));
	if (!parsed.ok) return { response: c.json({ error: parsed.error }, 400) };
	if (parsed.key) {
		const existing = await stub.findEmailIdByIdempotencyKey(parsed.key);
		if (existing) return { response: idempotentReplayResponse(c, existing) };
	}
	return { key: parsed.key };
}

/**
 * `createEmail` reported a replay after this request already reserved a send
 * slot and wrote its attachments under its own (now unused) id: give both back.
 */
export async function discardReplayedSend(
	env: { BUCKET: Parameters<typeof deleteEmailAttachments>[0] },
	stub: { releaseSendSlot: () => Promise<void> },
	unusedEmailId: string,
	attachments: { id: string; filename: string }[],
): Promise<void> {
	await stub.releaseSendSlot().catch(() => {});
	await deleteEmailAttachments(env.BUCKET, unusedEmailId, attachments).catch(() => {});
}
