// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The quoted original in an outgoing reply or forward, as the real message
 * (AVE-133): its HTML layout, links, images, emphasis and tables survive, the
 * way Gmail and Apple Mail quote. The Worker appends it to every reply and
 * forward a client sends with `quote_original: true`, so web, iOS and Android
 * produce byte-identical quotes.
 *
 * - `sanitizeQuotedHtml` is an allowlist sanitizer that needs no DOM (it runs
 *   in the Worker): unknown tags are unwrapped, `<script>`/`<style>`/forms and
 *   friends are dropped with their content, `on*` handlers and any attribute
 *   not on the list are removed, URLs must be http(s)/mailto/tel/cid (inline
 *   `data:image/…` for images), and tags are re-balanced so the original can't
 *   close the quote container early.
 * - The `text/plain` part uses `htmlToQuotedText` with `> ` prefixes.
 * - A plain-text original becomes a simple escaped HTML quote.
 */

import { formatQuotedDate } from "./dates";
import { decodeEntities, htmlToQuotedText } from "./quoted-text";
import { normalizeDisplayName, senderNameFromRawHeaders } from "./sender";

// ── Sanitizer ─────────────────────────────────────────────────────

/** Formatting and layout tags kept as-is (with allowed attributes only). */
const ALLOWED_TAGS = new Set([
	"a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br",
	"caption", "center", "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div", "dl",
	"dt", "em", "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
	"header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol", "p", "pre",
	"q", "s", "samp", "section", "small", "span", "strike", "strong", "sub", "sup", "table",
	"tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var", "wbr",
]);

/** Elements dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
	"applet", "audio", "base", "button", "canvas", "datalist", "embed", "frame", "frameset",
	"head", "iframe", "input", "link", "map", "math", "meta", "noembed", "noframes", "noscript",
	"object", "option", "optgroup", "plaintext", "script", "select", "style", "svg", "template",
	"textarea", "title", "video", "xmp",
]);

/** Raw-text elements: an unclosed one swallows the rest of the document. */
const RAW_TEXT = new Set([
	"iframe", "noembed", "noframes", "noscript", "plaintext", "script", "style", "textarea",
	"title", "xmp",
]);

const VOID_TAGS = new Set(["br", "col", "hr", "img", "wbr"]);

const ALLOWED_ATTRS = new Set([
	"abbr", "align", "alt", "background", "bgcolor", "border", "cellpadding", "cellspacing",
	"cite", "class", "color", "colspan", "datetime", "dir", "face", "headers", "height", "href",
	"hspace", "lang", "nowrap", "rowspan", "scope", "size", "span", "src", "start", "style",
	"summary", "title", "valign", "vspace", "width",
]);

const URL_ATTRS = new Set(["href", "src", "background", "cite"]);

