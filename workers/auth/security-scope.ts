// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Sign-in activity (AVE-151), judged once the response is ready: every
 * session Better Auth created during the request (any sign-in route, ours or
 * Better Auth's) that still exists and is a full app session is recorded as
 * a sign-in, and one from a new device mails a "was this you?" notice to the
 * login and the verified recovery email. Never on the request path: the
 * judging runs under `waitUntil`, and failures are only logged.
 */

import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { authDb } from "./authz";
import * as schema from "./schema";
import {
	classifySignIn,
	recordSecurityEvent,
	requestDevice,
	runInSecurityScope,
	type SecurityScope,
} from "./security-activity";
import { sendSecurityNotice } from "./security-notice";

/** Record (and, from a new device, announce) the sign-ins `scope` saw. */
export async function settleSecurityScope(env: Env, scope: SecurityScope, now = Date.now()): Promise<void> {
	if (!env.AUTH_DB || scope.sessions.length === 0) return;
	const db = authDb(env.AUTH_DB);
	const current = requestDevice(scope.request);
	const seen = new Set<string>();
	for (const { sessionId, userId } of scope.sessions) {
		// Already signed in on this request: a rotated session, not a sign-in.
		if (seen.has(sessionId) || scope.signedIn.has(userId)) continue;
		seen.add(sessionId);
		try {
			const row = await db
				.select({ scope: schema.session.scope })
				.from(schema.session)
				.where(eq(schema.session.id, sessionId))
				.get();
			// Gone again (two-factor challenge, re-auth) or an extension/AutoFill token.
			if (!row || row.scope) continue;
			const { newDevice } = await classifySignIn(db, { userId, sessionId, current, now });
			await recordSecurityEvent(db, { userId, kind: "sign_in", device: current, newDevice, at: new Date(now) });
			// A change notice (e.g. a password reset) from this request already told them.
			if (!newDevice || scope.noticed.has(userId)) continue;
			await sendSecurityNotice(env, {
				userId,
				requestUrl: scope.request.url,
				change: { kind: "new_device_sign_in" },
				device: current,
				skipRecord: true,
			});
		} catch (e) {
			console.error("[Auth] Sign-in activity failed:", (e as Error).message || e);
		}
	}
}

/**
 * Hono middleware body: run the rest of the request in a security scope,
 * then settle it after the response under `waitUntil`.
 */
export async function withSecurityScope(
	env: Env,
	request: Request,
	ctx: Pick<ExecutionContext, "waitUntil">,
	next: () => Promise<void>,
): Promise<void> {
	const scope = await runInSecurityScope(request, next);
	if (scope.sessions.length === 0) return;
	ctx.waitUntil(
		settleSecurityScope(env, scope).catch((e) =>
			console.error("[Auth] Sign-in activity failed:", (e as Error).message || e),
		),
	);
}
