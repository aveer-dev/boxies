// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Map Cloudflare Email Sending queue events onto mailbox delivery state.
 *
 * Event subscriptions publish lifecycle events such as bounced / complained.
 * See: https://developers.cloudflare.com/email-service/platform/event-subscriptions/
 */

import type { DeliveryStatus } from "../durableObject";
import {
	normalizeRecipientAddress,
	type RecipientDeliveryStatus,
	type RecipientDeliveryUpdate,
} from "./delivery-recipients";

export type EmailSendingEventType =
	| "cf.email.sending.message.delivered"
	| "cf.email.sending.message.deferred"
	| "cf.email.sending.message.bounced"
	| "cf.email.sending.message.failed"
	| "cf.email.sending.message.rejected"
	| "cf.email.sending.message.complained"
	| string;

export interface EmailSendingEventPayload {
	eventId?: string;
	messageId?: string;
	sender?: string;
	recipient?: string;
	subject?: string;
	terminal?: boolean;
	delivery?: {
		status?: string;
		smtpStatusCode?: string;
		smtpEnhancedStatusCode?: string;
		smtpResponse?: string;
	};
	bounce?: {
		type?: string;
		classification?: string;
		reason?: string;
	};
	complaint?: {
		type?: string;
		feedbackType?: string;
	};
}

export interface EmailSendingEvent {
	type: EmailSendingEventType;
	source?: {
		type?: string;
		zoneId?: string;
		domain?: string;
	};
	payload?: EmailSendingEventPayload;
	metadata?: Record<string, unknown>;
}

/** Terminal failure statuses written from Email Sending events. */
export type FailureDeliveryStatus = Extract<
	DeliveryStatus,
	"failed" | "bounced" | "complained"
>;

export interface MappedDeliveryEvent {
	status: FailureDeliveryStatus;
	error: string | null;
	providerMessageId: string;
	sender: string | null;
}

function firstNonEmpty(...values: Array<string | undefined | null>): string | null {
	for (const value of values) {
		const trimmed = value?.trim();
		if (trimmed) return trimmed;
	}
	return null;
}

/** Delivery status enums are not useful as user-facing error copy. */
function actionableDeliveryDetail(payload: EmailSendingEventPayload): string | null {
	return firstNonEmpty(
		payload.bounce?.reason,
		payload.delivery?.smtpResponse,
		payload.delivery?.smtpStatusCode,
	);
}

function complaintReason(payload: EmailSendingEventPayload): string | null {
	const feedback = firstNonEmpty(
		payload.complaint?.feedbackType,
		payload.complaint?.type,
	);
	if (!feedback) return null;
	if (/^(abuse|spam|fraud)$/i.test(feedback)) {
		return "Recipient marked this message as spam";
	}
	return `Recipient complaint: ${feedback}`;
}

/**
 * Cloudflare may wrap the event under a `data` property depending on how the
 * queue consumer receives the message body. Prefer a top-level `type` when
 * present so we do not unwrap a legitimate event that happens to include data.
 */
export function unwrapEmailSendingEvent(body: unknown): EmailSendingEvent {
	let value: unknown = body;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return { type: "" };
		}
	}
	if (!value || typeof value !== "object") return { type: "" };
	const record = value as Record<string, unknown>;
	if (typeof record.type === "string") {
		return value as EmailSendingEvent;
	}
	if (record.data && typeof record.data === "object") {
		return unwrapEmailSendingEvent(record.data);
	}
	return value as EmailSendingEvent;
}

/**
 * Convert a queue event body into a delivery-state update, or null if the
 * event should be ignored (unknown type / missing message id).
 */
export function mapEmailSendingEvent(
	event: EmailSendingEvent,
): MappedDeliveryEvent | null {
	const providerMessageId = event.payload?.messageId?.trim();
	if (!providerMessageId) return null;

	const sender = event.payload?.sender?.trim().toLowerCase() || null;
	const type = event.type || "";

	if (type.endsWith("message.bounced") || type === "message.bounced") {
		return {
			status: "bounced",
			error:
				actionableDeliveryDetail(event.payload ?? {}) ||
				"Message bounced",
			providerMessageId,
			sender,
		};
	}

	if (type.endsWith("message.complained") || type === "message.complained") {
		return {
			status: "complained",
			error:
				complaintReason(event.payload ?? {}) ||
				actionableDeliveryDetail(event.payload ?? {}) ||
				"Recipient marked this message as spam",
			providerMessageId,
			sender,
		};
	}

	if (
		type.endsWith("message.failed") ||
		type === "message.failed" ||
		type.endsWith("message.rejected") ||
		type === "message.rejected"
	) {
		return {
			status: "failed",
			error:
				actionableDeliveryDetail(event.payload ?? {}) ||
				"Message failed to send",
			providerMessageId,
			sender,
		};
	}

	// delivered / deferred: ignored for UI (failure-focused)
	return null;
}

