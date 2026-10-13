// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Sign in with Apple token revocation (App Store Review 5.1.1(v)): when an
 * account is deleted, the app must revoke its Apple tokens.
 *
 * At sign-in the iOS app sends Apple's one-time `authorizationCode`; we
 * exchange it for a refresh token and keep that on the user's "apple"
 * account row. Account deletion calls Apple's revoke endpoint with it.
 *
 * Needs a Sign in with Apple key: APPLE_SIGNIN_KEY_ID and
 * APPLE_SIGNIN_PRIVATE_KEY (the .p8 contents), plus APPLE_TEAM_ID (falls back
 * to APNS_TEAM_ID). Without them both steps are skipped and logged.
 */

import { and, eq } from "drizzle-orm";
import { importPKCS8, SignJWT } from "jose";
import type { Env } from "../types";
import type { AuthDb } from "./authz";
import * as schema from "./schema";

const APPLE_ISSUER = "https://appleid.apple.com";

type AppleKeyConfig = { clientId: string; teamId: string; keyId: string; privateKey: string };

function appleKeyConfig(env: Env): AppleKeyConfig | null {
	const clientId = env.APPLE_APP_BUNDLE_ID ?? env.APPLE_CLIENT_ID;
	const teamId = env.APPLE_TEAM_ID ?? env.APNS_TEAM_ID;
	const keyId = env.APPLE_SIGNIN_KEY_ID;
	const privateKey = env.APPLE_SIGNIN_PRIVATE_KEY;
	if (!clientId || !teamId || !keyId || !privateKey) return null;
	return { clientId, teamId, keyId, privateKey };
}

/** The ES256 client secret Apple's token endpoints require (valid 5 minutes). */
async function clientSecret(cfg: AppleKeyConfig): Promise<string> {
	const key = await importPKCS8(cfg.privateKey.replace(/\\n/g, "\n"), "ES256");
	return new SignJWT({})
		.setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
		.setIssuer(cfg.teamId)
		.setSubject(cfg.clientId)
		.setAudience(APPLE_ISSUER)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(key);
}

/**
 * Exchange the sign-in `authorizationCode` and store the refresh token on
 * the user's Apple account. Best effort: sign-in never fails because of it.
 */
export async function storeAppleRefreshToken(
	env: Env,
	db: AuthDb,
	opts: { userId: string; authorizationCode: string },
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	const cfg = appleKeyConfig(env);
	if (!cfg) {
		console.warn("[Apple] Sign in with Apple key not configured; can't store a refresh token");
		return false;
	}
	try {
		const res = await fetchImpl(`${APPLE_ISSUER}/auth/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: cfg.clientId,
				client_secret: await clientSecret(cfg),
				code: opts.authorizationCode,
				grant_type: "authorization_code",
			}),
		});
		if (!res.ok) {
			console.error("[Apple] Code exchange failed:", res.status);
			return false;
		}
		const body = (await res.json()) as { refresh_token?: string };
		if (!body.refresh_token) return false;
		await db
			.update(schema.account)
			.set({ refreshToken: body.refresh_token, updatedAt: new Date() })
			.where(and(eq(schema.account.userId, opts.userId), eq(schema.account.providerId, "apple")));
		return true;
	} catch (e) {
		console.error("[Apple] Code exchange failed:", (e as Error).message);
		return false;
	}
}

/** Revoke every stored Apple refresh token of `userId` (account deletion). */
export async function revokeAppleTokens(
	env: Env,
	db: AuthDb,
	userId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<number> {
	const rows = await db
		.select({ refreshToken: schema.account.refreshToken })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "apple")))
		.all();
	const tokens = rows.map((r) => r.refreshToken).filter((t): t is string => Boolean(t));
	if (tokens.length === 0) return 0;
	const cfg = appleKeyConfig(env);
	if (!cfg) {
		console.warn("[Apple] Sign in with Apple key not configured; tokens not revoked");
		return 0;
	}
	let revoked = 0;
	for (const token of tokens) {
		try {
			const res = await fetchImpl(`${APPLE_ISSUER}/auth/revoke`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: cfg.clientId,
					client_secret: await clientSecret(cfg),
					token,
					token_type_hint: "refresh_token",
				}),
			});
			if (res.ok) revoked++;
			else console.error("[Apple] Revoke failed:", res.status);
		} catch (e) {
			console.error("[Apple] Revoke failed:", (e as Error).message);
		}
	}
	return revoked;
}
