// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Who is calling: the Better Auth session behind the request.
 *
 * Every permission check keys off `userId`. `email` is the user's login
 * address, kept only for display and compatibility payloads; it never
 * grants anything.
 */

import { getAuth } from "./index";
import type { Env } from "../types";
import { noteSignedInRequest } from "./security-activity";
import { deleteWatchSession, liveParentSession, WATCH_SCOPE } from "./watch-session";

export type SessionScope = "aliases" | "watch";

export type RequestPrincipal = {
	userId: string;
	sessionId: string;
	email: string;
	/**
	 * Null for a full app session; "aliases" for extension / AutoFill tokens;
	 * "watch" for Apple Watch / Wear OS tokens (AVE-143).
	 */
	scope: SessionScope | null;
};

/**
 * The session's scope. Any non-empty scope we don't know is refused outright
 * (`invalid`) rather than read as a full session.
 */
function parseScope(value: unknown): SessionScope | null | "invalid" {
	if (value === null || value === undefined || value === "") return null;
	if (value === "aliases" || value === "watch") return value;
	return "invalid";
}

/** The signed-in principal for these request headers (cookie or Bearer), or null. */
export async function principalFromHeaders(
	env: Env,
	headers: Headers,
): Promise<RequestPrincipal | null> {
	try {
		const result = await getAuth(env).api.getSession({ headers });
		if (!result?.session || !result.user) return null;
		const session = result.session as typeof result.session & { scope?: unknown; parentSessionId?: unknown };
		const scope = parseScope(session.scope);
		if (scope === "invalid") return null;
		if (scope === WATCH_SCOPE) {
			// A watch session dies with the phone session it came from.
			const parentId = typeof session.parentSessionId === "string" ? session.parentSessionId : null;
			if (!(await liveParentSession(env, result.user.id, parentId))) {
				await deleteWatchSession(env, session.id);
				return null;
			}
		}
		// Sessions this request mints for an already signed-in user are
		// rotations (2FA setup, password change), not sign-ins (AVE-151).
		if (!scope) noteSignedInRequest(result.user.id);
		return {
			userId: result.user.id,
			sessionId: session.id,
			email: result.user.email,
			scope,
		};
	} catch (e) {
		console.error("[Auth] Session lookup failed:", (e as Error).message);
		return null;
	}
}

/** Device-token owner keys: pruned when the user leaves a mailbox or the session ends. */
export function deviceTokenOwnerKeys(principal: Pick<RequestPrincipal, "userId" | "sessionId">): string[] {
	return [userKey(principal.userId), sessionKey(principal.sessionId)];
}

export function userKey(userId: string): string {
	return `user:${userId}`;
}

export function sessionKey(sessionId: string): string {
	return `session:${sessionId}`;
}
