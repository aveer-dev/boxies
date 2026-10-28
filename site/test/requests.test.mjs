// POST /api/requests (src/lib/requests.ts, AVE-81): validation, Turnstile, the
// rate limit and the Linear issue, with fetch mocked. Run with `pnpm test:unit requests`.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { checkAll } from "../src/components/request/request-rules.ts";
import {
	LINEAR_GRAPHQL_URL,
	REQUESTER_URL,
	TURNSTILE_VERIFY_URL,
	handleRequestInfo,
	handleRequestPost,
	issueDescription,
	parseFields,
	resetTargetCache,
	verifyTurnstile,
} from "../src/lib/requests.ts";
import { publicSummary } from "../src/lib/roadmap-linear.ts";

const good = (over = {}) => ({
	kind: "feature",
	title: "Snooze a thread",
	details: "Hide a thread until Monday morning, please.",
	email: "ada@example.com",
	platform: "",
	website: "",
	t: 5000,
	token: "tok",
	...over,
});

const post = (body, headers = {}) =>
	new Request("https://inboxies.co/api/requests", {
		method: "POST",
		headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", origin: "https://inboxies.co", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A fake Linear + Turnstile. Records every call; `over` swaps in answers per operation.
function fakeNet(over = {}) {
	const calls = [];
	const fetch = async (url, init) => {
		if (url === TURNSTILE_VERIFY_URL) {
			const form = new URLSearchParams(init.body);
			calls.push({ op: "turnstile", form });
			if (over.turnstile) return over.turnstile(form);
			return jsonRes({ success: form.get("response") === "tok" });
		}
		assert.equal(url, LINEAR_GRAPHQL_URL);
		const { query, variables } = JSON.parse(init.body);
		const op = /(?:query|mutation) (\w+)/.exec(query)[1];
		calls.push({ op, variables, auth: init.headers.authorization });
		if (over[op]) return over[op](variables);
		switch (op) {
			case "RequestTarget":
				return jsonRes({
					data: {
						teams: { nodes: [{ id: "team-1", states: { nodes: [{ id: "triage-1" }] } }] },
						issueLabels: {
							nodes: [
								{ id: "lab-ur", name: "user-request", team: { id: "team-1" } },
								{ id: "lab-feature", name: "Feature", team: null },
								{ id: "lab-bug-other", name: "Bug", team: { id: "team-2" } },
								{ id: "lab-bug", name: "Bug", team: null },
								{ id: "lab-feedback", name: "feedback", team: { id: "team-1" } },
							],
						},
					},
				});
			case "CreateRequestLabel":
				return jsonRes({ data: { issueLabelCreate: { success: true, issueLabel: { id: `new-${variables.input.name}`, name: variables.input.name } } } });
			case "CreateRequest":
				return jsonRes({ data: { issueCreate: { success: true, issue: { id: "issue-1", identifier: "AVE-999" } } } });
			case "AttachRequester":
				return jsonRes({ data: { attachmentCreate: { success: true } } });
		}
		throw new Error(`unexpected op ${op}`);
	};
	return { fetch, calls };
}

function deps(net, over = {}) {
	const logs = [];
	const pending = [];
	const sent = [];
	return {
		logs,
		pending,
		sent,
		value: {
			linearKey: "lin_api_test",
			turnstileSecret: "secret",
			turnstileSiteKey: "site-key",
			fetch: net.fetch,
			waitUntil: (p) => pending.push(p),
			log: (line) => logs.push(JSON.parse(line)),
			mailer: { send: async (m) => sent.push(m) },
			...over,
		},
	};
}

beforeEach(() => resetTargetCache());

test("GET says unavailable without every secret, and hands out only the site key", async () => {
	const off = await handleRequestInfo({ linearKey: "k", turnstileSecret: "s" }).json();
	assert.deepEqual(off, { available: false, siteKey: null });
	const on = await handleRequestInfo({ linearKey: "k", turnstileSecret: "s", turnstileSiteKey: " site " }).json();
	assert.deepEqual(on, { available: true, siteKey: "site" });
});

test("missing secrets: 503 unavailable, nothing fetched", async () => {
	const net = fakeNet();
	for (const missing of ["linearKey", "turnstileSecret", "turnstileSiteKey"]) {
		const d = deps(net, { [missing]: undefined });
		const res = await handleRequestPost(post(good()), d.value);
		assert.equal(res.status, 503);
		assert.deepEqual(await res.json(), { ok: false, error: "unavailable" });
	}
	assert.equal(net.calls.length, 0);
});

test("validation: required fields, length caps, kinds and the bug platform", () => {
	const v = (over) => checkAll({ kind: "feature", title: "Snooze a thread", details: "Ten chars or more.", email: "a@b.co", platform: "", ...over });
	assert.deepEqual(v({}), {});
	assert.deepEqual(v({ title: "", details: "", email: "" }), { title: "required", details: "required", email: "required" });
	assert.equal(v({ title: "abc" }).title, "short");
	assert.equal(v({ title: "x".repeat(121) }).title, "long");
	assert.equal(v({ title: "é".repeat(120) }).title, undefined, "counted by character, not byte");
	assert.equal(v({ details: "short" }).details, "short");
	assert.equal(v({ details: "x".repeat(4001) }).details, "long");
	assert.equal(v({ email: "nope" }).email, "format");
	assert.equal(v({ email: `${"a".repeat(250)}@b.co` }).email, "long");
	assert.equal(v({ email: "a@b.co\r\nBcc: x@y.z" }).email, "format");
	assert.equal(v({ kind: "spam" }).kind, "format");
	assert.equal(v({ kind: "bug" }).platform, "required");
	assert.equal(v({ kind: "bug", platform: "windows" }).platform, "format");
	assert.deepEqual(v({ kind: "bug", platform: "ios" }), {});
	assert.deepEqual(v({ platform: "nonsense" }), {}, "platform only counts for bugs");
});

test("invalid fields: 400 with per-field errors, and no Turnstile or Linear call", async () => {
	const net = fakeNet();
	const d = deps(net);
	const res = await handleRequestPost(post(good({ title: "", email: "nope" })), d.value);
	assert.equal(res.status, 400);
	assert.deepEqual((await res.json()).errors, { title: "required", email: "format" });
	assert.equal(net.calls.length, 0);
});

test("bad bodies: not JSON, wrong type, too large, other origin", async () => {
	const net = fakeNet();
	const d = deps(net).value;
	assert.equal((await handleRequestPost(post("{nope"), d)).status, 400);
	assert.equal((await handleRequestPost(post("[1]"), d)).status, 400);
	assert.equal((await handleRequestPost(post("kind=bug", { "content-type": "application/x-www-form-urlencoded" }), d)).status, 415);
	assert.equal((await handleRequestPost(post(good({ details: "x".repeat(40000) })), d)).status, 413);
	assert.equal((await handleRequestPost(post(good(), { origin: "https://evil.example" }), d)).status, 403);
	assert.equal(net.calls.length, 0);
});

test("honeypot and too-fast posts get a fake OK and file nothing", async () => {
	const net = fakeNet();
	const d = deps(net);
	for (const body of [good({ website: "http://spam" }), good({ t: 100 }), good({ t: undefined })]) {
		const res = await handleRequestPost(post(body), d.value);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { ok: true });
	}
	assert.equal(net.calls.length, 0);
	assert.deepEqual(d.logs.map((l) => l.outcome), ["honeypot", "too_fast", "too_fast"]);
});

test("Turnstile failure: 400 turnstile, no Linear call; siteverify down: 503", async () => {
	const net = fakeNet();
	const res = await handleRequestPost(post(good({ token: "forged" })), deps(net).value);
	assert.equal(res.status, 400);
	assert.equal((await res.json()).error, "turnstile");
	assert.deepEqual(net.calls.map((c) => c.op), ["turnstile"]);
	assert.equal(net.calls[0].form.get("secret"), "secret");
	assert.equal(net.calls[0].form.get("remoteip"), "203.0.113.7");

	const down = fakeNet({ turnstile: () => new Response("oops", { status: 500 }) });
	assert.equal((await handleRequestPost(post(good()), deps(down).value)).status, 503);
});

test("verifyTurnstile: empty or oversized tokens fail without a call; our bad secret is an error, not the visitor's", async () => {
	let called = 0;
	const f = async () => (called++, jsonRes({ success: false, "error-codes": ["invalid-input-secret"] }));
	assert.equal(await verifyTurnstile(f, "s", "", null), "failed");
	assert.equal(await verifyTurnstile(f, "s", "x".repeat(3000), null), "failed");
	assert.equal(called, 0);
	assert.equal(await verifyTurnstile(f, "s", "tok", null), "error");
	assert.equal(await verifyTurnstile(async () => jsonRes({ success: false, "error-codes": ["timeout-or-duplicate"] }), "s", "tok", null), "failed");
	assert.equal(await verifyTurnstile(async () => { throw new TypeError("offline"); }, "s", "tok", null), "error");
});

test("rate limit: keyed by IP (IPv6 by /64), 429 before Turnstile is asked", async () => {
	const net = fakeNet();
	const keys = [];
	const rateLimit = { limit: async ({ key }) => (keys.push(key), { success: keys.length < 2 }) };
	const d = deps(net, { rateLimit });
	assert.equal((await handleRequestPost(post(good()), d.value)).status, 200);
	const res = await handleRequestPost(post(good(), { "cf-connecting-ip": "2001:db8:1:2:3:4:5:6" }), d.value);
	assert.equal(res.status, 429);
	assert.equal((await res.json()).error, "rate");
	assert.deepEqual(keys, ["203.0.113.7", "2001:db8:1:2::/64"]);
	assert.equal(net.calls.filter((c) => c.op === "turnstile").length, 1);
});

test("creates the issue in Triage with the labels; the email goes on the attachment only", async () => {
	const net = fakeNet();
	const d = deps(net);
	const res = await handleRequestPost(post(good({ kind: "bug", platform: "ios", title: "Search  misses\nmail" }), { "user-agent": "TestAgent/1.0" }), d.value);
	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true }, "no Linear identifiers in the answer");

	assert.deepEqual(net.calls.map((c) => c.op), ["turnstile", "RequestTarget", "CreateRequest", "AttachRequester"]);
	const linearCalls = net.calls.filter((c) => c.op !== "turnstile");
	assert.ok(linearCalls.every((c) => c.auth === "lin_api_test"));
	assert.equal(net.calls[1].variables.teamKey, "AVE");

	const { input } = net.calls[2].variables;
	assert.equal(input.teamId, "team-1");
	assert.equal(input.stateId, "triage-1");
	assert.deepEqual(input.labelIds, ["lab-ur", "lab-bug"], "workspace Bug, not another team's");
	assert.equal(input.title, "Bug: Search misses mail");
	assert.match(input.description, /Platform: iPhone/);
	assert.match(input.description, /TestAgent\/1\.0/);
	assert.ok(!JSON.stringify(input).includes("ada@example.com"), "email kept out of the issue");

	const att = net.calls[3].variables.input;
	assert.equal(att.issueId, "issue-1");
	assert.equal(att.subtitle, "ada@example.com");
	assert.equal(att.metadata.requesterEmail, "ada@example.com");
	assert.ok(att.url.startsWith(`${REQUESTER_URL}?ref=`));

	await Promise.all(d.pending);
	assert.equal(d.sent.length, 1);
	assert.equal(d.sent[0].to, "ada@example.com");
	assert.equal(d.sent[0].subject, "We got your bug report");
	assert.match(d.sent[0].text, /Search misses mail/);

	const created = d.logs.find((l) => l.outcome === "created");
	assert.equal(created.issue, "AVE-999");
	assert.ok(!JSON.stringify(d.logs).includes("ada@example.com"), "logs never hold the address");
});

