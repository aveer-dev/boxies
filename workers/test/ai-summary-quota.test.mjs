/**
 * AVE-215: AI summaries count against the mailbox's daily AI quota.
 * - a model run uses one unit of the chat bucket (real ai_usage table on
 *   node:sqlite); cached, ineligible and too-short results are free;
 * - over the limit the model is not called and the typed error comes back;
 * - concurrent calls that share one run (MailboxDO's in-flight map) use
 *   one unit;
 * - the summary routes answer 429 with the AiQuotaExceededError body;
 * - the web helpers turn that 429 into a calm note and skip the retry.
 * Workers AI is mocked: never call the real binding (it bills the account).
 * Run: pnpm test:unit ai-summary-quota
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { consumeAiQuota, dailyLimit, readAiUsage } from "../lib/ai-quota.ts";
import {
	readSummary,
	resolveSummary,
	shareInflight,
	SummaryQuotaExceededError,
} from "../lib/ai-summary.ts";
import { aiQuotaExceededError } from "../../shared/ai-quota.ts";
import { retrySummaryOnce, summaryQuotaError, summaryQuotaText } from "../../app/lib/summary-quota.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

function sqlStorage(db) {
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings);
		},
	};
}

function mailboxSql() {
	const sql = sqlStorage(new DatabaseSync(":memory:"));
	applyMigrations(sql, mailboxMigrations);
	return sql;
}

const quiet = async (fn) => {
	const saved = { log: console.log, error: console.error, warn: console.warn };
	console.log = console.error = console.warn = () => {};
	try {
		return await fn();
	} finally {
		Object.assign(console, saved);
	}
};

/** Mock Workers AI; `gate` (when set) holds every run until released. */
function mockAi(reply = "Alice asks to move the launch to Friday.") {
	const calls = [];
	return {
		calls,
		gate: null,
		async run(model, input) {
			calls.push({ model, input });
			if (this.gate) await this.gate;
			return { response: reply };
		},
	};
}

const LONG = "We need to talk about the launch plan. ".repeat(20);
const SHORT = "Thanks, sounds good!";
const meta = (id, date) => ({ id, folder_id: "inbox", date, sender: "alice@example.com", sender_name: "Alice", subject: "Launch" });

/** The DO's quota hook: the chat bucket at the free tier (see #consumeSummaryQuota). */
function quotaHook(sql, now) {
	const hook = () => {
		hook.calls++;
		const result = consumeAiQuota(sql, "chat", dailyLimit("free", "chat"), now);
		return result.allowed ? { allowed: true } : { allowed: false, error: result.error };
	};
	hook.calls = 0;
	return hook;
}

const NOW = Date.UTC(2026, 10, 9, 12);
const used = (sql) => readAiUsage(sql, "chat", NOW);

// ── Cached reads are free; generation uses one unit ─────────────
{
	const sql = mailboxSql();
	const ai = mockAi();
	const consumeQuota = quotaHook(sql, NOW);
	const base = {
		sql,
		ai,
		target: { type: "thread", id: "a" },
		threadMessages: [meta("a", "2026-11-01")],
		rejectedSenders: new Set(),
		loadBody: async () => LONG,
		consumeQuota,
	};

	assert.deepEqual(await resolveSummary({ ...base, mode: "cached" }), { status: "missing" });
	assert.equal(used(sql), 0, "a cached-only read with nothing stored is free");

	const first = await resolveSummary({ ...base, mode: "lazy" });
	assert.equal(first.status, "ready");
	assert.equal(first.cached, false);
	assert.equal(ai.calls.length, 1);
	assert.equal(used(sql), 1, "the lazy first generation uses one unit");

	const again = await resolveSummary({ ...base, mode: "lazy" });
	assert.equal(again.cached, true);
	const cached = await resolveSummary({ ...base, mode: "cached" });
	assert.equal(cached.cached, true);
	assert.equal(ai.calls.length, 1);
	assert.equal(used(sql), 1, "cache hits are free");

	await resolveSummary({ ...base, mode: "force" });
	assert.equal(ai.calls.length, 2);
	assert.equal(used(sql), 2, "regenerate uses one unit");

	// Too-short and ineligible mail never reach the model, so they're free.
	const short = await resolveSummary({
		...base,
		target: { type: "thread", id: "s" },
		threadMessages: [meta("s", "2026-11-02")],
		loadBody: async () => SHORT,
		mode: "force",
	});
	assert.deepEqual(short, { status: "not_eligible", reason: "too_short" });
	const spam = await resolveSummary({
		...base,
		threadMessages: [{ ...meta("a", "2026-11-01"), folder_id: "spam" }],
		mode: "force",
	});
	assert.equal(spam.status, "not_eligible");
	assert.equal(used(sql), 2);
	assert.equal(consumeQuota.calls, 2, "the quota is only checked right before a model run");

	// A failed quota check (null) fails open: the model still runs.
	await resolveSummary({ ...base, consumeQuota: () => null, mode: "force" });
	assert.equal(ai.calls.length, 3);
}

