// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Mailbox map for inbound envelope routing and every mailbox-id lookup.
 *
 * Cloudflare invokes email() once per envelope RCPT TO. Each call is an
 * O(1) R2 HEAD on `mailboxes/<canonical>.json` — never a mailbox list scan.
 * Plus-tags collapse onto the base mailbox so hello+invoices@domain and
 * hello@domain are the same Durable Object (serialized, so Message-ID
 * dedup is safe under concurrent fan-in).
 *
 * Reply-To display must keep the original plus-address; do not use this
 * helper in reply-recipient selection.
 */

export function mailboxMetadataKey(mailboxId: string): string {
	return `mailboxes/${mailboxId}.json`;
}

export function canonicalMailboxId(address: string): string | null {
	const trimmed = address.trim();
	if (!trimmed) return null;

	const angle = trimmed.match(/<([^>]+)>/);
	const extracted = (angle ? angle[1] : trimmed).trim().toLowerCase();
	const at = extracted.lastIndexOf("@");
	if (at <= 0 || at === extracted.length - 1) return null;

	const local = extracted.slice(0, at);
	const domain = extracted.slice(at + 1).replace(/\.+$/, "");
	const plus = local.indexOf("+");
	const baseLocal = plus === -1 ? local : local.slice(0, plus);
	if (!baseLocal || !domain || /\s/.test(baseLocal) || /\s/.test(domain)) {
		return null;
	}

	return `${baseLocal}@${domain}`;
}

/** Decode a URL/path mailbox id, then canonicalize. */
export function resolveMailboxParam(raw: string | undefined): string | null {
	if (!raw) return null;
	let decoded = raw;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		// Malformed % sequences — canonicalize the raw value.
	}
	return canonicalMailboxId(decoded);
}

export function allowedMailboxSet(addresses: readonly string[]): Set<string> {
	const set = new Set<string>();
	for (const address of addresses) {
		const id = canonicalMailboxId(address);
		if (id) set.add(id);
	}
	return set;
}

export type MailboxExists = (
	mailboxId: string,
) => boolean | Promise<boolean>;

export type InboundEnvelopeRoute =
	| { action: "deliver"; mailboxId: string }
	| { action: "reject"; reason: string };

/**
 * Map one SMTP envelope recipient onto a mailbox, or a permanent bounce.
 * `mailboxExists` must be an O(1) key check (R2 HEAD or Set), keyed by
 * the canonical mailbox id — never a linear scan of all mailboxes.
 */
export async function routeInboundEnvelope(
	envelopeTo: string,
	mailboxExists: MailboxExists,
): Promise<InboundEnvelopeRoute> {
	const mailboxId = canonicalMailboxId(envelopeTo);
	if (!mailboxId) return { action: "reject", reason: "Invalid recipient" };
	if (!(await mailboxExists(mailboxId))) {
		return { action: "reject", reason: "Mailbox does not exist" };
	}
	return { action: "deliver", mailboxId };
}

/**
 * Independent per-recipient routing. Production fan-out is N Worker
 * invocations; this is the same function applied to each envelope `to`.
 */
export async function routeInboundEnvelopes(
	envelopeRecipients: readonly string[],
	mailboxExists: MailboxExists,
): Promise<InboundEnvelopeRoute[]> {
	return Promise.all(
		envelopeRecipients.map((to) => routeInboundEnvelope(to, mailboxExists)),
	);
}

/**
 * Same Message-ID already stored in this mailbox (plus-address + base
 * address, or a Worker retry after a successful write).
 */
export function isDuplicateInbound(
	originalMessageId: string | null | undefined,
	alreadyStored: boolean,
): boolean {
	return Boolean(originalMessageId && alreadyStored);
}
