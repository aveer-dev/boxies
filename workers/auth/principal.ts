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

export type SessionScope = "aliases";

export type RequestPrincipal = {
	userId: string;
	sessionId: string;
	email: string;
	/** Null for a full app session; "aliases" for extension / AutoFill tokens. */
	scope: SessionScope | null;
};

function parseScope(value: unknown): SessionScope | null {
	return value === "aliases" ? "aliases" : null;
}

/** The signed-in principal for these request headers (cookie or Bearer), or null. */
export async function principalFromHeaders(
	env: Env,
	headers: Headers,
): Promise<RequestPrincipal | null> {
	try {
		const result = await getAuth(env).api.getSession({ headers });
		if (!result?.session || !result.user) return null;
		const session = result.session as typeof result.session & { scope?: unknown };
		return {
			userId: result.user.id,
			sessionId: session.id,
			email: result.user.email,
			scope: parseScope(session.scope),
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
