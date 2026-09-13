// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbound mail classification: spam vs ham vs bulk, before Inbox/auto-draft.
 *
 * Order:
 *   1. Explicit spam headers (wins over list headers)
 *   2. Bulk via List-Unsubscribe / List-Id / List-Unsubscribe-Post
 *      (and Precedence: list|bulk), then Promotions vs Updates
 *   3. Remaining mail: Workers AI spam vs ham, fail-open to ham
 */

export type InboundClass = "spam" | "ham" | "bulk";

export type ClassifyFolderId = "inbox" | "promotions" | "updates" | "spam";

export interface EmailClassification {
	class: InboundClass;
	folderId: ClassifyFolderId;
	reason: string;
}

export interface HeaderEntry {
	key?: string;
	name?: string;
	value?: string;
}

export interface ClassifyEmailInput {
	headers?: HeaderEntry[] | string | null;
	subject?: string | null;
	sender?: string | null;
	bodyText?: string | null;
	bodyHtml?: string | null;
}

/** Minimal AI binding used by the spam/ham step (Workers AI `env.AI`). */
export type ClassifyAi = {
	run: (
		model: string,
		options: {
			messages: Array<{ role: string; content: string }>;
			max_tokens?: number;
			temperature?: number;
		},
	) => Promise<{ response?: string }>;
};

const SPAM_CLASSIFICATION: EmailClassification = {
	class: "spam",
	folderId: "spam",
	reason: "spam-headers",
};

const HAM_CLASSIFICATION: EmailClassification = {
	class: "ham",
	folderId: "inbox",
	reason: "personal-ham",
};

const TRANSACTIONAL_RE =
	/\b(receipt|invoice|invoices|order|orders|shipped|shipping|delivery|tracking|payment|payments|statement|statements|refund|password|2fa|mfa|otp|verify|verification|security alert|security code|login|sign-in|signin|reservation|itinerary|boarding|ticket)\b/i;

const SPAM_HAM_PROMPT = `You are an email spam classifier. Classify this message as SPAM or HAM.

HAM is personal mail: a human writing to another human, including business correspondence and transactional messages without mailing-list headers.
SPAM is unsolicited junk, phishing, malware, scams, or commercial blasts that should not reach the inbox.

Return ONLY one word: SPAM or HAM.`;

const AI_BODY_LIMIT = 2000;

export function parseHeaderList(
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

function headerValues(map: Map<string, string[]>, name: string): string[] {
	return map.get(name.toLowerCase()) ?? [];
}

function firstHeader(map: Map<string, string[]>, name: string): string {
	return headerValues(map, name)[0] ?? "";
}

function hasHeader(map: Map<string, string[]>, name: string): boolean {
	return headerValues(map, name).length > 0;
}

function isExplicitSpam(map: Map<string, string[]>): boolean {
	const flag = firstHeader(map, "x-spam-flag").trim().toLowerCase();
	if (flag === "yes") return true;

	const status = firstHeader(map, "x-spam-status").trim().toLowerCase();
	if (status.startsWith("yes")) return true;

	const precedence = firstHeader(map, "precedence").trim().toLowerCase();
	if (precedence === "junk") return true;

	return false;
}

function isBulk(map: Map<string, string[]>): boolean {
	if (
		hasHeader(map, "list-unsubscribe") ||
		hasHeader(map, "list-id") ||
		hasHeader(map, "list-unsubscribe-post")
	) {
		return true;
	}
	const precedence = firstHeader(map, "precedence").trim().toLowerCase();
	return precedence === "list" || precedence === "bulk";
}

function isTransactionalBulk(
	map: Map<string, string[]>,
	subject: string,
	sender: string,
): boolean {
	const autoSubmitted = firstHeader(map, "auto-submitted").trim().toLowerCase();
	if (autoSubmitted && autoSubmitted !== "no") return true;
	return TRANSACTIONAL_RE.test(`${subject} ${sender}`);
}

function bulkClassification(
	map: Map<string, string[]>,
	subject: string,
	sender: string,
): EmailClassification {
	if (isTransactionalBulk(map, subject, sender)) {
		return {
			class: "bulk",
			folderId: "updates",
			reason: "bulk-transactional",
		};
	}
	return {
		class: "bulk",
		folderId: "promotions",
		reason: "bulk-list-headers",
	};
}

/**
 * Header/heuristic classification. Returns a decision for spam and bulk,
 * or null when the remaining spam-vs-ham step (AI or fail-open ham) is needed.
 */
export function classifyFromHeaders(
	input: ClassifyEmailInput,
): EmailClassification | null {
	const map = parseHeaderList(input.headers);
	if (isExplicitSpam(map)) return SPAM_CLASSIFICATION;
	if (isBulk(map)) {
		return bulkClassification(map, input.subject ?? "", input.sender ?? "");
	}
	return null;
}

function plaintextBody(input: ClassifyEmailInput): string {
	const text = (input.bodyText ?? "").trim();
	if (text) return text;
	const html = input.bodyHtml ?? "";
	if (!html) return "";
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

async function classifySpamVsHam(
	ai: ClassifyAi,
	input: ClassifyEmailInput,
): Promise<EmailClassification> {
	const body = plaintextBody(input).slice(0, AI_BODY_LIMIT);
	const userContent = [
		`From: ${input.sender || "(unknown)"}`,
		`Subject: ${input.subject || "(no subject)"}`,
		"",
		body || "(empty body)",
	].join("\n");

	try {
		const response = await ai.run("@cf/meta/llama-3.1-8b-instruct-fast", {
			messages: [
				{ role: "system", content: SPAM_HAM_PROMPT },
				{ role: "user", content: userContent },
			],
			max_tokens: 10,
			temperature: 0,
		});

		const result = (response?.response || "HAM").trim().toUpperCase();
		if (result.includes("SPAM")) {
			return {
				class: "spam",
				folderId: "spam",
				reason: "ai-spam",
			};
		}
		return { ...HAM_CLASSIFICATION, reason: "ai-ham" };
	} catch (e) {
		console.error(
			"Spam/ham classifier failed, failing open to ham:",
			(e as Error).message,
		);
		return { ...HAM_CLASSIFICATION, reason: "ai-fail-open" };
	}
}

export async function classifyInboundEmail(
	input: ClassifyEmailInput,
	ai?: ClassifyAi | null,
): Promise<EmailClassification> {
	const decided = classifyFromHeaders(input);
	if (decided) return decided;
	if (!ai) return HAM_CLASSIFICATION;
	return classifySpamVsHam(ai, input);
}

/** Rejected envelopes and duplicate Message-IDs must never reach classification. */
export function shouldClassifyInbound(options: {
	routeAction: "deliver" | "reject";
	isDuplicate: boolean;
}): boolean {
	return options.routeAction === "deliver" && !options.isDuplicate;
}

/** Only personal ham is auto-drafted. */
export function shouldAutoDraft(classification: EmailClassification): boolean {
	return classification.class === "ham";
}

/** Skip push for spam; ham and bulk still notify. */
export function shouldSendPush(classification: EmailClassification): boolean {
	return classification.class !== "spam";
}
