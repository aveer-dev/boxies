// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Deferred outbound delivery: update Sent-row delivery state after
 * the Cloudflare Email binding accepts or rejects the message.
 */

import { sendEmail, type SendEmailParams } from "../email-sender";
import type { DeliveryStatus } from "../durableObject";
import { getMailboxStub } from "./email-helpers";
import { mapSendFailureMessage } from "./outbound-limits";
import type { Env } from "../types";

type DeliveryStub = {
	setDeliveryState: (
		id: string,
		state: {
			providerMessageId?: string | null;
			status: DeliveryStatus;
			error?: string | null;
		},
	) => Promise<unknown>;
};

/**
 * Send via the Email binding, then persist accepted / failed on the Sent row.
 * Intended for waitUntil / background work after a 202 response.
 */
export async function deliverOutboundInBackground(
	env: Env,
	mailboxId: string,
	emailId: string,
	params: SendEmailParams,
): Promise<void> {
	const stub = getMailboxStub(env, mailboxId) as unknown as DeliveryStub;
	try {
		const result = await sendEmail(env.EMAIL, params);
		await stub.setDeliveryState(emailId, {
			status: "accepted",
			providerMessageId: result.messageId,
			error: null,
		});
	} catch (error) {
		const message = mapSendFailureMessage(error);
		console.error("Deferred email delivery failed:", message);
		try {
			await stub.setDeliveryState(emailId, {
				status: "failed",
				error: message,
			});
		} catch (updateError) {
			console.error(
				"Failed to persist delivery failure:",
				(updateError as Error).message,
			);
		}
	}
}
