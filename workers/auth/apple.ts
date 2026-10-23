// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Sign in with Apple token revocation (App Store Review 5.1.1(v)): when an
 * account is deleted, the app must revoke its Apple tokens.
 *
 * At sign-in the iOS app and the web login page (Apple JS) send Apple's
 * one-time `authorizationCode`; we exchange it for a refresh token and keep
 * it in `apple_refresh_token`, one per Apple client. Account deletion and
 * Apple unlink call Apple's revoke endpoint for each.
 *
 * Apple issues codes and tokens to a client: the iOS bundle id for native
 * sign-in, the Services ID (APPLE_WEB_SERVICES_ID) for the web. `/auth/token`
 * and `/auth/revoke` need `client_id` (and the client-secret JWT `sub`) to
 * match that client, and a web code exchange also needs the Return URL the
 * popup used as `redirect_uri`. The client is picked from the verified ID
 * token's `aud`, never from the request body.
 *
 * Refresh tokens stored before `apple_refresh_token` existed are on the
 * user's "apple" account row and were issued to the bundle id.
 *
 * Needs a Sign in with Apple key: APPLE_SIGNIN_KEY_ID and
 * APPLE_SIGNIN_PRIVATE_KEY (the .p8 contents), plus APPLE_TEAM_ID (falls back
 * to APNS_TEAM_ID). Without them both steps are skipped and logged.
 */

import { and, eq } from "drizzle-orm";
import { decodeJwt, importPKCS8, SignJWT } from "jose";
import type { Env } from "../types";
import type { AuthDb } from "./authz";
import * as schema from "./schema";

const APPLE_ISSUER = "https://appleid.apple.com";

/** Path of the web login page; Apple JS's `redirectURI` is this page on the web app's origin. */
export const APPLE_WEB_REDIRECT_PATH = "/login";

type AppleKey = { teamId: string; keyId: string; privateKey: string };

/** An Apple client tokens are issued to, and the `redirect_uri` its codes need. */
export type AppleClient = { clientId: string; redirectUri?: string };

function appleKey(env: Env): AppleKey | null {
	const teamId = env.APPLE_TEAM_ID ?? env.APNS_TEAM_ID;
	const keyId = env.APPLE_SIGNIN_KEY_ID;
	const privateKey = env.APPLE_SIGNIN_PRIVATE_KEY;
	if (!teamId || !keyId || !privateKey) return null;
	return { teamId, keyId, privateKey };
}

/** The iOS bundle id: native ID tokens' `aud`, and the client of legacy stored tokens. */
function bundleClientId(env: Env): string | undefined {
	return env.APPLE_APP_BUNDLE_ID ?? env.APPLE_CLIENT_ID;
}

/**
 * The Return URL the web button passes to Apple JS: `${APP_BASE_URL}/login`.
 * The button uses `${window.location.origin}/login`; both are the same page
 * because other hosts redirect /login to APP_BASE_URL (lib/web-host-redirect).
 */
export function appleWebRedirectUri(env: Env): string | undefined {
	const base = env.APP_BASE_URL?.trim().replace(/\/+$/, "");
	return base ? `${base}${APPLE_WEB_REDIRECT_PATH}` : undefined;
}

/**
 * Which Apple client issued `identityToken`, from its `aud`. Call only with
 * a token that was already verified (signature, issuer, audience).
 */
export function appleClientForIdentityToken(env: Env, identityToken: string): AppleClient | null {
	let aud: string | string[] | undefined;
	try {
		aud = decodeJwt(identityToken).aud;
	} catch {
		return null;
	}
	const audiences = Array.isArray(aud) ? aud : aud ? [aud] : [];
	const bundleId = bundleClientId(env);
	if (bundleId && audiences.includes(bundleId)) return { clientId: bundleId };
	const servicesId = env.APPLE_WEB_SERVICES_ID;
	if (servicesId && audiences.includes(servicesId)) {
		const redirectUri = appleWebRedirectUri(env);
		if (!redirectUri) {
			console.warn("[Apple] APP_BASE_URL is not set; can't exchange a web authorization code");
			return null;
		}
		return { clientId: servicesId, redirectUri };
	}
	return null;
}

/** The ES256 client secret Apple's token endpoints require (valid 5 minutes); `sub` is the client. */
async function clientSecret(key: AppleKey, clientId: string): Promise<string> {
	const pkcs8 = await importPKCS8(key.privateKey.replace(/\\n/g, "\n"), "ES256");
	return new SignJWT({})
		.setProtectedHeader({ alg: "ES256", kid: key.keyId })
		.setIssuer(key.teamId)
		.setSubject(clientId)
		.setAudience(APPLE_ISSUER)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(pkcs8);
}

