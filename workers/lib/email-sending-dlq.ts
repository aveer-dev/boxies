// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Dead letters for the `email-sending-events` queue (AVE-41).
 *
 * Events the consumer failed `max_retries` times used to be dropped. They
 * now go to `email-sending-events-dlq`, whose consumer logs each one and
 * keeps its body in R2 under `dlq/email-sending-events/`. Operators list,
 * replay (re-run the normal event handler) or discard them from /ops
 * (workers/routes/ops.ts). No alerting: the console.error lines land in
 * Workers Logs.
 *
 * The usual cause is an event whose Sent row can't be found (deleted, or
 * system mail from an address with no mailbox), so a replay may fail again;
 * discard those.
 */

import { unwrapEmailSendingEvent } from "./email-sending-events";
import type { Env } from "../types";

export const EMAIL_SENDING_EVENTS_QUEUE = "email-sending-events";
export const EMAIL_SENDING_EVENTS_DLQ = "email-sending-events-dlq";
export const EMAIL_SENDING_DLQ_PREFIX = "dlq/email-sending-events/";

/** What we keep per dead letter. */
export interface StoredDeadLetter {
	v: 1;
	/** Queue message id; also the R2 key suffix. */
	id: string;
	/** Original queue message body, untouched, for replay. */
	body: unknown;
	/** When the original message was first enqueued (ISO). */
	enqueuedAt: string | null;
	/** When the DLQ consumer stored it (ISO). */
	deadLetteredAt: string;
	/** Replays that didn't clear it. */
	replayAttempts: number;
	lastReplayAt?: string;
}

/** List view: enough to tell dead letters apart without the whole body. */
export interface DeadLetterSummary {
	id: string;
	type: string | null;
	providerMessageId: string | null;
	sender: string | null;
	recipient: string | null;
	enqueuedAt: string | null;
	deadLetteredAt: string;
	replayAttempts: number;
}

export type DeadLetterBucket = {
	get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
	put: (key: string, value: string, options?: R2PutOptions) => Promise<unknown>;
	delete: (key: string) => Promise<void>;
	list: (options: R2ListOptions) => Promise<{
		objects: { key: string }[];
		truncated: boolean;
		cursor?: string;
	}>;
};

/** Apply one event body; true = handled (ack), false = still failing. */
export type ApplyEvent = (body: unknown) => Promise<boolean>;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function isDeadLetterId(id: string): boolean {
	return ID_PATTERN.test(id);
}

export function deadLetterKey(id: string): string {
	return `${EMAIL_SENDING_DLQ_PREFIX}${id}.json`;
}

function errorMessage(error: unknown): string {
	return (error as Error | null)?.message ?? String(error);
}

export function summarizeDeadLetter(entry: StoredDeadLetter): DeadLetterSummary {
	const event = unwrapEmailSendingEvent(entry.body);
	const payload = event.payload ?? {};
	return {
		id: entry.id,
		type: event.type || null,
		providerMessageId: payload.messageId?.trim() || null,
		sender: payload.sender?.trim().toLowerCase() || null,
		recipient: payload.recipient?.trim().toLowerCase() || null,
		enqueuedAt: entry.enqueuedAt,
		deadLetteredAt: entry.deadLetteredAt,
		replayAttempts: entry.replayAttempts,
	};
}

async function readDeadLetter(
	bucket: DeadLetterBucket,
	id: string,
): Promise<StoredDeadLetter | null> {
	if (!isDeadLetterId(id)) return null;
	const object = await bucket.get(deadLetterKey(id));
	if (!object) return null;
	try {
		const parsed = JSON.parse(await object.text()) as StoredDeadLetter;
		return parsed?.v === 1 ? parsed : null;
	} catch {
		return null;
	}
}

// ── DLQ consumer ────────────────────────────────────────────────────

/**
 * Store and log one dead letter. Idempotent per queue message id, so a
 * redelivery overwrites the same object.
 */
