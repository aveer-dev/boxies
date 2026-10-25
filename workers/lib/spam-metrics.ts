// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Spam metrics per mailbox (AVE-100, docs/spam-management-plan.md §8).
 *
 * Content-free: only counts, keyed by reason code, auth tier and day. No
 * subject, body or sender is stored or returned.
 *
 * Two sources:
 * - **Inbound mail** (computed on read from `emails`): spam rate by
 *   `classification_reason`, `auth_tier` share, and allow/block rule matches.
 *   Windowed by receive time (`emails.date`); rows from before migration 37
 *   have no reason and are left out.
 * - **Feedback** (logged on move, in Durable Object storage as one counter
 *   record per UTC day): Not spam (moves out of Spam) by the message's
 *   stored reason, Report spam (moves into Spam) split by Inbox / other box,
 *   and repeat rescues — Not spam on a message that arrived after its sender
 *   was already allowed. Target: zero.
 *
 * Rule counts are a snapshot of `sender_triage` (allowed / rejected) and
 * explicit allows (allowed + a user-picked purpose box). When `sender_rules`
 * lands (AVE-96) these should read it instead.
 */

import { Folders } from "../../shared/folders.ts";
import { ClassificationReasons } from "../../shared/spam-reason.ts";

type Sql = Pick<SqlStorage, "exec">;

