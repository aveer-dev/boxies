// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * A `?next=` value as a same-origin path, or "/" when it would leave the app.
 * Resolving against the origin catches `//evil.com`, `/\evil.com` (browsers
 * treat `\` as `/`), `https:…` and `javascript:` alike.
 */
export function safeRedirectPath(next: string | null | undefined, origin: string): string {
	const raw = next?.trim();
	if (!raw || !raw.startsWith("/") || raw.includes("\\")) return "/";
	try {
		const url = new URL(raw, origin);
		if (url.origin !== new URL(origin).origin) return "/";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/";
	}
}
