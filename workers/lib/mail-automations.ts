// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Mailbox forwarding and vacation auto-reply decisions.
 *
 * Classification already maps Auto-Submitted / Precedence / List-* onto
 * ham vs bulk vs spam. This module adds X-Loop, noreply, self-dest, and
 * settings parsing so receiveEmail can stay thin.
 */

export const AUTO_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface HeaderEntry {
	key?: string;
	name?: string;
	value?: string;
}

export interface EmailClassification {
	class: string;
	folderId?: string;
	reason?: string;
}

export interface ForwardingSettings {
	enabled?: boolean;
	email?: string;
}

export interface AutoReplySettings {
	enabled?: boolean;
	subject?: string;
	message?: string;
}

export interface MailboxAutomationSettings {
	fromName?: string;
	forwarding?: ForwardingSettings;
	autoReply?: AutoReplySettings;
}

export type SkipDecision = { ok: false; reason: string };
export type ForwardDecision = { ok: true; dest: string } | SkipDecision;
export type AutoReplyDecision = { ok: true } | SkipDecision;

export type HeaderSource =
	| HeaderEntry[]
	| string
	| null
	| undefined
	| { get(name: string): string | null; getAll?(name: string): string[] };

const NOREPLY_LOCAL =
	/^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce|notifications?)(\+|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

/** Lowercase address with plus-tags kept (the actual SMTP dest). */
export function normalizeEmailAddress(
	address: string | null | undefined,
): string | null {
	if (typeof address !== "string") return null;
	const trimmed = address.trim();
	if (!trimmed) return null;

	const angle = trimmed.match(/<([^>]+)>/);
	const extracted = (angle ? angle[1] : trimmed).trim().toLowerCase();
	const at = extracted.lastIndexOf("@");
	if (at <= 0 || at === extracted.length - 1) return null;

	const local = extracted.slice(0, at);
	const domain = extracted.slice(at + 1).replace(/\.+$/, "");
	if (!local || !domain || /\s/.test(local) || /\s/.test(domain)) {
		return null;
	}
	return `${local}@${domain}`;
}

/** Plus-tags collapse so hello+tag@x and hello@x are the same mailbox. */
function canonicalMailboxId(address: string | null | undefined): string | null {
	const normalized = normalizeEmailAddress(address);
	if (!normalized) return null;
	const at = normalized.lastIndexOf("@");
	const local = normalized.slice(0, at);
	const domain = normalized.slice(at + 1);
	const plus = local.indexOf("+");
	const baseLocal = plus === -1 ? local : local.slice(0, plus);
	if (!baseLocal) return null;
	return `${baseLocal}@${domain}`;
}

function parseHeaderList(
	headers?: HeaderEntry[] | string | null,
): Map<string, string[]> {
	let entries: HeaderEntry[] = [];
	if (!headers) return new Map();
	if (typeof headers === "string") {
		try {
			const parsed = JSON.parse(headers) as unknown;
			if (!Array.isArray(parsed)) return new Map();
			entries = parsed as HeaderEntry[];
		} catch {
			return new Map();
		}
	} else {
		entries = headers;
	}

	const map = new Map<string, string[]>();
	for (const header of entries) {
		const key = (header.key || header.name || "").trim().toLowerCase();
		if (!key) continue;
		const list = map.get(key) ?? [];
		list.push(header.value ?? "");
		map.set(key, list);
	}
	return map;
}

const NESTED_SETTING_KEYS = ["forwarding", "autoReply", "signature"] as const;

/**
 * PUT /mailboxes replaces the R2 JSON blob. iOS omits nil optionals and
 * Android encodes with encodeDefaults=false, so a forwarding save can drop
 * auto-reply (and vice versa). Keep nested setting objects the client omitted;
 * omitted agentSystemPrompt still clears, matching prompt reset.
 */
export function mergeMailboxSettingsBlob(
	existing: Record<string, unknown>,
	incoming: unknown,
): Record<string, unknown> {
	if (!isRecord(incoming)) return { ...existing };
	const next: Record<string, unknown> = { ...incoming };
	for (const key of NESTED_SETTING_KEYS) {
		if (!(key in incoming) && key in existing) {
			next[key] = existing[key];
		}
	}
	if (!("fromName" in incoming) && "fromName" in existing) {
		next.fromName = existing.fromName;
	}
	return next;
}

export function parseAutomationSettings(raw: unknown): MailboxAutomationSettings {
	if (!isRecord(raw)) return {};
	const forwardingRaw = isRecord(raw.forwarding) ? raw.forwarding : undefined;
	const autoReplyRaw = isRecord(raw.autoReply) ? raw.autoReply : undefined;
	return {
		fromName: asTrimmedString(raw.fromName) || undefined,
		forwarding: forwardingRaw
			? {
					enabled: asBoolean(forwardingRaw.enabled),
					email: asTrimmedString(forwardingRaw.email),
				}
			: undefined,
		autoReply: autoReplyRaw
			? {
					enabled: asBoolean(autoReplyRaw.enabled),
					subject: asTrimmedString(autoReplyRaw.subject),
					message: asTrimmedString(autoReplyRaw.message),
				}
			: undefined,
	};
}

export function automationSettingsError(
	settings: MailboxAutomationSettings,
	mailboxId: string,
): string | null {
	const forwarding = settings.forwarding;
	if (forwarding?.enabled) {
		const dest = normalizeEmailAddress(forwarding.email);
		if (!dest) return "Enter a valid forwarding address";
		if (canonicalMailboxId(dest) === canonicalMailboxId(mailboxId)) {
			return "Forwarding address cannot be this mailbox";
		}
	}
	if (settings.autoReply?.enabled && !settings.autoReply.message) {
		return "Enter an auto-reply message";
	}
	return null;
}

export function headerMapFromSource(source: HeaderSource): Map<string, string[]> {
	if (!source) return new Map();
	if (
		typeof source === "object" &&
		!Array.isArray(source) &&
		typeof (source as { get?: unknown }).get === "function"
	) {
		const headers = source as {
			get(name: string): string | null;
			getAll?(name: string): string[];
			forEach?(callback: (value: string, key: string) => void): void;
		};
		const map = new Map<string, string[]>();
		if (typeof headers.forEach === "function") {
			headers.forEach((value, key) => {
				const name = key.trim().toLowerCase();
				if (!name) return;
				const list = map.get(name) ?? [];
				list.push(value);
				map.set(name, list);
			});
			return map;
		}
		return map;
	}
	return parseHeaderList(source as HeaderEntry[] | string | null);
}

export function xLoopAddresses(map: Map<string, string[]>): string[] {
	const values = map.get("x-loop") ?? [];
	const out: string[] = [];
	for (const value of values) {
		for (const part of value.split(/[,;]/)) {
			const address = normalizeEmailAddress(part);
			if (address) out.push(address);
		}
	}
	return out;
}

export function xLoopContains(
	map: Map<string, string[]>,
	address: string | null | undefined,
): boolean {
	const needle = canonicalMailboxId(address) ?? normalizeEmailAddress(address);
	if (!needle) return false;
	return xLoopAddresses(map).some(
		(entry) => (canonicalMailboxId(entry) ?? entry) === needle,
	);
}

export function appendXLoop(
	existing: string | undefined,
	mailboxId: string,
): string {
	const parts = existing
		? existing.split(/[,;]/).map((part) => part.trim()).filter(Boolean)
		: [];
	const already = parts.some(
		(part) =>
			(canonicalMailboxId(part) ?? normalizeEmailAddress(part)) ===
			canonicalMailboxId(mailboxId),
	);
	if (!already) parts.push(mailboxId);
	return parts.join(", ");
}

export function isNoreplyAddress(address: string | null | undefined): boolean {
	const normalized = normalizeEmailAddress(address);
	if (!normalized) return true;
	const local = normalized.slice(0, normalized.lastIndexOf("@"));
	return NOREPLY_LOCAL.test(local);
}

export function shouldForward(options: {
	enabled: boolean;
	dest?: string | null;
	mailboxId: string;
	sender?: string | null;
	classification: EmailClassification;
	headers?: HeaderSource;
	canBeForwarded?: boolean;
}): ForwardDecision {
	if (!options.enabled) return { ok: false, reason: "disabled" };
	if (options.classification.class === "spam") {
		return { ok: false, reason: "spam" };
	}
	if (options.canBeForwarded === false) {
		return { ok: false, reason: "cannot-forward" };
	}

	const dest = normalizeEmailAddress(options.dest);
	if (!dest) return { ok: false, reason: "invalid-dest" };

	const mailbox = canonicalMailboxId(options.mailboxId);
	if (mailbox && canonicalMailboxId(dest) === mailbox) {
		return { ok: false, reason: "self-dest" };
	}

	const sender = canonicalMailboxId(options.sender) ?? normalizeEmailAddress(options.sender);
	if (sender && canonicalMailboxId(dest) === sender) {
		return { ok: false, reason: "dest-is-sender" };
	}

	const map = headerMapFromSource(options.headers);
	if (xLoopContains(map, options.mailboxId) || xLoopContains(map, dest)) {
		return { ok: false, reason: "x-loop" };
	}

	return { ok: true, dest };
}

export function shouldAutoReply(options: {
	enabled: boolean;
	message?: string | null;
	mailboxId: string;
	sender?: string | null;
	classification: EmailClassification;
	headers?: HeaderSource;
}): AutoReplyDecision {
	if (!options.enabled) return { ok: false, reason: "disabled" };
	if (!asTrimmedString(options.message)) {
		return { ok: false, reason: "empty-message" };
	}
	if (options.classification.class !== "ham") {
		return { ok: false, reason: "not-ham" };
	}

	const sender = normalizeEmailAddress(options.sender);
	if (!sender) return { ok: false, reason: "no-sender" };

	const mailbox = canonicalMailboxId(options.mailboxId);
	if (mailbox && canonicalMailboxId(sender) === mailbox) {
		return { ok: false, reason: "self" };
	}
	if (isNoreplyAddress(sender)) return { ok: false, reason: "noreply" };

	const map = headerMapFromSource(options.headers);
	if (xLoopContains(map, options.mailboxId)) {
		return { ok: false, reason: "x-loop" };
	}
	if (isAutoSubmitted(map)) {
		return { ok: false, reason: "auto-submitted" };
	}

	return { ok: true };
}

/** RFC 3834: Auto-Submitted other than "no" is an automated message. */
export function isAutoSubmitted(map: Map<string, string[]>): boolean {
	const values = map.get("auto-submitted") ?? [];
	return values.some((value) => {
		const normalized = value.trim().toLowerCase();
		return Boolean(normalized) && normalized !== "no";
	});
}

export function autoReplySubject(
	configured: string | undefined,
	original: string | undefined,
): string {
	if (configured?.trim()) return configured.trim();
	const originalSubject = (original ?? "").trim();
	if (!originalSubject) return "Auto-reply";
	return /^re:\s/i.test(originalSubject)
		? originalSubject
		: `Re: ${originalSubject}`;
}

export function buildAutoReplyHeaders(options: {
	mailboxId: string;
	originalMessageId?: string | null;
	existingXLoop?: string;
}): Record<string, string> {
	const headers: Record<string, string> = {
		"Auto-Submitted": "auto-replied",
		Precedence: "bulk",
		"X-Auto-Response-Suppress": "All",
		"X-Loop": appendXLoop(options.existingXLoop, options.mailboxId),
	};
	const originalId = options.originalMessageId?.replace(/^<|>$/g, "").trim();
	if (originalId) {
		headers["In-Reply-To"] = `<${originalId}>`;
		headers.References = `<${originalId}>`;
	}
	return headers;
}

/**
 * Email Service send() rejects empty header values. Drop blanks so a
 * missing In-Reply-To cannot fail the whole auto-reply.
 */
export function headersForEmailSend(
	headers: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string" && value.trim()) out[key] = value;
	}
	return out;
}
