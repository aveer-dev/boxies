// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound delivery through the `outbound-send` Cloudflare Queue.
 *
 * Producer (send / reply / forward routes): after the Sent row is written
 * with `delivery_status = "queued"`, the Email binding payload goes to R2 and
 * a small `{ mailboxId, emailId }` message goes on the queue. The payload can
 * be up to 5 MiB with attachments; queue messages are capped at 128 KB.
 *
 * Consumer (`queue()` in workers/app.ts): claims the row in the mailbox DO,
 * sends via the Email binding, records accepted / failed on the row, and
 * retries transient binding errors with backoff. Messages that exhaust
 * `max_retries` land on `outbound-send-dlq`, whose consumer marks the row
 * failed so the user sees it.
 *
 * Anything that can rebuild `{ mailboxId, emailId }` can re-enqueue a row:
 * the consumer skips rows no longer queued. The stuck-send sweeper
 * (outbound-send-sweeper.ts, run from the mailbox DO alarm) does exactly that
 * for rows left `queued` too long.
 */

import { sendEmail, type SendEmailParams } from "../email-sender";
import type { DeliveryStatus } from "../durableObject";
import { getMailboxStub } from "./email-helpers";
import { mapSendFailureMessage } from "./outbound-limits";
import type { OutboundSendClaim } from "./outbound-send-claim";
import type { Env } from "../types";

export const OUTBOUND_SEND_QUEUE = "outbound-send";
export const OUTBOUND_SEND_DLQ = "outbound-send-dlq";
/** Keep in sync with the `outbound-send` consumer's `max_retries` in wrangler.jsonc. */
export const OUTBOUND_SEND_MAX_RETRIES = 5;
/** How long one consumer may hold a row before a duplicate delivery may send. */
export const OUTBOUND_SEND_CLAIM_LEASE_MS = 5 * 60 * 1000;
/** Retry backoff: 15s, 30s, 60s, 120s, 240s (about 8 minutes in total). */
const RETRY_BASE_SECONDS = 15;
const RETRY_MAX_SECONDS = 300;
/** Shown on the Sent row when we cannot say anything more specific. */
export const OUTBOUND_SEND_FAILED_ERROR = "Failed to send email. Please try again.";

/** Queue message body. Versioned so the shape can change without poison loops. */
export interface OutboundSendMessage {
	v: 1;
	mailboxId: string;
	emailId: string;
}

/** R2 object holding what the consumer passes to the Email binding. */
export interface OutboundSendPayload {
	v: 1;
	params: SendEmailParams;
	/**
	 * Set when the binding accepted the message but recording that on the row
	 * failed. A retry then records it instead of sending a second copy.
	 */
	acceptedProviderMessageId?: string;
}

export function outboundPayloadKey(emailId: string): string {
	return `outbound/${emailId}.json`;
}

export function parseOutboundSendMessage(body: unknown): OutboundSendMessage | null {
	if (!body || typeof body !== "object") return null;
	const record = body as Record<string, unknown>;
	if (record.v !== 1) return null;
	const { mailboxId, emailId } = record;
	if (typeof mailboxId !== "string" || !mailboxId.trim()) return null;
	if (typeof emailId !== "string" || !emailId.trim()) return null;
	return { v: 1, mailboxId, emailId };
}

/**
 * Email binding errors worth retrying: rate limits, service outages, and
 * errors without a binding code (network / runtime). Everything else needs
 * the message or the account fixed, so retrying would only delay the error.
 */
export function isRetryableSendError(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	if (code == null || code === "") return true;
	return code === "E_RATE_LIMIT_EXCEEDED" || code === "E_INTERNAL_SERVER_ERROR";
}

/** `message.attempts` starts at 1 on first delivery. */
export function retryDelaySeconds(attempts: number): number {
	const n = Math.max(1, Math.floor(attempts));
	return Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** (n - 1));
}

type DeliveryState = {
	providerMessageId?: string | null;
	status: DeliveryStatus;
	error?: string | null;
};

