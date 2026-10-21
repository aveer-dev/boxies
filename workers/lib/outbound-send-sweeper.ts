// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Stuck-send sweeper (AVE-66), run from the mailbox Durable Object's alarm.
 *
 * A Sent row stays `delivery_status = "queued"` until the outbound-send
 * consumer (or its DLQ consumer) settles it. If the queue message is lost
 * (enqueue looked fine but never arrived, a consumer died with its message
 * acked, a row from before the queue existed ...) the row would read
 * "Sending" forever. The sweeper finds rows queued for longer than
 * STUCK_SEND_THRESHOLD_MS, re-enqueues them (same `{ v, mailboxId, emailId }`
 * message the producer sends; the R2 payload is still staged), and after
 * STUCK_SEND_MAX_REENQUEUES re-enqueues marks the row failed so clients show
 * it as failed.
 *
 * Double sends are prevented by the consumer, not here: it claims the row in
 * the DO before calling the Email binding and acks rows no longer queued, so
 * an extra message for a row is harmless. The sweeper also leaves rows alone
 * while a consumer holds an unexpired claim (mid-delivery), and takes the
 * claim itself before marking a row failed, so it never fails a row a
 * consumer is sending.
 *
 * State lives on the emails row (migration 34_outbound_send_sweeper):
 * - `send_queued_at`: epoch ms of the last (re-)enqueue; NULL means "not seen
 *   yet" (the producer's note was lost, or the row predates this column) and
 *   the first sweep stamps it, so the clock starts then.
 * - `send_attempts`: re-enqueues the sweeper has made.
 */

import type { DeliveryStatus } from "../durableObject";
import { decideOutboundSendClaim, type OutboundSendClaim } from "./outbound-send-claim";
import {
	OUTBOUND_SEND_CLAIM_LEASE_MS,
	OUTBOUND_SEND_FAILED_ERROR,
	outboundPayloadKey,
	type OutboundBucket,
	type OutboundSendMessage,
	type OutboundSendPayload,
	type OutboundSendProducer,
} from "./outbound-send-queue";

/** A row queued this long without settling is considered stuck. */
export const STUCK_SEND_THRESHOLD_MS = 10 * 60 * 1000;
/** Re-enqueues before a still-stuck row is marked failed. */
export const STUCK_SEND_MAX_REENQUEUES = 3;
/** DO storage key holding the mailbox id (the DO can't derive its own name). */
export const OUTBOUND_SEND_MAILBOX_ID_KEY = "outbound_send_mailbox_id";
/** Slack after a row becomes due, so the alarm doesn't fire a hair early. */
const ALARM_SLACK_MS = 5_000;

/** `ctx.storage.sql` subset; results are iterated once. */
export type SweeperSql = {
	exec: (query: string, ...bindings: unknown[]) => Iterable<Record<string, unknown>>;
};

export type QueuedSendRow = {
	id: string;
	sendAttempts: number;
	sendQueuedAt: number | null;
};

export type StuckSendAction =
	/** First time the sweeper sees this row queued: start its clock. */
	| { kind: "stamp" }
	/** Not stuck yet. */
	| { kind: "wait"; dueAt: number }
	/** A consumer is delivering it right now. */
	| { kind: "in_flight"; dueAt: number }
	| { kind: "reenqueue" }
	| { kind: "fail" };

/** Pure decision for one queued row. */
export function decideStuckSend(
	row: QueuedSendRow,
	claimExpiresAt: number | null | undefined,
	now: number,
): StuckSendAction {
	if (row.sendQueuedAt == null) return { kind: "stamp" };
	const dueAt = row.sendQueuedAt + STUCK_SEND_THRESHOLD_MS;
	if (now < dueAt) return { kind: "wait", dueAt };
	if (decideOutboundSendClaim("queued", claimExpiresAt, now) === "in_flight") {
		return { kind: "in_flight", dueAt: claimExpiresAt as number };
	}
	return row.sendAttempts >= STUCK_SEND_MAX_REENQUEUES ? { kind: "fail" } : { kind: "reenqueue" };
}

/** Producer side: the row was just handed to the queue; start its clock. */
export function markOutboundSendQueued(sql: SweeperSql, emailId: string, now: number): void {
	consume(
		sql.exec(
			`UPDATE emails SET send_queued_at = ?2 WHERE id = ?1 AND delivery_status = 'queued'`,
			emailId,
			now,
		),
	);
}

export function listQueuedSends(sql: SweeperSql): QueuedSendRow[] {
	return [
		...sql.exec(
			`SELECT id, send_attempts, send_queued_at FROM emails WHERE delivery_status = 'queued'`,
		),
	].map((r) => ({
		id: String(r.id),
		sendAttempts: Number(r.send_attempts ?? 0),
		sendQueuedAt: r.send_queued_at == null ? null : Number(r.send_queued_at),
	}));
}

export function countQueuedSends(sql: SweeperSql): number {
	const row = [...sql.exec(`SELECT COUNT(*) AS n FROM emails WHERE delivery_status = 'queued'`)][0];
	return Number(row?.n ?? 0);
}

function consume(cursor: Iterable<unknown>): void {
	for (const _ of cursor) {
		/* drain */
	}
}