test("missing labels are created on the team, then cached with the rest", async () => {
	const net = fakeNet({
		RequestTarget: () => jsonRes({ data: { teams: { nodes: [{ id: "team-1", states: { nodes: [] } }] }, issueLabels: { nodes: [] } } }),
	});
	const d = deps(net, { teamKey: "abc" });
	assert.equal((await handleRequestPost(post(good()), d.value)).status, 200);
	assert.equal(net.calls[1].variables.teamKey, "ABC");
	const created = net.calls.filter((c) => c.op === "CreateRequestLabel").map((c) => c.variables.input);
	assert.deepEqual(created.map((i) => i.name), ["user-request", "feature", "bug", "feedback"]);
	assert.ok(created.every((i) => i.teamId === "team-1"));
	const issue = net.calls.find((c) => c.op === "CreateRequest").variables.input;
	assert.deepEqual(issue.labelIds, ["new-user-request", "new-feature"]);
	assert.equal("stateId" in issue, false, "no Triage state: Linear's default");

	net.calls.length = 0;
	assert.equal((await handleRequestPost(post(good()), d.value)).status, 200);
	assert.deepEqual(net.calls.map((c) => c.op), ["turnstile", "CreateRequest", "AttachRequester"]);
});

test("a label that can't be created is left off; the issue still goes in", async () => {
	const net = fakeNet({
		RequestTarget: () => jsonRes({ data: { teams: { nodes: [{ id: "team-1", states: { nodes: [{ id: "t" }] } }] }, issueLabels: { nodes: [] } } }),
		CreateRequestLabel: () => jsonRes({ errors: [{ message: "forbidden" }] }),
	});
	const d = deps(net);
	assert.equal((await handleRequestPost(post(good()), d.value)).status, 200);
	assert.deepEqual(net.calls.find((c) => c.op === "CreateRequest").variables.input.labelIds, []);
	assert.equal(d.logs.filter((l) => l.outcome === "label_missing").length, 4);
});