export const SPAM_METRICS_KEY_PREFIX = "spam_metrics:day:";
/** Daily feedback records older than this are pruned on write. */
export const SPAM_METRICS_RETENTION_DAYS = 35;
export const SPAM_METRICS_WINDOW_DAYS = [7, 30] as const;
export type SpamMetricsWindowDays = (typeof SPAM_METRICS_WINDOW_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN = "unknown";

/** Reasons that file inbound mail into Spam (or Screened out for rejected senders). */
export const SPAM_REASONS: ReadonlySet<string> = new Set([
	ClassificationReasons.AUTH_FAILED,
	ClassificationReasons.SPAM_HEADERS,
	ClassificationReasons.AI_SPAM,
	ClassificationReasons.SENDER_REJECTED,
]);

/** Folders that aren't "a box the user reads mail in" for feedback purposes. */
const NON_BOX_FOLDERS: ReadonlySet<string> = new Set([
	Folders.SPAM,
	Folders.TRASH,
	Folders.SENT,
	Folders.DRAFT,
	Folders.SCREENER,
	Folders.SCREENED_OUT,
]);

// ── Feedback events (logged on move) ─────────────────────────────

export type SpamFeedbackEvent =
	| { kind: "not_spam"; reason: string; repeatForAllowedSender: boolean }
	| { kind: "report_spam"; reason: string; fromInbox: boolean };

/**
 * The feedback a move records, or null. `senderTriage` is the sender's
 * Screener row *before* the move (the move route writes the lesson after).
 * A rescue is a repeat when the sender was already allowed before this
 * message arrived: the allow should have kept it out of Spam.
 */
export function spamFeedbackForMove(input: {
	fromFolderId: string | null | undefined;
	toFolderId: string;
	reason: string | null | undefined;
	receivedAt: string | null | undefined;
	senderTriage: { status: string; updated_at: string } | null | undefined;
}): SpamFeedbackEvent | null {
	const from = input.fromFolderId ?? "";
	const to = input.toFolderId;
	if (from === to) return null;
	const reason = input.reason?.trim() || UNKNOWN;
	if (from === Folders.SPAM && !NON_BOX_FOLDERS.has(to)) {
		const triage = input.senderTriage;
		const repeatForAllowedSender = Boolean(
			triage?.status === "allowed" &&
				input.receivedAt &&
				triage.updated_at &&
				triage.updated_at < input.receivedAt,
		);
		return { kind: "not_spam", reason, repeatForAllowedSender };
	}
	if (to === Folders.SPAM && from && !NON_BOX_FOLDERS.has(from)) {
		return { kind: "report_spam", reason, fromInbox: from === Folders.INBOX };
	}
	return null;
}

export interface SpamFeedbackCounts {
	notSpam: Record<string, number>;
	repeatRescues: Record<string, number>;
	reportSpamInbox: Record<string, number>;
	reportSpamOther: Record<string, number>;
}

export function emptyFeedbackCounts(): SpamFeedbackCounts {
	return { notSpam: {}, repeatRescues: {}, reportSpamInbox: {}, reportSpamOther: {} };
}

function bump(record: Record<string, number>, key: string, by = 1) {
	record[key] = (record[key] ?? 0) + by;
}

function addRecord(into: Record<string, number>, from: Record<string, number> | undefined) {
	for (const [key, n] of Object.entries(from ?? {})) {
		if (typeof n === "number" && Number.isFinite(n)) bump(into, key, n);
	}
}

/** A copy of `day` with `event` counted. */
export function applyFeedbackEvent(
	day: SpamFeedbackCounts | null | undefined,
	event: SpamFeedbackEvent,
): SpamFeedbackCounts {
	const next = mergeFeedbackCounts([day]);
	if (event.kind === "not_spam") {
		bump(next.notSpam, event.reason);
		if (event.repeatForAllowedSender) bump(next.repeatRescues, event.reason);
	} else {
		bump(event.fromInbox ? next.reportSpamInbox : next.reportSpamOther, event.reason);
	}
	return next;
}

export function mergeFeedbackCounts(
	days: ReadonlyArray<SpamFeedbackCounts | null | undefined>,
): SpamFeedbackCounts {
	const out = emptyFeedbackCounts();
	for (const day of days) {
		if (!day) continue;
		addRecord(out.notSpam, day.notSpam);
		addRecord(out.repeatRescues, day.repeatRescues);
		addRecord(out.reportSpamInbox, day.reportSpamInbox);
		addRecord(out.reportSpamOther, day.reportSpamOther);
	}
	return out;
}

/** Storage key for the UTC day containing `nowMs`. */
export function feedbackDayKey(nowMs: number): string {
	return SPAM_METRICS_KEY_PREFIX + new Date(nowMs).toISOString().slice(0, 10);
}

/** Keys for the last `days` UTC days, today included. */
export function feedbackWindowKeys(nowMs: number, days: number): string[] {
	return Array.from({ length: days }, (_, i) => feedbackDayKey(nowMs - i * DAY_MS));
}

/** Records strictly before this key are pruned. */
export function feedbackPruneBeforeKey(nowMs: number): string {
	return feedbackDayKey(nowMs - (SPAM_METRICS_RETENTION_DAYS - 1) * DAY_MS);
}

/** Start (ISO) of a `days`-day window ending now; matches `feedbackWindowKeys`. */
export function windowSinceIso(nowMs: number, days: number): string {
	const startOfToday = Date.parse(new Date(nowMs).toISOString().slice(0, 10) + "T00:00:00.000Z");
	return new Date(startOfToday - (days - 1) * DAY_MS).toISOString();
}

// ── Inbound counts (computed from emails) ─────────────────────────

export interface SpamInboundCounts {
	byReason: Record<string, number>;
	byAuthTier: Record<string, number>;
	/** Inbound from senders currently allowed in Screener. */
	allowMatches: number;
}

export interface SpamWindowCounts {
	days: number;
	since: string;
	inbound: SpamInboundCounts;
	feedback: SpamFeedbackCounts;
}

export interface SpamRuleCounts {
	allowed: number;
	/** Allowed with a user-picked purpose box (explicit allow, §5). */
	explicitAllowed: number;
	rejected: number;
}

/** What one mailbox reports; summed across mailboxes by the ops route. */
export interface MailboxSpamCounts {
	generatedAt: string;
	rules: SpamRuleCounts;
	windows: SpamWindowCounts[];
}

/** Inbound mail received at or after `sinceIso`, grouped by reason and tier. */
export function inboundSpamCounts(sql: Sql, sinceIso: string): SpamInboundCounts {
	const byReason: Record<string, number> = {};
	const byAuthTier: Record<string, number> = {};
	const rows = sql.exec(
		`SELECT classification_reason AS reason, COALESCE(auth_tier, '${UNKNOWN}') AS tier, COUNT(*) AS n
		   FROM emails
		  WHERE classification_reason IS NOT NULL
		    AND classification_reason != ?
		    AND date >= ?
		  GROUP BY classification_reason, COALESCE(auth_tier, '${UNKNOWN}')`,
		ClassificationReasons.DELIVERY_REPORT,
		sinceIso,
	) as Iterable<{ reason: string; tier: string; n: number }>;
	for (const row of rows) {
		bump(byReason, String(row.reason), Number(row.n));
		bump(byAuthTier, String(row.tier), Number(row.n));
	}
	const [match] = [
		...(sql.exec(
			`SELECT COUNT(*) AS n
			   FROM emails e
			   JOIN sender_triage t ON t.sender = lower(trim(e.sender))
			  WHERE e.classification_reason IS NOT NULL
			    AND e.classification_reason != ?
			    AND e.date >= ?
			    AND t.status = 'allowed'`,
			ClassificationReasons.DELIVERY_REPORT,
			sinceIso,
		) as Iterable<{ n: number }>),
	];
	return { byReason, byAuthTier, allowMatches: Number(match?.n ?? 0) };
}

export function senderRuleCounts(sql: Sql): SpamRuleCounts {
	const counts: SpamRuleCounts = { allowed: 0, explicitAllowed: 0, rejected: 0 };
	for (const row of sql.exec(
		`SELECT status, COUNT(*) AS n FROM sender_triage GROUP BY status`,
	) as Iterable<{ status: string; n: number }>) {
		if (row.status === "allowed") counts.allowed = Number(row.n);
		else if (row.status === "rejected") counts.rejected = Number(row.n);
	}
	const [explicit] = [
		...(sql.exec(
			`SELECT COUNT(*) AS n
			   FROM sender_triage t
			   JOIN sender_preferences p ON p.address = t.sender
			  WHERE t.status = 'allowed' AND p.source = 'user'`,
		) as Iterable<{ n: number }>),
	];
	counts.explicitAllowed = Number(explicit?.n ?? 0);
	return counts;
}

/** Sum mailbox reports (windows are matched by `days`). */
export function mergeMailboxSpamCounts(
	reports: ReadonlyArray<MailboxSpamCounts>,
	generatedAt: string,
): MailboxSpamCounts {
	const rules: SpamRuleCounts = { allowed: 0, explicitAllowed: 0, rejected: 0 };
	const windows = new Map<number, SpamWindowCounts>();
	for (const report of reports) {
		rules.allowed += report.rules.allowed;
		rules.explicitAllowed += report.rules.explicitAllowed;
		rules.rejected += report.rules.rejected;
		for (const w of report.windows) {
			const acc = windows.get(w.days) ?? {
				days: w.days,
				since: w.since,
				inbound: { byReason: {}, byAuthTier: {}, allowMatches: 0 },
				feedback: emptyFeedbackCounts(),
			};
			addRecord(acc.inbound.byReason, w.inbound.byReason);
			addRecord(acc.inbound.byAuthTier, w.inbound.byAuthTier);
			acc.inbound.allowMatches += w.inbound.allowMatches;
			acc.feedback = mergeFeedbackCounts([acc.feedback, w.feedback]);
			if (w.since < acc.since) acc.since = w.since;
			windows.set(w.days, acc);
		}
	}
	return {
		generatedAt,
		rules,
		windows: [...windows.values()].sort((a, b) => a.days - b.days),
	};
}

// ── Summary (rates) ───────────────────────────────────────────────

export interface CountRate {
	count: number;
	/** null when the denominator is zero. */
	rate: number | null;
}

export interface SpamWindowSummary {
	days: number;
	since: string;
	inbound: { total: number; byAuthTier: Record<string, number>; unverified: CountRate };
	spam: CountRate & { byReason: Record<string, CountRate> };
	/** False positives: Not spam over spam, overall and per reason (target < 1%). */
	notSpam: CountRate & { byReason: Record<string, CountRate> };
	/** False negatives: Report spam on Inbox mail over non-spam inbound. */
	reportSpam: CountRate & { otherBoxes: number; byReason: Record<string, number> };
	/** Not spam for a sender allowed before the message arrived (target: zero). */
	repeatRescues: { count: number; byReason: Record<string, number> };
	ruleMatches: { allow: number; block: number; aiSpamOverridden: number };
}

export interface SpamMetricsSummary {
	generatedAt: string;
	rules: SpamRuleCounts;
	windows: SpamWindowSummary[];
}

function rate(count: number, total: number): number | null {
	return total > 0 ? Math.round((count / total) * 10_000) / 10_000 : null;
}

function sum(record: Record<string, number>): number {
	return Object.values(record).reduce((a, b) => a + b, 0);
}

export function summarizeSpamWindow(w: SpamWindowCounts): SpamWindowSummary {
	const total = sum(w.inbound.byReason);
	const spamByReason: Record<string, CountRate> = {};
	let spamTotal = 0;
	for (const [reason, count] of Object.entries(w.inbound.byReason)) {
		if (!SPAM_REASONS.has(reason)) continue;
		spamTotal += count;
		spamByReason[reason] = { count, rate: rate(count, total) };
	}
	const notSpamByReason: Record<string, CountRate> = {};
	for (const [reason, count] of Object.entries(w.feedback.notSpam)) {
		notSpamByReason[reason] = { count, rate: rate(count, w.inbound.byReason[reason] ?? 0) };
	}
	const notSpamTotal = sum(w.feedback.notSpam);
	const reportInbox = sum(w.feedback.reportSpamInbox);
	const reportByReason: Record<string, number> = {};
	addRecord(reportByReason, w.feedback.reportSpamInbox);
	addRecord(reportByReason, w.feedback.reportSpamOther);
	const tierTotal = sum(w.inbound.byAuthTier);
	const unverified = w.inbound.byAuthTier.unverified ?? 0;
	return {
		days: w.days,
		since: w.since,
		inbound: {
			total,
			byAuthTier: { ...w.inbound.byAuthTier },
			unverified: { count: unverified, rate: rate(unverified, tierTotal) },
		},
		spam: { count: spamTotal, rate: rate(spamTotal, total), byReason: spamByReason },
		notSpam: { count: notSpamTotal, rate: rate(notSpamTotal, spamTotal), byReason: notSpamByReason },
		reportSpam: {
			count: reportInbox,
			rate: rate(reportInbox, total - spamTotal),
			otherBoxes: sum(w.feedback.reportSpamOther),
			byReason: reportByReason,
		},
		repeatRescues: { count: sum(w.feedback.repeatRescues), byReason: { ...w.feedback.repeatRescues } },
		ruleMatches: {
			allow: w.inbound.allowMatches,
			block: w.inbound.byReason[ClassificationReasons.SENDER_REJECTED] ?? 0,
			aiSpamOverridden: w.inbound.byReason[ClassificationReasons.AI_SPAM_OVERRIDDEN] ?? 0,
		},
	};
}

export function summarizeSpamMetrics(counts: MailboxSpamCounts): SpamMetricsSummary {
	return {
		generatedAt: counts.generatedAt,
		rules: { ...counts.rules },
		windows: counts.windows.map(summarizeSpamWindow),
	};
}

// ── Ops dashboard (HTML) ──────────────────────────────────────────

export interface SpamMetricsReport {
	generatedAt: string;
	filter: { domain: string | null; mailbox: string | null };
	mailboxCount: number;
	truncated: boolean;
	/** Mailboxes whose Durable Object didn't answer. */
	failed: string[];
	total: SpamMetricsSummary;
	mailboxes: Array<{ id: string; metrics: SpamMetricsSummary }>;
}

function esc(value: unknown): string {
	return String(value).replace(/[&<>"']/g, (ch) =>
		ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;",
	);
}

function pct(r: number | null): string {
	return r === null ? "—" : `${(r * 100).toFixed(r < 0.01 && r > 0 ? 2 : 1)}%`;
}

function cr(c: CountRate): string {
	return `${c.count} <span class="muted">(${pct(c.rate)})</span>`;
}

function byWindow(summary: SpamMetricsSummary, days: number) {
	return summary.windows.find((w) => w.days === days);
}

function reasonRows(
	label: string,
	summary: SpamMetricsSummary,
	pick: (w: SpamWindowSummary) => Record<string, CountRate | number>,
): string {
	const reasons = new Set<string>();
	for (const w of summary.windows) for (const r of Object.keys(pick(w))) reasons.add(r);
	return [...reasons]
		.sort()
		.map((reason) => {
			const cells = SPAM_METRICS_WINDOW_DAYS.map((d) => {
				const w = byWindow(summary, d);
				const v = w ? pick(w)[reason] : undefined;
				if (v === undefined) return "<td>0</td>";
				return `<td>${typeof v === "number" ? v : cr(v)}</td>`;
			}).join("");
			return `<tr><td class="sub">${esc(label)} · <code>${esc(reason)}</code></td>${cells}</tr>`;
		})
		.join("");
}

function metricRow(label: string, summary: SpamMetricsSummary, cell: (w: SpamWindowSummary) => string, cls = "") {
	const cells = SPAM_METRICS_WINDOW_DAYS.map((d) => {
		const w = byWindow(summary, d);
		return `<td>${w ? cell(w) : "—"}</td>`;
	}).join("");
	return `<tr class="${cls}"><td>${esc(label)}</td>${cells}</tr>`;
}

function summaryTable(summary: SpamMetricsSummary): string {
	const head = SPAM_METRICS_WINDOW_DAYS.map((d) => `<th>Last ${d} days</th>`).join("");
	const rows = [
		metricRow("Inbound (classified)", summary, (w) => String(w.inbound.total)),
		metricRow("Unverified share of inbound", summary, (w) => cr(w.inbound.unverified)),
		reasonRows("Auth tier", summary, (w) => w.inbound.byAuthTier),
		metricRow("Spam rate", summary, (w) => cr(w.spam)),
		reasonRows("Spam", summary, (w) => w.spam.byReason),
		metricRow("Not spam rate (of spam)", summary, (w) => cr(w.notSpam)),
		reasonRows("Not spam", summary, (w) => w.notSpam.byReason),
		metricRow("Report spam on Inbox mail (of non-spam)", summary, (w) => cr(w.reportSpam)),
		metricRow("Report spam from other boxes", summary, (w) => String(w.reportSpam.otherBoxes)),
		metricRow(
			"Repeat rescues, allowed senders (target 0)",
			summary,
			(w) => `<span class="${w.repeatRescues.count > 0 ? "bad" : ""}">${w.repeatRescues.count}</span>`,
		),
		reasonRows("Repeat rescue", summary, (w) => w.repeatRescues.byReason),
		metricRow("Allow-rule matches (inbound)", summary, (w) => String(w.ruleMatches.allow)),
		metricRow("Block-rule matches (inbound)", summary, (w) => String(w.ruleMatches.block)),
		metricRow("AI spam overridden by trust", summary, (w) => String(w.ruleMatches.aiSpamOverridden)),
	].join("");
	return `<table><thead><tr><th>Metric</th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderSpamMetricsHtml(report: SpamMetricsReport): string {
	const { total } = report;
	const scope = report.filter.mailbox
		? `mailbox ${esc(report.filter.mailbox)}`
		: report.filter.domain
			? `domain ${esc(report.filter.domain)}`
			: "all mailboxes";
	const mailboxRows = report.mailboxes
		.map((m) => {
			const cells = SPAM_METRICS_WINDOW_DAYS.map((d) => {
				const w = byWindow(m.metrics, d);
				if (!w) return "<td colspan=5>—</td>";
				return [
					`<td>${w.inbound.total}</td>`,
					`<td>${pct(w.spam.rate)}</td>`,
					`<td>${pct(w.notSpam.rate)}</td>`,
					`<td>${pct(w.reportSpam.rate)}</td>`,
					`<td class="${w.repeatRescues.count > 0 ? "bad" : ""}">${w.repeatRescues.count}</td>`,
				].join("");
			}).join("");
			const w30 = byWindow(m.metrics, 30);
			return `<tr><td><code>${esc(m.id)}</code></td>${cells}<td>${pct(w30?.inbound.unverified.rate ?? null)}</td><td>${m.metrics.rules.allowed} / ${m.metrics.rules.explicitAllowed} / ${m.metrics.rules.rejected}</td></tr>`;
		})
		.join("");
	const groupHead = SPAM_METRICS_WINDOW_DAYS.map((d) => `<th colspan=5>Last ${d} days</th>`).join("");
	const subHead = SPAM_METRICS_WINDOW_DAYS.map(
		() => "<th>Inbound</th><th>Spam</th><th>Not spam</th><th>Report</th><th>Repeat</th>",
	).join("");
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spam metrics — Inboxies ops</title>
<style>
:root{color-scheme:light dark;--fg:#1f2328;--muted:#6e7781;--line:#d8dee4;--bad:#cf222e;--bg:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--bad:#ff7b72;--bg:#0d1117}}
body{font:14px/1.45 system-ui,-apple-system,"Inter",sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:16px;max-width:1200px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
.muted,.sub{color:var(--muted)}.sub{padding-left:20px}.bad{color:var(--bad);font-weight:600}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:4px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
code{font-size:12px}
</style></head><body>
<h1>Spam metrics</h1>
<p class="muted">${scope} · ${report.mailboxCount} mailbox${report.mailboxCount === 1 ? "" : "es"}${report.truncated ? " (truncated — filter by ?domain=)" : ""} · generated ${esc(report.generatedAt)} · counts only, no message content. Inbound is by receive time; Not spam / Report spam are by the day the move happened.${report.failed.length ? ` · <span class="bad">${report.failed.length} mailbox(es) failed to report</span>` : ""}</p>
<h2>Totals</h2>
<div class="scroll">${summaryTable(total)}</div>
<p class="muted">Sender rules (Screener list): ${total.rules.allowed} allowed (${total.rules.explicitAllowed} explicit), ${total.rules.rejected} blocked.</p>
<h2>Per mailbox</h2>
<div class="scroll"><table><thead><tr><th rowspan=2>Mailbox</th>${groupHead}<th rowspan=2>Unverified (30d)</th><th rowspan=2>Rules allow / explicit / block</th></tr><tr>${subHead}</tr></thead><tbody>${mailboxRows || '<tr><td colspan=13 class="muted">No mailboxes</td></tr>'}</tbody></table></div>
<p class="muted">Add <code>?format=json</code> for the raw data.</p>
</body></html>`;
}
