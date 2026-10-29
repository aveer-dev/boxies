// /api/requests (AVE-81): the request form on /request.
//   GET  → { available, siteKey }: whether the form can send, and the Turnstile site key.
//   POST → files a Linear issue in Triage (src/lib/requests.ts does the work).
// Not prerendered. Without LINEAR_REQUESTS_API_KEY, TURNSTILE_SECRET_KEY and
// TURNSTILE_SITE_KEY the GET says unavailable and the POST answers 503; the page
// still renders and points at email. README, Request forms.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleRequestInfo, handleRequestPost, methodNotAllowed } from "../../lib/requests";

export const prerender = false;

export const ALL: APIRoute = () => methodNotAllowed();

export const GET: APIRoute = () => handleRequestInfo(secrets());

export const POST: APIRoute = ({ request, locals }) =>
	handleRequestPost(request, {
		...secrets(),
		teamKey: env.LINEAR_REQUESTS_TEAM_KEY,
		rateLimit: env.REQUESTS_RATE,
		mailer: env.REQUEST_MAIL,
		fetch: (input, init) => fetch(input, init),
		waitUntil: (p) => {
			const ctx = locals.cfContext;
			if (ctx) ctx.waitUntil(p.catch(() => {}));
			else p.catch(() => {});
		},
	});

const secrets = () => ({
	linearKey: env.LINEAR_REQUESTS_API_KEY,
	turnstileSecret: env.TURNSTILE_SECRET_KEY,
	turnstileSiteKey: env.TURNSTILE_SITE_KEY,
});