export interface StuckSendSweepDeps {
	sql: SweeperSql;
	now: () => number;
	/** Mailbox id for the queue message; null if this DO never learned it. */
	mailboxId: string | null;
	/** Current claim expiry for a row (peek; does not take it). */
	getClaimExpiry: (emailId: string) => Promise<number | null | undefined>;
	/** The DO's atomic status check + claim (MailboxDO.claimOutboundSend). */
	claim: (emailId: string, leaseMs: number) => Promise<OutboundSendClaim>;
	releaseClaim: (emailId: string) => Promise<void>;
	setDeliveryState: (
		emailId: string,
		state: { status: DeliveryStatus; providerMessageId?: string | null; error?: string | null },
	) => Promise<unknown>;
	bucket: Pick<OutboundBucket, "get" | "delete">;
	queue: OutboundSendProducer;
}

export type StuckSendSweepResult = {
	stamped: string[];
	reenqueued: string[];
	failed: string[];
	/** Epoch ms the alarm should next fire, or null when nothing is queued. */
	nextDueAt: number | null;
};

function errorMessage(error: unknown): string {
	return (error as Error | null)?.message ?? String(error);
}

async function acceptedProviderMessageId(
	bucket: StuckSendSweepDeps["bucket"],
	emailId: string,
): Promise<string | undefined> {
	try {
		const object = await bucket.get(outboundPayloadKey(emailId));
		if (!object) return undefined;
		const payload = JSON.parse(await object.text()) as OutboundSendPayload;
		return typeof payload?.acceptedProviderMessageId === "string"
			? payload.acceptedProviderMessageId
			: undefined;
	} catch (error) {
		console.warn("Stuck-send payload read failed:", emailId, errorMessage(error));
		return undefined;
	}
}

/**
 * One sweep over this mailbox's queued Sent rows. Per-row errors are logged
 * and the row is retried on the next sweep; this only throws if listing the
 * rows fails.
 */
export async function sweepStuckSends(deps: StuckSendSweepDeps): Promise<StuckSendSweepResult> {
	const result: StuckSendSweepResult = { stamped: [], reenqueued: [], failed: [], nextDueAt: null };
	const due = (at: number) => {
		result.nextDueAt = result.nextDueAt == null ? at : Math.min(result.nextDueAt, at);
	};

	for (const row of listQueuedSends(deps.sql)) {
		const now = deps.now();
		try {
			const action = decideStuckSend(row, await deps.getClaimExpiry(row.id), now);
			switch (action.kind) {
				case "stamp":
					markOutboundSendQueued(deps.sql, row.id, now);
					result.stamped.push(row.id);
					due(now + STUCK_SEND_THRESHOLD_MS);
					break;
				case "wait":
				case "in_flight":
					due(action.dueAt);
					break;
				case "reenqueue": {
					// Count the attempt and restart the clock before sending, so a
					// queue that keeps rejecting still ends in "failed".
					consume(
						deps.sql.exec(
							`UPDATE emails SET send_attempts = send_attempts + 1, send_queued_at = ?2
							 WHERE id = ?1 AND delivery_status = 'queued'`,
							row.id,
							now,
						),
					);
					due(now + STUCK_SEND_THRESHOLD_MS);
					if (!deps.mailboxId) {
						console.error("Stuck send but mailbox id unknown; cannot re-enqueue:", row.id);
						break;
					}
					const message: OutboundSendMessage = { v: 1, mailboxId: deps.mailboxId, emailId: row.id };
					await deps.queue.send(message, { contentType: "json" });
					console.warn(
						`Re-enqueued stuck send (attempt ${row.sendAttempts + 1}/${STUCK_SEND_MAX_REENQUEUES}):`,
						row.id,
					);
					result.reenqueued.push(row.id);
					break;
				}
				case "fail": {
					// Take the claim so no consumer starts sending while we settle.
					const claim = await deps.claim(row.id, OUTBOUND_SEND_CLAIM_LEASE_MS);
					if (claim === "in_flight") {
						due(now + OUTBOUND_SEND_CLAIM_LEASE_MS);
						break;
					}
					if (claim !== "claimed") break; // settled or gone meanwhile
					const accepted = await acceptedProviderMessageId(deps.bucket, row.id);
					try {
						await deps.setDeliveryState(
							row.id,
							accepted
								? { status: "accepted", providerMessageId: accepted, error: null }
								: { status: "failed", error: OUTBOUND_SEND_FAILED_ERROR },
						);
					} catch (error) {
						await deps.releaseClaim(row.id).catch(() => {});
						throw error;
					}
					console.error(
						`Stuck send gave up after ${row.sendAttempts} re-enqueues:`,
						row.id,
						accepted ? "(accepted)" : "",
					);
					try {
						await deps.bucket.delete(outboundPayloadKey(row.id));
					} catch (error) {
						console.warn("Stuck-send payload cleanup failed:", row.id, errorMessage(error));
					}
					result.failed.push(row.id);
					break;
				}
			}
		} catch (error) {
			console.error("Stuck-send sweep failed for row:", row.id, errorMessage(error));
			due(now + 60_000);
		}
	}
	return result;
}

/** Delay until the alarm should run for `nextDueAt` (with a little slack). */
export function stuckSendAlarmDelayMs(nextDueAt: number, now: number): number {
	return Math.max(1_000, nextDueAt - now + ALARM_SLACK_MS);
}

/** First alarm after a fresh enqueue. */
export const STUCK_SEND_FIRST_CHECK_MS = STUCK_SEND_THRESHOLD_MS + ALARM_SLACK_MS;
