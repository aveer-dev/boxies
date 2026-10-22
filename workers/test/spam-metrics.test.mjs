/**
 * Spam metrics (AVE-100): feedback events on moves, daily counters, inbound
 * counts from the real MailboxDO schema (node:sqlite), rates, merging across
 * mailboxes and the ops dashboard HTML.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/spam-metrics.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { MailboxDO } from "../durableObject/index.ts";
import {
	applyFeedbackEvent,
	feedbackDayKey,
	feedbackPruneBeforeKey,
	feedbackWindowKeys,
	inboundSpamCounts,
	mergeFeedbackCounts,
	mergeMailboxSpamCounts,
	renderSpamMetricsHtml,
	senderRuleCounts,
	spamFeedbackForMove,
	summarizeSpamMetrics,
	summarizeSpamWindow,
	windowSinceIso,
} from "../lib/spam-metrics.ts";

const allowedAt = (updated_at) => ({ status: "allowed", updated_at });

// ── Feedback events ─────────────────────────────────────────────
{
	// Not spam: out of Spam into a box.
	assert.deepEqual(
		spamFeedbackForMove({
			fromFolderId: "spam",
			toFolderId: "inbox",
			reason: "ai-spam",
			receivedAt: "2026-10-20T10:00:00.000Z",
			senderTriage: null,
		}),
		{ kind: "not_spam", reason: "ai-spam", repeatForAllowedSender: false },
	);
	// Repeat rescue: the sender was allowed before the message arrived.
	assert.deepEqual(
		spamFeedbackForMove({
			fromFolderId: "spam",
			toFolderId: "promotions",
			reason: "spam-headers",
			receivedAt: "2026-10-20T10:00:00.000Z",
			senderTriage: allowedAt("2026-10-01T00:00:00.000Z"),
		}),
		{ kind: "not_spam", reason: "spam-headers", repeatForAllowedSender: true },
	);
	// Allowed after it arrived (e.g. rescuing older mail) is not a repeat.
	assert.equal(
		spamFeedbackForMove({
			fromFolderId: "spam",
			toFolderId: "inbox",
			reason: "ai-spam",
			receivedAt: "2026-10-01T00:00:00.000Z",
			senderTriage: allowedAt("2026-10-20T00:00:00.000Z"),
		}).repeatForAllowedSender,
		false,
	);
	// A rejected sender is never a repeat.
	assert.equal(
		spamFeedbackForMove({
			fromFolderId: "spam",
			toFolderId: "inbox",
			reason: "sender-rejected",
			receivedAt: "2026-10-20T00:00:00.000Z",
			senderTriage: { status: "rejected", updated_at: "2026-10-01T00:00:00.000Z" },
		}).repeatForAllowedSender,
		false,
	);
	// Report spam: into Spam from a box; Inbox is split out. Legacy rows → unknown.
	assert.deepEqual(
		spamFeedbackForMove({ fromFolderId: "inbox", toFolderId: "spam", reason: "ai-ham", receivedAt: null, senderTriage: null }),
		{ kind: "report_spam", reason: "ai-ham", fromInbox: true },
	);
	assert.deepEqual(
		spamFeedbackForMove({ fromFolderId: "updates", toFolderId: "spam", reason: null, receivedAt: null, senderTriage: null }),
		{ kind: "report_spam", reason: "unknown", fromInbox: false },
	);
	// Not feedback: Spam → Trash, Trash → Spam, Screener moves, same folder, box → box.
	for (const [from, to] of [
		["spam", "trash"],
		["trash", "spam"],
		["spam", "screened_out"],
		["screened_out", "spam"],
		["screener", "spam"],
		["spam", "spam"],
		["inbox", "archive"],
		["sent", "spam"],
	]) {
		assert.equal(
			spamFeedbackForMove({ fromFolderId: from, toFolderId: to, reason: "ai-spam", receivedAt: null, senderTriage: null }),
			null,
			`${from} → ${to}`,
		);
	}
}

// ── Daily counters ──────────────────────────────────────────────
{
	let day = applyFeedbackEvent(null, { kind: "not_spam", reason: "ai-spam", repeatForAllowedSender: true });
	day = applyFeedbackEvent(day, { kind: "not_spam", reason: "ai-spam", repeatForAllowedSender: false });
	day = applyFeedbackEvent(day, { kind: "report_spam", reason: "ai-ham", fromInbox: true });
	day = applyFeedbackEvent(day, { kind: "report_spam", reason: "bulk-list-headers", fromInbox: false });
	assert.deepEqual(day, {
		notSpam: { "ai-spam": 2 },
		repeatRescues: { "ai-spam": 1 },
		reportSpamInbox: { "ai-ham": 1 },
		reportSpamOther: { "bulk-list-headers": 1 },
	});
	const merged = mergeFeedbackCounts([day, undefined, day]);
	assert.equal(merged.notSpam["ai-spam"], 4);
	assert.equal(day.notSpam["ai-spam"], 2, "merge doesn't mutate");

	const now = Date.parse("2026-10-22T15:00:00.000Z");
	assert.equal(feedbackDayKey(now), "spam_metrics:day:2026-10-22");
	const week = feedbackWindowKeys(now, 7);
	assert.equal(week.length, 7);
	assert.equal(week[6], "spam_metrics:day:2026-10-16");
	assert.equal(windowSinceIso(now, 7), "2026-10-16T00:00:00.000Z");
	assert.equal(windowSinceIso(now, 30), "2026-09-23T00:00:00.000Z");
	// Pruning keeps the 30-day window (and a margin).
	const prune = feedbackPruneBeforeKey(now);
	for (const key of feedbackWindowKeys(now, 30)) assert.ok(key >= prune, key);
}

// ── Inbound counts from the MailboxDO schema ────────────────────
function mailboxSql() {
	const db = new DatabaseSync(":memory:");
	const sql = {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings);
		},
	};
	applyMigrations(sql, mailboxMigrations);
	for (const id of ["inbox", "spam", "promotions", "screened_out"]) {
		sql.exec(`INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES (?, ?, 0)`, id, id);
	}
	return sql;
}

{
	const sql = mailboxSql();
	let n = 0;
	const add = (folder, sender, date, reason, tier) =>
		sql.exec(
			`INSERT INTO emails (id, folder_id, subject, sender, date, classification_reason, auth_tier) VALUES (?, ?, 's', ?, ?, ?, ?)`,
			`e${n++}`,
			folder,
			sender,
			date,
			reason,
			tier,
		);
	const recent = "2026-10-21T00:00:00.000Z";
	const older = "2026-10-01T00:00:00.000Z";
	add("inbox", "friend@ok.com", recent, "personal-ham", "verified");
	add("inbox", "Friend@OK.com", recent, "ai-spam-overridden", "unverified");
	add("spam", "bad@spam.com", recent, "ai-spam", "unverified");
	add("spam", "forged@bank.com", recent, "auth-failed", "failed");
	add("screened_out", "blocked@x.com", recent, "sender-rejected", "verified");
	add("promotions", "news@list.com", older, "bulk-list-headers", "verified");
	add("inbox", "mailer-daemon@x.com", recent, "delivery-report", null); // not counted
	add("inbox", "legacy@x.com", recent, null, null); // pre-37: not counted
	add("sent", "me@inboxies.email", recent, null, null); // outbound: not counted

	sql.exec(
		`INSERT INTO sender_triage (sender, status, decided_at, updated_at) VALUES
		 ('friend@ok.com', 'allowed', 't', 't'), ('news@list.com', 'allowed', 't', 't'), ('blocked@x.com', 'rejected', 't', 't')`,
	);
	sql.exec(
		`INSERT INTO sender_preferences (address, folder_id, source, updated_at) VALUES ('friend@ok.com', 'inbox', 'user', 't'), ('news@list.com', 'promotions', 'screener', 't')`,
	);

	const week = inboundSpamCounts(sql, "2026-10-16T00:00:00.000Z");
	assert.deepEqual(week.byReason, {
		"personal-ham": 1,
		"ai-spam-overridden": 1,
		"ai-spam": 1,
		"auth-failed": 1,
		"sender-rejected": 1,
	});
	assert.deepEqual(week.byAuthTier, { verified: 2, unverified: 2, failed: 1 });
	assert.equal(week.allowMatches, 2, "both friend@ok.com messages, case-insensitive");
	const month = inboundSpamCounts(sql, "2026-09-23T00:00:00.000Z");
	assert.equal(month.byReason["bulk-list-headers"], 1);
	assert.equal(month.allowMatches, 3);

	assert.deepEqual(senderRuleCounts(sql), { allowed: 2, explicitAllowed: 1, rejected: 1 });

	// ── Rates ──
	const feedback = mergeFeedbackCounts([
		applyFeedbackEvent(
			applyFeedbackEvent(null, { kind: "not_spam", reason: "ai-spam", repeatForAllowedSender: true }),
			{ kind: "report_spam", reason: "personal-ham", fromInbox: true },
		),
	]);
	const summary = summarizeSpamWindow({ days: 7, since: "2026-10-16T00:00:00.000Z", inbound: week, feedback });
	assert.equal(summary.inbound.total, 5);
	assert.deepEqual(summary.inbound.unverified, { count: 2, rate: 0.4 });
	assert.deepEqual(summary.spam.count, 3);
	assert.equal(summary.spam.rate, 0.6);
	assert.deepEqual(summary.spam.byReason["auth-failed"], { count: 1, rate: 0.2 });
	assert.ok(!("personal-ham" in summary.spam.byReason));
	assert.deepEqual(summary.notSpam.byReason["ai-spam"], { count: 1, rate: 1 });
	assert.equal(summary.notSpam.rate, 0.3333);
	assert.equal(summary.reportSpam.count, 1);
	assert.equal(summary.reportSpam.rate, 0.5, "1 report over 2 non-spam");
	assert.deepEqual(summary.repeatRescues, { count: 1, byReason: { "ai-spam": 1 } });
	assert.deepEqual(summary.ruleMatches, { allow: 2, block: 1, aiSpamOverridden: 1 });

	// Empty mailbox: rates are null, not NaN.
	const empty = summarizeSpamWindow({
		days: 30,
		since: "x",
		inbound: { byReason: {}, byAuthTier: {}, allowMatches: 0 },
		feedback: mergeFeedbackCounts([]),
	});
	assert.equal(empty.spam.rate, null);
	assert.equal(empty.notSpam.rate, null);
	assert.equal(empty.inbound.unverified.rate, null);

	// ── Merge across mailboxes ──
	const one = {
		generatedAt: "g",
		rules: { allowed: 2, explicitAllowed: 1, rejected: 1 },
		windows: [
			{ days: 7, since: "2026-10-16T00:00:00.000Z", inbound: week, feedback },
			{ days: 30, since: "2026-09-23T00:00:00.000Z", inbound: month, feedback },
		],
	};
	const total = mergeMailboxSpamCounts([one, one], "now");
	assert.deepEqual(total.rules, { allowed: 4, explicitAllowed: 2, rejected: 2 });
	assert.deepEqual(total.windows.map((w) => w.days), [7, 30]);
	assert.equal(total.windows[0].inbound.byReason["ai-spam"], 2);
	assert.equal(total.windows[0].inbound.allowMatches, 4);
	assert.equal(total.windows[0].feedback.repeatRescues["ai-spam"], 2);
	assert.equal(summarizeSpamMetrics(total).windows[0].spam.rate, 0.6, "rates recomputed from summed counts");

	// ── Dashboard HTML ──
	const html = renderSpamMetricsHtml({
		generatedAt: "now",
		filter: { domain: "<script>x</script>", mailbox: null },
		mailboxCount: 1,
		truncated: false,
		failed: [],
		total: summarizeSpamMetrics(total),
		mailboxes: [{ id: "ada@acme.com", metrics: summarizeSpamMetrics(one) }],
	});
	assert.ok(html.includes("Last 7 days") && html.includes("Last 30 days"));
	for (const label of [
		"Spam rate",
		"Not spam rate",
		"Report spam on Inbox mail",
		"Unverified share of inbound",
		"Repeat rescues, allowed senders",
		"Allow-rule matches",
		"Block-rule matches",
		"Sender rules",
	]) {
		assert.ok(html.includes(label), label);
	}
	assert.ok(!html.includes("<script>x"), "filter is escaped");
	assert.ok(html.includes("&lt;script&gt;"));
	assert.ok(html.includes("ada@acme.com"));
}

// ── MailboxDO: moves record feedback; counts come back per window ──
{
	const db = new DatabaseSync(":memory:");
	const sql = {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			const statement = db.prepare(query);
			const rows =
				/^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /RETURNING/i.test(query)
					? statement.all(...bindings)
					: (statement.run(...bindings), []);
			// Enough of a SqlStorageCursor for drizzle's durable-sqlite driver.
			return Object.assign(rows, {
				toArray: () => rows,
				raw: () => ({ toArray: () => rows.map((r) => Object.values(r)) }),
			});
		},
		get databaseSize() {
			return 0;
		},
	};
	const kv = new Map();
	const storage = {
		sql,
		getAlarm: async () => null,
		setAlarm: async () => {},
		transactionSync: (fn) => fn(),
		get: async (key) => (Array.isArray(key) ? new Map(key.filter((k) => kv.has(k)).map((k) => [k, kv.get(k)])) : kv.get(key)),
		put: async (key, value) => void kv.set(key, structuredClone(value)),
		delete: async (keys) => {
			for (const k of [keys].flat()) kv.delete(k);
		},
		list: async ({ prefix = "", end } = {}) =>
			new Map([...kv].filter(([k]) => k.startsWith(prefix) && (end === undefined || k < end)).sort()),
	};
	const mailbox = new MailboxDO({ storage, id: { toString: () => "test" } }, {});
	for (const id of ["inbox", "spam", "trash", "promotions"]) {
		sql.exec(`INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES (?, ?, 0)`, id, id);
	}
	const now = Date.now();
	const iso = (msAgo) => new Date(now - msAgo).toISOString();
	const DAY = 24 * 60 * 60 * 1000;
	const insert = db.prepare(
		`INSERT INTO emails (id, folder_id, subject, sender, date, classification_reason, auth_tier) VALUES (?, ?, 's', ?, ?, ?, ?)`,
	);
	insert.run("a", "spam", "pal@ok.com", iso(60_000), "ai-spam", "unverified");
	insert.run("b", "spam", "new@ok.com", iso(60_000), "spam-headers", "verified");
	insert.run("c", "inbox", "promo@ads.com", iso(60_000), "ai-ham", "verified");
	insert.run("d", "spam", "junk@x.com", iso(60_000), "ai-spam", "unverified");
	insert.run("old", "inbox", "x@y.com", iso(20 * DAY), "personal-ham", "verified");
	sql.exec(
		`INSERT INTO sender_triage (sender, status, decided_at, updated_at) VALUES ('pal@ok.com', 'allowed', ?, ?)`,
		iso(5 * DAY),
		iso(5 * DAY),
	);
	// A stale day record past retention is pruned on the first write of a day.
	kv.set("spam_metrics:day:2000-01-01", { notSpam: { x: 9 }, repeatRescues: {}, reportSpamInbox: {}, reportSpamOther: {} });

	assert.equal(await mailbox.moveEmail("a", "inbox"), true); // repeat rescue (allowed 5 days ago)
	assert.equal(await mailbox.moveEmail("b", "inbox"), true); // first rescue
	assert.equal(await mailbox.moveEmail("c", "spam"), true); // report spam on Inbox mail
	assert.equal(await mailbox.moveEmail("d", "trash"), true); // not feedback
	assert.equal(kv.has("spam_metrics:day:2000-01-01"), false);
	const today = kv.get(feedbackDayKey(now));
	assert.deepEqual(today, {
		notSpam: { "ai-spam": 1, "spam-headers": 1 },
		repeatRescues: { "ai-spam": 1 },
		reportSpamInbox: { "ai-ham": 1 },
		reportSpamOther: {},
	});

	const counts = await mailbox.getSpamMetricsCounts();
	assert.deepEqual(counts.windows.map((w) => w.days), [7, 30]);
	assert.deepEqual(counts.rules, { allowed: 1, explicitAllowed: 0, rejected: 0 });
	const [w7, w30] = summarizeSpamMetrics(counts).windows;
	assert.equal(w7.inbound.total, 4);
	assert.equal(w30.inbound.total, 5);
	assert.equal(w7.spam.count, 3, "spam by stored reason, wherever it is now");
	assert.equal(w7.notSpam.count, 2);
	assert.equal(w7.repeatRescues.count, 1);
	assert.equal(w7.reportSpam.count, 1);
	assert.equal(w7.ruleMatches.allow, 1);
	assert.equal(w7.inbound.unverified.count, 2);
	// JSON-safe for the DO RPC boundary.
	assert.deepEqual(JSON.parse(JSON.stringify(counts)), counts);
}

console.log("spam-metrics: ok");
