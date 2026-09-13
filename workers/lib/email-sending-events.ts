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

export interface MappedDeliveryEvent {
	status: DeliveryStatus;
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
