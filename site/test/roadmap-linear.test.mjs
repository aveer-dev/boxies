// Pure mapping for /api/roadmap (src/lib/roadmap-linear.ts). Run with `pnpm test:unit roadmap`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	SUMMARY_MAX,
	TITLE_MAX,
	clip,
	parseLinearPage,
	publicId,
	publicSummary,
	statusFor,
	toPlainText,
	toRoadmapItems,
} from "../src/lib/roadmap-linear.ts";

const issue = (over = {}) => ({
	id: "uuid-1",
	title: "Snooze",
	description: null,
	updatedAt: "2026-10-01T00:00:00.000Z",
	completedAt: null,
	stateType: "backlog",
	...over,
});

test("state types map to the three public statuses; canceled and unknown drop", () => {
	for (const t of ["backlog", "unstarted", "triage"]) assert.equal(statusFor(t), "Planned");
	assert.equal(statusFor("started"), "In progress");
	assert.equal(statusFor("completed"), "Shipped");
	assert.equal(statusFor("canceled"), null);
	assert.equal(statusFor("duplicate"), null);
	assert.equal(statusFor(""), null);
});

test("public summary: heading forms", () => {
	assert.equal(publicSummary("Internal notes\n\n## Public summary\nSnooze a thread until later.\n\n## Plan\nsecret"), "Snooze a thread until later.");
	assert.equal(publicSummary("### Public Summary:\n\nLine one\nline two\n---\ninternal"), "Line one line two");
	assert.equal(publicSummary("**Public summary:** Same-line text.\n\nmore\n**Internal**\nhidden"), "Same-line text. more");
	assert.equal(publicSummary("Public summary: Plain colon form"), "Plain colon form");
	assert.equal(publicSummary("# Public summary\n"), null);
	assert.equal(publicSummary("Just a description, no section."), null);
	assert.equal(publicSummary("The public summary is TBD"), null);
	assert.equal(publicSummary(null), null);
});

test("public summary is plain text: links, urls, html, code and images stripped", () => {
	const s = publicSummary(
		"## Public summary\nSee [the spec](https://linear.app/aveer/issue/AVE-1) and https://internal.example/x.\n<script>alert(1)</script> **Bold** and `code` ![img](https://x/y.png)\n```\nconst secret = 1\n```",
	);
	assert.equal(s, "See the spec and Bold and code");
	assert.ok(!/https?:|<|linear\.app/.test(s));
});

test("plain text drops control and bidi characters", () => {
	assert.equal(toPlainText("a‮b\u0000c​d"), "a b c d");
});

test("summary and title are length-capped by code point", () => {
	const long = "word ".repeat(200);
	const s = publicSummary(`## Public summary\n${long}`);
	assert.ok([...s].length <= SUMMARY_MAX);
	assert.ok(s.endsWith("…"));
	assert.equal(clip("short", 10), "short");
	const emoji = "😀".repeat(TITLE_MAX + 5);
	const c = clip(emoji, TITLE_MAX);
	assert.equal([...c].length, TITLE_MAX);
	assert.ok(!c.includes("�"));
});

test("items carry only id, title, summary and status, sorted by status then recency", async () => {
	const items = await toRoadmapItems([
		issue({ id: "a", title: "Old plan", updatedAt: "2026-01-01T00:00:00Z" }),
		issue({ id: "b", title: "New plan", updatedAt: "2026-09-01T00:00:00Z" }),
		issue({ id: "c", title: "Shipped early", stateType: "completed", completedAt: "2026-02-01T00:00:00Z" }),
		issue({ id: "d", title: "Shipped late", stateType: "completed", completedAt: "2026-08-01T00:00:00Z" }),
		issue({ id: "e", title: "Doing", stateType: "started", description: "## Public summary\nUnderway." }),
		issue({ id: "f", title: "Dropped", stateType: "canceled" }),
		issue({ id: "g", title: "   ", stateType: "started" }),
		issue({ id: "a", title: "Duplicate node" }),
	]);
	assert.deepEqual(
		items.map((i) => [i.title, i.status]),
		[
			["Doing", "In progress"],
			["New plan", "Planned"],
			["Old plan", "Planned"],
			["Shipped late", "Shipped"],
			["Shipped early", "Shipped"],
		],
	);
	for (const item of items) assert.deepEqual(Object.keys(item).sort(), ["id", "status", "summary", "title"]);
	assert.equal(items[0].summary, "Underway.");
	assert.equal(items[1].summary, null);
});

test("public id is a stable opaque hash, not the Linear id", async () => {
	const id = await publicId("9f0c1d2e-uuid");
	assert.match(id, /^[0-9a-f]{16}$/);
	assert.equal(await publicId("9f0c1d2e-uuid"), id);
	assert.notEqual(await publicId("other"), id);
	assert.ok(!id.includes("9f0c1d2e"));
});

test("parseLinearPage reads nodes and page info, skipping malformed nodes", () => {
	const page = parseLinearPage({
		data: {
			issues: {
				nodes: [
					{ id: "1", title: "Ok", description: "d", updatedAt: "x", completedAt: null, state: { type: "started" }, assignee: { name: "private" } },
					{ id: 2, title: "bad id", state: { type: "started" } },
					{ id: "3", title: "no state" },
					null,
				],
				pageInfo: { hasNextPage: true, endCursor: "cur" },
			},
		},
	});
	assert.equal(page.issues.length, 1);
	assert.deepEqual(Object.keys(page.issues[0]).sort(), ["completedAt", "description", "id", "stateType", "title", "updatedAt"]);
	assert.equal(page.hasNextPage, true);
	assert.equal(page.endCursor, "cur");
});

test("parseLinearPage throws on GraphQL errors without echoing them", () => {
	assert.throws(() => parseLinearPage({ errors: [{ message: "Authentication required, key lin_api_x" }] }), (err) => {
		assert.ok(!err.message.includes("lin_api"));
		return true;
	});
	assert.throws(() => parseLinearPage({ data: {} }));
	assert.throws(() => parseLinearPage("nope"));
});
