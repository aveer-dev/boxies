// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Users, credentials and sessions outside Better Auth's own endpoints:
 * sign-up and invite accept create users together with their mailbox rows
 * in one D1 batch, and the compatibility sign-in routes mint sessions.
 * Session rows still go through Better Auth's internal adapter, so its
 * hooks (device-token pruning) fire.
 */

import { and, eq, ne } from "drizzle-orm";
import { hashPassword } from "../lib/password-auth";
import type { Env } from "../types";
import { getAuth } from "./index";
import { authDb, type AuthDb } from "./authz";
import type { SessionScope } from "./principal";
import * as schema from "./schema";

export type NewUser = {
	id?: string;
	email: string;
	name: string;
	emailVerified: boolean;
	/** Plain password; stored as a PBKDF2 hash on a "credential" account. */
	password?: string;
};

/** Insert statements for a user (and their password). Batch them with the mailbox rows. */
export async function userRowStatements(db: AuthDb, user: NewUser) {
	const id = user.id ?? crypto.randomUUID();
	const statements = [
		db.insert(schema.user).values({
			id,
			email: user.email.toLowerCase(),
			name: user.name,
			emailVerified: user.emailVerified,
		}),
	];
	if (user.password) {
		statements.push(
			db.insert(schema.account).values({
				id: `credential_${id}`,
				accountId: id,
				providerId: "credential",
				userId: id,
				password: await hashPassword(user.password),
			}) as unknown as (typeof statements)[number],
		);
	}
	return { id, statements };
}

export async function findUserByEmail(db: AuthDb, email: string) {
	return db
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, email.trim().toLowerCase()))
		.get();
}

export async function findUserById(db: AuthDb, userId: string) {
	return db.select().from(schema.user).where(eq(schema.user.id, userId)).get();
}

export type MintedSession = { id: string; token: string; expiresAt: Date };

/** A new session for `userId` (a revocable row like any Better Auth sign-in). */
export async function createSessionForUser(
	env: Env,
	userId: string,
	opts: { scope?: SessionScope; label?: string; headers?: Headers } = {},
): Promise<MintedSession> {
	const ctx = await getAuth(env).$context;
	const session = await ctx.internalAdapter.createSession(userId, false, {
		...(opts.scope ? { scope: opts.scope } : {}),
		...(opts.label ? { label: opts.label } : {}),
		...(opts.headers
			? {
					ipAddress: opts.headers.get("cf-connecting-ip") ?? "",
					userAgent: opts.headers.get("user-agent") ?? "",
				}
			: {}),
	});
	if (!session) throw new Error("Failed to create session");
	return { id: session.id, token: session.token, expiresAt: new Date(session.expiresAt) };
}

async function hmacBase64(secret: string, value: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

type CookieAttrs = { path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; domain?: string };

function cookieString(name: string, value: string, attrs: CookieAttrs, maxAge: number): string {
	let out = `${name}=${value}; Max-Age=${maxAge}; Path=${attrs.path ?? "/"}`;
	if (attrs.domain) out += `; Domain=${attrs.domain}`;
	if (attrs.httpOnly !== false) out += "; HttpOnly";
	if (attrs.secure) out += "; Secure";
	const sameSite = attrs.sameSite ?? "lax";
	out += `; SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`;
	return out;
}

/** The web session cookie for a minted session, exactly as Better Auth signs it. */
export async function sessionCookieHeader(env: Env, session: MintedSession): Promise<string> {
	const ctx = await getAuth(env).$context;
	const { name, attributes } = ctx.authCookies.sessionToken;
	const signed = encodeURIComponent(`${session.token}.${await hmacBase64(ctx.secret, session.token)}`);
	const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
	return cookieString(name, signed, attributes as CookieAttrs, maxAge);
}

export async function clearSessionCookieHeader(env: Env): Promise<string> {
	const ctx = await getAuth(env).$context;
	const { name, attributes } = ctx.authCookies.sessionToken;
	return cookieString(name, "", attributes as CookieAttrs, 0);
}

/** End one session (its device tokens go with it, via the session delete hook). */
export async function revokeSession(env: Env, userId: string, sessionId: string): Promise<boolean> {
	const db = authDb(env.AUTH_DB);
	const row = await db
		.select({ token: schema.session.token })
		.from(schema.session)
		.where(and(eq(schema.session.id, sessionId), eq(schema.session.userId, userId)))
		.get();
	if (!row) return false;
	const ctx = await getAuth(env).$context;
	await ctx.internalAdapter.deleteSession(row.token);
	return true;
}

/** End every session of `userId`, optionally keeping the caller's own. */
export async function revokeUserSessions(
	env: Env,
	userId: string,
	opts: { exceptSessionId?: string } = {},
): Promise<number> {
	const db = authDb(env.AUTH_DB);
	const rows = await db
		.select({ token: schema.session.token })
		.from(schema.session)
		.where(
			opts.exceptSessionId
				? and(eq(schema.session.userId, userId), ne(schema.session.id, opts.exceptSessionId))
				: eq(schema.session.userId, userId),
		)
		.all();
	if (rows.length === 0) return 0;
	const ctx = await getAuth(env).$context;
	await ctx.internalAdapter.deleteSessions(rows.map((r) => r.token));
	return rows.length;
}

/** Set (or replace) the user's password. */
export async function setUserPassword(db: AuthDb, userId: string, password: string): Promise<void> {
	const hash = await hashPassword(password);
	await db
		.insert(schema.account)
		.values({
			id: `credential_${userId}`,
			accountId: userId,
			providerId: "credential",
			userId,
			password: hash,
		})
		.onConflictDoUpdate({
			target: [schema.account.providerId, schema.account.accountId],
			set: { password: hash, updatedAt: new Date() },
		});
}

export async function hasPassword(db: AuthDb, userId: string): Promise<boolean> {
	const row = await db
		.select({ id: schema.account.id })
		.from(schema.account)
		.where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")))
		.get();
	return Boolean(row);
}

/** The user's verified recovery email, or null. */
export async function verifiedRecoveryEmail(db: AuthDb, userId: string): Promise<string | null> {
	const row = await db
		.select()
		.from(schema.recoveryEmail)
		.where(eq(schema.recoveryEmail.userId, userId))
		.get();
	return row?.verifiedAt ? row.email : null;
}

/** The user's recovery email, verified or not (billing notices may use either). */
export async function anyRecoveryEmail(db: AuthDb, userId: string): Promise<{ email: string; verified: boolean } | null> {
	const row = await db
		.select()
		.from(schema.recoveryEmail)
		.where(eq(schema.recoveryEmail.userId, userId))
		.get();
	return row ? { email: row.email, verified: Boolean(row.verifiedAt) } : null;
}
