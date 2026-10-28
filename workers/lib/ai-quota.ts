// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * LLM quotas and chat history caps (AVE-45).
 *
 * - Daily request counters per mailbox, kept in the MailboxDO's SQLite
 *   (`ai_usage`, migration 41) and keyed by UTC day and bucket:
 *     chat    — one per agent chat turn (any conversation in the mailbox)
 *     inbound — one per inbound AI step: spam/ham classification, auto-draft run
 * - Limits live here, keyed by plan tier. There is no billing plan concept
 *   yet, so `getPlanTier()` is the single seam and returns "free" for
 *   everyone; wire it to a real plan lookup when paid plans exist.
 * - Per-user counters: there is no per-user Durable Object today (users and
 *   mailboxes live in D1), so limits are enforced per mailbox only.
 *
 * Over quota, chat gets a typed error (shared/ai-quota.ts) and inbound mail
 * falls back to rules-only classification with no auto-draft.
 */

import {
	aiQuotaExceededError,
	type AiQuotaBucket,
	type AiQuotaExceededError,
} from "../../shared/ai-quota.ts";

export type { AiQuotaBucket };

export type PlanTier = "free" | "paid";

/** Requests per UTC day, per mailbox. */
export const AI_DAILY_LIMITS: Record<PlanTier, Record<AiQuotaBucket, number>> = {
	free: { chat: 50, inbound: 200 },
	paid: { chat: 500, inbound: 2000 },
};

/** Messages of chat history sent to the model each turn. */
export const CHAT_HISTORY_LIMIT = 20;

/** Messages kept in the auto-draft conversation (two per run). */
export const AUTO_DRAFT_HISTORY_LIMIT = 100;

/** Days of counters kept before pruning. */
const USAGE_RETENTION_DAYS = 7;

/**
 * Plan tier for a mailbox. Single seam for billing: everyone is Free until
 * the codebase has plans.
 */
export function getPlanTier(_mailboxId: string): PlanTier {
	return "free";
}

export function dailyLimit(tier: PlanTier, bucket: AiQuotaBucket): number {
	return AI_DAILY_LIMITS[tier][bucket];
}

/** `YYYY-MM-DD` for the UTC day containing `now`. */
export function utcDay(now: number): string {
	return new Date(now).toISOString().slice(0, 10);
}

/** ISO timestamp of the next UTC midnight after `now`. */
export function nextUtcMidnight(now: number): string {
	const d = new Date(now);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
}

export type AiQuotaResult =
	| { allowed: true; used: number; limit: number }
	| { allowed: false; used: number; limit: number; error: AiQuotaExceededError };

type Sql = Pick<SqlStorage, "exec">;

/**
 * Count one request against today's bucket if it is under `limit`. The
 * check and increment are one statement, so concurrent calls in the DO
 * can't overshoot. Refused requests are not counted.
 */
export function consumeAiQuota(
	sql: Sql,
	bucket: AiQuotaBucket,
	limit: number,
	now: number = Date.now(),
): AiQuotaResult {
	const day = utcDay(now);
	const row =
		limit > 0
			? ([
					...sql.exec(
						`INSERT INTO ai_usage (day, bucket, count) VALUES (?1, ?2, 1)
						 ON CONFLICT (day, bucket) DO UPDATE SET count = count + 1
						   WHERE ai_usage.count < ?3
						 RETURNING count`,
						day,
						bucket,
						limit,
					),
				][0] as { count: number } | undefined)
			: undefined;
	if (row) {
		pruneAiUsage(sql, now);
		return { allowed: true, used: Number(row.count), limit };
	}
	const used = readAiUsage(sql, bucket, now);
	return {
		allowed: false,
		used,
		limit,
		error: aiQuotaExceededError(bucket, limit, nextUtcMidnight(now)),
	};
}

export function readAiUsage(sql: Sql, bucket: AiQuotaBucket, now: number = Date.now()): number {
	const row = [
		...sql.exec(`SELECT count FROM ai_usage WHERE day = ?1 AND bucket = ?2`, utcDay(now), bucket),
	][0] as { count: number } | undefined;
	return row ? Number(row.count) : 0;
}

function pruneAiUsage(sql: Sql, now: number): void {
	const cutoff = utcDay(now - USAGE_RETENTION_DAYS * 86_400_000);
	sql.exec(`DELETE FROM ai_usage WHERE day < ?1`, cutoff);
}

/**
 * The last `max` messages of a chat, starting on a user message so the
 * model never sees an assistant turn without the prompt that led to it.
 * Tool calls and their results live in the same UI message, so cutting on
 * message boundaries never orphans a tool result.
 */
export function capChatHistory<T extends { role: string }>(
	messages: readonly T[],
	max: number = CHAT_HISTORY_LIMIT,
): T[] {
	if (messages.length <= max) return [...messages];
	const tail = messages.slice(-max);
	const firstUser = tail.findIndex((m) => m.role === "user");
	return firstUser > 0 ? tail.slice(firstUser) : tail;
}

/** Minimal mailbox stub surface for quota checks (MailboxDO.consumeAiQuota). */
export interface AiQuotaStub {
	consumeAiQuota(bucket: AiQuotaBucket, tier: PlanTier): Promise<AiQuotaResult>;
}

/**
 * Consume one request of `bucket` for `mailboxId` through its MailboxDO, at
 * the mailbox's plan tier. A failed check (DO hiccup) fails open: losing a
 * counter must not take AI off for the request.
 */
export async function tryConsumeAiQuota(
	stub: AiQuotaStub,
	mailboxId: string,
	bucket: AiQuotaBucket,
): Promise<AiQuotaResult | null> {
	try {
		return await stub.consumeAiQuota(bucket, getPlanTier(mailboxId));
	} catch (e) {
		console.error(`AI quota check failed (${bucket}, ${mailboxId}), allowing:`, (e as Error).message);
		return null;
	}
}
