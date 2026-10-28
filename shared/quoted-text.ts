// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * HTML → plain text for quoting a message in a reply or forward (AVE-133).
 *
 * Used by the web composer, the Worker's agent/MCP reply tools, and mirrored
 * line-for-line by iOS `QuotedText.swift` and Android `QuotedText.kt` so the
 * quote reads the same everywhere, including in the sent email.
 *
 * Rules:
 * - Non-content (`<head>`, `<style>`, `<script>`, comments) and hidden
 *   elements (`display:none` preheaders) are dropped.
 * - Source whitespace is collapsed like a browser would; only `<br>` and
 *   block elements produce line breaks.
 * - Named and numeric entities are decoded, then invisible spacer characters
 *   (soft hyphen, zero-width joiners, CGJ…) that marketing mail pads its
 *   preheaders with are removed.
 * - Plain-text input (no tags) keeps its own line breaks.
 *
 * The result is plain text; callers must HTML-escape it before inlining.
 */

const NAMED_ENTITIES: Record<string, string> = {
	nbsp: " ",
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	shy: "",
	zwnj: "",
	zwj: "‍",
	lrm: "",
	rlm: "",
	ensp: " ",
	emsp: " ",
	thinsp: " ",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	sbquo: "‚",
	ldquo: "“",
	rdquo: "”",
	bdquo: "„",
	laquo: "«",
	raquo: "»",
	hellip: "…",
	bull: "•",
	middot: "·",
	copy: "©",
	reg: "®",
	trade: "™",
	euro: "€",
	pound: "£",
	yen: "¥",
	cent: "¢",
	deg: "°",
	times: "×",
	divide: "÷",
	plusmn: "±",
	sect: "§",
	para: "¶",
	iexcl: "¡",
	iquest: "¿",
	rarr: "→",
	larr: "←",
	uarr: "↑",
	darr: "↓",
	hearts: "♥",
	star: "☆",
	check: "✓",
	aacute: "á",
	eacute: "é",
	iacute: "í",
	oacute: "ó",
	uacute: "ú",
	agrave: "à",
	egrave: "è",
	ugrave: "ù",
	acirc: "â",
	ecirc: "ê",
	ocirc: "ô",
	auml: "ä",
	euml: "ë",
	iuml: "ï",
	ouml: "ö",
	uuml: "ü",
	ntilde: "ñ",
	ccedil: "ç",
	szlig: "ß",
	Aacute: "Á",
	Eacute: "É",
	Oacute: "Ó",
	Auml: "Ä",
	Ouml: "Ö",
	Uuml: "Ü",
	Ntilde: "Ñ",
	Ccedil: "Ç",
};

/** Invisible/format characters used as preheader padding. ZWJ is kept (emoji). */
const INVISIBLE_CHARS =
	/[­͏؜᠎​‌‎‏⁠-⁤﻿]/g;

const HTML_TAG = /<\/?[a-z][^>]*>|<!--/i;

/** Decode named (known) and numeric HTML entities. Unknown names are kept. */
export function decodeEntities(text: string): string {
	return text.replace(
		/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi,
		(match: string, body: string) => {
			if (body[0] === "#") {
				const code =
					body[1] === "x" || body[1] === "X"
						? Number.parseInt(body.slice(2), 16)
						: Number.parseInt(body.slice(1), 10);
				if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
				if (code >= 0xd800 && code <= 0xdfff) return "";
				return String.fromCodePoint(code);
			}
			const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
			return named ?? match;
		},
	);
}

/** Remove `<head>`, `<style>`, `<script>`, `<title>` blocks and comments. */
function dropNonContent(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(head|style|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<(style|script)\b[^>]*>[\s\S]*$/gi, "");
}

const VOID_TAGS = new Set([
	"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

/** Remove elements styled `display:none` (and everything inside them). */
function dropHiddenElements(html: string): string {
	const opener =
		/<([a-z][a-z0-9]*)\b[^>]*\bstyle\s*=\s*("[^"]*"|'[^']*')[^>]*>/gi;
	let out = html;
	let searchFrom = 0;
	for (;;) {
		opener.lastIndex = searchFrom;
		const match = opener.exec(out);
		if (!match) break;
		const style = match[2].toLowerCase();
		if (!/display\s*:\s*none/.test(style)) {
			searchFrom = match.index + match[0].length;
			continue;
		}
		const tag = match[1].toLowerCase();
		const start = match.index;
		const afterOpen = start + match[0].length;
		if (VOID_TAGS.has(tag) || match[0].endsWith("/>")) {
			out = out.slice(0, start) + out.slice(afterOpen);
			searchFrom = start;
			continue;
		}
		const tagRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
		tagRe.lastIndex = afterOpen;
		let depth = 1;
		let end = -1;
		for (let t = tagRe.exec(out); t; t = tagRe.exec(out)) {
			depth += t[1] ? -1 : 1;
			if (depth === 0) {
				end = t.index + t[0].length;
				break;
			}
		}
		// Unbalanced markup: drop just the opening tag rather than the rest of the mail.
		out = out.slice(0, start) + out.slice(end === -1 ? afterOpen : end);
		searchFrom = start;
	}
	return out;
}

function tidyLines(text: string): string {
	return text
		.replace(INVISIBLE_CHARS, "")
		.split("\n")
		.map((line) => line.replace(/[ \t  -   　]+/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Plain text that keeps paragraph and line breaks, for quoting a message in a
 * reply or forward. Works without a DOM (browser, Worker, SSR).
 */
export function htmlToQuotedText(html: string | null | undefined): string {
	if (!html) return "";
	const input = html.replace(/\r\n?/g, "\n");
	if (!HTML_TAG.test(input)) {
		return tidyLines(decodeEntities(input));
	}
	const withBreaks = dropHiddenElements(dropNonContent(input))
		.replace(/[ \t\n\f]+/g, " ")
		.replace(/<br\b[^>]*>/gi, "\n")
		.replace(/<li\b[^>]*>/gi, "\n• ")
		.replace(/<\/?(p|h[1-6]|blockquote|pre|ul|ol)\b[^>]*>/gi, "\n\n")
		.replace(/<\/?(div|tr|table|tbody|thead|tfoot|section|article|header|footer|dl|dt|dd|center|address)\b[^>]*>/gi, "\n")
		.replace(/<hr\b[^>]*>/gi, "\n")
		.replace(/<\/(td|th)\s*>/gi, " ")
		.replace(/<[^>]*>/g, "")
		.replace(/<[^>]*$/, "");
	return tidyLines(decodeEntities(withBreaks));
}
