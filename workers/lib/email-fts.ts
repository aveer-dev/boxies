// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * SQLite FTS5 helpers for mailbox full-text search.
 * Indexed plain text lives in `emails_fts` inside each MailboxDO.
 */

/** Cap indexed body length so huge messages cannot blow DO SQLite storage. */
export const FTS_BODY_MAX_LENGTH = 100_000;

export const FTS_BACKFILL_BATCH_SIZE = 25;
export const FTS_BACKFILL_MIGRATION = "js_backfill_emails_fts";

export interface FtsEmailFields {
	id: string;
	subject?: string | null;
	sender?: string | null;
	sender_name?: string | null;
	recipient?: string | null;
	cc?: string | null;
	bcc?: string | null;
	body_text?: string | null;
}

/**
 * Strip HTML tags / script / style to plain text.
 * Kept local so this module stays free of Durable Object imports (unit-testable).
 * Behavior matches `stripHtmlToText` in email-helpers.
 */
function stripHtmlToPlain(html: string): string {
	if (!html) return "";
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Concatenate recipient headers into a single searchable field. */
export function formatFtsRecipients(
	recipient?: string | null,
	cc?: string | null,
	bcc?: string | null,
): string {
	return [recipient, cc, bcc].filter((v) => !!v && v.trim()).join(" ");
}

/**
 * Build plain text for the FTS body column.
 * Prefer an already-extracted text/plain part when available; otherwise strip HTML.
 */
export function computeSearchText(
	htmlOrText: string,
	options?: { plainText?: string | null; maxLength?: number },
): string {
	const maxLength = options?.maxLength ?? FTS_BODY_MAX_LENGTH;
	const plain = options?.plainText?.trim()
		? options.plainText
		: stripHtmlToPlain(htmlOrText ?? "");
	const normalized = plain.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxLength) return normalized;
	return normalized.slice(0, maxLength);
}

/**
 * Turn a user free-text query into a safe FTS5 MATCH expression.
 * Uses prefix tokens (`"term"*`) so partial matches work like the iOS client.
 * Returns null when nothing searchable remains.
 */
export function sanitizeFtsQuery(input: string): string | null {
	const tokens = input
		.trim()
		.split(/\s+/)
		.map((token) => token.replace(/["*():^]/g, ""))
		.filter(
			(token) =>
				token.length > 0 && !/^(AND|OR|NOT|NEAR)$/i.test(token),
		);

	if (tokens.length === 0) return null;

	return tokens
		.map((token) => {
			const escaped = token.replace(/"/g, '""');
			return `"${escaped}"*`;
		})
		.join(" ");
}