export type OutboundSendStub = {
	claimOutboundSend: (id: string, leaseMs: number) => Promise<OutboundSendClaim>;
	releaseOutboundSendClaim: (id: string) => Promise<void>;
	setDeliveryState: (id: string, state: DeliveryState) => Promise<unknown>;
	/** Start the stuck-send sweeper's clock (MailboxDO.noteOutboundSendQueued). */
	noteOutboundSendQueued?: (id: string, mailboxId: string) => Promise<void>;
};

export type OutboundBucket = {
	get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
	put: (key: string, value: string, options?: R2PutOptions) => Promise<unknown>;
	delete: (key: string) => Promise<void>;
};

export type OutboundSendProducer = {
	send: (body: OutboundSendMessage, options?: QueueSendOptions) => Promise<unknown>;
};

export interface OutboundSendDeps {
	bucket: OutboundBucket;
	email: SendEmail;
	/** May throw for an invalid mailbox id. */
	stubFor: (mailboxId: string) => OutboundSendStub;
}

export type OutboundSendOutcome =
	| { action: "ack" }
	| { action: "retry"; delaySeconds: number };

const ACK: OutboundSendOutcome = { action: "ack" };

function errorMessage(error: unknown): string {
	return (error as Error | null)?.message ?? String(error);
}

async function deletePayload(bucket: OutboundBucket, emailId: string): Promise<void> {
	try {
		await bucket.delete(outboundPayloadKey(emailId));
	} catch (error) {
		console.warn("Outbound payload cleanup failed:", emailId, errorMessage(error));
	}
}

async function releaseClaim(stub: OutboundSendStub, emailId: string): Promise<void> {
	try {
		await stub.releaseOutboundSendClaim(emailId);
	} catch (error) {
		// The lease expires on its own.
		console.warn("Outbound send claim release failed:", emailId, errorMessage(error));
	}
}

async function readPayload(
	bucket: OutboundBucket,
	emailId: string,
): Promise<OutboundSendPayload | null> {
	const object = await bucket.get(outboundPayloadKey(emailId));
	if (!object) return null;
	try {
		const parsed = JSON.parse(await object.text()) as OutboundSendPayload;
		if (parsed?.v !== 1 || !parsed.params || typeof parsed.params !== "object") return null;
		return parsed;
	} catch {
		return null;
	}
}

// ── Producer ────────────────────────────────────────────────────────

/**
 * Hand a queued Sent row to the outbound-send queue. Call after the row is
 * written. Never throws: if staging or enqueueing fails the row is marked
 * failed, the same thing the user saw when an inline send failed.
 */
export async function enqueueOutboundSend(
	deps: {
		bucket: OutboundBucket;
		queue: OutboundSendProducer;
		stub: Pick<OutboundSendStub, "setDeliveryState" | "noteOutboundSendQueued">;
	},
	mailboxId: string,
	emailId: string,
	params: SendEmailParams,
): Promise<void> {
	const payload: OutboundSendPayload = { v: 1, params };
	try {
		await deps.bucket.put(outboundPayloadKey(emailId), JSON.stringify(payload), {
			httpMetadata: { contentType: "application/json" },
		});
		await deps.queue.send({ v: 1, mailboxId, emailId }, { contentType: "json" });
	} catch (error) {
		await recordEnqueueFailure(deps, emailId, error);
		return;
	}
	// Enqueued. Tell the mailbox so the stuck-send sweeper can re-enqueue the
	// row if the message is lost. Best effort: without it the sweeper still
	// finds the row (its clock just starts at the first sweep).
	// (Optional so test doubles may omit it; a real DO stub always has it.)
	if (deps.stub.noteOutboundSendQueued) {
		try {
			await deps.stub.noteOutboundSendQueued(emailId, mailboxId);
		} catch (error) {
			console.warn("Failed to note queued send for the sweeper:", emailId, errorMessage(error));
		}
	}
}

