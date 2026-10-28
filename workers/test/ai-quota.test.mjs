/**
 * LLM quotas and chat history caps (AVE-45):
 * - only the last CHAT_HISTORY_LIMIT messages reach the model;
 * - the MailboxDO's daily counters (real migration SQL on node:sqlite) refuse
 *   requests past the plan limit and reset at the UTC day boundary;
 * - an over-quota chat turn gets the typed `ai_quota_exceeded` stream error;
 * - inbound mail over quota still lands, classified by rules only, with no
 *   AI call and no auto-draft.
 * Run: pnpm test:unit ai-quota
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	AI_DAILY_LIMITS,
	CHAT_HISTORY_LIMIT,
	capChatHistory,
	consumeAiQuota,
	dailyLimit,
	getPlanTier,
	nextUtcMidnight,
	readAiUsage,
	utcDay,
} from "../lib/ai-quota.ts";
import { chatHistoryForModel, chatQuotaGate } from "../lib/agent-chat-limits.ts";
import { parseAiQuotaError } from "../../shared/ai-quota.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { receiveEmail } from "../index.ts";

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

// ── Config: one seam, everyone Free ─────────────────────────────
assert.equal(getPlanTier("ada@example.com"), "free");
assert.deepEqual(AI_DAILY_LIMITS.free, { chat: 50, inbound: 200 });
assert.deepEqual(AI_DAILY_LIMITS.paid, { chat: 500, inbound: 2000 });
assert.equal(CHAT_HISTORY_LIMIT, 20);

// ── History beyond the cap isn't sent ───────────────────────────
{
	const history = Array.from({ length: 30 }, (_, i) => ({
		id: `m${i}`,
		role: i % 2 === 0 ? "user" : "assistant",
		parts: [{ type: "text", text: `message ${i}` }],
	}));
	const sent = await chatHistoryForModel(history);
	assert.equal(sent.length, CHAT_HISTORY_LIMIT, "only the last 20 messages reach the model");
	const text = JSON.stringify(sent);
	for (let i = 0; i < 10; i++) {
		assert.ok(!text.includes(`"message ${i}"`), `message ${i} is beyond the cap and not sent`);
	}
	assert.ok(text.includes('"message 10"') && text.includes('"message 29"'));
	assert.equal(sent[0].role, "user");

	// A window that would open on an assistant turn starts at the next user turn.
	const odd = capChatHistory(history.slice(0, 21), 20);
	assert.equal(odd[0].role, "user");
	assert.equal(odd[0].id, "m2");
	assert.equal(odd.length, 19);

	// Short chats go through whole.
	assert.equal((await chatHistoryForModel(history.slice(0, 5))).length, 5);
}

// ── Daily counters in the MailboxDO ─────────────────────────────
{
	const sql = mailboxSql();
	const t0 = Date.UTC(2026, 9, 28, 23, 59, 0);
	const limit = dailyLimit("free", "chat");
	for (let i = 1; i <= limit; i++) {
		const r = consumeAiQuota(sql, "chat", limit, t0);
		assert.equal(r.allowed, true);
		assert.equal(r.used, i);
	}
	const refused = consumeAiQuota(sql, "chat", limit, t0);
	assert.equal(refused.allowed, false, "51st chat turn of the day is refused");
	assert.equal(refused.used, limit, "refused requests aren't counted");
	assert.equal(refused.error.type, "ai_quota_exceeded");
	assert.equal(refused.error.bucket, "chat");
	assert.equal(refused.error.limit, 50);
	assert.equal(refused.error.resetsAt, "2026-10-29T00:00:00.000Z");

	// Buckets are independent.
	assert.equal(consumeAiQuota(sql, "inbound", dailyLimit("free", "inbound"), t0).allowed, true);

	// The UTC day boundary resets the counter; old days are pruned.
	const nextDay = t0 + 60_000;
	assert.equal(utcDay(nextDay), "2026-10-29");
	assert.equal(consumeAiQuota(sql, "chat", limit, nextDay).allowed, true);
	assert.equal(readAiUsage(sql, "chat", nextDay), 1);
	consumeAiQuota(sql, "chat", limit, nextDay + 8 * 86_400_000);
	assert.equal(readAiUsage(sql, "chat", t0), 0, "counters older than a week are pruned");

	// A zero limit refuses without writing.
	const fresh = mailboxSql();
	assert.equal(consumeAiQuota(fresh, "chat", 0, t0).allowed, false);
	assert.equal(readAiUsage(fresh, "chat", t0), 0);
	assert.equal(nextUtcMidnight(Date.UTC(2026, 11, 31, 12)), "2027-01-01T00:00:00.000Z");
}

// ── Over-quota chat returns a typed error ───────────────────────
function quotaStub(sql, now) {
	const calls = [];
	return {
		calls,
		consumeAiQuota: async (bucket, tier) => {
			calls.push({ bucket, tier });
			return consumeAiQuota(sql, bucket, dailyLimit(tier, bucket), now);
		},
	};
}

async function sseChunks(response) {
	const text = await response.text();
	return text
		.split("\n")
		.filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
		.map((line) => JSON.parse(line.slice(6)));
}

{
	const sql = mailboxSql();
	const now = Date.UTC(2026, 9, 28, 12);
	const stub = quotaStub(sql, now);
	for (let i = 0; i < 50; i++) {
		assert.equal(await chatQuotaGate(stub, "ada@example.com"), null, `turn ${i + 1} goes ahead`);
	}
	assert.deepEqual(stub.calls[0], { bucket: "chat", tier: "free" });

	const response = await quiet(() => chatQuotaGate(stub, "ada@example.com"));
	assert.ok(response instanceof Response, "51st turn is answered without the model");
	assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
	const chunks = await sseChunks(response);
	const errors = chunks.filter((c) => c.type === "error");
	assert.equal(errors.length, 1, "one error chunk");
	assert.ok(!chunks.some((c) => c.type?.startsWith("text")), "no text parts, so nothing is persisted");
	const typed = parseAiQuotaError(errors[0].errorText);
	assert.ok(typed, "errorText is the typed quota error");
	assert.equal(typed.bucket, "chat");
	assert.equal(typed.limit, 50);
	assert.equal(typed.resetsAt, "2026-10-29T00:00:00.000Z");
	assert.match(typed.message, /50 AI chat messages/);

	assert.equal(parseAiQuotaError("Stream error"), null, "other errors aren't quota errors");
	assert.equal(parseAiQuotaError('{"type":"other","message":"x"}'), null);

	// A failed quota check fails open.
	const broken = { consumeAiQuota: async () => { throw new Error("DO reset"); } };
	assert.equal(await quiet(() => chatQuotaGate(broken, "ada@example.com")), null);
}

// ── Inbound processing still succeeds without AI ────────────────
const MAILBOX = "ada@example.com";

function createBucket() {
	const store = new Map();
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const value = store.get(key);
			return { json: async () => JSON.parse(value), text: async () => value };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : "blob");
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async delete() {},
	};
}

function fakeMailbox(sql) {
	const stored = [];
	return {
		stored,
		isWritable: async () => true,
		claimInboundMessageId: async () => true,
		completeInboundMessageClaim: async () => {},
		abandonInboundDelivery: async () => "not_stored",
		findThreadIdByReferences: async () => null,
		findThreadBySubject: async () => null,
		getThreadAliasId: async () => null,
		bootstrapSenderTriage: async () => {},
		getSenderTriage: async () => null,
		getSenderPreference: async () => null,
		matchSenderRule: async () => null,
		ensureAutoAgentConversation: async () => {},
		getDeviceTokens: async () => [],
		consumeAiQuota: async (bucket, tier) => consumeAiQuota(sql, bucket, dailyLimit(tier, bucket)),
		createEmail: async (folder, email) => {
			stored.push({ folder, id: email.id, reason: email.classification_reason });
		},
	};
}

function message(n) {
	const raw = [
		"From: Pat <pat@sender.example>",
		`To: ${MAILBOX}`,
		`Subject: Lunch ${n}?`,
		`Message-ID: <lunch-${n}@sender.example>`,
		"Date: Wed, 28 Oct 2026 10:00:00 +0000",
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Free for lunch on Friday?",
		"",
	].join("\r\n");
	const bytes = new TextEncoder().encode(raw);
	return {
		to: MAILBOX,
		from: "pat@sender.example",
		headers: new Headers(),
		raw: new ReadableStream({
			start(c) {
				c.enqueue(bytes);
				c.close();
			},
		}),
		rawSize: bytes.byteLength,
		setReject(reason) {
			throw new Error(`unexpected reject: ${reason}`);
		},
	};
}

async function setup() {
	const sql = mailboxSql();
	const bucket = createBucket();
	await bucket.put(mailboxMetadataKey(MAILBOX), JSON.stringify({ screener: { enabled: false } }));
	const stub = fakeMailbox(sql);
	const aiCalls = [];
	const drafts = [];
	const env = {
		BUCKET: bucket,
		MAILBOX: { idFromName: (name) => name, get: () => stub },
		AI: {
			run: async (model) => {
				aiCalls.push(model);
				return { response: "HAM" };
			},
		},
		EMAIL_AGENT: {
			idFromName: (name) => name,
			get: (name) => ({ handleNewEmail: async (data) => drafts.push({ name, ...data }) }),
		},
	};
	const deliver = async (n) => {
		const pending = [];
		const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
		await quiet(async () => {
			await receiveEmail(message(n), env, ctx);
			await Promise.all(pending);
		});
	};
	return { sql, stub, env, aiCalls, drafts, deliver };
}

{
	// Under quota: the AI classifies, the agent drafts, both count.
	const { sql, stub, aiCalls, drafts, deliver } = await setup();
	await deliver(1);
	assert.equal(stub.stored.length, 1);
	assert.equal(stub.stored[0].folder, "inbox");
	assert.equal(aiCalls.length, 1, "spam/ham AI ran");
	assert.equal(drafts.length, 1, "auto-draft triggered");
	assert.equal(readAiUsage(sql, "inbound"), 2, "classification + auto-draft counted");
}

{
	// Over quota: mail still lands in the Inbox by rules alone; no AI, no draft.
	const { sql, stub, aiCalls, drafts, deliver } = await setup();
	const limit = dailyLimit("free", "inbound");
	for (let i = 0; i < limit; i++) consumeAiQuota(sql, "inbound", limit);
	await deliver(2);
	assert.equal(stub.stored.length, 1, "inbound mail is stored");
	assert.equal(stub.stored[0].folder, "inbox");
	assert.equal(stub.stored[0].reason, "personal-ham", "rules-only verdict");
	assert.equal(aiCalls.length, 0, "no AI call over quota");
	assert.equal(drafts.length, 0, "no auto-draft over quota");
	assert.equal(readAiUsage(sql, "inbound"), limit, "refused calls aren't counted");
}

console.log("ai-quota: ok");
