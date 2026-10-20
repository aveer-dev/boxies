// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-message send claim held in the mailbox Durable Object while the
 * outbound-send queue consumer calls the Email binding. Queues deliver at
 * least once, so two consumers can hold the same message; the DO is single
 * threaded, which makes "check status + take the claim" atomic there.
 *
 * Kept free of runtime imports so the DO and unit tests can both load it.
 */

/** Outcome of asking the mailbox DO for the right to send one Sent row. */
export type OutboundSendClaim =
	/** The row is queued and this consumer now owns the send. */
	| "claimed"
	/** No such row (deleted, purged, or never written). */
	| "missing"
	/** The row already left `queued` (accepted / failed / bounced ...). */
	| "not_queued"
	/** Another consumer holds an unexpired claim on this row. */
	| "in_flight";

/** Durable Object storage key holding a claim's expiry (epoch ms). */
export function outboundSendClaimKey(emailId: string): string {
	return `outbound_send_claim:${emailId}`;
}

/**
 * Decide a claim from the row's delivery status and any existing claim.
 * An expired claim (crashed consumer) no longer blocks a retry.
 */
export function decideOutboundSendClaim(
	deliveryStatus: string | null | undefined,
	existingClaimExpiresAt: number | null | undefined,
	now: number,
): OutboundSendClaim {
	if (deliveryStatus === undefined) return "missing";
	if (deliveryStatus !== "queued") return "not_queued";
	if (typeof existingClaimExpiresAt === "number" && existingClaimExpiresAt > now) {
		return "in_flight";
	}
	return "claimed";
}