const TAG_AT = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** A URL the quote may carry, or null. Relative and script URLs are dropped. */
function safeUrl(raw: string, attr: string, tag: string): string | null {
	// Browsers ignore control characters and surrounding whitespace in URLs.
	const value = decodeEntities(raw).replace(/[\u0000- \u007f]+/g, (m, offset: number) =>
		offset === 0 ? "" : m,
	).trim();
	if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
	if (attr === "href" && value.startsWith("#")) return value;
	if (attr === "src" && /^cid:/i.test(value)) return value;
	if (attr === "src" && tag === "img" && /^data:image\/(png|gif|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
		return value;
	}
	return null;
}

/** Inline CSS, unless it could run code or load a non-image resource. */
function safeStyle(raw: string): string | null {
	const value = decodeEntities(raw);
	if (/[\\]|expression\s*\(|javascript:|vbscript:|behavio(u)?r\s*:|-moz-binding|@import/i.test(value)) {
		return null;
	}
	const urls = value.match(/url\s*\(\s*['"]?\s*([^'")\s]*)/gi) ?? [];
	for (const url of urls) {
		const target = url.replace(/^url\s*\(\s*['"]?\s*/i, "");
		if (!/^(https?:\/\/|cid:)/i.test(target)) return null;
	}
	return value;
}

function cleanAttributes(tag: string, source: string): string {
	let out = "";
	let hasHref = false;
	const seen = new Set<string>();
	ATTR.lastIndex = 0;
	for (let match = ATTR.exec(source); match; match = ATTR.exec(source)) {
		const name = match[1].toLowerCase();
		if (!ALLOWED_ATTRS.has(name) || seen.has(name)) continue;
		seen.add(name);
		const raw = match[2] ?? match[3] ?? match[4] ?? "";
		let value: string | null;
		if (URL_ATTRS.has(name)) value = safeUrl(raw, name, tag);
		else if (name === "style") value = safeStyle(raw);
		else value = decodeEntities(raw);
		if (value === null) continue;
		if (name === "href") hasHref = true;
		out += ` ${name}="${escapeAttr(value)}"`;
	}
	if (tag === "a" && hasHref) out += ' target="_blank" rel="noopener noreferrer"';
	return out;
}

/** Index just past the closing tag of `name` from `from`, or -1. */
function indexAfterClose(html: string, name: string, from: number): number {
	const close = new RegExp(`</${name}\\s*>`, "ig");
	close.lastIndex = from;
	const found = close.exec(html);
	return found ? found.index + found[0].length : -1;
}

/**
 * Allowlist-sanitise email HTML for quoting in an outgoing message. Pure
 * string work (no DOM), so the Worker, Node tests and browsers agree.
 */
export function sanitizeQuotedHtml(html: string | null | undefined): string {
	if (!html) return "";
	let out = "";
	const open: string[] = [];
	let i = 0;
	const n = html.length;

	while (i < n) {
		const lt = html.indexOf("<", i);
		if (lt === -1) {
			out += html.slice(i).replace(/>/g, "&gt;");
			break;
		}
		out += html.slice(i, lt).replace(/>/g, "&gt;");
		i = lt;

		if (html.startsWith("<!--", i)) {
			const end = html.indexOf("-->", i + 4);
			i = end === -1 ? n : end + 3;
			continue;
		}
		if (html[i + 1] === "!" || html[i + 1] === "?") {
			const end = html.indexOf(">", i);
			i = end === -1 ? n : end + 1;
			continue;
		}

		TAG_AT.lastIndex = i;
		const tag = TAG_AT.exec(html);
		if (!tag) {
			out += "&lt;";
			i += 1;
			continue;
		}
		i = TAG_AT.lastIndex;
		const closing = tag[1] === "/";
		const name = tag[2].toLowerCase();
		const attrs = tag[3] ?? "";

		if (DROP_WITH_CONTENT.has(name)) {
			if (closing || /\/\s*$/.test(attrs)) continue;
			const after = indexAfterClose(html, name, i);
			if (after !== -1) i = after;
			else if (RAW_TEXT.has(name)) i = n;
			continue;
		}
		if (!ALLOWED_TAGS.has(name)) continue; // unwrap: keep the content only

		if (closing) {
			const at = open.lastIndexOf(name);
			if (at === -1) continue; // stray closer can't escape the quote
			while (open.length > at) out += `</${open.pop()}>`;
			continue;
		}
		out += `<${name}${cleanAttributes(name, attrs)}>`;
		if (!VOID_TAGS.has(name)) open.push(name);
	}
	while (open.length) out += `</${open.pop()}>`;
	return out;
}

// ── Quote blocks ──────────────────────────────────────────────────

export interface QuoteOriginal {
	date?: string | null;
	sender: string;
	sender_name?: string | null;
	raw_headers?: string | null;
	recipient?: string | null;
	cc?: string | null;
	subject?: string | null;
	body?: string | null;
}

export interface QuoteOptions {
	/** IANA zone for the attribution date (the sender's); UTC when absent or invalid. */
	timeZone?: string | null;
}

export interface QuoteParts {
	html: string;
	text: string;
}

const HTML_TAG = /<\/?[a-z][^>]*>/i;

/** Gmail's quote styling, so other clients collapse and draw it the same way. */
const BLOCKQUOTE_STYLE = "margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex";

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function validTimeZone(timeZone: string | null | undefined): string {
	if (!timeZone) return "UTC";
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return timeZone;
	} catch {
		return "UTC";
	}
}

/** "Tue, Oct 28, 2026, 3:04 PM" in the sender's zone. */
export function quoteDate(date: string | null | undefined, options: QuoteOptions = {}): string {
	return formatQuotedDate(date ?? undefined, validTimeZone(options.timeZone));
}

/** "Ada Lovelace <ada@example.com>", or just the address when there is no name. */
export function quoteSender(original: QuoteOriginal): string {
	const name = normalizeDisplayName(original.sender_name) || senderNameFromRawHeaders(original.raw_headers);
	return name && name !== original.sender ? `${name} <${original.sender}>` : original.sender;
}

/** The original's body as quotable HTML: sanitised, or escaped plain text. */
export function quotedBodyHtml(body: string | null | undefined): string {
	if (!body) return "";
	if (HTML_TAG.test(body)) return sanitizeQuotedHtml(body);
	return `<div dir="auto">${escapeHtml(body.trim()).replace(/\r?\n/g, "<br>")}</div>`;
}

function prefixLines(text: string): string {
	return text
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
}

/** "On <date>, <sender> wrote:" + the original as a Gmail-compatible blockquote. */
export function buildReplyQuote(original: QuoteOriginal, options: QuoteOptions = {}): QuoteParts {
	const attribution = `On ${quoteDate(original.date, options)}, ${quoteSender(original)} wrote:`;
	const bodyHtml = quotedBodyHtml(original.body);
	const bodyText = htmlToQuotedText(original.body);
	return {
		html:
			`<br><div class="gmail_quote inboxies_quote">` +
			`<div dir="ltr" class="gmail_attr">${escapeHtml(attribution)}<br></div>` +
			`<blockquote class="gmail_quote" type="cite" style="${BLOCKQUOTE_STYLE}">${bodyHtml}</blockquote>` +
			`</div>`,
		text: `\n\n${attribution}\n\n${bodyText ? prefixLines(bodyText) : ">"}`,
	};
}

/** Gmail's "---------- Forwarded message ---------" header + the original as-is. */
export function buildForwardQuote(original: QuoteOriginal, options: QuoteOptions = {}): QuoteParts {
	const header = [
		"---------- Forwarded message ---------",
		`From: ${quoteSender(original)}`,
		`Date: ${quoteDate(original.date, options)}`,
		`Subject: ${original.subject ?? ""}`,
		`To: ${original.recipient ?? ""}`,
		...(original.cc ? [`Cc: ${original.cc}`] : []),
	];
	const bodyText = htmlToQuotedText(original.body);
	return {
		html:
			`<br><div class="gmail_quote inboxies_quote">` +
			`<div dir="ltr" class="gmail_attr">${header.map(escapeHtml).join("<br>")}<br></div><br>` +
			quotedBodyHtml(original.body) +
			`</div>`,
		text: `\n\n${header.join("\n")}\n\n${bodyText}`,
	};
}

/**
 * The reply/forward the client wrote plus the quote. A text-only send gets an
 * HTML part too, so the quote keeps its formatting.
 */
export function appendQuote(
	message: { html?: string | null; text?: string | null },
	quote: QuoteParts,
): { html: string; text: string } {
	const userHtml = message.html ?? (message.text ? textToParagraphs(message.text) : "");
	return {
		html: `${userHtml}${quote.html}`,
		text: `${(message.text ?? "").replace(/\s+$/, "")}${quote.text}`,
	};
}

function textToParagraphs(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";
	return trimmed
		.split(/\n{2,}/)
		.map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
		.join("");
}

/**
 * Whether a saved draft body already carries a quote inline (drafts saved
 * before quotes were added at send time). Those send as-is, without a second
 * quote.
 */
export function bodyHasInlineQuote(body: string | null | undefined): boolean {
	if (!body) return false;
	return /<blockquote\b|gmail_quote|-{5,}\s*Forwarded message|<strong>Forwarded message:<\/strong>/i.test(body);
}
