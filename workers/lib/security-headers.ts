// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Baseline security headers on every Worker response (AVE-115): pages, the
 * API, redirects, MCP and OAuth. workers/app.ts applies them in its first
 * middleware, so they also cover responses that other middleware or routes
 * return early.
 *
 * A header the response already carries is never replaced: the OAuth consent
 * page keeps its own `Referrer-Policy: same-origin` and `frame-ancestors`
 * (workers/mcp/oauth.ts), downloads keep their `Content-Type`.
 *
 * The script/style Content-Security-Policy is separate (AVE-148,
 * workers/lib/content-security-policy.ts). The only CSP set here is an
 * enforcing `frame-ancestors 'none'`, added when the response has no
 * `Content-Security-Policy` of its own.
 *
 * Anti-framing is `'none'`/`DENY`: the app never frames its own URLs (mail
 * renders in `srcdoc` iframes, attachments are fetched as blobs or
 * downloaded), and the native apps load the API, not pages in a frame.
 */

/** One year; `includeSubDomains`, no `preload` yet. Sent on HTTPS only. */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";
export const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";
export const REFERRER_POLICY = "strict-origin-when-cross-origin";
/** Nothing in the app uses these. Passkeys (publickey-credentials-*) stay allowed. */
export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";
/**
 * HTML only. Not plain `same-origin`: Sign in with Apple (`usePopup: true`)
 * and Google Identity Services hand the result back from a popup to its
 * opener, which `same-origin` would sever.
 */
export const CROSS_ORIGIN_OPENER_POLICY = "same-origin-allow-popups";
/** Downloads (attachments, mailbox exports): no cross-origin `<img>`/`<script>` loads. */
export const CROSS_ORIGIN_RESOURCE_POLICY = "same-origin";

/** The headers this response should carry, before skipping ones already set. */
export function securityHeadersFor(response: Response, request: Request): Array<[string, string]> {
	const headers: Array<[string, string]> = [
		["X-Content-Type-Options", "nosniff"],
		["Referrer-Policy", REFERRER_POLICY],
		["X-Frame-Options", "DENY"],
		["Permissions-Policy", PERMISSIONS_POLICY],
	];
	if (new URL(request.url).protocol === "https:") {
		headers.push(["Strict-Transport-Security", STRICT_TRANSPORT_SECURITY]);
	}
	// Any CSP the response already has (the OAuth pages' frame-ancestors, or
	// AVE-148's policy once it enforces) owns framing; don't add a second one.
	if (!response.headers.has("Content-Security-Policy")) {
		headers.push(["Content-Security-Policy", FRAME_ANCESTORS_POLICY]);
	}
	if (/^\s*text\/html\b/i.test(response.headers.get("Content-Type") ?? "")) {
		headers.push(["Cross-Origin-Opener-Policy", CROSS_ORIGIN_OPENER_POLICY]);
	}
	if (/^\s*attachment\b/i.test(response.headers.get("Content-Disposition") ?? "")) {
		headers.push(["Cross-Origin-Resource-Policy", CROSS_ORIGIN_RESOURCE_POLICY]);
	}
	return headers;
}

/**
 * Returns the response with any missing security headers added. WebSocket
 * upgrades (101, Agents SDK / Durable Objects) pass through untouched: they
 * can't be re-wrapped and the headers mean nothing there. The response is
 * copied before changing it, since fetched or cached responses have
 * immutable headers; the body stream is reused, not buffered.
 */
export function withSecurityHeaders(response: Response, request: Request): Response {
	if (response.status === 101 || response.webSocket) return response;
	const missing = securityHeadersFor(response, request).filter(([name]) => !response.headers.has(name));
	if (missing.length === 0) return response;
	const res = new Response(response.body, response);
	for (const [name, value] of missing) res.headers.set(name, value);
	return res;
}
