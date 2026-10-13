// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Better Auth on AUTH_DB. Built per request because Worker bindings only
 * exist inside a request.
 *
 * Identity rules (see docs in the auth plan):
 * - A user is `user.id`. Emails never link or unlock accounts: implicit
 *   linking is off, so an Apple/Google sign-in whose email matches an existing
 *   user is refused (`account_not_linked`) until that user links it while
 *   signed in.
 * - Sessions are rows: sign-out, password reset and "sign out everywhere"
 *   revoke them. Mobile, MCP and the extension send the session token as a
 *   Bearer header; the web app uses the HttpOnly cookie.
 * - Sign-up goes through our own onboarding routes (they also create the
 *   mailbox), so Better Auth's public sign-up is disabled.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { hashPassword, verifyPassword } from "../lib/password-auth";
import type { Env } from "../types";
import { sendAuthEmail } from "./mail";
import * as schema from "./schema";

export const AUTH_BASE_PATH = "/api/auth";
const DAY_SECONDS = 24 * 60 * 60;

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
		providers.apple = {
			clientId: env.APPLE_CLIENT_ID,
			clientSecret: env.APPLE_CLIENT_SECRET ?? "",
			// Native iOS ID tokens carry the bundle id as their audience.
			appBundleIdentifier: env.APPLE_APP_BUNDLE_ID ?? env.APPLE_CLIENT_ID,
		};
	}
	return providers;
}

export function isBetterAuthEnabled(env: Env): boolean {
	return env.BETTER_AUTH_ENABLED === "true" && Boolean(env.AUTH_DB) && Boolean(env.BETTER_AUTH_SECRET);
}

/**
 * The handler-level surface the Worker uses. Spelled out because the fully
 * inferred Better Auth type can't be named outside the package (TS2742).
 */
export type Auth = Pick<ReturnType<typeof betterAuth>, "handler" | "api" | "options">;

export function createAuth(env: Env): Auth {
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
			// Wired to the verified recovery email at cutover (R2). Until then
			// nothing can request a reset through Better Auth.
			sendResetPassword: async () => {
				throw new Error("Password reset is not enabled yet");
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
		},
		plugins: [
			bearer(),
			emailOTP({
				disableSignUp: true,
				otpLength: 6,
				expiresIn: 10 * 60,
				sendVerificationOTP: async ({ email, otp, type }) => {
					await sendAuthEmail(env, {
						to: email,
						subject: type === "forget-password" ? "Your Inboxies reset code" : "Your Inboxies code",
						text: `Your code is ${otp}. It expires in 10 minutes. If you didn't ask for it, ignore this email.`,
					});
				},
			}),
		],
	});
}
