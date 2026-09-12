// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Canonical mailbox IDs for inbound envelope routing and mailbox creation.
 *
 * Plus-tags are stripped so hello+invoices@domain maps to hello@domain.
 * Reply-To display must keep the original plus-address; do not use this
 * helper in reply-recipient selection.
 */

export function canonicalMailboxId(address: string): string | null {
	const trimmed = address.trim();
	if (!trimmed) return null;

	const angle = trimmed.match(/<([^>]+)>/);
	const extracted = (angle ? angle[1] : trimmed).trim().toLowerCase();
	const at = extracted.lastIndexOf("@");
	if (at <= 0 || at === extracted.length - 1) return null;

	const local = extracted.slice(0, at);
	const domain = extracted.slice(at + 1);
	const plus = local.indexOf("+");
	const baseLocal = plus === -1 ? local : local.slice(0, plus);
	if (!baseLocal || !domain || /\s/.test(baseLocal) || /\s/.test(domain)) {
		return null;
	}

	return `${baseLocal}@${domain}`;
}

export type InboundEnvelopeRoute =
	| { action: "deliver"; mailboxId: string }
	| { action: "reject"; reason: string };

/**
 * Map an SMTP envelope recipient onto a mailbox, or a permanent bounce reason.
 * Existence is supplied by the caller (R2 mailbox metadata).
 */
export function routeInboundEnvelope(
	envelopeTo: string,
	mailboxExists: boolean,
): InboundEnvelopeRoute {
	const mailboxId = canonicalMailboxId(envelopeTo);
	if (!mailboxId) return { action: "reject", reason: "Invalid recipient" };
	if (!mailboxExists) return { action: "reject", reason: "Mailbox does not exist" };
	return { action: "deliver", mailboxId };
}
