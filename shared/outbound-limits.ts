// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Cloudflare Email Service caps outbound MIME at 5 MiB for general recipients.
 * Shared by the Worker preflight and compose clients.
 */

export const MAX_OUTBOUND_MESSAGE_BYTES = 5 * 1024 * 1024;

export const OUTBOUND_SIZE_ERROR =
	"Message exceeds the 5 MiB outbound limit";

export interface OutboundSizeInput {
	html?: string;
	text?: string;
	attachments?: { content: string }[];
}

/** UTF-8 byte length of a string. */
export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

/**
 * Approximate decoded size of a base64 payload. Ignores whitespace and
 * accounts for padding so estimates stay at or under true byte length.
 */
export function base64DecodedByteLength(base64: string): number {
	const cleaned = base64.replace(/\s/g, "");
	if (!cleaned) return 0;
	const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

/**
 * Estimate total outbound MIME size from body + decoded attachment bytes.
 * Slightly under-counts MIME headers/boundaries, which is fine for a
 * preflight against a hard provider cap.
 */
export function estimateOutboundMessageBytes(input: OutboundSizeInput): number {
	let total = 0;
	if (input.html) total += utf8ByteLength(input.html);
	if (input.text) total += utf8ByteLength(input.text);
	for (const att of input.attachments ?? []) {
		total += base64DecodedByteLength(att.content);
	}
	return total;
}

/** Bytes remaining under the 5 MiB cap for another attachment. */
export function remainingOutboundBudget(input: OutboundSizeInput): number {
	return Math.max(0, MAX_OUTBOUND_MESSAGE_BYTES - estimateOutboundMessageBytes(input));
}
