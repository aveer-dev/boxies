/**
 * Atomic inbound dedup inside MailboxDO SQLite.
 *
 * Inbound delivery awaits R2 writes and an AI classify call before
 * `createEmail`, and the Durable Object takes other requests at every one of
 * those awaits. A read-only "is this Message-ID stored?" check therefore lets
 * two concurrent deliveries of the same message (an Email Routing retry, or
 * several recipients that route to one mailbox) both pass and both insert.
 *
 * Instead the worker claims the Message-ID first. The check against `emails`
 * and the claim insert run synchronously with no await in between, so only
 * one delivery wins. Each mailbox is its own Durable Object, so the same
 * Message-ID delivered to two different mailboxes is claimed once per mailbox.
 *
 * Each claim carries the delivery's own id (the email row id it will insert),
 * so a delivery can only complete or release its own claim. A claim holds
 * until `createEmail` stores the row (`email_id` is then recorded). A delivery that fails gives its claim back so a retry can
 * redeliver; a claim left behind by a crashed isolate goes stale after
 * `INBOUND_CLAIM_STALE_MS` and can be taken over.
 */

type Sql = Pick<SqlStorage, "exec">;

/** A pending claim older than this is treated as abandoned. */
export const INBOUND_CLAIM_STALE_MS = 15 * 60 * 1000;
/** Claim rows older than this are pruned; `emails` still dedups stored mail. */
export const INBOUND_CLAIM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Same normalization as `findEmailByMessageId`. */
export function normalizeInboundMessageId(messageId: string | null | undefined): string {
	return (messageId ?? "").trim().replace(/^<|>$/g, "");
}

function firstRow<T>(sql: Sql, query: string, ...bindings: unknown[]): T | undefined {
	return [...sql.exec(query, ...bindings)][0] as T | undefined;
}

/**
 * Claim a Message-ID for delivery. `claimId` is the email row id this
 * delivery will insert. Returns false when the message is already
 * stored or another delivery holds a live claim. Synchronous: run it inside
 * `transactionSync` (and never put an await between the check and insert).
 */
export function claimInboundMessage(
	sql: Sql,
	messageId: string,
	claimId: string,
	now = Date.now(),
	staleMs = INBOUND_CLAIM_STALE_MS,
): boolean {
	const cleaned = normalizeInboundMessageId(messageId);
	if (!cleaned) return true; // No Message-ID: nothing to dedup on.

	sql.exec(
		`DELETE FROM inbound_message_claims WHERE claimed_at < ?`,
		now - INBOUND_CLAIM_RETENTION_MS,
	);

	if (firstRow(sql, `SELECT 1 AS hit FROM emails WHERE message_id = ? LIMIT 1`, cleaned)) {
		return false;
	}

	const claim = firstRow<{ claimed_at: number; email_id: string | null }>(
		sql,
		`SELECT claimed_at, email_id FROM inbound_message_claims WHERE message_id = ?`,
		cleaned,
	);
	if (!claim) {
		sql.exec(
			`INSERT INTO inbound_message_claims (message_id, claimed_at, claim_id, email_id) VALUES (?, ?, ?, NULL)`,
			cleaned,
			now,
			claimId,
		);
		return true;
	}

	// A completed claim whose email has since been deleted (the `emails`
	// check above missed it) may be delivered again, as before claims existed.
	const pending = claim.email_id == null;
	if (pending && now - Number(claim.claimed_at) < staleMs) return false;

	sql.exec(
		`UPDATE inbound_message_claims SET claimed_at = ?, claim_id = ?, email_id = NULL WHERE message_id = ?`,
		now,
		claimId,
		cleaned,
	);
	return true;
}

/**
 * `createEmail` stored the message: record which row holds it. `emailId` is
 * also the claim id the delivery claimed with, so only its own claim moves.
 */
export function completeInboundMessageClaim(sql: Sql, messageId: string, emailId: string): void {
	const cleaned = normalizeInboundMessageId(messageId);
	if (!cleaned) return;
	sql.exec(
		`UPDATE inbound_message_claims SET email_id = ? WHERE message_id = ? AND claim_id = ?`,
		emailId,
		cleaned,
		emailId,
	);
}

/**
 * A delivery failed before or during `createEmail`. If the row was stored
 * after all, keep the claim (completed) and report `"stored"` so the caller
 * keeps its R2 blobs. Otherwise drop the claim so a retry can redeliver and
 * report `"not_stored"`: the caller's blobs are orphans and can be deleted.
 */
export function abandonInboundDelivery(
	sql: Sql,
	emailId: string,
	messageId: string | null | undefined,
): "stored" | "not_stored" {
	const cleaned = normalizeInboundMessageId(messageId);
	const stored = Boolean(firstRow(sql, `SELECT 1 AS hit FROM emails WHERE id = ?`, emailId));
	if (cleaned) {
		if (stored) {
			completeInboundMessageClaim(sql, cleaned, emailId);
		} else {
			sql.exec(
				`DELETE FROM inbound_message_claims WHERE message_id = ? AND claim_id = ? AND email_id IS NULL`,
				cleaned,
				emailId,
			);
		}
	}
	return stored ? "stored" : "not_stored";
}
