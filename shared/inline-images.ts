// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inline `cid:` images in the web reader (AVE-110).
 *
 * The message body renders in a sandboxed iframe with an opaque origin (no
 * `allow-same-origin`), so an `<img>` pointing at the attachment API goes out
 * without the session cookie and comes back blocked. Instead the app fetches
 * each referenced inline image itself (same origin, with credentials) and
 * swaps the `cid:` reference for a `data:` URL before the body is handed to
 * the iframe — the iframe still never talks to the API. iOS and Android do the
 * same (EmailBodyView `resolveInlineImages`).
 *
 * A hostile message decides what it references, so only image attachments of
 * this message that the body actually references are fetched, within size caps.
 */

/** Largest single inline image the reader will load. */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
/** Largest total of inline images loaded for one message. */
export const MAX_INLINE_IMAGES_TOTAL_BYTES = 20 * 1024 * 1024;

export interface InlineImageAttachment {
	id: string;
	mimetype?: string | null;
	size?: number | null;
	content_id?: string | null;
}

/** `<image001@example.com>` → `image001@example.com`. */
export function normalizeContentId(contentId: string | null | undefined): string | null {
	if (!contentId) return null;
	let cid = contentId.trim();
	if (cid.startsWith("<") && cid.endsWith(">")) cid = cid.slice(1, -1).trim();
	return cid || null;
}

/** `image/png; name=x.png` → `image/png`; anything that isn't a plain image type → null. */
export function inlineImageMimeType(mimetype: string | null | undefined): string | null {
	const type = (mimetype ?? "").split(";")[0].trim().toLowerCase();
	return /^image\/[a-z0-9][a-z0-9.+-]*$/.test(type) ? type : null;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches `cid:<id>` or `cid:id` as a whole reference: `cid:img1` must not
 * match inside `cid:img10`. The id may be percent-encoded (RFC 2392).
 */
function cidReferencePattern(cid: string): RegExp {
	const forms = [cid];
	const encoded = encodeURI(cid);
	if (encoded !== cid) forms.push(encoded);
	const ids = forms.map(escapeRegExp).join("|");
	return new RegExp(`cid:(?:&lt;|<)?(?:${ids})(?:&gt;|>)?(?=$|["'\\s)\\],;&<>])`, "gi");
}

/** Whether `body` references this content id. */
export function referencesContentId(body: string, contentId: string | null | undefined): boolean {
	const cid = normalizeContentId(contentId);
	if (!body || !cid) return false;
	return cidReferencePattern(cid).test(body);
}

/**
 * The attachments worth fetching for `body`: images of this message that the
 * body references by `cid:`, each at most `maxBytes` and together at most
 * `maxTotalBytes` (by declared size; the fetched size is checked again).
 * Images over the caps are left out and their references stay broken.
 */
export function selectInlineImages<T extends InlineImageAttachment>(
	body: string,
	attachments: readonly T[] | null | undefined,
	limits: { maxBytes?: number; maxTotalBytes?: number } = {},
): T[] {
	if (!body || !attachments?.length || !/cid:/i.test(body)) return [];
	const maxBytes = limits.maxBytes ?? MAX_INLINE_IMAGE_BYTES;
	const maxTotalBytes = limits.maxTotalBytes ?? MAX_INLINE_IMAGES_TOTAL_BYTES;
	const picked: T[] = [];
	const seen = new Set<string>();
	let total = 0;
	for (const att of attachments) {
		const cid = normalizeContentId(att.content_id);
		if (!cid || seen.has(cid.toLowerCase())) continue;
		if (!inlineImageMimeType(att.mimetype)) continue;
		if (!referencesContentId(body, cid)) continue;
		const size = typeof att.size === "number" && att.size >= 0 ? att.size : 0;
		if (size > maxBytes || total + size > maxTotalBytes) continue;
		seen.add(cid.toLowerCase());
		total += size;
		picked.push(att);
	}
	return picked;
}

/**
 * Swap each `cid:` reference for its URL (content id → URL). References with
 * no entry are left as they are.
 */
export function replaceContentIds(body: string, urls: ReadonlyMap<string, string>): string {
	if (!body || urls.size === 0) return body;
	let result = body;
	for (const [contentId, url] of urls) {
		const cid = normalizeContentId(contentId);
		if (!cid) continue;
		result = result.replace(cidReferencePattern(cid), () => url);
	}
	return result;
}
