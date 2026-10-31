// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Step-up re-authentication (AVE-113; see `auth/reauth.ts`).
 *
 * - `GET  /api/v1/me/reauth` — is this session fresh, and how can it re-auth.
 * - `POST /api/v1/me/reauth/email-code` — mail a 6-digit code (accounts
 *   without a password only).
 * - `POST /api/v1/me/reauth` — prove it's you; the session is fresh for 5 minutes:
 *   - `{ method: "password", password, code?, codeType?: "totp" | "backup_code" }`
 *   - `{ method: "passkey", response }`: a WebAuthn assertion for the challenge
 *     from `GET /api/auth/passkey/generate-authenticate-options` (its signed
 *     challenge cookie must come back with this request).
 *   - `{ method: "email_code", code }`
 *
 * Throttled like sign-in: per IP and per user, and wrong passwords count
 * against the account lock (AVE-124) exactly as at sign-in.
 */

import type { Context, Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAuth, twoFactorApi } from "../auth";
import { authDb } from "../auth/authz";
import { codeEmail, sendSystemEmail } from "../auth/mail";
import { consumeOtp, issueOtp } from "../auth/otp";
import type { RequestPrincipal } from "../auth/principal";
import { clientIp, isAccountLocked, isRateLimited, recordPasswordFailure, TOO_MANY } from "../auth/rate-limit";
import {
	REAUTH_MAX_AGE_MS,
	reauthEmailTarget,
	reauthFreshUntil,
	reauthOptions,
	recordReauth,
	maskEmail,
} from "../auth/reauth";
import * as schema from "../auth/schema";
import { findUserById, hasPassword } from "../auth/users";
import { isDevRuntime } from "../lib/dev-runtime";
import type { MailboxContext } from "../lib/mailbox";
import { verifyPassword } from "../lib/password-auth";

type App = Hono<MailboxContext>;
type C = Context<MailboxContext>;

const ReauthBody = z.discriminatedUnion("method", [
	z.object({
		method: z.literal("password"),
		password: z.string().min(1).max(200),
		code: z.string().trim().min(1).max(64).optional(),
		codeType: z.enum(["totp", "backup_code"]).default("totp"),
	}),
	z.object({ method: z.literal("passkey"), response: z.record(z.string(), z.unknown()) }),
	z.object({ method: z.literal("email_code"), code: z.string().trim().min(4).max(12) }),
]);

const FAILED = { error: "That didn't work. Check it and try again.", code: "reauth_failed" } as const;

function emailCodeSubject(principal: RequestPrincipal): string {
	return `${principal.userId}:${principal.sessionId}`;
}

function principalOf(c: C): RequestPrincipal | null {
	return c.get("principal") ?? null;
}

/** Same throttles as a sign-in attempt, keyed by IP and by the account. */
async function signInThrottled(c: C, principal: RequestPrincipal): Promise<boolean> {
	return (
		(await isRateLimited(c.env, "sign-in", clientIp(c.req.raw.headers))) ||
		(await isRateLimited(c.env, "sign-in", principal.userId))
	);
}

type PasskeyVerify = (args: {
	body: { response: Record<string, unknown> };
	headers: Headers;
}) => Promise<{ session?: { id?: string; token?: string; userId?: string } }>;

/**
 * Check a passkey assertion with the passkey plugin itself (challenge cookie,
 * signature, counter). It signs in as a side effect; that new session is
 * deleted at once, and only the caller's own passkeys count.
 */
async function verifyPasskeyForUser(c: C, userId: string, response: Record<string, unknown>): Promise<boolean> {
	const api = getAuth(c.env).api as Record<string, unknown>;
	const verify = api.verifyPasskeyAuthentication as PasskeyVerify | undefined;
	if (typeof verify !== "function") throw new Error("passkey plugin is not installed");
	// Only what the ceremony needs: the challenge cookie and the origin.
	const headers = new Headers();
	for (const name of ["cookie", "origin", "user-agent", "cf-connecting-ip"]) {
		const value = c.req.raw.headers.get(name);
		if (value) headers.set(name, value);
	}
	let minted: { id?: string; token?: string; userId?: string } | undefined;
	try {
		minted = (await verify({ body: { response }, headers }))?.session;
	} catch {
		return false;
	}
	if (minted?.id) {
		await authDb(c.env.AUTH_DB).delete(schema.session).where(eq(schema.session.id, minted.id));
	}
	return Boolean(minted?.userId && minted.userId === userId);
}

