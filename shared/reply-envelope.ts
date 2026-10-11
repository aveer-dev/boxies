// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reply envelope (to / cc / from / subject) shared by the full composer and
 * the reading-room quick reply, so both send the same headers.
 */

import {
	type ReplyOriginal,
	replyAllAddresses,
	replyToAddresses,
} from "./reply-recipients";

export type ReplyMode = "reply" | "reply-all";

export interface ReplyEnvelopeOriginal extends ReplyOriginal {
	subject: string;
	alias_id?: string | null;
}

export interface ReplyEnvelopeMailbox {
	email: string;
	name?: string | null;
	fromName?: string | null;
}

export type ReplyFrom = string | { email: string; name: string };

export interface ReplyEnvelope {
	to: string | string[];
	cc?: string | string[];
	from: ReplyFrom;
	subject: string;
}

export function prefixSubject(subject: string, prefix: "Re" | "Fwd"): string {
	const expectedPrefix = `${prefix}: `;
	return subject.startsWith(expectedPrefix)
		? subject
		: `${expectedPrefix}${subject}`;
}

/** Mail that arrived on a private-email alias is answered from that alias. */
export function isAliasReply(
	mode: string,
	original?: Pick<ReplyEnvelopeOriginal, "alias_id" | "recipient"> | null,
): boolean {
	return Boolean(
		(mode === "reply" || mode === "reply-all") &&
			(original?.alias_id || original?.recipient?.includes("@private.")),
	);
}

export function replyFrom(
	mode: string,
	original: Pick<ReplyEnvelopeOriginal, "alias_id" | "recipient"> | null | undefined,
	mailbox: ReplyEnvelopeMailbox,
): ReplyFrom {
	const fromAddress =
		isAliasReply(mode, original) && original?.recipient
			? original.recipient
			: mailbox.email;
	const fromName = mailbox.fromName || mailbox.name;
	return fromName && fromName !== fromAddress
		? { email: fromAddress, name: fromName }
		: fromAddress;
}

function asListValue(addresses: string[]): string | string[] | undefined {
	if (addresses.length === 0) return undefined;
	return addresses.length === 1 ? addresses[0] : addresses;
}

export function buildReplyEnvelope(
	original: ReplyEnvelopeOriginal,
	mailbox: ReplyEnvelopeMailbox,
	mode: ReplyMode,
): ReplyEnvelope {
	const self = mailbox.email.toLowerCase();
	const recipients =
		mode === "reply-all"
			? replyAllAddresses(original, self)
			: { to: replyToAddresses(original, self), cc: [] };
	return {
		to: asListValue(recipients.to) ?? "",
		cc: asListValue(recipients.cc),
		from: replyFrom(mode, original, mailbox),
		subject: prefixSubject(original.subject || "", "Re"),
	};
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Plain textarea text → paragraphs of escaped HTML for an outgoing body. */
export function plainTextToHtml(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	return trimmed
		.split(/\n{2,}/)
		.map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
		.join("");
}
