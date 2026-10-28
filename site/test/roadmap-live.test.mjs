// The roadmap page's live list and its fallback (src/lib/roadmap-live.ts, AVE-87).
// Run with `pnpm test:unit roadmap-live`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveItems, loadLiveItems } from "../src/lib/roadmap-live.ts";

const item = (over = {}) => ({ id: "a1", title: "Snooze", summary: "Hide a thread until later.", status: "Planned", ...over });
const payload = (items, over = {}) => ({ items, source: "linear", fetchedAt: "2026-10-20T09:00:00.000Z", ...over });
const respond = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("Linear items come back In progress, Planned, Shipped, API order kept within a status", () => {
	const got = liveItems(
		payload([
			item({ id: "s", status: "Shipped", title: "S" }),
			item({ id: "p1", title: "P1" }),
			item({ id: "i", status: "In progress", title: "I" }),
			item({ id: "p2", title: "P2" }),
		]),
	);
	assert.deepEqual(got.map((i) => i.title), ["I", "P1", "P2", "S"]);
});

test("anything but a non-empty Linear answer keeps the static list", () => {
	for (const body of [
		null,
		"nope",
		[],
		{},
		payload([]),
		payload([item()], { source: "unconfigured" }),
		payload([item()], { source: "error" }),
		payload("x"),
		payload([item({ status: "Canceled" }), item({ id: "b", title: "  " }), item({ id: 3 }), null]),
	])
		assert.equal(liveItems(body), null, JSON.stringify(body));
});

test("bad fields are dropped or blanked, never passed through", () => {
	const got = liveItems(payload([item({ summary: 42 }), item({ id: "a1", title: "dup" }), item({ id: "b", summary: "  " })]));
	assert.deepEqual(got, [
		{ id: "a1", title: "Snooze", summary: null, status: "Planned" },
		{ id: "b", title: "Snooze", summary: null, status: "Planned" },
	]);
});

test("loadLiveItems: OK with items → items; 503, network error, bad JSON or timeout → null", async () => {
	assert.equal((await loadLiveItems(respond(200, payload([item()]))))?.length, 1);
	assert.equal(await loadLiveItems(respond(503, payload([], { source: "unconfigured", fetchedAt: null }))), null);
	assert.equal(await loadLiveItems(respond(200, payload([]))), null);
	assert.equal(await loadLiveItems(async () => { throw new TypeError("offline"); }), null);
	assert.equal(await loadLiveItems(async () => new Response("<html>", { status: 200 })), null);
	const hang = (_url, init) =>
		new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
	const started = Date.now();
	assert.equal(await loadLiveItems(hang, "/api/roadmap", 50), null);
	assert.ok(Date.now() - started < 2000);
});
