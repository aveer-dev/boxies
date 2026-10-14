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
 */

import type { Env } from "../types";

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
