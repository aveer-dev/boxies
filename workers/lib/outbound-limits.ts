// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound email size / binding-error helpers.
 *
 * Cloudflare Email Service caps total message size at 5 MiB for general
 * recipients. Reject oversized payloads before writing Sent / calling send.
 */

export {
	MAX_OUTBOUND_MESSAGE_BYTES,
	OUTBOUND_SIZE_ERROR,
	utf8ByteLength,
	base64DecodedByteLength,
	estimateOutboundMessageBytes,
	remainingOutboundBudget,
	type OutboundSizeInput,
} from "../../shared/outbound-limits.ts";

import {
	estimateOutboundMessageBytes,
	MAX_OUTBOUND_MESSAGE_BYTES,
	OUTBOUND_SIZE_ERROR,
	type OutboundSizeInput,
} from "../../shared/outbound-limits.ts";

export class OutboundSizeError extends Error {
	constructor(message = OUTBOUND_SIZE_ERROR) {
		super(message);
		this.name = "OutboundSizeError";
	}
}

export function assertOutboundMessageSize(input: OutboundSizeInput): void {
	if (estimateOutboundMessageBytes(input) > MAX_OUTBOUND_MESSAGE_BYTES) {
		throw new OutboundSizeError();
	}
}

/** Map Cloudflare Email binding / transport errors to user-facing copy. */
export function mapSendFailureMessage(error: unknown): string {
	const err = error as { message?: string; code?: string | number } | null;
	const message = (err?.message || String(error || "Unknown send failure")).trim();
	const code = err?.code != null ? String(err.code) : "";
	const haystack = `${code} ${message}`.toLowerCase();

	if (
		haystack.includes("content_too_large") ||
		haystack.includes("content-too-large") ||
		haystack.includes("too large") ||
		haystack.includes("5 mib") ||
		haystack.includes("5mb") ||
		haystack.includes("message size")
	) {
		return OUTBOUND_SIZE_ERROR;
	}

	if (
		haystack.includes("rate limit") ||
		haystack.includes("rate_limit") ||
		haystack.includes("too many")
	) {
		return "Rate limit exceeded while sending. Please try again later.";
	}

	return message || "Failed to send email.";
}
