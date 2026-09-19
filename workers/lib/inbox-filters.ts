// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * User-defined inbound filter rules (Gmail-style).
 *
 * Match on sender / mailing list / subject, then file to a folder,
 * skip auto-draft, and/or forward. First enabled matching rule wins.
 */

import {
	headerMapFromSource,
	normalizeEmailAddress,
	type HeaderSource,
} from "./mail-automations.ts";

export const MAX_INBOX_FILTERS = 50;

export interface InboxFilterRule {
	id: string;
	enabled: boolean;
	name?: string;
	/** Sender: exact address, `@domain`, or substring. */
	from?: string;
	/** List-Id contains; `"*"` = any list mail. */
	list?: string;
	/** Subject contains (case-insensitive). */
	subject?: string;
	folderId?: string;
	skipAutoDraft?: boolean;
	forwardTo?: string;
}

export interface InboxFilterMatchInput {
	sender?: string | null;
	subject?: string | null;
	headers?: HeaderSource;
}

export interface InboxFilterHit {
	ruleId: string;
	folderId?: string;
	skipAutoDraft: boolean;
	forwardTo?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown): boolean {
	return value === true;
}

function headerValues(
	map: Map<string, string[]>,
	name: string,
): string[] {
	return map.get(name.toLowerCase()) ?? [];
}

function isListMail(map: Map<string, string[]>): boolean {
	if (headerValues(map, "list-id").some((v) => v.trim())) return true;
	if (headerValues(map, "list-unsubscribe").some((v) => v.trim())) return true;
	return headerValues(map, "precedence").some((v) => {
		const n = v.trim().toLowerCase();
		return n === "list" || n === "bulk";
	});
}

/** Match sender against from condition. */
export function matchFromCondition(
	condition: string,
	sender: string | null | undefined,
): boolean {
	const needle = condition.trim().toLowerCase();
	if (!needle) return false;
	const senderNorm = normalizeEmailAddress(sender) ?? (sender ?? "").trim().toLowerCase();
	if (!senderNorm) return false;

	if (needle.startsWith("*@")) {
		const domain = needle.slice(2);
		return domain.length > 0 && senderNorm.endsWith(`@${domain}`);
	}
	if (needle.startsWith("@")) {
		const domain = needle.slice(1);
		return domain.length > 0 && senderNorm.endsWith(`@${domain}`);
	}
	if (needle.includes("@") && !needle.includes(" ")) {
		return senderNorm === needle || senderNorm.includes(needle);
	}
	return senderNorm.includes(needle);
}

export function matchListCondition(
	condition: string,
	headers: HeaderSource,
): boolean {
	const needle = condition.trim().toLowerCase();
	if (!needle) return false;
	const map = headerMapFromSource(headers);
	if (needle === "*") return isListMail(map);
	return headerValues(map, "list-id").some((v) =>
		v.toLowerCase().includes(needle),
	);
}

export function matchSubjectCondition(
	condition: string,
	subject: string | null | undefined,
): boolean {
	const needle = condition.trim().toLowerCase();
	if (!needle) return false;
	return (subject ?? "").toLowerCase().includes(needle);
}

function hasCondition(rule: InboxFilterRule): boolean {
	return Boolean(
		asTrimmedString(rule.from) ||
			asTrimmedString(rule.list) ||
			asTrimmedString(rule.subject),
	);
}

function hasAction(rule: InboxFilterRule): boolean {
	return Boolean(
		asTrimmedString(rule.folderId) ||
			rule.skipAutoDraft === true ||
			asTrimmedString(rule.forwardTo),
	);
}

export function parseInboxFilterRule(raw: unknown): InboxFilterRule | null {
	if (!isRecord(raw)) return null;
	const id = asTrimmedString(raw.id);
	if (!id) return null;

	const from = asTrimmedString(raw.from) || undefined;
	const list = asTrimmedString(raw.list) || undefined;
	const subject = asTrimmedString(raw.subject) || undefined;
	const folderId = asTrimmedString(raw.folderId) || undefined;
	const forwardTo = asTrimmedString(raw.forwardTo) || undefined;
	const name = asTrimmedString(raw.name) || undefined;
	const skipAutoDraft = asBoolean(raw.skipAutoDraft) || undefined;

	return {
		id,
		enabled: raw.enabled !== false,
		name,
		from,
		list,
		subject,
		folderId,
		skipAutoDraft: skipAutoDraft || undefined,
		forwardTo,
	};
}

/** Parse filters from a mailbox settings blob (or a raw filters array). */
export function parseInboxFilters(raw: unknown): InboxFilterRule[] {
	const list = Array.isArray(raw)
		? raw
		: isRecord(raw) && Array.isArray(raw.filters)
			? raw.filters
			: null;
	if (!list) return [];

	const rules: InboxFilterRule[] = [];
	for (const item of list) {
		const rule = parseInboxFilterRule(item);
		if (rule) rules.push(rule);
	}
	return rules;
}

export function inboxFiltersError(
	filters: InboxFilterRule[],
	mailboxId: string,
): string | null {
	if (filters.length > MAX_INBOX_FILTERS) {
		return `At most ${MAX_INBOX_FILTERS} filters allowed`;
	}

	const ids = new Set<string>();
	for (const rule of filters) {
		if (!rule.id.trim()) return "Each filter needs an id";
		if (ids.has(rule.id)) return "Filter ids must be unique";
		ids.add(rule.id);

		if (!hasCondition(rule)) {
			return "Each filter needs at least one condition (from, list, or subject)";
		}
		if (!hasAction(rule)) {
			return "Each filter needs at least one action (folder, skip auto-draft, or forward)";
		}

		if (rule.forwardTo) {
			const dest = normalizeEmailAddress(rule.forwardTo);
			if (!dest) return "Enter a valid filter forward address";
			const mailboxNorm = normalizeEmailAddress(mailboxId);
			if (mailboxNorm && dest === mailboxNorm) {
				return "Filter forward address cannot be this mailbox";
			}
		}
	}
	return null;
}

export function matchInboxFilter(
	rule: InboxFilterRule,
	input: InboxFilterMatchInput,
): boolean {
	if (!rule.enabled) return false;
	if (!hasCondition(rule)) return false;

	if (rule.from) {
		if (!matchFromCondition(rule.from, input.sender)) return false;
	}
	if (rule.list) {
		if (!matchListCondition(rule.list, input.headers)) return false;
	}
	if (rule.subject) {
		if (!matchSubjectCondition(rule.subject, input.subject)) return false;
	}
	return true;
}

/** First enabled matching rule wins. */
export function applyInboxFilters(
	rules: InboxFilterRule[],
	input: InboxFilterMatchInput,
): InboxFilterHit | null {
	for (const rule of rules) {
		if (!matchInboxFilter(rule, input)) continue;
		const forwardTo = normalizeEmailAddress(rule.forwardTo) ?? undefined;
		return {
			ruleId: rule.id,
			folderId: asTrimmedString(rule.folderId) || undefined,
			skipAutoDraft: rule.skipAutoDraft === true,
			forwardTo,
		};
	}
	return null;
}