/** One recipient's status from an event (AVE-41), for `delivery_recipients`. */
export interface MappedRecipientEvent extends RecipientDeliveryUpdate {
	status: RecipientDeliveryStatus;
	error: string | null;
	providerMessageId: string;
	sender: string | null;
}

/**
 * Per-recipient status for any lifecycle event that names its recipient,
 * delivered and deferred included. Null when the event has no message id,
 * no usable recipient, or an unknown type.
 */
export function mapRecipientDeliveryEvent(
	event: EmailSendingEvent,
): MappedRecipientEvent | null {
	const payload = event.payload ?? {};
	const providerMessageId = payload.messageId?.trim();
	const address = normalizeRecipientAddress(payload.recipient);
	if (!providerMessageId || !address) return null;
	const sender = payload.sender?.trim().toLowerCase() || null;

	const failure = mapEmailSendingEvent(event);
	if (failure) {
		return { address, status: failure.status, error: failure.error, providerMessageId, sender };
	}
	const type = event.type || "";
	if (type.endsWith("message.delivered")) {
		return { address, status: "delivered", error: null, providerMessageId, sender };
	}
	if (type.endsWith("message.deferred")) {
		return {
			address,
			status: "deferred",
			error: actionableDeliveryDetail(payload),
			providerMessageId,
			sender,
		};
	}
	return null;
}

/**
 * Delivered / deferred events only update `delivery_recipients`. When their
 * Sent row isn't there yet (or never will be, e.g. system mail from a
 * no-reply address) they get this many tries, then are dropped quietly
 * instead of filling the dead-letter queue. Failure events keep retrying
 * until the queue gives up and dead-letters them.
 */
export const RECIPIENT_ONLY_EVENT_MAX_ATTEMPTS = 3;

export type DeliveryStub = {
	findEmailByProviderMessageId: (
		providerMessageId: string,
	) => Promise<{ id: string } | null>;
	setDeliveryState: (
		id: string,
		state: {
			providerMessageId?: string | null;
			status: "failed" | "bounced" | "complained";
			error?: string | null;
		},
	) => Promise<unknown>;
	recordRecipientDelivery: (
		emailId: string,
		update: RecipientDeliveryUpdate,
	) => Promise<unknown>;
};

export type ResolveDeliveryStub = (sender: string) => DeliveryStub | Promise<DeliveryStub>;

/**
 * Apply one Email Sending event body. Returns whether the message should be
 * acked (true) or retried (false). `attempts` is the queue's
 * `message.attempts` (1 on first delivery).
 */
export async function applyEmailSendingEvent(
	body: unknown,
	resolveStub: ResolveDeliveryStub,
	attempts = 1,
): Promise<boolean> {
	const event = unwrapEmailSendingEvent(body);
	const mapped = mapEmailSendingEvent(event);
	const recipient = mapRecipientDeliveryEvent(event);
	if (!mapped && !recipient) {
		// Unknown type, or delivered / deferred without a recipient.
		return true;
	}

	const providerMessageId = (mapped ?? recipient)!.providerMessageId;
	const sender = mapped?.sender ?? recipient?.sender ?? null;
	if (!sender) {
		console.warn(
			"Email sending event missing sender; cannot route to mailbox",
			providerMessageId,
		);
		return true;
	}

	let stub: DeliveryStub;
	try {
		stub = await resolveStub(sender);
	} catch (error) {
		// Invalid / unknown sender cannot be fixed by retry — ack to avoid poison loops.
		console.warn(
			"Email sending event sender is not a valid mailbox; acking",
			sender,
			(error as Error).message,
		);
		return true;
	}

	try {
		const email = await stub.findEmailByProviderMessageId(providerMessageId);
		if (!email) {
			if (!mapped) {
				// Delivered / deferred: worth a short wait, not a dead letter.
				return attempts >= RECIPIENT_ONLY_EVENT_MAX_ATTEMPTS;
			}
			// Race: Sent row may not have provider_message_id yet — retry.
			console.warn(
				"No email found for provider message id; will retry",
				providerMessageId,
				sender,
			);
			return false;
		}

		if (mapped) {
			await stub.setDeliveryState(email.id, {
				status: mapped.status,
				error: mapped.error,
				providerMessageId: mapped.providerMessageId,
			});
		}
		if (recipient) {
			await stub.recordRecipientDelivery(email.id, {
				address: recipient.address,
				status: recipient.status,
				error: recipient.error,
			});
		}
		return true;
	} catch (error) {
		console.error(
			"Failed to apply email sending event:",
			(error as Error).message,
		);
		return false;
	}
}
