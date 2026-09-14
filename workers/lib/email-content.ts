// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email HTML bodies and raw MIME live in R2 so Durable Object SQLite rows
 * stay under the 2 MB limit and the mailbox DO stays under the storage cap.
 * SQLite keeps metadata + a short snippet only.
 */
import type { Env } from "../types";

export const SNIPPET_MAX_LENGTH = 300;

export function emailBodyKey(emailId: string): string {
	return `emails/${emailId}/body.html`;
}

export function emailRawKey(emailId: string): string {
	return `emails/${emailId}/raw.eml`;
}

export function emailContentKeys(emailId: string): string[] {
	return [emailBodyKey(emailId), emailRawKey(emailId)];
}

/** First N characters of the stored body — matches historical SUBSTR(body, 1, 300). */
export function computeSnippet(
	htmlOrText: string,
	maxLength = SNIPPET_MAX_LENGTH,
): string {
	if (!htmlOrText) return "";
	return htmlOrText.length <= maxLength
		? htmlOrText
		: htmlOrText.slice(0, maxLength);
}

export async function storeEmailContent(
	bucket: Env["BUCKET"],
	emailId: string,
	options: {
		htmlOrText?: string | null;
		rawMime?: ArrayBuffer | Uint8Array | string | null;
	},
): Promise<void> {
	const puts: Promise<R2Object | null>[] = [];
	// Allow empty string so draft clears overwrite a previous body.html object.
	if (options.htmlOrText != null) {
		puts.push(
			bucket.put(emailBodyKey(emailId), options.htmlOrText, {
				httpMetadata: { contentType: "text/html; charset=utf-8" },
			}),
		);
	}
	if (options.rawMime != null) {
		puts.push(
			bucket.put(emailRawKey(emailId), options.rawMime, {
				httpMetadata: { contentType: "message/rfc822" },
			}),
		);
	}
	if (puts.length > 0) await Promise.all(puts);
}

export async function loadEmailBody(
	bucket: Env["BUCKET"],
	emailId: string,
): Promise<string | null> {
	const obj = await bucket.get(emailBodyKey(emailId));
	if (!obj) return null;
	return obj.text();
}

export async function deleteEmailContent(
	bucket: Env["BUCKET"],
	emailId: string,
): Promise<void> {
	await bucket.delete(emailContentKeys(emailId));
}

export interface SimpleMimeHeaders {
	from?: string | null;
	to?: string | null;
	cc?: string | null;
	bcc?: string | null;
	subject?: string | null;
	date?: string | null;
	messageId?: string | null;
	inReplyTo?: string | null;
}

/** Minimal RFC822 message for outbound/draft .eml objects. */
export function buildSimpleMime(
	headers: SimpleMimeHeaders,
	body: string,
): string {
	const isHtml = /<[a-z][\s\S]*>/i.test(body);
	const lines: string[] = [];
	if (headers.from) lines.push(`From: ${headers.from}`);
	if (headers.to) lines.push(`To: ${headers.to}`);
	if (headers.cc) lines.push(`Cc: ${headers.cc}`);
	if (headers.bcc) lines.push(`Bcc: ${headers.bcc}`);
	if (headers.subject) lines.push(`Subject: ${headers.subject}`);
	if (headers.date) lines.push(`Date: ${headers.date}`);
	if (headers.messageId) {
		const id = headers.messageId.replace(/^<|>$/g, "");
		lines.push(`Message-ID: <${id}>`);
	}
	if (headers.inReplyTo) {
		const id = headers.inReplyTo.replace(/^<|>$/g, "");
		lines.push(`In-Reply-To: <${id}>`);
	}
	lines.push("MIME-Version: 1.0");
	lines.push(
		isHtml
			? "Content-Type: text/html; charset=utf-8"
			: "Content-Type: text/plain; charset=utf-8",
	);
	lines.push("");
	lines.push(body);
	return lines.join("\r\n");
}
