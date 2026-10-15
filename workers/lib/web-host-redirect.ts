// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Paths that stay on a redirected host: the native apps and the browser
 * extension call the API there, mail links and Stripe returns may point at
 * it, and /ops is gated by that host's own Cloudflare Access application.
 */
const KEEP_ON_HOST = [/^\/api(?:\/|$)/, /^\/mcp(?:\/|$)/, /^\/agents\//, /^\/ops(?:\/|$)/, /^\/\.well-known\//, /^\/cdn-cgi\//];

/**
 * A browser visit to one of `WEB_REDIRECT_HOSTS` (e.g. inboxies.email) gets
 * a 301 to the same path on `APP_BASE_URL` (inboxies.app), so the web app has
 * a single home. Returns null when the request should be served here.
 */
export function webHostRedirect(
	env: { APP_BASE_URL?: string; WEB_REDIRECT_HOSTS?: string },
	request: Request,
): Response | null {
	const base = env.APP_BASE_URL?.trim();
	const hosts = (env.WEB_REDIRECT_HOSTS ?? "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean);
	if (!base || hosts.length === 0) return null;
	if (request.method !== "GET" && request.method !== "HEAD") return null;

	const url = new URL(request.url);
	if (!hosts.includes(url.hostname.toLowerCase())) return null;
	let target: URL;
	try {
		target = new URL(base);
	} catch {
		return null;
	}
	if (target.hostname.toLowerCase() === url.hostname.toLowerCase()) return null;
	if (KEEP_ON_HOST.some((re) => re.test(url.pathname))) return null;

	return new Response(null, {
		status: 301,
		headers: { Location: `${target.origin}${url.pathname}${url.search}`, "Cache-Control": "public, max-age=3600" },
	});
}
