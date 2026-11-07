// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Workers Rate Limiting in front of the routes an attacker can hammer
 * without an account: sign-in, sign-up, OTP send/verify, password reset,
 * invites, domain checks and checkout.
 *
 * Limits are per key per minute (see `ratelimits` in wrangler.jsonc). They
 * fail open when the binding is missing or errors: every route behind them
 * has its own per-record caps as well (OTP attempts, reset issuance).
 *
 * Password checks are also capped per account (below), so many IPs can't
 * share out guesses against one login.
 */

import { canonicalMailboxId } from "../lib/mailbox-routing";
import type { Env } from "../types";
import { sha256Hex } from "./otp";

export type LimitBucket =
	| "sign-in" // AUTH_LIMITER
	| "sign-up"
	| "otp-send"
	| "otp-verify" // PASSWORD_RESET_LIMITER (guess throttle)
	| "invite" // INVITE_LIMITER
	| "domain-check" // PUBLIC_LIMITER
	| "checkout";

function limiterFor(env: Env, bucket: LimitBucket): RateLimit | undefined {
	switch (bucket) {
		case "otp-verify":
			return env.PASSWORD_RESET_LIMITER;
		case "invite":
			return env.INVITE_LIMITER;
		case "domain-check":
		case "checkout":
			return env.PUBLIC_LIMITER;
		default:
			return env.AUTH_LIMITER;
	}
}

export function clientIp(headers: Headers): string {
	return headers.get("cf-connecting-ip") ?? "unknown";
}

/** True when `key` is over its limit for `bucket` (the caller should 429). */
export async function isRateLimited(env: Env, bucket: LimitBucket, key: string): Promise<boolean> {
	const limiter = limiterFor(env, bucket);
	if (!limiter) return false;
	try {
		const { success } = await limiter.limit({ key: `${bucket}:${key}` });
		return !success;
	} catch (e) {
		console.error(`[RateLimit] ${bucket} limiter failed:`, (e as Error).message || e);
		return false;
	}
}

export const TOO_MANY = { error: "Too many attempts. Wait a minute and try again." } as const;

// ── Per-account password failures ────────────────────────────────
//
// Wrong passwords count per login (any IP). After ACCOUNT_FAILURE_LIMIT of
// them inside ACCOUNT_FAILURE_WINDOW_MS, password checks for that login
// answer 429 (`TOO_MANY`, the same reply as the per-IP limit) for
// ACCOUNT_LOCK_MS. The key is applied to any email, existing or not, so a
// lockout doesn't reveal whether an account exists. A successful sign-in does
// not reset the count: it simply ages out, like the per-IP limiter's. Passkey,
// social and emailed-code sign-in don't check it.
//
// Workers Rate Limiting periods are 10 or 60 seconds and count every call,
// so the counts live in Better Auth's `verification` table (like OTP
// attempts), one row per login with a fixed id; the cron's
// `deleteExpiredVerifications` removes them once expired. Fails open, like
// the limiter above.

export const ACCOUNT_FAILURE_LIMIT = 10;
export const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_LOCK_MS = 15 * 60 * 1000;

/** The login a password attempt counts against: canonical address (plus-tags dropped), else trimmed + lowercased. */
export function accountLoginKey(email: string): string {
	return canonicalMailboxId(email) ?? email.trim().toLowerCase();
}

async function failureRowId(email: string): Promise<string> {
	return `password-failures:${await sha256Hex(accountLoginKey(email))}`;
}

/** True while `email` has used up its wrong passwords (the caller should 429 without checking the password). */
export async function isAccountLocked(env: Env, email: string, now = Date.now()): Promise<boolean> {
	if (!env.AUTH_DB) return false;
	try {
		const row = await env.AUTH_DB.prepare("SELECT value, expires_at FROM verification WHERE id = ?")
			.bind(await failureRowId(email))
			.first<{ value: string; expires_at: number }>();
		return Boolean(row && Number(row.expires_at) > now && Number(row.value) >= ACCOUNT_FAILURE_LIMIT);
	} catch (e) {
		console.error("[RateLimit] account lock check failed:", (e as Error).message || e);
		return false;
	}
}

/**
 * Count one wrong password for `email`. One atomic upsert, so concurrent
 * guesses can't race past the limit: an expired row starts over at 1, and
 * the attempt that reaches the limit pushes expiry out to the cool-down.
 */
export async function recordPasswordFailure(env: Env, email: string, now = Date.now()): Promise<void> {
	if (!env.AUTH_DB) return;
	try {
		const id = await failureRowId(email);
		const windowEnd = now + ACCOUNT_FAILURE_WINDOW_MS;
		const lockEnd = now + ACCOUNT_LOCK_MS;
		await env.AUTH_DB.prepare(
			`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
			VALUES (?, ?, '1', ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				value = CASE WHEN verification.expires_at <= ? THEN '1'
					ELSE CAST(CAST(verification.value AS INTEGER) + 1 AS TEXT) END,
				expires_at = CASE WHEN verification.expires_at <= ? THEN ?
					WHEN CAST(verification.value AS INTEGER) + 1 >= ? THEN ?
					ELSE verification.expires_at END,
				updated_at = ?`,
		)
			.bind(id, id, windowEnd, now, now, now, now, windowEnd, ACCOUNT_FAILURE_LIMIT, lockEnd, now)
			.run();
	} catch (e) {
		console.error("[RateLimit] account failure count failed:", (e as Error).message || e);
	}
}
