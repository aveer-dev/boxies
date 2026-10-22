// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbound delivery status notifications (RFC 3464 bounce reports).
 *
 * Detection is deliberately narrow: only a top-level
 * `multipart/report; report-type=delivery-status` (or the RFC 6533
 * `global-delivery-status`) message counts. A DSN is applied only when it
 * names a Sent message in this mailbox and reports a failed recipient; then
 * the Sent row's delivery status is updated, recipient-level permanent
 * failures are suppressed, and the report is kept (archived, read, in the
 * original's thread) instead of landing in the inbox. Anything else files
 * as normal mail.
 */

import type { AuthDb } from "../auth/authz";
import type { DeliveryStatus } from "../durableObject";
import { normalizeEmailAddress } from "./mail-automations";
import {
	isPermanentRecipientStatus,
	recordSuppression,
	suppressionDomainFor,
} from "./email-suppression";

export interface DsnRecipient {
	/** Bare address from `Final-Recipient` (falls back to `Original-Recipient`). */
	recipient: string;
	/** Lower-cased `Action` (failed, delayed, delivered, relayed, expanded). */
	action: string;
	/** Enhanced status code, e.g. `5.1.1`. */
	status: string | null;
	diagnostic: string | null;
}

export interface DeliveryStatusReport {
	recipients: DsnRecipient[];
	/** Message-IDs that may name the original message, most specific first. */
	originalMessageIds: string[];
}

/** Message-IDs tried when linking a DSN to its Sent message. */
const MAX_CANDIDATE_IDS = 8;

/** Top-level headers are read from this prefix before anything else is decoded. */
const HEADER_SCAN_CHARS = 64 * 1024;

/** Hard cap on how much of the message we scan, so a huge report stays cheap. */
const MAX_SCAN_CHARS = 512 * 1024;

type MimePart = { headers: Map<string, string>; body: string };

function splitHeaderBlock(text: string): { headerText: string; body: string } {
	const m = /\r?\n\r?\n/.exec(text);
	if (!m) return { headerText: text, body: "" };
	return { headerText: text.slice(0, m.index), body: text.slice(m.index + m[0].length) };
}

/** Unfold and parse a header block. Later duplicates don't overwrite earlier ones. */
function parseHeaders(headerText: string): Map<string, string> {
	const out = new Map<string, string>();
	const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
	for (const line of unfolded.split(/\r?\n/)) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		if (!key || out.has(key)) continue;
		out.set(key, line.slice(idx + 1).trim());
	}
	return out;
}

function contentTypeValue(header: string | undefined): string {
	return (header ?? "").split(";")[0]!.trim().toLowerCase();
}