// ── Over the limit: typed error, no model call, nothing stored ──
{
	const sql = mailboxSql();
	const limit = dailyLimit("free", "chat");
	for (let i = 0; i < limit; i++) consumeAiQuota(sql, "chat", limit, NOW);
	const ai = mockAi();
	const base = {
		sql,
		ai,
		target: { type: "thread", id: "a" },
		threadMessages: [meta("a", "2026-11-01")],
		rejectedSenders: new Set(),
		loadBody: async () => LONG,
		consumeQuota: quotaHook(sql, NOW),
	};
	for (const mode of ["lazy", "force"]) {
		await assert.rejects(resolveSummary({ ...base, mode }), (e) => {
			assert.ok(e instanceof SummaryQuotaExceededError, `${mode}: quota error`);
			assert.equal(e.quota.type, "ai_quota_exceeded");
			assert.equal(e.quota.bucket, "chat");
			assert.equal(e.quota.limit, limit);
			assert.equal(e.quota.resetsAt, "2026-11-10T00:00:00.000Z");
			assert.match(e.quota.message, /AI chat messages and summaries/);
			return true;
		});
	}
	assert.equal(ai.calls.length, 0, "the model is never called over the limit");
	assert.equal(readSummary(sql, "thread", "a"), null, "nothing stored");
	assert.equal(used(sql), limit, "refused requests aren't counted");

	// A summary stored before the limit is still served from cache.
	const fresh = mailboxSql();
	const ok = { ...base, sql: fresh, consumeQuota: quotaHook(fresh, NOW) };
	await resolveSummary({ ...ok, mode: "lazy" });
	for (let i = 1; i < limit; i++) consumeAiQuota(fresh, "chat", limit, NOW);
	const cached = await resolveSummary({ ...ok, mode: "lazy" });
	assert.equal(cached.status, "ready");
	assert.equal(cached.cached, true, "cached reads still work at the limit");
}

// ── Concurrent calls share one run and one unit ─────────────────
{
	const sql = mailboxSql();
	const ai = mockAi();
	let release;
	ai.gate = new Promise((resolve) => {
		release = resolve;
	});
	const consumeQuota = quotaHook(sql, NOW);
	const base = {
		sql,
		ai,
		target: { type: "thread", id: "a" },
		threadMessages: [meta("a", "2026-11-01")],
		rejectedSenders: new Set(),
		loadBody: async () => LONG,
		consumeQuota,
	};
	const inflight = new Map();
	const call = (mode) => shareInflight(inflight, "thread:a", () => resolveSummary({ ...base, mode }));
	const runs = [call("force"), call("force"), call("lazy")];
	assert.equal(inflight.size, 1);
	await new Promise((resolve) => setTimeout(resolve, 0));
	release();
	const results = await Promise.all(runs);
	assert.ok(results.every((r) => r === results[0]), "every caller gets the shared result");
	assert.equal(ai.calls.length, 1, "the model runs once");
	assert.equal(consumeQuota.calls, 1);
	assert.equal(used(sql), 1, "one unit for the shared run");
	assert.equal(inflight.size, 0, "the entry is dropped once settled");

	ai.gate = null;
	await call("force");
	assert.equal(used(sql), 2, "a later call is a new run");
}

// ── Routes: 429 with the typed error; the plan tier reaches the DO ──
{
	const quota = aiQuotaExceededError("chat", 50, "2026-11-10T00:00:00.000Z");
	const calls = [];
	const mailboxes = mockMailboxNamespace({
		getThreadSummary: async (...args) => {
			calls.push(["thread", ...args]);
			return { status: "quota_exceeded", error: quota };
		},
		getEmailSummary: async (...args) => {
			calls.push(["email", ...args]);
			return args[1] === "cached" ? { status: "missing" } : { status: "quota_exceeded", error: quota };
		},
	});
	const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mailboxes });
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
	await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
	const base = "/api/v1/mailboxes/ada@inboxies.email";
	const send = (method, path, body) =>
		request(env, { method, path: `${base}${path}`, principal: principalFor(ada), ...(body ? { body } : {}) });

	for (const [method, path, body] of [
		["GET", "/threads/t1/summary"],
		["POST", "/threads/t1/summary/regenerate"],
		["POST", "/emails/e1/summary/generate", {}],
		["POST", "/emails/e1/summary/generate", { regenerate: true }],
	]) {
		const res = await quiet(() => send(method, path, body));
		assert.equal(res.status, 429, `${method} ${path} → 429`);
		assert.equal(res.payload.type, "ai_quota_exceeded");
		assert.equal(res.payload.bucket, "chat");
		assert.equal(res.payload.limit, 50);
		assert.equal(res.payload.resetsAt, quota.resetsAt);
		assert.equal(res.payload.error, quota.message, "`error` carries the message for generic clients");
	}
	assert.deepEqual(calls, [
		["thread", "t1", "lazy", "free"],
		["thread", "t1", "force", "free"],
		["email", "e1", "lazy", "free"],
		["email", "e1", "force", "free"],
	]);

	// The cached quick-summary read never generates, so it never hits the quota.
	const cachedRead = await send("GET", "/emails/e1/summary");
	assert.equal(cachedRead.status, 200);
	assert.deepEqual(cachedRead.payload, { status: "missing" });
}

// ── Web: a 429 becomes a calm note and isn't retried ────────────
{
	const quota = aiQuotaExceededError("chat", 50, "2026-11-10T00:00:00.000Z");
	const apiError = { status: 429, body: { ...quota, error: quota.message } };
	assert.deepEqual(summaryQuotaError(apiError), apiError.body);
	assert.equal(summaryQuotaError({ status: 502, body: { error: "Couldn't generate a summary. Try again." } }), null);
	assert.equal(summaryQuotaError({ status: 429, body: { error: "Too many requests" } }), null, "a plain rate limit isn't the AI quota");
	assert.equal(summaryQuotaError(new Error("network")), null);
	assert.equal(summaryQuotaError(null), null);

	assert.equal(summaryQuotaText(quota, Date.UTC(2026, 10, 9, 18)), "Daily AI limit reached. Resets in 6h.");

	assert.equal(retrySummaryOnce(0, { status: 502, body: {} }), true, "one retry for a model failure");
	assert.equal(retrySummaryOnce(1, { status: 502, body: {} }), false);
	assert.equal(retrySummaryOnce(0, apiError), false, "no retry at the quota limit");
}

console.log("ai-summary-quota: ok");
