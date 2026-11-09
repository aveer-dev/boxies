// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The mailbox signature (AVE-204): `settings.signature = { enabled, text, html? }`.
 *
 * Web writes it with basic formatting and links; iOS and Android edit the plain
 * text. The HTML ends up in outgoing mail, so it is allowlist-sanitised when the
 * Worker saves it and again when a client renders it: bold / italic / underline /
 * strike, paragraphs, line breaks, lists, and http(s) or mailto links. No styles,
 * images, scripts or other attributes. `text` always mirrors the HTML (links keep
 * their URL) so the apps, and the text/plain part, carry the same signature.
 */

import { decodeEntities } from "./quoted-text";
import { type HtmlAllowlist, sanitizeHtmlWithAllowlist } from "./quoted-html";

export interface MailboxSignature {
	enabled: boolean;
	text: string;
	html?: string;
}

/** Longest signature HTML the Worker stores (before sanitising). */
export const SIGNATURE_HTML_MAX = 10_000;
/** Longest plain-text signature the Worker stores. */
export const SIGNATURE_TEXT_MAX = 2_000;

const SIGNATURE_TAGS = new Set([
	"a", "b", "br", "del", "div", "em", "i", "li", "ol", "p", "s", "span", "strike", "strong",
	"u", "ul",
]);

function signatureUrl(raw: string, attr: string, tag: string): string | null {
	if (attr !== "href" || tag !== "a") return null;
	const value = decodeEntities(raw).replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return /^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(value) ? value : null;
}

const SIGNATURE_ALLOWLIST: HtmlAllowlist = {
	tags: SIGNATURE_TAGS,
	attrs: new Set(["href"]),
	url: signatureUrl,
};

/** Signature HTML with only basic formatting and http(s) / mailto links left. */
export function sanitizeSignatureHtml(html: string | null | undefined): string {
	return sanitizeHtmlWithAllowlist(html, SIGNATURE_ALLOWLIST)
		// Empty links (no href survived) are just text.
		.replace(/<a>([\s\S]*?)<\/a>/g, "$1")
		.trim();
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Plain text for a signature's HTML: one line per paragraph or break, bullets for
 * list items, and a link's URL after its label ("Site (https://…)") unless the
 * label already is the address.
 */
export function signatureHtmlToText(html: string | null | undefined): string {
	if (!html) return "";
	const clean = sanitizeSignatureHtml(html);
	const linked = clean.replace(
		/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
		(_match, rawHref: string, inner: string) => {
			const href = decodeEntities(rawHref);
			const label = decodeEntities(inner.replace(/<[^>]*>/g, "")).trim();
			const bare = href.replace(/^mailto:/i, "");
			if (!label || label === href || label === bare || `${label}/` === href) {
				return escapeHtml(bare);
			}
			return `${inner} (${escapeHtml(bare)})`;
		},
	);
	// Block ends mark a line end once however many close together (\u0001);
	// a <br> is always its own line, so an empty paragraph stays a blank line.
	const text = linked
		.replace(/[ \t\r\n\f]+/g, " ")
		.replace(/<br\b[^>]*>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "\u0001• ")
		.replace(/<\/(p|div|ul|ol|li)\s*>/gi, "\u0001")
		.replace(/<[^>]*>/g, "")
		.replace(/\u0001[\u0001 ]*/g, "\n");
	return decodeEntities(text)
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Escaped plain text as signature HTML, one `<br>` per line. */
export function signatureTextToHtml(text: string): string {
	return escapeHtml(text.trim()).replace(/\r?\n/g, "<br>");
}

/**
 * The signature's body as safe HTML, or "" when it is off or empty. Text-only
 * signatures (the apps' editor, older mailboxes) become escaped lines.
 */
export function signatureContentHtml(signature: Partial<MailboxSignature> | null | undefined): string {
	if (!signature?.enabled) return "";
	const html = sanitizeSignatureHtml(signature.html);
	if (html && signatureHtmlToText(html)) return html;
	const text = typeof signature.text === "string" ? signature.text.trim() : "";
	return text ? signatureTextToHtml(text) : "";
}

/**
 * The stored form of a signature a client saved: HTML sanitised, `text` derived
 * from it (so every client shows the same words), and `html` dropped when only
 * text was sent. A non-object clears the signature. Errors are user-facing.
 * An enabled signature with no words is stored as sent: the apps then add their
 * fixed "Sent with Inboxies Email" line, and web adds nothing.
 */
export function normalizeSignatureSetting(
	raw: unknown,
): { ok: true; signature: MailboxSignature | null } | { ok: false; error: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: true, signature: null };
	const value = raw as Record<string, unknown>;
	const enabled = value.enabled === true;
	const rawHtml = typeof value.html === "string" ? value.html : "";
	const rawText = typeof value.text === "string" ? value.text : "";
	if (rawHtml.length > SIGNATURE_HTML_MAX) return { ok: false, error: "Signature is too long" };
	const html = sanitizeSignatureHtml(rawHtml);
	const htmlText = html ? signatureHtmlToText(html) : "";
	const text = htmlText || rawText.replace(/\r\n?/g, "\n").trim();
	if (text.length > SIGNATURE_TEXT_MAX) return { ok: false, error: "Signature is too long" };
	return { ok: true, signature: htmlText ? { enabled, text, html } : { enabled, text } };
}

/** `settings` with its signature in stored form; one that can't be stored is dropped. */
export function withStoredSignature(settings: Record<string, unknown>): Record<string, unknown> {
	if (!("signature" in settings)) return settings;
	const { signature: raw, ...rest } = settings;
	const signature = normalizeSignatureSetting(raw);
	return signature.ok && signature.signature ? { ...rest, signature: signature.signature } : rest;
}
