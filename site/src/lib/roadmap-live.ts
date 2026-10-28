// The roadmap page's live list (AVE-87): reads GET /api/roadmap (AVE-85) in the
// browser and decides whether to show it. Pure apart from the fetch it's handed,
// so test/roadmap-live.test.mjs covers it in node.
//
// The page is prerendered with its hand-written "Coming next" list, and that list
// stays unless this returns items: a failed, slow (over LIVE_TIMEOUT_MS), non-OK,
// non-Linear or empty answer all mean "keep the static list". Nothing from the API
// is trusted: each field is checked here and the page only ever sets textContent.
import type { RoadmapStatus } from "./roadmap-linear";

export const LIVE_TIMEOUT_MS = 3000;

export interface LiveItem {
	id: string;
	title: string;
	summary: string | null;
	status: RoadmapStatus;
}

const STATUSES: readonly RoadmapStatus[] = ["In progress", "Planned", "Shipped"];

/** Public status → the StatusPill look it borrows, and the label it shows. */
export const PILL: Record<RoadmapStatus, { status: string; label: string }> = {
	"In progress": { status: "progress", label: "In progress" },
	Planned: { status: "planned", label: "Planned" },
	Shipped: { status: "available", label: "Shipped" },
};

/**
 * The items worth showing from an /api/roadmap body, In progress, Planned, then Shipped
 * (the API's order is kept within a status), or null when the static list should stay.
 */
export function liveItems(body: unknown): LiveItem[] | null {
	if (!isObject(body) || body.source !== "linear" || !Array.isArray(body.items)) return null;
	const items: LiveItem[] = [];
	const seen = new Set<string>();
	for (const raw of body.items) {
		if (!isObject(raw)) continue;
		const { id, title, summary, status } = raw;
		if (typeof id !== "string" || !id || seen.has(id)) continue;
		if (typeof title !== "string" || !title.trim()) continue;
		if (!STATUSES.includes(status as RoadmapStatus)) continue;
		seen.add(id);
		items.push({
			id,
			title: title.trim(),
			summary: typeof summary === "string" && summary.trim() ? summary.trim() : null,
			status: status as RoadmapStatus,
		});
	}
	if (!items.length) return null;
	// Stable sort: the API's own order survives within each status.
	return items
		.map((item, i) => ({ item, i }))
		.sort((a, b) => STATUSES.indexOf(a.item.status) - STATUSES.indexOf(b.item.status) || a.i - b.i)
		.map(({ item }) => item);
}

/** Fetches /api/roadmap and returns liveItems' answer; any failure or timeout is null. */
export async function loadLiveItems(
	fetchImpl: typeof fetch = fetch,
	url = "/api/roadmap",
	timeoutMs = LIVE_TIMEOUT_MS,
): Promise<LiveItem[] | null> {
	// A plain setTimeout rather than AbortSignal.timeout(): Node (< 24) runs the latter on
	// an unref'd timer, so a hung fetch in the unit test let the event loop exit first.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
	try {
		const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: controller.signal });
		if (!res.ok) return null;
		return liveItems(await res.json());
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
