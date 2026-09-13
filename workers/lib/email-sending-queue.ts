// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Consume Cloudflare Email Sending lifecycle events and map bounce /
 * complaint / failure onto the matching Sent message in a mailbox DO.
 */

import { getMailboxStub } from "./email-helpers";
import {
	mapEmailSendingEvent,
	type EmailSendingEvent,
} from "./email-sending-events";
import type { Env } from "../types";

type DeliveryStub = {
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

/**
 * Process one Email Sending queue message. Returns whether the message
 * should be acked (true) or retried (false).
 */
export async function handleEmailSendingQueueMessage(
	env: Env,
	body: unknown,
): Promise<boolean> {
	const event = body as EmailSendingEvent;
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

	try {
		const stub = getMailboxStub(env, sender) as unknown as DeliveryStub;
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

export async function handleEmailSendingQueueBatch(
	batch: MessageBatch<unknown>,
	env: Env,
): Promise<void> {
	for (const message of batch.messages) {
		try {
			const ok = await handleEmailSendingQueueMessage(env, message.body);
			if (ok) message.ack();
			else message.retry();
		} catch (error) {
			console.error(
				"Email sending queue message failed:",
				(error as Error).message,
			);
			message.retry();
		}
	}
}