/**
 * Exchange the sign-in `authorizationCode` with the client that issued it
 * and store the refresh token for that client (replacing only that client's
 * previous token). Best effort: sign-in never fails because of it.
 */
export async function storeAppleRefreshToken(
	env: Env,
	db: AuthDb,
	opts: { userId: string; authorizationCode: string; client: AppleClient },
	fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
	const key = appleKey(env);
	if (!key) {
		console.warn("[Apple] Sign in with Apple key not configured; can't store a refresh token");
		return false;
	}
	const { client } = opts;
	try {
		const res = await fetchImpl(`${APPLE_ISSUER}/auth/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: client.clientId,
				client_secret: await clientSecret(key, client.clientId),
				code: opts.authorizationCode,
				grant_type: "authorization_code",
				...(client.redirectUri ? { redirect_uri: client.redirectUri } : {}),
			}),
		});
		if (!res.ok) {
			console.error("[Apple] Code exchange failed:", res.status, client.clientId);
			return false;
		}
		const body = (await res.json()) as { refresh_token?: string };
		if (!body.refresh_token) return false;
		const now = new Date();
		await db
			.insert(schema.appleRefreshToken)
			.values({ userId: opts.userId, clientId: client.clientId, refreshToken: body.refresh_token })
			.onConflictDoUpdate({
				target: [schema.appleRefreshToken.userId, schema.appleRefreshToken.clientId],
				set: { refreshToken: body.refresh_token, updatedAt: now },
			});
		return true;
	} catch (e) {
		console.error("[Apple] Code exchange failed:", (e as Error).message);
		return false;
	}
}

/** Every stored Apple refresh token of `userId` with the client it was issued to. */
async function storedAppleTokens(env: Env, db: AuthDb, userId: string) {
	const tokens = new Map<string, string>(); // token → client id
	const rows = await db
		.select({ clientId: schema.appleRefreshToken.clientId, refreshToken: schema.appleRefreshToken.refreshToken })
		.from(schema.appleRefreshToken)
		.where(eq(schema.appleRefreshToken.userId, userId))
		.all();
	for (const r of rows) tokens.set(r.refreshToken, r.clientId);
	// Legacy: tokens on the account row came from iOS, so the bundle id.
	const bundleId = bundleClientId(env);
	const legacy = await db
		.select({ refreshToken: schema.account.refreshToken })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "apple")))
		.all();
	for (const r of legacy) {
		if (r.refreshToken && bundleId && !tokens.has(r.refreshToken)) tokens.set(r.refreshToken, bundleId);
	}
	return [...tokens].map(([token, clientId]) => ({ token, clientId }));
}

/**
 * Revoke every stored Apple refresh token of `userId` (account deletion,
 * Apple unlink), each with the client it was issued to. Best effort: never
 * throws, so deletion and unlink go ahead when Apple fails.
 */
export async function revokeAppleTokens(
	env: Env,
	db: AuthDb,
	userId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<number> {
	let tokens: { token: string; clientId: string }[];
	try {
		tokens = await storedAppleTokens(env, db, userId);
	} catch (e) {
		console.error("[Apple] Couldn't read stored tokens:", (e as Error).message);
		return 0;
	}
	if (tokens.length === 0) return 0;
	const key = appleKey(env);
	if (!key) {
		console.warn("[Apple] Sign in with Apple key not configured; tokens not revoked");
		return 0;
	}
	let revoked = 0;
	for (const { token, clientId } of tokens) {
		try {
			const res = await fetchImpl(`${APPLE_ISSUER}/auth/revoke`, {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: await clientSecret(key, clientId),
					token,
					token_type_hint: "refresh_token",
				}),
			});
			if (res.ok) revoked++;
			else console.error("[Apple] Revoke failed:", res.status, clientId);
		} catch (e) {
			console.error("[Apple] Revoke failed:", (e as Error).message);
		}
	}
	return revoked;
}

/** Forget `userId`'s stored Apple refresh tokens (after revoking them on unlink). */
export async function deleteAppleTokens(db: AuthDb, userId: string): Promise<void> {
	await db.delete(schema.appleRefreshToken).where(eq(schema.appleRefreshToken.userId, userId));
}
