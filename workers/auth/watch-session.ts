// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Watch sessions (AVE-143, docs/watch-companion-plan.md phase 2).
 *
 * The phone app mints a "watch"-scoped session from its own full session
 * (`POST /api/v1/me/extension-session` with `client: "watchos" | "wearos"`)
 * and hands the token to the paired watch. That session:
 * - may only call the routes in `isPathAllowedForTokenScope("watch", …)`;
 * - lives exactly as long as its phone session (`parent_session_id`): the
 *   phone's refresh extends it, deleting the phone session deletes it (FK
 *   cascade), and every request re-checks that the phone session is still a
 *   live full session of the same user;
 * - can't mint sessions (only full sessions reach the mint route);
 * - can be revoked on its own in Devices & sessions.
 *
 * Imports only the schema: `auth/index.ts` calls `extendWatchSessions` from a
 * Better Auth hook.
 */

import { and, eq } from "drizzle-orm";
import type { Env } from "../types";
import { authDb } from "./authz";
import * as schema from "./schema";

export const WATCH_SCOPE = "watch";

/** Session-list names for the two watch clients. */
export const WATCH_CLIENT_LABELS = {
	watchos: "Apple Watch",
	wearos: "Wear OS watch",
} as const;

export type WatchClient = keyof typeof WATCH_CLIENT_LABELS;

export function isWatchClient(client: unknown): client is WatchClient {
	return client === "watchos" || client === "wearos";
}

/**
 * The phone session a watch session belongs to, if it is still a live full
 * session of `userId`; otherwise null (the watch session must not be used).
 */
export async function liveParentSession(
	env: Env,
	userId: string,
	parentSessionId: string | null | undefined,
	now = Date.now(),
): Promise<{ id: string; expiresAt: Date } | null> {
	if (!parentSessionId) return null;
	const parent = await authDb(env.AUTH_DB)
		.select({
			id: schema.session.id,
			userId: schema.session.userId,
			scope: schema.session.scope,
			expiresAt: schema.session.expiresAt,
		})
		.from(schema.session)
		.where(eq(schema.session.id, parentSessionId))
		.get();
	if (!parent || parent.userId !== userId || parent.scope) return null;
	if (parent.expiresAt.getTime() <= now) return null;
	return { id: parent.id, expiresAt: parent.expiresAt };
}

/**
 * Carry a phone session's new expiry to its watch sessions (only ever
 * later). Runs from Better Auth's session update hook, so on the phone's
 * daily refresh; a failure is logged, never fails the phone's request.
 */
export async function extendWatchSessions(env: Env, parentSessionId: string, expiresAt: Date): Promise<void> {
	if (Number.isNaN(expiresAt.getTime())) return;
	try {
		// Raw SQL: drizzle's `$onUpdate` would also bump `updated_at`, which the
		// session list shows as the watch's "last active".
		await env.AUTH_DB.prepare(
			"UPDATE session SET expires_at = ?1 WHERE parent_session_id = ?2 AND scope = ?3 AND expires_at < ?1",
		)
			.bind(expiresAt.getTime(), parentSessionId, WATCH_SCOPE)
			.run();
	} catch (e) {
		console.error("[Auth] Extending watch sessions failed:", (e as Error).message);
	}
}

/** Drop a watch session whose phone session is gone (it has no push tokens to prune). */
export async function deleteWatchSession(env: Env, sessionId: string): Promise<void> {
	try {
		await authDb(env.AUTH_DB)
			.delete(schema.session)
			.where(and(eq(schema.session.id, sessionId), eq(schema.session.scope, WATCH_SCOPE)));
	} catch (e) {
		console.error("[Auth] Orphaned watch session cleanup failed:", (e as Error).message);
	}
}
