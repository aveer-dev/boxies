// One home for the site: https://inboxies.co (AVE-166). Mirrors the app Worker's
// workers/lib/https-redirect.ts (AVE-109). No imports, so test/canonical-redirect.test.mjs
// can load it in node.
//
// The zone settings do this at the edge (Always Use HTTPS, and a Single Redirect for
// www); this is the Worker-level fallback for when they're off. It only sees requests
// that reach the Worker: /api/*, /roadmap, /media/* and 404s. Prerendered pages are
// answered by the asset server before the Worker runs (wrangler.jsonc
// assets.run_worker_first), so those still rely on the zone settings.
//
// - www.inboxies.co, GET/HEAD: 301 straight to https://inboxies.co, same path and
//   query, so http://www. is one hop too. Other methods stay put: a form on a www
//   page posts to www, and the endpoints' Origin check would refuse it on the apex.
// - Any other http: request: 301 for GET/HEAD, 308 otherwise (keeps the method and
//   body) to the same host over HTTPS.
// - Never for a local host, so `astro dev`, `pnpm preview` and `wrangler dev` work.

export const CANONICAL_HOST = "inboxies.co";
export const WWW_HOST = "www.inboxies.co";

export function canonicalRedirect(request: Request): Response | null {
	const url = new URL(request.url);
	const host = url.hostname.toLowerCase();
	if (isLocalHost(host)) return null;
	const safe = request.method === "GET" || request.method === "HEAD";

	if (host === WWW_HOST && safe) {
		url.protocol = "https:";
		url.hostname = CANONICAL_HOST;
		url.port = "";
		return redirect(url, 301);
	}
	if (url.protocol !== "http:") return null;
	url.protocol = "https:";
	return redirect(url, safe ? 301 : 308);
}

/** localhost, *.localhost, 127.0.0.0/8 and [::1]. */
export function isLocalHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return host === "localhost" || host.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === "[::1]";
}

function redirect(url: URL, status: 301 | 308): Response {
	return new Response(null, { status, headers: { Location: url.toString() } });
}
