// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Direct mail: a person writing to this mailbox, as opposed to newsletters,
 * notifications, receipts and other machine-sent mail. Only direct mail gets
 * the automatic AI draft (AVE-172). Deterministic header/address heuristics
 * only; no AI call.
 *
 * Mail is NOT direct when any signal below holds:
 *   - list/bulk headers: List-Unsubscribe, List-Id, List-Post,
 *     List-Unsubscribe-Post, Precedence: bulk|list|junk
 *   - automated headers: Auto-Submitted other than "no", X-Auto-Response-Suppress
 *   - campaign/ESP markers: Feedback-ID, X-Mailchimp-*, X-MC-*, X-Campaign*,
 *     X-SG-EID, X-Mailgun-Tag, X-Mailgun-Variables
 *   - a no-reply style From or Reply-To (noreply, donotreply, notifications@,
 *     alerts@, mailer-daemon, postmaster, bounce…)
 *   - none of the mailbox's addresses is in To/Cc (Bcc or list delivery),
 *     checked only when To/Cc and own addresses are both known
 *   - filed anywhere other than Inbox (Promotions, Updates, Screener, …)
 */

import { parseHeaderList, type HeaderEntry } from "./classify-email.ts";

export type NotDirectSignal =
	| "list-headers"
	| "automated-headers"
	| "campaign-headers"
	| "no-reply-sender"
	| "no-reply-reply-to"
	| "not-addressed"
	| "not-inbox";

export interface DirectMailInput {
	headers?: HeaderEntry[] | string | null;
	/** From address. */
	sender?: string | null;
	replyTo?: Array<string | null | undefined> | null;
	/** To + Cc addresses as written in the message. */
	recipients?: Array<string | null | undefined> | null;
	/** Addresses that mean "this mailbox" (envelope recipient, mailbox id, alias). */
	ownAddresses?: Array<string | null | undefined> | null;
	/** Folder the mail is filed into; omitted means not checked. */
	folderId?: string | null;
}

const LIST_HEADERS = ["list-unsubscribe", "list-unsubscribe-post", "list-id", "list-post"];
const CAMPAIGN_HEADERS = ["feedback-id", "x-sg-eid", "x-mailgun-tag", "x-mailgun-variables"];
const CAMPAIGN_HEADER_PREFIXES = ["x-mailchimp-", "x-mc-", "x-campaign"];

const NO_REPLY_ANYWHERE_RE = /no[-_.]?reply|do[-_.]?not[-_.]?reply/;
const NO_REPLY_LOCAL_RE =
	/^(notifications?|notify|alerts?|mailer[-_.]?daemon|postmaster|bounces?)([-_.+].*)?$/;

/** True for noreply@, do-not-reply@, notifications@, mailer-daemon@, bounce+x@, … */
export function isNoReplyAddress(address: string | null | undefined): boolean {
	const value = (address ?? "").trim().toLowerCase();
	const at = value.lastIndexOf("@");
	const local = at >= 0 ? value.slice(0, at) : value;
	if (!local) return false;
	return NO_REPLY_ANYWHERE_RE.test(local) || NO_REPLY_LOCAL_RE.test(local);
}

/** Lowercase, drop +tag and a private. subdomain so aliases compare equal. */
function normalizeAddress(address: string | null | undefined): string {
	const value = (address ?? "").trim().toLowerCase();
	const at = value.lastIndexOf("@");
	if (at <= 0) return value;
	const local = value.slice(0, at).replace(/\+.*$/, "");
	const domain = value.slice(at + 1).replace(/^private\./, "");
	return `${local}@${domain}`;
}

function cleanList(values: Array<string | null | undefined> | null | undefined): string[] {
	return (values ?? []).map(normalizeAddress).filter((v) => v.includes("@"));
}

/** Every reason the mail is not direct; empty means direct. */
export function directMailSignals(input: DirectMailInput): NotDirectSignal[] {
	const signals: NotDirectSignal[] = [];
	const map = parseHeaderList(input.headers);
	const first = (name: string) => (map.get(name)?.[0] ?? "").trim().toLowerCase();

	const precedence = first("precedence");
	if (
		LIST_HEADERS.some((name) => map.has(name)) ||
		precedence === "bulk" ||
		precedence === "list" ||
		precedence === "junk"
	) {
		signals.push("list-headers");
	}

	const autoSubmitted = first("auto-submitted");
	if ((autoSubmitted && autoSubmitted !== "no") || map.has("x-auto-response-suppress")) {
		signals.push("automated-headers");
	}

	const keys = [...map.keys()];
	if (
		CAMPAIGN_HEADERS.some((name) => map.has(name)) ||
		keys.some((key) => CAMPAIGN_HEADER_PREFIXES.some((prefix) => key.startsWith(prefix)))
	) {
		signals.push("campaign-headers");
	}

	if (isNoReplyAddress(input.sender)) signals.push("no-reply-sender");
	if ((input.replyTo ?? []).some((address) => isNoReplyAddress(address))) {
		signals.push("no-reply-reply-to");
	}

	const recipients = cleanList(input.recipients);
	const own = new Set(cleanList(input.ownAddresses));
	if (recipients.length > 0 && own.size > 0 && !recipients.some((r) => own.has(r))) {
		signals.push("not-addressed");
	}

	if (input.folderId != null && input.folderId !== "inbox") signals.push("not-inbox");

	return signals;
}

/** Person-to-person mail addressed to this mailbox and filed to Inbox. */
export function isDirectMail(input: DirectMailInput): boolean {
	return directMailSignals(input).length === 0;
}
