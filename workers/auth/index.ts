// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Better Auth on AUTH_DB.
 *
 * Identity rules:
 * - A user is `user.id`. Emails never link or unlock accounts: implicit
 *   linking is off, so an Apple/Google sign-in whose email matches an existing
 *   user is refused (`account_not_linked`) until that user links it while
 *   signed in.
 * - Sessions are rows: sign-out, password reset and "sign out everywhere"
 *   revoke them, and revoking one also drops the push tokens it registered.
 *   Mobile, MCP and the extension send the session token as a Bearer header;
 *   the web app uses the HttpOnly cookie.
 * - Password accounts are created by our onboarding and invite routes (they
 *   also create the mailbox), so Better Auth's email sign-up is disabled.
 *   Apple/Google sign-in may create a user, but never with an address on a
 *   domain we host: that address would block (or impersonate) its mailbox.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { hashPassword, verifyPassword } from "../lib/password-auth";
import type { Env } from "../types";
import { isHostedEmailDomain, pruneSessionDeviceTokens } from "./hooks";
import * as schema from "./schema";

export const AUTH_BASE_PATH = "/api/auth";
const DAY_SECONDS = 24 * 60 * 60;
/** Social sign-ups whose provider email is on a domain we host get this instead. */
export const PLACEHOLDER_EMAIL_DOMAIN = "users.inboxies.invalid";

function splitList(value: string | undefined): string[] {
	return (value ?? "")
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

function socialProviders(env: Env) {
	const providers: Record<string, unknown> = {};
	const googleClientIds = [
		env.GOOGLE_CLIENT_ID,
		...splitList(env.GOOGLE_EXTRA_CLIENT_IDS),
	].filter((v): v is string => Boolean(v));
	if (googleClientIds.length > 0) {
		// Web, iOS and Android each have their own client id; ID tokens from
		// any of them are accepted.
		providers.google = {
			clientId: googleClientIds,
			clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
		};
	}
	if (env.APPLE_CLIENT_ID) {
		const bundleId = env.APPLE_APP_BUNDLE_ID ?? env.APPLE_CLIENT_ID;
		providers.apple = {
			clientId: env.APPLE_CLIENT_ID,
			clientSecret: env.APPLE_CLIENT_SECRET ?? "",
			// Native iOS ID tokens carry the bundle id as their audience.
			appBundleIdentifier: bundleId,
			// Web (Apple JS) ID tokens carry the Services ID instead; accept
			// both only when one is configured.
			...(env.APPLE_WEB_SERVICES_ID ? { audience: [bundleId, env.APPLE_WEB_SERVICES_ID] } : {}),
		};
	}
	return providers;
}

export function isBetterAuthEnabled(env: Env): boolean {
	return Boolean(env.AUTH_DB) && Boolean(env.BETTER_AUTH_SECRET);
}

export function createAuth(env: Env) {
	if (!env.AUTH_DB) throw new Error("AUTH_DB binding is missing");
	if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set");
	const db = drizzle(env.AUTH_DB, { schema });

	return betterAuth({
		appName: "Inboxies",
		baseURL: env.APP_BASE_URL,
		basePath: AUTH_BASE_PATH,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: env.APP_BASE_URL ? [env.APP_BASE_URL] : [],
		database: drizzleAdapter(db, { provider: "sqlite", schema }),
		emailAndPassword: {
			enabled: true,
			disableSignUp: true,
			minPasswordLength: 10,
			maxPasswordLength: 200,
			// Keep the existing PBKDF2 format so migrated hashes verify as-is.
			// (Better Auth's default scrypt is too CPU-heavy for Workers.)
			password: {
				hash: hashPassword,
				verify: ({ hash, password }) => verifyPassword(password, hash),
			},
			revokeSessionsOnPasswordReset: true,
			// Resets go through /api/v1/auth/password/forgot, which only mails a
			// verified recovery address. Better Auth's own reset routes are not
			// routed (see `routes/better-auth.ts`).
			sendResetPassword: async () => {
				throw new Error("Use /api/v1/auth/password/forgot");
			},
		},
		socialProviders: socialProviders(env),
		account: {
			accountLinking: {
				enabled: true,
				disableImplicitLinking: true,
				allowDifferentEmails: true,
			},
		},
		session: {
			expiresIn: 30 * DAY_SECONDS,
			updateAge: DAY_SECONDS,
			additionalFields: {
				// Set only by our own routes (extension / AutoFill tokens).
				scope: { type: "string", required: false, input: false },
				label: { type: "string", required: false, input: false },
			},
		},
		databaseHooks: {
			user: {
				create: {
					// Only Apple/Google sign-up reaches this (our routes insert users
					// directly). A provider email on a domain we host would claim
					// that mailbox's login address, so it becomes a placeholder.
					before: async (user) => {
						const email = String(user.email ?? "").toLowerCase();
						if (!(await isHostedEmailDomain(env, email))) return { data: user };
						return {
							data: {
								...user,
								email: `${crypto.randomUUID()}@${PLACEHOLDER_EMAIL_DOMAIN}`,
								emailVerified: false,
							},
						};
					},
				},
			},
			session: {
				delete: {
					after: async (session) => {
						await pruneSessionDeviceTokens(env, {
							userId: String(session.userId),
							sessionId: String(session.id),
						});
					},
				},
			},
		},
		// Workers isolates don't share memory, so Better Auth's in-memory limiter
		// would only be per isolate; the Workers Rate Limiting bindings in front
		// of the auth routes do this job (see `auth/rate-limit.ts`).
		rateLimit: { enabled: false },
		plugins: [bearer()],
	});
}

export type Auth = ReturnType<typeof createAuth>;

const authCache = new WeakMap<object, Auth>();

/** One Better Auth instance per `env` object (Workers reuse it across requests). */
export function getAuth(env: Env): Auth {
	let auth = authCache.get(env);
	if (!auth) {
		auth = createAuth(env);
		authCache.set(env, auth);
	}
	return auth;
}
