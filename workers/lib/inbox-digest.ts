// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type {
	InboxDigest,
	InboxDigestTodo,
	InboxDigestTopic,
	InboxDigestTopicItem,
} from "../../shared/inbox-digest";
import { localPart } from "../../shared/sender";
import { stripHtmlToText } from "./email-helpers";

/** Thread row shape returned by getThreadedEmails (inbox). */
export interface DigestEmailRow {
	id: string;
	subject: string;
	sender: string;
	sender_name?: string | null;
	date: string;
	read: boolean;
	snippet?: string | null;
	thread_id?: string | null;
	needs_reply?: boolean;
	has_attachment?: boolean;
	thread_unread_count?: number;
}

export interface BuildInboxDigestOptions {
	emails: DigestEmailRow[];
	dismissedIds: Set<string>;
	unreadCount: number;
	greetingName: string;
	attachmentCounts?: Map<string, number>;
	/** Minimum needs_reply hits before skipping keyword fallback. */
	minNeedsReplyTodos?: number;
}

const ACTION_KEYWORDS = [
	"action required",
	"please",
	"invoice",
	"verify",
	"urgent",
	"confirm",
	"complete",
	"respond",
	"reminder",
] as const;

type TopicBucket = {
	id: string;
	title: string;
	emoji: string;
	match: (email: DigestEmailRow, domain: string, subject: string) => boolean;
};

const TOPIC_BUCKETS: TopicBucket[] = [
	{
		id: "purchases",
		title: "Purchases",
		emoji: "🛍️",
		match: (_e, domain, subject) =>
			/(order|shipped|delivery|tracking|receipt|purchase|bought)/.test(subject) ||
			/(amazon|shopify|etsy|ebay|walmart|target|bestbuy)\./.test(domain),
	},
	{
		id: "finances",
		title: "Finances",
		emoji: "🏦",
		match: (_e, domain, subject) =>
			/(invoice|payment|statement|billing|refund|receipt|wire|transfer|payroll)/.test(subject) ||
			/(stripe|paypal|venmo|chase|bank|wise|brex|ramp|mercury)\./.test(domain),
	},
	{
		id: "travel",
		title: "Travel",
		emoji: "✈️",
		match: (_e, domain, subject) =>
			/(flight|boarding|itinerary|hotel|reservation|trip|airline|check-in)/.test(subject) ||
			/(united|delta|aa\.com|airbnb|booking|expedia|marriott|hilton)\./.test(domain),
	},
	{
		id: "security",
		title: "Security",
		emoji: "🔐",
		match: (_e, domain, subject) =>
			/(security|verify|verification|password|login|sign-in|2fa|mfa|suspicious|alert)/.test(
				subject,
			) || /(okta|auth0|1password|lastpass)\./.test(domain),
	},
	{
		id: "social",
		title: "Social",
		emoji: "💬",
		match: (_e, domain, subject) =>
			/(mentioned|commented|liked|followed|invitation|invite)/.test(subject) ||
			/(linkedin|facebook|twitter|x\.com|instagram|slack|discord)\./.test(domain),
	},
	{
		id: "updates",
		title: "Updates",
		emoji: "📰",
		match: (_e, domain, subject) =>
			/(newsletter|digest|update|news|announcement|changelog)/.test(subject) ||
			/(substack|beehiiv|mailchimp|newsletter)\./.test(domain),
	},
];

export function resolveGreetingName(input: {
	fromName?: string | null;
	mailboxName?: string | null;
	mailboxEmail: string;
}): string {
	const fromName = input.fromName?.trim();
	if (fromName) {
		return firstName(fromName);
	}
	const mailboxName = input.mailboxName?.trim();
	if (mailboxName && !mailboxName.includes("@")) {
		return firstName(mailboxName);
	}
	return firstName(localPart(input.mailboxEmail));
}

function firstName(value: string): string {
	const cleaned = value.trim();
	if (!cleaned) return "there";
	const token = cleaned.split(/\s+/)[0] ?? cleaned;
	return token.charAt(0).toUpperCase() + token.slice(1);
}

export function senderDomain(sender: string): string {
	const angle = sender.match(/<([^>]+)>/);
	const address = (angle?.[1] ?? sender).trim().toLowerCase();
	const at = address.lastIndexOf("@");
	if (at < 0) return address || "unknown";
	return address.slice(at + 1);
}

export function previewSummary(snippet?: string | null, maxLength = 140): string {
	const text = stripHtmlToText(snippet ?? "");
	if (!text) return "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength).trimEnd()}…`;
}

