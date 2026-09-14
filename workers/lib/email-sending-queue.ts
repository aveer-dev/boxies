// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Consume Cloudflare Email Sending lifecycle events and map bounce /
 * complaint / failure onto the matching Sent message in a mailbox DO.
 */

import { getMailboxStub } from "./email-helpers";
import {
	applyEmailSendingEvent,
	type DeliveryStub,
} from "./email-sending-events";
import type { Env } from "../types";

/**
 * Process one Email Sending queue message. Returns whether the message
 * should be acked (true) or retried (false).
 */
export async function handleEmailSendingQueueMessage(
	env: Env,
	body: unknown,
): Promise<boolean> {
	return applyEmailSendingEvent(
		body,
		(sender) => getMailboxStub(env, sender) as unknown as DeliveryStub,
	);
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
