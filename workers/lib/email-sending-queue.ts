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
import { authDb } from "../auth/authz";
import { recordSuppression, suppressionDomainFor } from "./email-suppression";
import type { Env } from "../types";

/** Mail sent from a private alias is stored in the alias's target mailbox. */
async function mailboxIdForSender(env: Env, sender: string): Promise<string> {
	const alias = await env.BUCKET.get(aliasMetadataKey(sender.toLowerCase()));
	if (alias) {
		try {
			const meta = (await alias.json()) as { targetMailboxId?: string };
			if (meta.targetMailboxId) return meta.targetMailboxId;
		} catch {
			// Unreadable alias record: fall back to the sender address.
		}
	}
	return sender;
}

/**
 * Process one Email Sending queue message. Returns whether the message
 * should be acked (true) or retried (false).
 */
export async function handleEmailSendingQueueMessage(
	env: Env,
	body: unknown,
	attempts = 1,
): Promise<boolean> {
	return applyEmailSendingEvent(
		body,
		async (sender) =>
			getMailboxStub(env, await mailboxIdForSender(env, sender)) as unknown as DeliveryStub,
		async (suppression) => {
			const domain = suppressionDomainFor(suppression.sender);
			if (!domain) return;
			await recordSuppression(authDb(env.AUTH_DB), {
				domain,
				recipient: suppression.recipient,
				reason: suppression.reason,
				source: "email_sending_event",
				sourceEventId: suppression.eventId,
				sourceMailboxId: (await mailboxIdForSender(env, suppression.sender)).toLowerCase(),
				sourceMessageId: suppression.providerMessageId,
				detail: suppression.detail,
			});
		},
		attempts,
	);
}

export async function handleEmailSendingQueueBatch(
	batch: MessageBatch<unknown>,
	env: Env,
): Promise<void> {
	for (const message of batch.messages) {
		try {
			const ok = await handleEmailSendingQueueMessage(
				env,
				message.body,
				message.attempts,
			);
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