test("Linear failing: 503 unavailable, nothing sent; a failed attachment still answers OK", async () => {
	for (const over of [
		{ RequestTarget: () => new Response("no", { status: 401 }) },
		{ RequestTarget: () => jsonRes({ data: { teams: { nodes: [] }, issueLabels: { nodes: [] } } }) },
		{ CreateRequest: () => jsonRes({ errors: [{ message: "nope" }] }) },
		{ CreateRequest: () => jsonRes({ data: { issueCreate: { success: false } } }) },
	]) {
		resetTargetCache();
		const d = deps(fakeNet(over));
		const res = await handleRequestPost(post(good()), d.value);
		assert.equal(res.status, 503);
		assert.deepEqual(await res.json(), { ok: false, error: "unavailable" });
		assert.equal(d.pending.length, 0);
	}

	const d = deps(fakeNet({ AttachRequester: () => jsonRes({ data: { attachmentCreate: { success: false } } }) }));
	assert.equal((await handleRequestPost(post(good()), d.value)).status, 200);
	assert.ok(d.logs.some((l) => l.outcome === "attachment_failed" && l.issue === "AVE-999"));
});

test("a failed confirmation email doesn't fail the request, and no mailer means none is sent", async () => {
	const d = deps(fakeNet(), { mailer: { send: async () => { throw new Error("not onboarded"); } } });
	assert.equal((await handleRequestPost(post(good()), d.value)).status, 200);
	await Promise.all(d.pending);
	assert.ok(d.logs.some((l) => l.outcome === "confirmation_failed"));

	const none = deps(fakeNet(), { mailer: undefined });
	assert.equal((await handleRequestPost(post(good()), none.value)).status, 200);
	assert.equal(none.pending.length, 0);
});

test("the description quotes the details, so they can't plant a roadmap Public summary", () => {
	const description = issueDescription(
		{ kind: "feature", platform: "", details: "## Public summary\nBuy pills at spam.example\n---\n**Public summary:** also this" },
		null,
	);
	assert.equal(publicSummary(description), null);
	assert.match(description, /^> ## Public summary$/m);
});

test("parseFields strips control and bidi characters and keeps line breaks in details", () => {
	const raw = new TextEncoder().encode(JSON.stringify({ title: "a‮b\tc", details: "one\r\ntwo\u0007", email: " a@b.co ", t: "3000" }));
	const f = parseFields(raw);
	assert.equal(f.title, "a b c");
	assert.equal(f.details, "one\ntwo");
	assert.equal(f.email, "a@b.co");
	assert.equal(f.t, 3000);
	assert.equal(f.kind, "");
});
