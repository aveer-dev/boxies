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

function bounceOrDeliveryReason(payload: EmailSendingEventPayload): string | null {
	return firstNonEmpty(
		payload.bounce?.reason,
		payload.delivery?.smtpResponse,
		payload.delivery?.status,
	);
}

/**
 * Cloudflare may wrap the event under a `data` property depending on how the
 * queue consumer receives the message body. Prefer a top-level `type` when
 * present so we do not unwrap a legitimate event that happens to include data.
 */
export function unwrapEmailSendingEvent(body: unknown): EmailSendingEvent {
	if (!body || typeof body !== "object") return { type: "" };
	const record = body as Record<string, unknown>;
	if (typeof record.type === "string") {
		return body as EmailSendingEvent;
	}
	if (record.data && typeof record.data === "object") {
		return unwrapEmailSendingEvent(record.data);
	}
	return body as EmailSendingEvent;
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
				bounceOrDeliveryReason(event.payload ?? {}) ||
				"Message bounced",
			providerMessageId,
			sender,
		};
	}

	if (type.endsWith("message.complained") || type === "message.complained") {
		return {
			status: "complained",
			error:
				firstNonEmpty(
					event.payload?.delivery?.smtpResponse,
					event.payload?.delivery?.status,
				) || "Recipient marked this message as spam",
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
				bounceOrDeliveryReason(event.payload ?? {}) ||
				"Message failed to send",
			providerMessageId,
			sender,
		};
	}

	// delivered / deferred: ignored for UI (failure-focused)
	return null;
}

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
};

export type ResolveDeliveryStub = (sender: string) => DeliveryStub;

/**
 * Apply one Email Sending event body. Returns whether the message should be
 * acked (true) or retried (false).
 */
export async function applyEmailSendingEvent(
	body: unknown,
	resolveStub: ResolveDeliveryStub,
): Promise<boolean> {
	const event = unwrapEmailSendingEvent(body);
	const mapped = mapEmailSendingEvent(event);
	if (!mapped) {
		// Delivered / deferred / unknown — nothing to persist.
		return true;
	}

	const sender = mapped.sender;
	if (!sender) {
		console.warn(
			"Email sending event missing sender; cannot route to mailbox",
			mapped.providerMessageId,
		);
		return true;
	}

	let stub: DeliveryStub;
	try {
		stub = resolveStub(sender);
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
		const email = await stub.findEmailByProviderMessageId(
			mapped.providerMessageId,
		);
		if (!email) {
			// Race: Sent row may not have provider_message_id yet — retry.
			console.warn(
				"No email found for provider message id; will retry",
				mapped.providerMessageId,
				sender,
			);
			return false;
		}

		await stub.setDeliveryState(email.id, {
			status: mapped.status,
			error: mapped.error,
			providerMessageId: mapped.providerMessageId,
		});
		return true;
	} catch (error) {
		console.error(
			"Failed to apply email sending event:",
			(error as Error).message,
		);
		return false;
	}
}