export function registerReauthRoutes(app: App) {
	app.get("/api/v1/me/reauth", async (c) => {
		const principal = principalOf(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const freshUntil = await reauthFreshUntil(authDb(c.env.AUTH_DB), principal);
		return c.json({
			fresh: freshUntil !== null,
			freshUntil: freshUntil?.toISOString() ?? null,
			maxAgeSeconds: REAUTH_MAX_AGE_MS / 1000,
			...(await reauthOptions(c.env, principal.userId)),
		});
	});

	app.post("/api/v1/me/reauth/email-code", async (c) => {
		const principal = principalOf(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserById(db, principal.userId);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		// Password accounts confirm with the password (or a passkey).
		if (await hasPassword(db, user.id)) {
			return c.json({ error: "Confirm with your password or a passkey instead." }, 400);
		}
		const target = await reauthEmailTarget(c.env, db, user);
		if (!target) {
			return c.json({ error: "There's no email address to send a code to. Sign out and sign back in instead." }, 400);
		}
		if ((await isRateLimited(c.env, "otp-send", principal.userId)) || (await isRateLimited(c.env, "otp-send", target))) {
			return c.json(TOO_MANY, 429);
		}
		const otp = await issueOtp(db, "reauth", emailCodeSubject(principal), target);
		if (!otp.ok) return c.json({ error: "A code was just sent. Wait a minute before asking again." }, 429);
		const mail = codeEmail({
			purposeLine: `Someone signed in to ${user.email} on Inboxies asked to confirm it's them before changing sign-in or recovery settings.`,
			code: otp.code,
		});
		const sent = await sendSystemEmail(c.env, { to: target, subject: "Your Inboxies confirmation code", ...mail });
		if (!sent && isDevRuntime()) console.log(`[Dev] Re-auth code for ${user.email}: ${otp.code}`);
		return c.json({ ok: true, sentTo: maskEmail(target), ...(isDevRuntime() ? { devCode: otp.code } : {}) });
	});

	app.post("/api/v1/me/reauth", async (c) => {
		const principal = principalOf(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const parsed = ReauthBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "Send a password, passkey or code to confirm it's you." }, 400);
		const body = parsed.data;
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserById(db, principal.userId);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		if (body.method === "password") {
			if (await signInThrottled(c, principal)) return c.json(TOO_MANY, 429);
			if (await isAccountLocked(c.env, user.email)) return c.json(TOO_MANY, 429);
			const credential = await db
				.select({ password: schema.account.password })
				.from(schema.account)
				.where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")))
				.get();
			if (!credential?.password) return c.json({ error: "This account has no password. Use a passkey or an emailed code." }, 400);
			if (!(await verifyPassword(body.password, credential.password))) {
				await recordPasswordFailure(c.env, user.email);
				return c.json({ ...FAILED, error: "Incorrect password." }, 401);
			}
			if (user.twoFactorEnabled) {
				if (!body.code) {
					return c.json(
						{ error: "Enter the code from your authenticator app.", code: "two_factor_required", twoFactorMethods: ["totp", "backup_code"] },
						401,
					);
				}
				// Signed-in verify: checks the code against this user's secret
				// (or burns one backup code) without touching the session.
				const api = twoFactorApi(getAuth(c.env));
				const verify = body.codeType === "backup_code" ? api.verifyBackupCode : api.verifyTOTP;
				try {
					await verify({ body: { code: body.code.replace(/\s+/g, "") }, headers: c.req.raw.headers, returnHeaders: true });
				} catch {
					return c.json({ error: "That code didn't work.", code: "two_factor_invalid_code" }, 401);
				}
			}
		} else if (body.method === "passkey") {
			if (await signInThrottled(c, principal)) return c.json(TOO_MANY, 429);
			if (!(await verifyPasskeyForUser(c, user.id, body.response))) {
				return c.json({ ...FAILED, error: "That passkey couldn't confirm it's you. Try again or use another way." }, 401);
			}
		} else {
			if (await isRateLimited(c.env, "otp-verify", principal.userId)) return c.json(TOO_MANY, 429);
			const check = await consumeOtp(db, "reauth", emailCodeSubject(principal), body.code);
			// The code is bound to where it was mailed; that must still be a safe address.
			const target = check.ok ? await reauthEmailTarget(c.env, db, user) : null;
			if (!check.ok || !target || check.target !== target) {
				return c.json({ ...FAILED, error: "Invalid or expired code." }, 401);
			}
		}

		const freshUntil = await recordReauth(db, principal);
		return c.json({ ok: true, freshUntil: freshUntil.toISOString() });
	});
}
