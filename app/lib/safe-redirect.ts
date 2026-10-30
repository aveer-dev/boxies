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

/**
 * Same-origin paths that need a full page load after sign-in because the
 * Worker handles them first: the MCP OAuth consent page (workers/mcp/oauth.ts
 * validates the request, then renders app/routes/authorize.tsx), and old
 * links with account details in the path (`/mailbox/<address>/...`,
 * `/invite/<token>`), which the Worker rewrites before any page loads, so
 * page analytics never record them (AVE-126, workers/lib/legacy-app-urls.ts).
 */
export function isWorkerPagePath(path: string): boolean {
	const pathname = path.split(/[?#]/, 1)[0];
	if (pathname === "/authorize") return true;
	if (/^\/invite\/[^/]+/.test(pathname)) return true;
	const mailbox = /^\/mailbox\/([^/]+)/.exec(pathname)?.[1];
	return mailbox !== undefined && !/^(0|[1-9]\d{0,3})$/.test(mailbox);
}
