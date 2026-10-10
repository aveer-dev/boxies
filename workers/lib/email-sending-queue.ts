// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Consume Cloudflare Email Sending lifecycle events and map bounce /
 * complaint / failure onto the matching Sent message in a mailbox DO.
 */

import { getMailboxStub } from "./email-helpers";
import { aliasMetadataKey } from "./alias-utils";
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
	return applyEmailSendingEvent(body, async (sender) => {
		// Mail sent from a private alias is stored in the alias's target mailbox.
		const alias = await env.BUCKET.get(aliasMetadataKey(sender.toLowerCase()));
		let mailboxId = sender;
		if (alias) {
			try {
				const meta = (await alias.json()) as { targetMailboxId?: string };
				if (meta.targetMailboxId) mailboxId = meta.targetMailboxId;
			} catch {
				// Unreadable alias record: fall back to the sender address.
			}
		}
		return getMailboxStub(env, mailboxId) as unknown as DeliveryStub;
	});
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
