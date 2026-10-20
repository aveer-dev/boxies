// GET /api/roadmap: the public roadmap, read from Linear (AVE-85). Issues carrying
// the `public-roadmap` label come back as { items, source, fetchedAt }, each item
// only { id, title, summary, status } (src/lib/roadmap-linear.ts does the mapping).
//
// The Linear key is the LINEAR_ROADMAP_API_KEY secret (read-only; README, Roadmap
// from Linear). Without it, or when Linear fails, the answer is a 503 with no items
// and source "unconfigured" or "error", and the page shows its static list.
//
// Answers are cached for 10 minutes with the Cache API, plus a copy in the isolate's
// memory: the Cache API does nothing on workers.dev, and the memory copy also stands
// in for up to a day when Linear is down. The key is never logged or returned.
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
	LINEAR_GRAPHQL_URL,
	MAX_PAGES,
	PAGE_SIZE,
	ROADMAP_LABEL,
	ROADMAP_QUERY,
	parseLinearPage,
	toRoadmapItems,
	type LinearIssue,
	type RoadmapPayload,
} from "../../lib/roadmap-linear";

export const prerender = false;

const TTL_S = 600;
// A failed read is remembered for a minute, so a Linear outage isn't a request per visit.
const ERROR_TTL_S = 60;
// How long the last good answer may stand in while Linear is failing.
const STALE_MAX_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
// Bump when the payload's shape changes, so old cached answers aren't served.
const CACHE_VERSION = "1";

type Outcome = "hit" | "memory" | "fetched" | "unconfigured" | "error" | "stale";

// Public data only, shared by every request this isolate serves.
let memory: { payload: RoadmapPayload; at: number } | null = null;

const log = (outcome: Outcome, extra: Record<string, unknown> = {}) =>
	console.log(JSON.stringify({ event: "roadmap", outcome, ...extra }));

const json = (status: number, payload: RoadmapPayload, cacheControl: string) =>
	new Response(JSON.stringify(payload), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": cacheControl },
	});

const fresh = (payload: RoadmapPayload) => json(200, payload, `public, max-age=${TTL_S}`);

export const ALL: APIRoute = () =>
	new Response(JSON.stringify({ error: "method" }), {
		status: 405,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", allow: "GET, HEAD" },
	});

export const GET: APIRoute = async ({ request, locals }) => {
	const key = env.LINEAR_ROADMAP_API_KEY?.trim();
	if (!key) {
		log("unconfigured");
		return json(503, { items: [], source: "unconfigured", fetchedAt: null }, "no-store");
	}

	if (memory && memory.payload.source === "linear" && Date.now() - memory.at < TTL_S * 1000) {
		log("memory");
		return fresh(memory.payload);
	}

	// One cache entry for every visitor: no query string or headers reach the key.
	const cacheKey = new Request(new URL(`/api/roadmap?v=${CACHE_VERSION}`, request.url).href, { method: "GET" });
	// A named cache (the DOM typings in this project don't know caches.default); same data center, same TTL.
	const cache = typeof caches !== "undefined" ? await caches.open("roadmap").catch(() => null) : null;
	const hit = await cache?.match(cacheKey).catch(() => undefined);
	// A cached failure (maybe another isolate's) loses to a good copy this isolate still holds.
	if (hit && !(hit.status !== 200 && usableStale())) {
		log("hit");
		return hit;
	}

	const waitUntil = (p: Promise<unknown>) => {
		const ctx = locals.cfContext;
		if (ctx) ctx.waitUntil(p.catch(() => {}));
		else p.catch(() => {});
	};

	let payload: RoadmapPayload;
	try {
		payload = { items: await toRoadmapItems(await readIssues(key)), source: "linear", fetchedAt: new Date().toISOString() };
	} catch (err) {
		// Only our own error text (parseLinearPage never quotes Linear); no key, no response body.
		const reason = err instanceof Error ? err.message.slice(0, 100) : "unknown";
		if (memory && usableStale()) {
			log("stale", { reason });
			return json(200, memory.payload, `public, max-age=${ERROR_TTL_S}`);
		}
		log("error", { reason });
		const failed = json(503, { items: [], source: "error", fetchedAt: null }, `public, max-age=${ERROR_TTL_S}`);
		if (cache) waitUntil(cache.put(cacheKey, failed.clone()));
		return failed;
	}

	memory = { payload, at: Date.now() };
	log("fetched", { count: payload.items.length });
	const response = fresh(payload);
	if (cache) waitUntil(cache.put(cacheKey, response.clone()));
	return response;
};

export const HEAD = GET;

function usableStale(): boolean {
	return !!memory && memory.payload.source === "linear" && Date.now() - memory.at < STALE_MAX_MS;
}

async function readIssues(key: string): Promise<LinearIssue[]> {
	const issues: LinearIssue[] = [];
	let after: string | null = null;
	for (let page = 0; page < MAX_PAGES; page++) {
		const res = await fetch(LINEAR_GRAPHQL_URL, {
			method: "POST",
			// A personal API key goes in as is; Linear only wants "Bearer" for OAuth tokens.
			headers: { authorization: key, "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ query: ROADMAP_QUERY, variables: { label: ROADMAP_LABEL, first: PAGE_SIZE, after } }),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!res.ok) {
			await res.body?.cancel();
			throw new Error(`linear: http ${res.status}`);
		}
		const result = parseLinearPage(await res.json());
		issues.push(...result.issues);
		if (!result.hasNextPage || !result.endCursor) break;
		after = result.endCursor;
	}
	return issues;
}
