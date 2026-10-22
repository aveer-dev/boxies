// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The Better Auth routes we expose at /api/auth/*. Everything not listed is
 * a 404: email sign-up (sign-up creates a mailbox, so it's ours), Better
 * Auth's password-reset routes (they mail `user.email`, which can be a shared
 * mailbox; ours mail the verified recovery address), email change, user
 * deletion (ours also purges mailboxes), and the OAuth redirect/callback
 * flow (clients send native ID tokens).
 *
 * Passkeys: registering and managing them needs a full session; the two
 * sign-in steps are public and rate limited like password sign-in. The
 * WebAuthn challenge rides in a short-lived signed cookie between the two
 * calls (`better-auth-passkey`), so native clients echo it back.
 *
 * Two-factor (TOTP + backup codes, optional): enable/disable/regenerate need
 * the password and are throttled like sign-in; the verify routes finish a
 * password sign-in from its `two_factor` challenge cookie (or confirm setup
 * while signed in) and are throttled like code guesses. Native clients that
 * don't keep cookies use `/api/v1/auth/two-factor/verify` instead.
 */

import { getAuth, AUTH_BASE_PATH } from "../auth";
import { principalFromHeaders } from "../auth/principal";
import { clientIp, isRateLimited, TOO_MANY } from "../auth/rate-limit";
import type { Env } from "../types";

type RouteRule = {
	methods: readonly string[];
	/** Allowed for scoped (extension / AutoFill) sessions. */
	scoped?: boolean;
	/** Rate limited per client IP before Better Auth sees it. */
	limit?: "sign-in" | "otp-verify";
	/** Body must carry an `idToken` (no redirect flow). */
	idTokenOnly?: boolean;
};

const ROUTES: Record<string, RouteRule> = {
	"/sign-in/email": { methods: ["POST"], limit: "sign-in" },
	"/sign-in/social": { methods: ["POST"], limit: "sign-in", idTokenOnly: true },
	"/sign-out": { methods: ["POST"], scoped: true },
	"/get-session": { methods: ["GET"], scoped: true },
	"/list-sessions": { methods: ["GET"] },
	"/revoke-session": { methods: ["POST"] },
	"/revoke-sessions": { methods: ["POST"] },
	"/revoke-other-sessions": { methods: ["POST"] },
	"/change-password": { methods: ["POST"], limit: "sign-in" },
	"/link-social": { methods: ["POST"], idTokenOnly: true },
	"/unlink-account": { methods: ["POST"] },
	"/list-accounts": { methods: ["GET"] },
	"/update-user": { methods: ["POST"] },
	// Passkeys (@better-auth/passkey).
	"/passkey/generate-register-options": { methods: ["GET"] },
	"/passkey/verify-registration": { methods: ["POST"] },
	"/passkey/generate-authenticate-options": { methods: ["GET"], limit: "sign-in" },
	"/passkey/verify-authentication": { methods: ["POST"], limit: "sign-in" },
	"/passkey/list-user-passkeys": { methods: ["GET"] },
	"/passkey/update-passkey": { methods: ["POST"] },
	"/passkey/delete-passkey": { methods: ["POST"] },
	// Two-factor (twoFactor plugin; TOTP only, so no /two-factor/*-otp routes).
	"/two-factor/enable": { methods: ["POST"], limit: "sign-in" },
	"/two-factor/disable": { methods: ["POST"], limit: "sign-in" },
	"/two-factor/get-totp-uri": { methods: ["POST"], limit: "sign-in" },
	"/two-factor/generate-backup-codes": { methods: ["POST"], limit: "sign-in" },
	"/two-factor/verify-totp": { methods: ["POST"], limit: "otp-verify" },
	"/two-factor/verify-backup-code": { methods: ["POST"], limit: "otp-verify" },
};

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function handleBetterAuthRequest(env: Env, request: Request): Promise<Response> {
	if (!env.AUTH_DB || !env.BETTER_AUTH_SECRET) return json({ error: "Not found" }, 404);
	const path = new URL(request.url).pathname.slice(AUTH_BASE_PATH.length);
	const rule = ROUTES[path];
	if (!rule || !rule.methods.includes(request.method)) return json({ error: "Not found" }, 404);

	if (rule.limit && (await isRateLimited(env, rule.limit, clientIp(request.headers)))) {
		return json(TOO_MANY, 429);
	}
	if (rule.idTokenOnly) {
		const body = (await request.clone().json().catch(() => null)) as { idToken?: unknown } | null;
		if (!body || typeof body.idToken !== "object" || body.idToken === null) {
			return json({ error: "Send the provider's ID token as idToken" }, 400);
		}
	}
	if (!rule.scoped) {
		const principal = await principalFromHeaders(env, request.headers);
		if (principal?.scope) return json({ error: "This session can only manage private emails" }, 403);
	}
	return getAuth(env).handler(request);
}