async function recordEnqueueFailure(
	deps: {
		bucket: OutboundBucket;
		stub: Pick<OutboundSendStub, "setDeliveryState">;
	},
	emailId: string,
	error: unknown,
): Promise<void> {
	console.error("Failed to enqueue outbound send:", emailId, errorMessage(error));
	try {
		await deps.stub.setDeliveryState(emailId, {
			status: "failed",
			error: OUTBOUND_SEND_FAILED_ERROR,
		});
	} catch (updateError) {
		console.error("Failed to persist enqueue failure:", emailId, errorMessage(updateError));
	}
	await deletePayload(deps.bucket, emailId);
}

/** Route helper: producer wired to the Worker env. */
export function enqueueOutboundSendFromEnv(
	env: Env,
	mailboxId: string,
	emailId: string,
	params: SendEmailParams,
): Promise<void> {
	return enqueueOutboundSend(
		{
			bucket: env.BUCKET,
			queue: env.OUTBOUND_SEND,
			stub: getMailboxStub(env, mailboxId) as unknown as OutboundSendStub,
		},
		mailboxId,
		emailId,
		params,
	);
}

// ── Consumer ────────────────────────────────────────────────────────

/**
 * Process one `outbound-send` message. `attempts` is `message.attempts`.
 * Idempotent: rows that are gone or no longer queued are acked untouched.
 */
export async function processOutboundSend(
	deps: OutboundSendDeps,
	body: unknown,
	attempts: number,
): Promise<OutboundSendOutcome> {
	const message = parseOutboundSendMessage(body);
	if (!message) {
		console.warn("Dropping malformed outbound-send message");
		return ACK;
	}
	const { mailboxId, emailId } = message;
	const retry: OutboundSendOutcome = {
		action: "retry",
		delaySeconds: retryDelaySeconds(attempts),
	};

	let stub: OutboundSendStub;
	try {
		stub = deps.stubFor(mailboxId);
	} catch (error) {
		console.warn("Outbound send for invalid mailbox; dropping", mailboxId, errorMessage(error));
		await deletePayload(deps.bucket, emailId);
		return ACK;
	}

	const claim = await stub.claimOutboundSend(emailId, OUTBOUND_SEND_CLAIM_LEASE_MS);
	if (claim === "in_flight") return retry;
	if (claim !== "claimed") {
		// Gone or already settled (duplicate delivery, sweeper re-enqueue).
		await deletePayload(deps.bucket, emailId);
		return ACK;
	}

	let payload: OutboundSendPayload | null;
	try {
		payload = await readPayload(deps.bucket, emailId);
	} catch (error) {
		console.error("Outbound payload read failed:", emailId, errorMessage(error));
		await releaseClaim(stub, emailId);
		return retry;
	}
	if (!payload) {
		console.error("Outbound payload missing or unreadable:", emailId);
		await stub.setDeliveryState(emailId, { status: "failed", error: OUTBOUND_SEND_FAILED_ERROR });
		return ACK;
	}

	if (payload.acceptedProviderMessageId) {
		await stub.setDeliveryState(emailId, {
			status: "accepted",
			providerMessageId: payload.acceptedProviderMessageId,
			error: null,
		});
		await deletePayload(deps.bucket, emailId);
		return ACK;
	}

	let providerMessageId: string;
	try {
		providerMessageId = (await sendEmail(deps.email, payload.params)).messageId;
	} catch (error) {
		const userMessage = mapSendFailureMessage(error);
		if (isRetryableSendError(error) && attempts <= OUTBOUND_SEND_MAX_RETRIES) {
			console.warn(
				`Outbound send attempt ${attempts} failed; retrying:`,
				emailId,
				userMessage,
			);
			await releaseClaim(stub, emailId);
			return retry;
		}
		console.error("Outbound send failed:", emailId, userMessage);
		await stub.setDeliveryState(emailId, { status: "failed", error: userMessage });
		await deletePayload(deps.bucket, emailId);
		return ACK;
	}

	try {
		await stub.setDeliveryState(emailId, {
			status: "accepted",
			providerMessageId,
			error: null,
		});
	} catch (error) {
		// Sent, but not recorded. Remember the provider id so the retry
		// records it instead of sending a second copy.
		console.error("Failed to record accepted send:", emailId, errorMessage(error));
		try {
			const marked: OutboundSendPayload = { ...payload, acceptedProviderMessageId: providerMessageId };
			await deps.bucket.put(outboundPayloadKey(emailId), JSON.stringify(marked), {
				httpMetadata: { contentType: "application/json" },
			});
		} catch (markError) {
			// Retrying now would send twice; leave the row queued and the
			// claim held until it expires.
			console.error("Failed to mark accepted send; not retrying:", emailId, errorMessage(markError));
			return ACK;
		}
		await releaseClaim(stub, emailId);
		return retry;
	}
	await deletePayload(deps.bucket, emailId);
	return ACK;
}

