// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { isDevRuntime } from "./dev-runtime";

/**
 * Cleartext requests get sent to HTTPS (AVE-109). The zones' "Always Use
 * HTTPS" setting does this at the edge; this is the Worker-level fallback for
 * when that setting is off, so `http://inboxies.app/login` never renders and
 * `http://inboxies.email/api/...` never answers over cleartext.
 *
 * The scheme comes from `request.url`: on Cloudflare the Worker sees the URL
 * the visitor requested, `http:` included. `cf-visitor` and
 * `X-Forwarded-Proto` carry the same thing and aren't needed. HSTS for the
 * HTTPS responses is added by workers/lib/security-headers.ts.
 *
 * GET/HEAD get a 301. Other methods get a 308, which keeps the method and
 * body, so a stray cleartext POST is replayed over HTTPS instead of turning
 * into a GET (what 301/302 do in browsers) and losing its body. The native
 * apps and the extension only call HTTPS, so this is a safety net.
 *
 * Never redirects in local development: under `react-router dev`
 * (isDevRuntime) or for a loopback / emulator host, which only a local
 * runtime ever serves (Cloudflare routes by hostname).
 */
export function httpsRedirect(request: Request): Response | null {
	const url = new URL(request.url);
	if (url.protocol !== "http:") return null;
	if (isDevRuntime() || isLocalHost(url.hostname)) return null;

	url.protocol = "https:";
	const status = request.method === "GET" || request.method === "HEAD" ? 301 : 308;
	return new Response(null, { status, headers: { Location: url.toString() } });
}

/** localhost, *.localhost, 127.0.0.0/8, [::1], and 10.0.2.2 (the Android emulator's host). */
export function isLocalHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
		host === "[::1]" ||
		host === "10.0.2.2"
	);
}