function contentTypeParam(header: string | undefined, name: string): string | null {
	const re = new RegExp(`;\\s*${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i");
	const m = re.exec(header ?? "");
	return m ? (m[1] ?? m[2] ?? null) : null;
}

function decodeBody(part: MimePart): string {
	const cte = (part.headers.get("content-transfer-encoding") ?? "").toLowerCase();
	if (cte === "base64") {
		try {
			return atob(part.body.replace(/[^A-Za-z0-9+/=]/g, ""));
		} catch {
			return "";
		}
	}
	if (cte === "quoted-printable") {
		return part.body
			.replace(/=\r?\n/g, "")
			.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
	}
	return part.body;
}

function splitMultipart(body: string, boundary: string): MimePart[] {
	const delimiter = `--${boundary}`;
	const parts: MimePart[] = [];
	const chunks = body.split(delimiter);
	// chunks[0] is the preamble; a chunk starting with "--" is the epilogue.
	for (let i = 1; i < chunks.length; i++) {
		let chunk = chunks[i]!;
		if (chunk.startsWith("--")) break;
		chunk = chunk.replace(/^[ \t]*\r?\n/, "");
		const { headerText, body: partBody } = splitHeaderBlock(chunk);
		parts.push({ headers: parseHeaders(headerText), body: partBody.replace(/\r?\n$/, "") });
	}
	return parts;
}

function stripAngle(value: string): string | null {
	const m = /<([^>]+)>/.exec(value);
	const id = (m ? m[1]! : value.trim().split(/\s+/)[0] ?? "").trim();
	return id || null;
}

function addressFromTypedField(value: string | undefined): string | null {
	if (!value) return null;
	// "rfc822; user@example.com" (address-type is optional in practice).
	const semi = value.indexOf(";");
	const raw = semi >= 0 ? value.slice(semi + 1) : value;
	return normalizeEmailAddress(raw.trim());
}

function parseStatusFields(text: string): {
	perMessage: Map<string, string>;
	perRecipient: Map<string, string>[];
} {
	const groups = text
		.split(/\r?\n[ \t]*\r?\n/)
		.map((g) => g.trim())
		.filter(Boolean)
		.map(parseHeaders);
	return { perMessage: groups[0] ?? new Map(), perRecipient: groups.slice(1) };
}

function toText(raw: Uint8Array | string): string {
	if (typeof raw === "string") return raw.slice(0, MAX_SCAN_CHARS);
	const slice = raw.byteLength > MAX_SCAN_CHARS ? raw.subarray(0, MAX_SCAN_CHARS) : raw;
	return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

/**
 * Parse a raw message as an RFC 3464 delivery status report. Returns null
 * unless it is a top-level `multipart/report; report-type=delivery-status`
 * with a parseable status part naming at least one recipient.
 */
export function parseDeliveryStatusReport(raw: Uint8Array | string): DeliveryStatusReport | null {
	// Every inbound message passes through here: look at the top-level
	// headers first and only decode the rest for an actual report.
	const head = typeof raw === "string" ? raw.slice(0, HEADER_SCAN_CHARS) : toText(raw.subarray(0, HEADER_SCAN_CHARS));
	if (contentTypeValue(parseHeaders(splitHeaderBlock(head).headerText).get("content-type")) !== "multipart/report") {
		return null;
	}
	const text = toText(raw);
	const { headerText, body } = splitHeaderBlock(text);
	const headers = parseHeaders(headerText);
	const ctype = headers.get("content-type");
	if (contentTypeValue(ctype) !== "multipart/report") return null;
	const reportType = contentTypeParam(ctype, "report-type")?.toLowerCase();
	if (reportType !== "delivery-status" && reportType !== "global-delivery-status") return null;
	const boundary = contentTypeParam(ctype, "boundary");
	if (!boundary) return null;

	const parts = splitMultipart(body, boundary);
	const statusPart = parts.find((p) =>
		["message/delivery-status", "message/global-delivery-status"].includes(
			contentTypeValue(p.headers.get("content-type")),
		),
	);
	if (!statusPart) return null;

	const { perMessage, perRecipient } = parseStatusFields(decodeBody(statusPart));
	const recipients: DsnRecipient[] = [];
	for (const fields of perRecipient) {
		const recipient =
			addressFromTypedField(fields.get("final-recipient")) ??
			addressFromTypedField(fields.get("original-recipient"));
		const action = (fields.get("action") ?? "").trim().toLowerCase().split(/\s/)[0] ?? "";
		if (!recipient || !action) continue;
		const statusMatch = /\b[245]\.\d{1,3}\.\d{1,3}\b/.exec(fields.get("status") ?? "");
		recipients.push({
			recipient,
			action,
			status: statusMatch ? statusMatch[0] : null,
			diagnostic: fields.get("diagnostic-code")?.replace(/^[^;]*;\s*/, "").trim() || null,
		});
	}
	if (recipients.length === 0) return null;

	const ids: string[] = [];
	const push = (value: string | undefined) => {
		if (!value) return;
		for (const piece of value.match(/<[^>]+>/g) ?? [value]) {
			const id = stripAngle(piece);
			if (id && !ids.includes(id)) ids.push(id);
		}
	};
	// Non-standard but common: some MTAs name the original in the status part.
	push(perMessage.get("original-message-id"));
	push(perMessage.get("x-original-message-id"));
	// The returned headers (text/rfc822-headers) or whole message (message/rfc822).
	const returned = parts.find((p) =>
		["text/rfc822-headers", "message/rfc822", "message/global", "message/global-headers"].includes(
			contentTypeValue(p.headers.get("content-type")),
		),
	);
	if (returned) {
		const returnedHeaders = parseHeaders(splitHeaderBlock(decodeBody(returned)).headerText);
		push(returnedHeaders.get("message-id"));
	}
	push(headers.get("original-message-id"));
	push(headers.get("in-reply-to"));
	const refs = headers.get("references");
	if (refs) {
		// Newest reference first.
		for (const piece of (refs.match(/<[^>]+>/g) ?? []).reverse()) push(piece);
	}

	return { recipients, originalMessageIds: ids };
}

/** Delivery outcome one DSN recipient implies, or null when it isn't a failure. */
export function dsnRecipientOutcome(r: DsnRecipient): {
	status: Extract<DeliveryStatus, "bounced" | "failed">;
	suppress: boolean;
} | null {
	if (r.action !== "failed") return null;
	if (r.status?.startsWith("5.")) {
		return { status: "bounced", suppress: isPermanentRecipientStatus(r.status) };
	}
	return { status: "failed", suppress: false };
}

type SentRow = {
	id: string;
	folder_id?: string | null;
	thread_id?: string | null;
	sender?: string | null;
	recipient?: string | null;
	cc?: string | null;
	bcc?: string | null;
	delivery_status?: string | null;
};

export type DsnStub = {
	findEmailByMessageId(messageId: string): Promise<SentRow | null>;
	findEmailByProviderMessageId(providerMessageId: string): Promise<SentRow | null>;
	setDeliveryState(
		id: string,
		state: { status: DeliveryStatus; error?: string | null },
	): Promise<unknown>;
};

export type AppliedDsn = {
	originalId: string;
	threadId: string | null;
	status: "bounced" | "failed";
	suppressed: string[];
};

function addressList(...fields: Array<string | null | undefined>): Set<string> {
	const out = new Set<string>();
	for (const field of fields) {
		for (const part of (field ?? "").split(",")) {
			const addr = normalizeEmailAddress(part);
			if (addr) out.add(addr);
		}
	}
	return out;
}

/**
 * Link a parsed DSN to its Sent message and apply it. Returns null (file the
 * DSN normally) when no Sent message in this mailbox matches, or when the
 * report has no failed recipient that the original was actually sent to.
 *
 * Only recipients of the original are acted on, so a forged report can't
 * suppress an address the message never went to.
 */
export async function applyInboundDsn(options: {
	report: DeliveryStatusReport;
	stub: DsnStub;
	db: AuthDb | null;
	mailboxId: string;
	dsnMessageId: string | null;
}): Promise<AppliedDsn | null> {
	const { report, stub } = options;
	// Our Sent rows keep the id we generated (`message_id`) and the id Email
	// Sending returned (`provider_message_id`); the wire Message-ID can be
	// either, so try both, bare and bracketed.
	let original: SentRow | null = null;
	const isSent = (row: SentRow | null): row is SentRow => Boolean(row && row.folder_id === "sent");
	// Bounded: References can be long, and each id is a DO lookup.
	for (const id of report.originalMessageIds.slice(0, MAX_CANDIDATE_IDS)) {
		const byMessageId = await stub.findEmailByMessageId(id);
		if (isSent(byMessageId)) {
			original = byMessageId;
			break;
		}
		for (const providerId of [id, `<${id}>`]) {
			const byProvider = await stub.findEmailByProviderMessageId(providerId);
			if (isSent(byProvider)) {
				original = byProvider;
				break;
			}
		}
		if (original) break;
	}
	if (!original) return null;

	const sentTo = addressList(original.recipient, original.cc, original.bcc);
	const failures = report.recipients
		.map((r) => ({ r, outcome: dsnRecipientOutcome(r) }))
		.filter(
			(f): f is { r: DsnRecipient; outcome: NonNullable<ReturnType<typeof dsnRecipientOutcome>> } =>
				f.outcome !== null && sentTo.has(f.r.recipient),
		);
	if (failures.length === 0) return null;

	const bounced = failures.some((f) => f.outcome.status === "bounced");
	const status: "bounced" | "failed" = bounced ? "bounced" : "failed";
	const first = failures.find((f) => f.outcome.status === status)!.r;
	const error = [
		`Delivery to ${first.recipient} failed`,
		[first.status, first.diagnostic].filter(Boolean).join(" ") || null,
	]
		.filter(Boolean)
		.join(": ");

	// Never downgrade a bounce / complaint already recorded by Email Sending.
	const current = original.delivery_status;
	const keepCurrent =
		status === "failed" && (current === "bounced" || current === "complained");
	if (!keepCurrent && !(status === "bounced" && current === "complained")) {
		await stub.setDeliveryState(original.id, { status, error });
	}

	const suppressed: string[] = [];
	const domain = original.sender ? suppressionDomainFor(original.sender) : null;
	if (options.db && domain) {
		for (const { r, outcome } of failures) {
			if (!outcome.suppress) continue;
			const ok = await recordSuppression(options.db, {
				domain,
				recipient: r.recipient,
				reason: "hard_bounce",
				source: "inbound_dsn",
				sourceEventId: options.dsnMessageId,
				sourceMailboxId: options.mailboxId,
				sourceMessageId: original.id,
				detail: [r.status, r.diagnostic].filter(Boolean).join(" ") || null,
			});
			if (ok) suppressed.push(r.recipient);
		}
	}

	return { originalId: original.id, threadId: original.thread_id ?? null, status, suppressed };
}