/**
 * Process one `outbound-send-dlq` message: the send queue gave up on it.
 * Mark the row failed (or accepted, if the binding took it but recording
 * did not) so the user is not left looking at "Sending".
 */
export async function processOutboundSendDeadLetter(
	deps: Pick<OutboundSendDeps, "bucket" | "stubFor">,
	body: unknown,
): Promise<OutboundSendOutcome> {
	const message = parseOutboundSendMessage(body);
	if (!message) {
		console.warn("Dropping malformed outbound-send-dlq message");
		return ACK;
	}
	const { mailboxId, emailId } = message;

	let stub: OutboundSendStub;
	try {
		stub = deps.stubFor(mailboxId);
	} catch {
		await deletePayload(deps.bucket, emailId);
		return ACK;
	}

	const claim = await stub.claimOutboundSend(emailId, OUTBOUND_SEND_CLAIM_LEASE_MS);
	if (claim === "in_flight") {
		// Wait out the other consumer's lease rather than burning DLQ retries.
		return { action: "retry", delaySeconds: Math.ceil(OUTBOUND_SEND_CLAIM_LEASE_MS / 1000) };
	}
	if (claim !== "claimed") {
		await deletePayload(deps.bucket, emailId);
		return ACK;
	}

	let accepted: string | undefined;
	try {
		accepted = (await readPayload(deps.bucket, emailId))?.acceptedProviderMessageId;
	} catch (error) {
		console.warn("Outbound payload read failed in DLQ:", emailId, errorMessage(error));
	}

	console.error("Outbound send exhausted retries:", emailId, accepted ? "(accepted)" : "");
	await stub.setDeliveryState(
		emailId,
		accepted
			? { status: "accepted", providerMessageId: accepted, error: null }
			: { status: "failed", error: OUTBOUND_SEND_FAILED_ERROR },
	);
	await deletePayload(deps.bucket, emailId);
	return ACK;
}

type Processor = (body: unknown, attempts: number) => Promise<OutboundSendOutcome>;

/** Apply per-message outcomes; an unexpected throw retries that message only. */
export async function runOutboundBatch(
	messages: readonly Pick<Message<unknown>, "body" | "attempts" | "ack" | "retry">[],
	handle: Processor,
	label: string,
): Promise<void> {
	await Promise.all(
		messages.map(async (message) => {
			try {
				const outcome = await handle(message.body, message.attempts);
				if (outcome.action === "ack") message.ack();
				else message.retry({ delaySeconds: outcome.delaySeconds });
			} catch (error) {
				console.error(`${label} message failed:`, errorMessage(error));
				message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
			}
		}),
	);
}

function depsFromEnv(env: Env): OutboundSendDeps {
	return {
		bucket: env.BUCKET,
		email: env.EMAIL,
		stubFor: (mailboxId) => getMailboxStub(env, mailboxId) as unknown as OutboundSendStub,
	};
}

export function handleOutboundSendBatch(batch: MessageBatch<unknown>, env: Env): Promise<void> {
	const deps = depsFromEnv(env);
	return runOutboundBatch(
		batch.messages,
		(body, attempts) => processOutboundSend(deps, body, attempts),
		"Outbound send",
	);
}

export function handleOutboundSendDeadLetterBatch(
	batch: MessageBatch<unknown>,
	env: Env,
): Promise<void> {
	const deps = depsFromEnv(env);
	return runOutboundBatch(
		batch.messages,
		(body) => processOutboundSendDeadLetter(deps, body),
		"Outbound send DLQ",
	);
}
