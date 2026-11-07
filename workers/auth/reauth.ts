// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Step-up re-authentication for sensitive account changes (AVE-113).
 *
 * A session alone can't change how the account is recovered or signed in to:
 * setting, replacing or removing the recovery email, adding or removing a
 * password, Apple/Google sign-in or passkey, changing the password, and
 * deleting the account all need a *fresh* session. A session is fresh for
 * `REAUTH_MAX_AGE_MS` (5 minutes) after either
 * - it was created (a full sign-in: password + 2FA, passkey, Apple/Google, or
 *   a password reset through the verified recovery email), or
 * - it proved the user again at `POST /api/v1/me/reauth` (password, plus the
 *   TOTP or a backup code when 2FA is on; a passkey; or, for accounts
 *   without a password, a code mailed to a safe address).
 *
 * The proof is a `verification` row keyed by the session id (`reauth:<id>`,
 * value = user id), written only by the server, so it can't be forged by a
 * client flag and it dies with the session's 5-minute window (the cron's
 * `deleteExpiredVerifications` sweeps old rows). It never carries over to
 * another session.
 *
 * Routes that need it answer 403 with `REAUTH_REQUIRED_CODE` and the methods
 * this account can use (`reauthRequiredBody`), so clients can prompt and
 * retry.
 */

import { and, eq } from "drizzle-orm";
import type { Env } from "../types";
import { authDb, type AuthDb } from "./authz";
import { isHostedEmailDomain } from "./hooks";
import type { RequestPrincipal } from "./principal";
import * as schema from "./schema";
import { verifiedRecoveryEmail } from "./users";

export const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;
/** Stable machine code on the 403; clients key off this, not the message. */
export const REAUTH_REQUIRED_CODE = "reauth_required";
/**
 * Human text on the 403. Builds that predate the re-auth prompt show it as
 * is, so it says what works with them: signing in again.
 */
export const REAUTH_REQUIRED_MESSAGE =
	"For your security, confirm it's you first. Sign out and sign back in, then try again within 5 minutes.";

/**
 * - `password`: the account password (plus a TOTP or backup code when 2FA is on).
 * - `passkey`: an assertion from one of the user's passkeys.
 * - `email_code`: a 6-digit code mailed to `emailCodeTo` (accounts without a password).
 * - `sign_in`: sign out and sign in again; a new session is fresh for 5 minutes.
 */
export type ReauthMethod = "password" | "passkey" | "email_code" | "sign_in";

type Principal = Pick<RequestPrincipal, "userId" | "sessionId">;

function reauthRowId(sessionId: string): string {
	return `reauth:${sessionId}`;
}

/** Mark this session as re-authenticated now. */
export async function recordReauth(db: AuthDb, principal: Principal, now = Date.now()): Promise<Date> {
	const id = reauthRowId(principal.sessionId);
	const expiresAt = new Date(now + REAUTH_MAX_AGE_MS);
	await db
		.insert(schema.verification)
		.values({ id, identifier: id, value: principal.userId, expiresAt })
		.onConflictDoUpdate({
			target: schema.verification.id,
			set: { value: principal.userId, expiresAt, updatedAt: new Date(now) },
		});
	return expiresAt;
}

/**
 * Until when this session counts as freshly authenticated, or null when it
 * doesn't (stale, unknown session, or a session of another user).
 */
export async function reauthFreshUntil(db: AuthDb, principal: Principal, now = Date.now()): Promise<Date | null> {
	const session = await db
		.select({ createdAt: schema.session.createdAt })
		.from(schema.session)
		.where(and(eq(schema.session.id, principal.sessionId), eq(schema.session.userId, principal.userId)))
		.get();
	if (!session) return null;
	let until = session.createdAt.getTime() + REAUTH_MAX_AGE_MS;
	const row = await db
		.select({ value: schema.verification.value, expiresAt: schema.verification.expiresAt })
		.from(schema.verification)
		.where(eq(schema.verification.id, reauthRowId(principal.sessionId)))
		.get();
	if (row && row.value === principal.userId) until = Math.max(until, row.expiresAt.getTime());
	return until > now ? new Date(until) : null;
}

export async function isReauthFresh(db: AuthDb, principal: Principal, now = Date.now()): Promise<boolean> {
	return (await reauthFreshUntil(db, principal, now)) !== null;
}

/** Placeholder logins (`…@users.inboxies.invalid`) can't receive mail. */
export function isDeliverableLogin(email: string): boolean {
	return !email.toLowerCase().endsWith(".invalid");
}

/**
 * Where a re-auth code may go: the verified recovery email, else the login
 * address when it is outside Inboxies (an Apple/Google user's own inbox).
 * Never a mailbox we host: whoever holds the session can read that one.
 */
export async function reauthEmailTarget(env: Env, db: AuthDb, user: { id: string; email: string }): Promise<string | null> {
	const recovery = await verifiedRecoveryEmail(db, user.id);
	if (recovery) return recovery;
	if (isDeliverableLogin(user.email) && !(await isHostedEmailDomain(env, user.email))) return user.email;
	return null;
}

/** `ada.backup@gmail.com` → `a•••p@gmail.com`. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf("@");
	if (at <= 0) return "•••";
	const local = email.slice(0, at);
	const shown = local.length <= 2 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`;
	return `${shown}${email.slice(at)}`;
}

export type ReauthOptions = {
	methods: ReauthMethod[];
	/** A password re-auth also needs a TOTP or backup code. */
	twoFactor: boolean;
	/** Masked address an `email_code` goes to, when offered. */
	emailCodeTo: string | null;
};

/** The ways this user can re-authenticate. `sign_in` is always last. */
export async function reauthOptions(env: Env, userId: string): Promise<ReauthOptions> {
	const db = authDb(env.AUTH_DB);
	const user = await db
		.select({ id: schema.user.id, email: schema.user.email, twoFactorEnabled: schema.user.twoFactorEnabled })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.get();
	if (!user) return { methods: ["sign_in"], twoFactor: false, emailCodeTo: null };
	const [credential, passkey] = await Promise.all([
		db
			.select({ id: schema.account.id })
			.from(schema.account)
			.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")))
			.get(),
		db.select({ id: schema.passkey.id }).from(schema.passkey).where(eq(schema.passkey.userId, userId)).get(),
	]);
	const methods: ReauthMethod[] = [];
	if (credential) methods.push("password");
	if (passkey) methods.push("passkey");
	let emailCodeTo: string | null = null;
	if (!credential) {
		const target = await reauthEmailTarget(env, db, user);
		if (target) {
			methods.push("email_code");
			emailCodeTo = maskEmail(target);
		}
	}
	methods.push("sign_in");
	return { methods, twoFactor: Boolean(credential && user.twoFactorEnabled), emailCodeTo };
}

/** The 403 body every gated route answers with. */
export async function reauthRequiredBody(env: Env, userId: string) {
	return {
		error: REAUTH_REQUIRED_MESSAGE,
		// Better Auth's browser client reads `message`.
		message: REAUTH_REQUIRED_MESSAGE,
		code: REAUTH_REQUIRED_CODE,
		maxAgeSeconds: REAUTH_MAX_AGE_MS / 1000,
		...(await reauthOptions(env, userId)),
	};
}

/**
 * Null when `principal`'s session is fresh; otherwise the 403 body to send.
 * Use at the top of every gated route, after the session check.
 */
export async function reauthGate(env: Env, principal: Principal): Promise<Awaited<ReturnType<typeof reauthRequiredBody>> | null> {
	if (await isReauthFresh(authDb(env.AUTH_DB), principal)) return null;
	return reauthRequiredBody(env, principal.userId);
}