function subjectMatchesAction(subject: string): boolean {
	const lower = subject.toLowerCase();
	return ACTION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function attachmentCountFor(
	email: DigestEmailRow,
	counts?: Map<string, number>,
): number {
	const counted = counts?.get(email.id);
	if (typeof counted === "number") return counted;
	return email.has_attachment ? 1 : 0;
}

function toTopicItem(
	email: DigestEmailRow,
	counts?: Map<string, number>,
): InboxDigestTopicItem {
	const unread =
		!email.read || (email.thread_unread_count ?? 0) > 0;
	return {
		email_id: email.id,
		thread_id: email.thread_id ?? null,
		subject: email.subject?.trim() || "(no subject)",
		summary: previewSummary(email.snippet),
		date: email.date,
		unread,
		attachment_count: attachmentCountFor(email, counts),
	};
}

function buildTodos(
	emails: DigestEmailRow[],
	dismissedIds: Set<string>,
	minNeedsReplyTodos: number,
): InboxDigestTodo[] {
	const eligible = emails.filter((email) => !dismissedIds.has(email.id));
	const needsReply = eligible.filter((email) => email.needs_reply === true);

	let selected = needsReply;
	if (needsReply.length < minNeedsReplyTodos) {
		const keywordHits = eligible.filter(
			(email) =>
				!email.needs_reply &&
				!email.read &&
				subjectMatchesAction(email.subject ?? ""),
		);
		const seen = new Set(needsReply.map((e) => e.id));
		selected = [
			...needsReply,
			...keywordHits.filter((e) => !seen.has(e.id)),
		];
	}

	return selected
		.slice()
		.sort((a, b) => String(b.date).localeCompare(String(a.date)))
		.map((email) => ({
			id: email.id,
			email_id: email.id,
			thread_id: email.thread_id ?? null,
			title: email.subject?.trim() || "(no subject)",
			summary: previewSummary(email.snippet),
			date: email.date,
		}));
}

function classifyTopic(
	email: DigestEmailRow,
): { id: string; title: string; emoji: string } {
	const domain = senderDomain(email.sender);
	const subject = (email.subject ?? "").toLowerCase();
	for (const bucket of TOPIC_BUCKETS) {
		if (bucket.match(email, domain, subject)) {
			return { id: bucket.id, title: bucket.title, emoji: bucket.emoji };
		}
	}
	const label = domain || "Other";
	return {
		id: `domain:${domain || "other"}`,
		title: label.charAt(0).toUpperCase() + label.slice(1),
		emoji: "📩",
	};
}

function remainingSummary(items: InboxDigestTopicItem[]): string | null {
	if (items.length <= 1) return null;
	const rest = items.slice(1);
	const subjects = rest
		.map((item) => item.subject)
		.filter(Boolean)
		.slice(0, 2);
	if (subjects.length === 0) {
		return `Remaining updates (${rest.length})`;
	}
	const joined = subjects.join(", ");
	const extra = rest.length > subjects.length ? ` and ${rest.length - subjects.length} more` : "";
	return `Remaining updates are about ${joined}${extra}`;
}

function buildTopics(
	emails: DigestEmailRow[],
	counts?: Map<string, number>,
): InboxDigestTopic[] {
	const groups = new Map<
		string,
		{ meta: { id: string; title: string; emoji: string }; emails: DigestEmailRow[] }
	>();

	for (const email of emails) {
		const meta = classifyTopic(email);
		const existing = groups.get(meta.id);
		if (existing) {
			existing.emails.push(email);
		} else {
			groups.set(meta.id, { meta, emails: [email] });
		}
	}

	const topics: InboxDigestTopic[] = [];
	for (const { meta, emails: groupEmails } of groups.values()) {
		const sorted = groupEmails.slice().sort((a, b) => {
			const aUnread = !a.read || (a.thread_unread_count ?? 0) > 0 ? 1 : 0;
			const bUnread = !b.read || (b.thread_unread_count ?? 0) > 0 ? 1 : 0;
			if (aUnread !== bUnread) return bUnread - aUnread;
			return String(b.date).localeCompare(String(a.date));
		});
		const items = sorted.map((email) => toTopicItem(email, counts));
		const caughtUp = items.every((item) => !item.unread);
		topics.push({
			id: meta.id,
			title: meta.title,
			emoji: meta.emoji,
			caught_up: caughtUp,
			remaining_summary: remainingSummary(items),
			items,
		});
	}

	return topics.sort((a, b) => {
		if (a.caught_up !== b.caught_up) return a.caught_up ? 1 : -1;
		const aDate = a.items[0]?.date ?? "";
		const bDate = b.items[0]?.date ?? "";
		return String(bDate).localeCompare(String(aDate));
	});
}

export function buildInboxDigest(options: BuildInboxDigestOptions): InboxDigest {
	const {
		emails,
		dismissedIds,
		unreadCount,
		greetingName,
		attachmentCounts,
		minNeedsReplyTodos = 3,
	} = options;

	return {
		greeting_name: greetingName || "there",
		unread_count: unreadCount,
		todos: buildTodos(emails, dismissedIds, minNeedsReplyTodos),
		topics: buildTopics(emails, attachmentCounts),
	};
}