export async function storeDeadLetter(
	bucket: DeadLetterBucket,
	message: { id: string; body: unknown; timestamp?: Date },
	now: Date = new Date(),
): Promise<StoredDeadLetter> {
	const id = isDeadLetterId(message.id) ? message.id : crypto.randomUUID();
	const entry: StoredDeadLetter = {
		v: 1,
		id,
		body: message.body,
		enqueuedAt: message.timestamp ? message.timestamp.toISOString() : null,
		deadLetteredAt: now.toISOString(),
		replayAttempts: 0,
	};
	await bucket.put(deadLetterKey(id), JSON.stringify(entry), {
		httpMetadata: { contentType: "application/json" },
	});
	console.error(
		"Email sending event dead-lettered; kept for replay:",
		JSON.stringify(summarizeDeadLetter(entry)),
	);
	return entry;
}

/** A failed R2 write retries; the DLQ consumer's own max_retries bounds it. */
export async function handleEmailSendingDeadLetterBatch(
	batch: MessageBatch<unknown>,
	env: Env,
): Promise<void> {
	for (const message of batch.messages) {
		try {
			await storeDeadLetter(env.BUCKET, message);
			message.ack();
		} catch (error) {
			console.error(
				"Failed to store email sending dead letter:",
				message.id,
				errorMessage(error),
			);
			message.retry({ delaySeconds: 30 });
		}
	}
}

// ── Operator actions ────────────────────────────────────────────────

export async function listDeadLetters(
	bucket: DeadLetterBucket,
	{ limit = 100, cursor }: { limit?: number; cursor?: string } = {},
): Promise<{ deadLetters: DeadLetterSummary[]; cursor: string | null }> {
	const page = await bucket.list({
		prefix: EMAIL_SENDING_DLQ_PREFIX,
		limit: Math.min(500, Math.max(1, limit)),
		...(cursor ? { cursor } : {}),
	});
	const entries = await Promise.all(
		page.objects.map(async ({ key }) => {
			const id = key.slice(EMAIL_SENDING_DLQ_PREFIX.length).replace(/\.json$/, "");
			return readDeadLetter(bucket, id);
		}),
	);
	return {
		deadLetters: entries
			.filter((entry): entry is StoredDeadLetter => entry !== null)
			.map(summarizeDeadLetter),
		cursor: page.truncated ? page.cursor ?? null : null,
	};
}

export type ReplayOutcome = "applied" | "still_failing" | "not_found";

/**
 * Re-run the normal event handler on stored dead letters. Handled ones are
 * removed; ones that still fail stay, with the attempt counted.
 */
export async function replayDeadLetters(
	bucket: DeadLetterBucket,
	ids: readonly string[],
	apply: ApplyEvent,
	now: Date = new Date(),
): Promise<Array<{ id: string; outcome: ReplayOutcome; error?: string }>> {
	const results: Array<{ id: string; outcome: ReplayOutcome; error?: string }> = [];
	for (const id of ids) {
		const entry = await readDeadLetter(bucket, id);
		if (!entry) {
			results.push({ id, outcome: "not_found" });
			continue;
		}
		let handled = false;
		let error: string | undefined;
		try {
			handled = await apply(entry.body);
		} catch (e) {
			error = errorMessage(e);
		}
		if (handled) {
			await bucket.delete(deadLetterKey(id));
			results.push({ id, outcome: "applied" });
			continue;
		}
		const updated: StoredDeadLetter = {
			...entry,
			replayAttempts: entry.replayAttempts + 1,
			lastReplayAt: now.toISOString(),
		};
		await bucket.put(deadLetterKey(id), JSON.stringify(updated), {
			httpMetadata: { contentType: "application/json" },
		});
		results.push({ id, outcome: "still_failing", ...(error ? { error } : {}) });
	}
	return results;
}

/** Remove a dead letter for good. Returns whether it existed. */
export async function discardDeadLetter(
	bucket: DeadLetterBucket,
	id: string,
): Promise<boolean> {
	// Existence only, so an unreadable object can still be discarded.
	if (!isDeadLetterId(id) || !(await bucket.get(deadLetterKey(id)))) return false;
	await bucket.delete(deadLetterKey(id));
	return true;
}
