// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The signed-in user's account: profile, sessions, recovery email, sign-in
 * methods, account deletion; plus the sign-in routes app builds already in
 * the stores call (`/api/v1/auth/{apple,google,password,…}`).
 *
 * The compatibility routes run Better Auth underneath and answer in the old
 * JSON shapes with a bearer session token (`{ token, expiresAt, … }`), so
 * those builds keep working once their users sign in again.
 */

import type { Context, Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "../auth";
import { revokeAppleTokens, storeAppleRefreshToken } from "../auth/apple";
import { authDb, listDomainsForUser, listMailboxesForUser, removeMailboxMember, type AuthDb } from "../auth/authz";
import { isHostedEmailDomain } from "../auth/hooks";
import { appBaseUrl, codeEmail, sendSystemEmail } from "../auth/mail";
import { deleteMailboxRows, pruneDeviceTokensToMembership } from "../auth/mailboxes";
import { consumeLinkToken, consumeOtp, issueLinkToken, issueOtp, revokeLinkTokens } from "../auth/otp";
import { userKey, type RequestPrincipal } from "../auth/principal";
import { clientIp, isRateLimited, TOO_MANY } from "../auth/rate-limit";
import * as schema from "../auth/schema";
import {
	clearSessionCookieHeader,
	createSessionForUser,
	findUserByEmail,
	findUserById,
	hasPassword,
	revokeSession,
	revokeUserSessions,
	sessionCookieHeader,
	setUserPassword,
	verifiedRecoveryEmail,
	type MintedSession,
} from "../auth/users";
import { isDevRuntime } from "../lib/dev-runtime";
import { purgeEmailAgents } from "../lib/email-agent";
import { getMailboxStub } from "../lib/email-helpers";
import type { MailboxContext } from "../lib/mailbox";
import { mailDomainConfig } from "../lib/mail-domain";
import { canonicalMailboxId } from "../lib/mailbox-routing";
import { validatePasswordStrength, verifyPassword } from "../lib/password-auth";
import type { Env } from "../types";

type App = Hono<MailboxContext>;
type C = Context<MailboxContext>;

const RESET_LINK_TTL_MS = 60 * 60 * 1000;
const GENERIC_FORGOT_REPLY = {
	ok: true,
	message: "If an account exists with this email, reset instructions have been sent.",
} as const;

export function requirePrincipal(c: C): RequestPrincipal | null {
	return c.get("principal") ?? null;
}

/**
 * Display keys for compatibility payloads. Shipped clients match these
 * against `settings.acl` to decide what to show; they grant nothing.
 */
export function compatKeys(user: { id: string; email: string }): string[] {
	return [userKey(user.id), `email:${user.email}`];
}

/** Normalize a typed login: mailbox addresses canonicalize (plus-tags dropped). */
function loginEmail(raw: string): string {
	return canonicalMailboxId(raw) ?? raw.trim().toLowerCase();
}

async function sessionResponseFields(env: Env, session: MintedSession, user: { id: string; email: string }) {
	return {
		token: session.token,
		expiresAt: session.expiresAt.toISOString(),
		email: user.email,
		sub: userKey(user.id),
		keys: compatKeys(user),
	};
}

/** The session row behind a token Better Auth just issued. */
async function sessionByToken(db: AuthDb, token: string): Promise<MintedSession | null> {
	const row = await db
		.select({ id: schema.session.id, token: schema.session.token, expiresAt: schema.session.expiresAt })
		.from(schema.session)
		.where(eq(schema.session.token, token))
		.get();
	return row ? { id: row.id, token: row.token, expiresAt: row.expiresAt } : null;
}

function apiErrorStatus(e: unknown): number {
	const status = (e as { statusCode?: number; status?: number | string })?.statusCode;
	return typeof status === "number" ? status : 401;
}

function apiErrorMessage(e: unknown): string {
	const body = (e as { body?: { message?: string } })?.body;
	return body?.message || (e as Error)?.message || "";
}

// ── Identities (sign-in methods) ─────────────────────────────────

type IdentityRow = { type: string; key: string; label: string; current: boolean };

async function listIdentities(db: AuthDb, userId: string, user: { email: string }): Promise<IdentityRow[]> {
	const accounts = await db
		.select({ providerId: schema.account.providerId, accountId: schema.account.accountId })
		.from(schema.account)
		.where(eq(schema.account.userId, userId))
		.all();
	return accounts.map((a) => {
		const type = a.providerId === "credential" ? "password" : a.providerId;
		const label =
			type === "password" ? `Password (${user.email})` : type === "apple" ? "Apple" : type === "google" ? "Google" : type;
		return {
			type,
			key: type === "password" ? userKey(userId) : `sub:${a.accountId}`,
			label,
			current: false,
		};
	});
}

async function isAdminUser(db: AuthDb, userId: string): Promise<boolean> {
	return (await listDomainsForUser(db, userId)).length > 0;
}

// ── Social sign-in ───────────────────────────────────────────────

const SOCIAL_NOT_LINKED =
	"This sign-in isn't connected to an Inboxies account yet. Sign in with your password, then connect it in Settings.";

async function socialSignIn(
	c: C,
	provider: "apple" | "google",
	idToken: string,
	nonce?: string,
): Promise<{ ok: true; session: MintedSession; user: typeof schema.user.$inferSelect } | { ok: false; status: number; error: string }> {
	const db = authDb(c.env.AUTH_DB);
	try {
		const result = (await getAuth(c.env).api.signInSocial({
			body: { provider, idToken: { token: idToken, ...(nonce ? { nonce } : {}) } },
			headers: c.req.raw.headers,
		})) as { token?: string } | undefined;
		const session = result?.token ? await sessionByToken(db, result.token) : null;
		if (!session) return { ok: false, status: 401, error: `Invalid ${provider === "apple" ? "Apple" : "Google"} identity token` };
		const row = await db
			.select({ userId: schema.session.userId })
			.from(schema.session)
			.where(eq(schema.session.id, session.id))
			.get();
		const user = row ? await findUserById(db, row.userId) : undefined;
		if (!user) return { ok: false, status: 401, error: "Sign-in failed" };
		return { ok: true, session, user };
	} catch (e) {
		const message = apiErrorMessage(e);
		if (/not linked/i.test(message)) return { ok: false, status: 409, error: SOCIAL_NOT_LINKED };
		console.error(`[Auth] ${provider} sign-in failed:`, message);
		return { ok: false, status: 401, error: `Invalid ${provider === "apple" ? "Apple" : "Google"} identity token` };
	}
}

// ── Account deletion ─────────────────────────────────────────────

async function purgeMailbox(env: Env, db: AuthDb, mailboxId: string): Promise<void> {
	const stub = getMailboxStub(env, mailboxId);
	const { conversationIds } = await stub.purgeMailbox(mailboxId);
	await purgeEmailAgents(env, mailboxId, conversationIds);
	await deleteMailboxRows(db, mailboxId);
}

/**
 * Delete the user: mailboxes they solely own are purged, shared ones just
 * lose them; Apple tokens are revoked; sessions, accounts and memberships go
 * with the user row.
 */
export async function deleteUserAccount(env: Env, userId: string) {
	const db = authDb(env.AUTH_DB);
	const deletedMailboxes: string[] = [];
	const leftMailboxes: string[] = [];
	for (const { mailboxId, role } of await listMailboxesForUser(db, userId)) {
		const owners = await db
			.select({ userId: schema.mailboxMember.userId })
			.from(schema.mailboxMember)
			.where(and(eq(schema.mailboxMember.mailboxId, mailboxId), eq(schema.mailboxMember.role, "owner")))
			.all();
		if (role === "owner" && owners.every((o) => o.userId === userId)) {
			await purgeMailbox(env, db, mailboxId);
			deletedMailboxes.push(mailboxId);
			continue;
		}
		await db
			.delete(schema.mailboxMember)
			.where(and(eq(schema.mailboxMember.mailboxId, mailboxId), eq(schema.mailboxMember.userId, userId)));
		await pruneDeviceTokensToMembership(env, mailboxId);
		leftMailboxes.push(mailboxId);
	}
	await revokeAppleTokens(env, db, userId);
	const ctx = await getAuth(env).$context;
	await ctx.internalAdapter.deleteUser(userId);
	await db.insert(schema.auditLog).values({
		id: crypto.randomUUID(),
		actorUserId: userId,
		action: "user.delete",
		target: userId,
		detail: JSON.stringify({ deletedMailboxes, leftMailboxes }),
	});
	return { deletedMailboxes, leftMailboxes };
}

// ── Routes ───────────────────────────────────────────────────────

const AppleBody = z.object({
	identityToken: z.string().min(1),
	/** Raw nonce whose SHA-256 the app passed to Apple (new builds). */
	nonce: z.string().min(1).optional(),
	/** One-time code from Apple; exchanged so account deletion can revoke. */
	authorizationCode: z.string().min(1).optional(),
	fullName: z.object({ givenName: z.string().optional(), familyName: z.string().optional() }).optional(),
});

const GoogleBody = z.object({ idToken: z.string().min(1), nonce: z.string().min(1).optional() });
const PasswordLoginBody = z.object({ email: z.string().min(3).max(320), password: z.string().min(1).max(200) });
const ForgotBody = z.object({ email: z.string().email() });
const ResetBody = z.object({
	token: z.string().optional(),
	email: z.string().max(320).optional(),
	code: z.string().optional(),
	newPassword: z.string().min(1).max(200),
});

export function registerAccountRoutes(app: App) {
	// ── Sign-in (compatibility shapes) ────────────────────────────

	app.post("/api/v1/auth/apple", async (c) => {
		if (!c.env.APPLE_CLIENT_ID) return c.json({ error: "Apple Sign In is not configured." }, 503);
		if (await isRateLimited(c.env, "sign-in", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);
		const parsed = AppleBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "identityToken is required" }, 400);
		const result = await socialSignIn(c, "apple", parsed.data.identityToken, parsed.data.nonce);
		if (!result.ok) return c.json({ error: result.error }, result.status as 401);
		if (parsed.data.authorizationCode) {
			c.executionCtx.waitUntil(
				storeAppleRefreshToken(c.env, authDb(c.env.AUTH_DB), {
					userId: result.user.id,
					authorizationCode: parsed.data.authorizationCode,
				}),
			);
		}
		return c.json({
			token: result.session.token,
			expiresAt: result.session.expiresAt.toISOString(),
			user: { id: result.user.id, email: result.user.email, fullName: parsed.data.fullName ?? null },
		});
	});

	app.post("/api/v1/auth/google", async (c) => {
		if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: "Google Sign In is not configured." }, 503);
		if (await isRateLimited(c.env, "sign-in", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);
		const parsed = GoogleBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "idToken is required" }, 400);
		const result = await socialSignIn(c, "google", parsed.data.idToken, parsed.data.nonce);
		if (!result.ok) return c.json({ error: result.error }, result.status as 401);
		return c.json({
			token: result.session.token,
			expiresAt: result.session.expiresAt.toISOString(),
			user: {
				id: result.user.id,
				email: result.user.email,
				fullName: result.user.name ? { givenName: result.user.name } : null,
			},
		});
	});

	/** Local development only: sign in as any email, creating the user if needed. */
	app.post("/api/v1/auth/dev", async (c) => {
		if (!isDevRuntime()) return c.json({ error: "Dev auth is only available in local development" }, 404);
		const body = (await c.req.json().catch(() => ({}))) as { email?: string };
		const email = (body.email?.trim() || "dev@example.com").toLowerCase();
		const db = authDb(c.env.AUTH_DB);
		let user = await findUserByEmail(db, email);
		if (!user) {
			await db.insert(schema.user).values({ id: crypto.randomUUID(), email, name: email.split("@")[0], emailVerified: true });
			user = await findUserByEmail(db, email);
		}
		const session = await createSessionForUser(c.env, user!.id, { headers: c.req.raw.headers });
		c.header("Set-Cookie", await sessionCookieHeader(c.env, session));
		return c.json({
			token: session.token,
			expiresAt: session.expiresAt.toISOString(),
			user: { id: user!.id, email, fullName: null },
		});
	});

	app.post("/api/v1/auth/password", async (c) => {
		const parsed = PasswordLoginBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "Email and password are required" }, 400);
		if (await isRateLimited(c.env, "sign-in", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);
		const db = authDb(c.env.AUTH_DB);
		try {
			const { headers, response } = await getAuth(c.env).api.signInEmail({
				body: { email: loginEmail(parsed.data.email), password: parsed.data.password },
				headers: c.req.raw.headers,
				returnHeaders: true,
			});
			const session = await sessionByToken(db, response.token);
			if (!session) return c.json({ error: "Invalid email or password" }, 401);
			const cookie = headers.get("set-cookie");
			if (cookie) c.header("Set-Cookie", cookie);
			return c.json(await sessionResponseFields(c.env, session, response.user));
		} catch (e) {
			const status = apiErrorStatus(e);
			if (status >= 500) console.error("[Auth] Password sign-in failed:", apiErrorMessage(e));
			return c.json({ error: "Invalid email or password" }, 401);
		}
	});

	const logout = async (c: C) => {
		const principal = requirePrincipal(c);
		if (principal) await revokeSession(c.env, principal.userId, principal.sessionId);
		c.header("Set-Cookie", await clearSessionCookieHeader(c.env));
		return c.json({ ok: true });
	};
	app.post("/api/v1/auth/password/logout", logout);
	app.post("/api/v1/auth/logout", logout);

	/**
	 * Reset codes and links go only to the user's verified recovery email:
	 * a mailbox address may be readable by other members.
	 */
	app.post("/api/v1/auth/password/forgot", async (c) => {
		const parsed = ForgotBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "Please enter a valid email address" }, 400);
		if (await isRateLimited(c.env, "otp-send", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserByEmail(db, loginEmail(parsed.data.email));
		const recovery = user ? await verifiedRecoveryEmail(db, user.id) : null;
		if (!user || !recovery || !(await hasPassword(db, user.id))) {
			return c.json(GENERIC_FORGOT_REPLY);
		}
		const otp = await issueOtp(db, "password-reset", user.id, recovery);
		if (!otp.ok) return c.json(GENERIC_FORGOT_REPLY);
		const token = await issueLinkToken(db, "password-reset", user.id, RESET_LINK_TTL_MS);
		const resetUrl = `${appBaseUrl(c.env, c.req.url)}/reset-password?token=${token}`;
		const mail = codeEmail({
			purposeLine: `Someone asked to reset the password for ${user.email} on Inboxies.`,
			code: otp.code,
			extraLinkUrl: resetUrl,
			extraLinkLabel: "Reset your password",
		});
		const sent = await sendSystemEmail(c.env, { to: recovery, subject: "Reset your Inboxies password", ...mail });
		if (!sent && isDevRuntime()) console.log(`[Dev] Password reset code for ${user.email}: ${otp.code}`);
		return c.json({
			...GENERIC_FORGOT_REPLY,
			...(isDevRuntime() ? { devResetCode: otp.code, devResetToken: token } : {}),
		});
	});

	app.post("/api/v1/auth/password/reset", async (c) => {
		const parsed = ResetBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) {
			return c.json({ error: "Invalid request. Provide token, or email and code, and newPassword." }, 400);
		}
		const { newPassword } = parsed.data;
		const token = parsed.data.token?.trim() ?? "";
		const code = parsed.data.code?.trim() ?? "";
		const email = parsed.data.email?.trim() ?? "";
		if (!token && !code) return c.json({ error: "Reset token or 6-digit code is required." }, 400);
		if (!token && !email) return c.json({ error: "Email is required with the 6-digit code." }, 400);
		const strengthErr = validatePasswordStrength(newPassword);
		if (strengthErr) return c.json({ error: strengthErr }, 400);
		if (await isRateLimited(c.env, "otp-verify", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);

		const db = authDb(c.env.AUTH_DB);
		let userId: string | null = null;
		if (token) {
			userId = await consumeLinkToken(db, "password-reset", token);
		} else {
			const user = await findUserByEmail(db, loginEmail(email));
			if (user && (await consumeOtp(db, "password-reset", user.id, code)).ok) userId = user.id;
		}
		const user = userId ? await findUserById(db, userId) : undefined;
		if (!user) return c.json({ error: "Invalid or expired reset code or link." }, 400);

		await setUserPassword(db, user.id, newPassword);
		await revokeLinkTokens(db, "password-reset", user.id);
		await revokeUserSessions(c.env, user.id);
		const session = await createSessionForUser(c.env, user.id, { headers: c.req.raw.headers });
		c.header("Set-Cookie", await sessionCookieHeader(c.env, session));
		return c.json({ ok: true, ...(await sessionResponseFields(c.env, session, user)) });
	});

	// ── Profile ───────────────────────────────────────────────────

	app.get("/api/v1/me", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserById(db, principal.userId);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		const administeredDomains = await listDomainsForUser(db, user.id);
		const { mailDomain, domains } = mailDomainConfig(c.env);
		return c.json({
			userId: user.id,
			name: user.name,
			email: user.email,
			sub: userKey(user.id),
			linkedEmails: [],
			keys: compatKeys(user),
			isAdmin: administeredDomains.length > 0,
			administeredDomains,
			mailDomain,
			domains,
			sessionScope: principal.scope,
		});
	});

	/** Delete the signed-in account (App Store / Play requirement). Body `{ "confirm": "DELETE" }`. */
	app.delete("/api/v1/me", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const body = (await c.req.json().catch(() => ({}))) as { confirm?: string };
		if (body.confirm !== "DELETE") return c.json({ error: 'Confirm with { "confirm": "DELETE" }' }, 400);
		const result = await deleteUserAccount(c.env, principal.userId);
		c.header("Set-Cookie", await clearSessionCookieHeader(c.env));
		return c.json({ ok: true, ...result });
	});

	// ── Sessions ──────────────────────────────────────────────────

	app.get("/api/v1/me/sessions", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const rows = await authDb(c.env.AUTH_DB)
			.select()
			.from(schema.session)
			.where(eq(schema.session.userId, principal.userId))
			.all();
		const now = Date.now();
		return c.json(
			rows
				.filter((s) => s.expiresAt.getTime() > now)
				.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
				.map((s) => ({
					id: s.id,
					label: s.label,
					scope: s.scope,
					userAgent: s.userAgent,
					ipAddress: s.ipAddress,
					createdAt: s.createdAt.toISOString(),
					lastActiveAt: s.updatedAt.toISOString(),
					expiresAt: s.expiresAt.toISOString(),
					current: s.id === principal.sessionId,
				})),
		);
	});

	app.delete("/api/v1/me/sessions/:sessionId", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const ok = await revokeSession(c.env, principal.userId, c.req.param("sessionId"));
		if (!ok) return c.json({ error: "Not found" }, 404);
		return c.json({ ok: true });
	});

	/** "Sign out everywhere else". */
	app.post("/api/v1/me/sessions/revoke-others", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const revoked = await revokeUserSessions(c.env, principal.userId, { exceptSessionId: principal.sessionId });
		return c.json({ ok: true, revoked });
	});

	/**
	 * A scoped session for the browser extension or iOS/Android AutoFill. It
	 * can list mailboxes and create/list private emails, nothing else, and it
	 * shows up (and can be revoked) in the session list.
	 */
	app.post("/api/v1/me/extension-session", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const body = (await c.req.json().catch(() => ({}))) as { client?: string };
		const label =
			body.client === "ios-autofill"
				? "iPhone AutoFill"
				: body.client === "android-autofill"
					? "Android AutoFill"
					: "Browser extension";
		const session = await createSessionForUser(c.env, principal.userId, {
			scope: "aliases",
			label,
			headers: c.req.raw.headers,
		});
		return c.json({ id: session.id, token: session.token, expiresAt: session.expiresAt.toISOString(), label });
	});

	// ── Recovery email ────────────────────────────────────────────

	app.get("/api/v1/me/recovery-email", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const row = await authDb(c.env.AUTH_DB)
			.select()
			.from(schema.recoveryEmail)
			.where(eq(schema.recoveryEmail.userId, principal.userId))
			.get();
		return c.json({ email: row?.email ?? null, verified: Boolean(row?.verifiedAt) });
	});

	/** Set (or replace) the recovery email and mail it a code. */
	app.post("/api/v1/me/recovery-email", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const parsed = z.object({ email: z.string().email().max(320) }).safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "Please enter a valid email address" }, 400);
		const email = parsed.data.email.trim().toLowerCase();
		// Other people may read a mailbox we host (members, admins), so it
		// can't be where password resets go.
		if (await isHostedEmailDomain(c.env, email)) {
			return c.json({ error: "Use an address outside Inboxies for account recovery" }, 400);
		}
		if (
			(await isRateLimited(c.env, "otp-send", principal.userId)) ||
			(await isRateLimited(c.env, "otp-send", email))
		) {
			return c.json(TOO_MANY, 429);
		}
		const db = authDb(c.env.AUTH_DB);
		await db
			.insert(schema.recoveryEmail)
			.values({ userId: principal.userId, email, verifiedAt: null })
			.onConflictDoUpdate({
				target: schema.recoveryEmail.userId,
				set: { email, verifiedAt: null, updatedAt: new Date() },
			});
		const otp = await issueOtp(db, "recovery-email", principal.userId, email);
		if (!otp.ok) return c.json({ error: "A code was just sent. Wait a minute before asking again." }, 429);
		const mail = codeEmail({ purposeLine: "Confirm this address as your Inboxies recovery email.", code: otp.code });
		await sendSystemEmail(c.env, { to: email, subject: "Your Inboxies verification code", ...mail });
		return c.json({ ok: true, email, verified: false, ...(isDevRuntime() ? { devCode: otp.code } : {}) });
	});

	app.post("/api/v1/me/recovery-email/verify", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const parsed = z.object({ code: z.string().min(4).max(12) }).safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "Enter the 6-digit code" }, 400);
		if (await isRateLimited(c.env, "otp-verify", principal.userId)) return c.json(TOO_MANY, 429);
		const db = authDb(c.env.AUTH_DB);
		const row = await db
			.select()
			.from(schema.recoveryEmail)
			.where(eq(schema.recoveryEmail.userId, principal.userId))
			.get();
		if (!row) return c.json({ error: "Add a recovery email first" }, 400);
		const check = await consumeOtp(db, "recovery-email", principal.userId, parsed.data.code);
		// The code is bound to the address it was mailed to.
		if (!check.ok || check.target !== row.email) return c.json({ error: "Invalid or expired code" }, 400);
		await db
			.update(schema.recoveryEmail)
			.set({ verifiedAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.recoveryEmail.userId, principal.userId));
		return c.json({ ok: true, email: row.email, verified: true });
	});

	app.delete("/api/v1/me/recovery-email", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		// Domain owners must keep one (billing and renewal notices); they can replace it.
		const owns = await authDb(c.env.AUTH_DB)
			.select({ domain: schema.domain.domain })
			.from(schema.domain)
			.where(eq(schema.domain.ownerUserId, principal.userId))
			.get();
		if (owns) {
			return c.json(
				{ error: "Domain owners need a recovery email. Replace it instead of removing it.", code: "recovery_email_required" },
				400,
			);
		}
		await authDb(c.env.AUTH_DB).delete(schema.recoveryEmail).where(eq(schema.recoveryEmail.userId, principal.userId));
		return c.json({ ok: true });
	});

	// ── Sign-in methods ───────────────────────────────────────────

	app.get("/api/v1/me/identities", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserById(db, principal.userId);
		if (!user) return c.json({ error: "Unauthorized" }, 401);
		return c.json({
			accountId: user.id,
			identities: await listIdentities(db, user.id, user),
			keys: compatKeys(user),
			linkedEmails: [],
		});
	});

	/**
	 * Connect Apple/Google (a freshly verified ID token) or add a password to
	 * the signed-in user. Linking never happens by email.
	 */
	app.post("/api/v1/me/identities/attach", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const body = (await c.req.json().catch(() => ({}))) as {
			provider?: string;
			identityToken?: string;
			idToken?: string;
			nonce?: string;
			password?: string;
		};
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserById(db, principal.userId);
		if (!user) return c.json({ error: "Unauthorized" }, 401);

		if (body.provider === "password") {
			if (await hasPassword(db, user.id)) return c.json({ error: "This account already has a password" }, 409);
			const strength = validatePasswordStrength(body.password ?? "");
			if (strength) return c.json({ error: strength }, 400);
			await setUserPassword(db, user.id, body.password!);
		} else if (body.provider === "apple" || body.provider === "google") {
			const token = body.provider === "apple" ? body.identityToken ?? body.idToken : body.idToken ?? body.identityToken;
			if (!token) return c.json({ error: "An identity token is required" }, 400);
			try {
				await getAuth(c.env).api.linkSocialAccount({
					body: { provider: body.provider, idToken: { token, ...(body.nonce ? { nonce: body.nonce } : {}) } },
					headers: c.req.raw.headers,
				});
			} catch (e) {
				const message = apiErrorMessage(e);
				if (/already linked|different user/i.test(message)) {
					return c.json({ error: "This sign-in is already linked to another account" }, 409);
				}
				console.error("[Auth] Link failed:", message);
				return c.json({ error: "Couldn't verify that sign-in. Try again." }, 400);
			}
		} else {
			return c.json({ error: "provider must be apple, google or password" }, 400);
		}
		return c.json({
			ok: true,
			isAdmin: await isAdminUser(db, user.id),
			identities: await listIdentities(db, user.id, user),
		});
	});

	/** Change password; every other session is signed out. */
	app.post("/api/v1/me/identities/password", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const parsed = z
			.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) })
			.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "currentPassword and newPassword are required" }, 400);
		if (await isRateLimited(c.env, "sign-in", principal.userId)) return c.json(TOO_MANY, 429);
		const db = authDb(c.env.AUTH_DB);
		const credential = await db
			.select({ password: schema.account.password })
			.from(schema.account)
			.where(and(eq(schema.account.userId, principal.userId), eq(schema.account.providerId, "credential")))
			.get();
		if (!credential?.password) return c.json({ error: "This account has no password yet" }, 400);
		if (!(await verifyPassword(parsed.data.currentPassword, credential.password))) {
			return c.json({ error: "Current password is incorrect" }, 403);
		}
		const strength = validatePasswordStrength(parsed.data.newPassword);
		if (strength) return c.json({ error: strength }, 400);
		await setUserPassword(db, principal.userId, parsed.data.newPassword);
		await revokeUserSessions(c.env, principal.userId, { exceptSessionId: principal.sessionId });
		const user = await findUserById(db, principal.userId);
		return c.json({ ok: true, identities: user ? await listIdentities(db, user.id, user) : [] });
	});

	/** Disconnect a sign-in method. The last one can't be removed. */
	app.delete("/api/v1/me/identities/:type", async (c) => {
		const principal = requirePrincipal(c);
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const type = c.req.param("type");
		const providerId = type === "password" ? "credential" : type;
		const db = authDb(c.env.AUTH_DB);
		const accounts = await db
			.select({ id: schema.account.id, providerId: schema.account.providerId })
			.from(schema.account)
			.where(eq(schema.account.userId, principal.userId))
			.all();
		const target = accounts.filter((a) => a.providerId === providerId);
		if (target.length === 0) return c.json({ error: "Not found" }, 404);
		if (accounts.length - target.length < 1) {
			return c.json({ error: "You need at least one way to sign in" }, 400);
		}
		if (providerId === "apple") await revokeAppleTokens(c.env, db, principal.userId);
		for (const a of target) await db.delete(schema.account).where(eq(schema.account.id, a.id));
		return c.json({ ok: true });
	});

	// Link codes merged two signed-in identities into one account; linking is
	// now done by signing in with the other method while signed in.
	const linkCodesGone = (c: C) =>
		c.json({ error: "Link codes are no longer supported. Connect Apple or Google from Settings while signed in." }, 410);
	app.post("/api/v1/me/identity-link-codes", linkCodesGone);
	app.post("/api/v1/auth/redeem-identity-link", linkCodesGone);
	app.post("/api/v1/auth/link-provider", linkCodesGone);

	// The account directory exposed every user's email. Sharing now goes
	// through invites.
	app.get("/api/v1/accounts", (c) => c.json([]));
}

/** Remove a member from a mailbox and stop their push notifications for it. */
export async function leaveMailbox(env: Env, mailboxId: string, userId: string) {
	const result = await removeMailboxMember(authDb(env.AUTH_DB), mailboxId, userId);
	if (result.ok) await pruneDeviceTokensToMembership(env, mailboxId);
	return result;
}
