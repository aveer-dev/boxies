// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Request authentication (mounted in workers/app.ts).
 *
 * - Everyone but operators: a Better Auth session, from the HttpOnly cookie
 *   (web) or `Authorization: Bearer` (mobile, MCP, extension). No session is
 *   a 401. Auth bootstrap and invite routes are public but still see the
 *   caller's session when there is one.
 * - Scoped sessions (extension / AutoFill) only reach `isPathAllowedForTokenScope`.
 * - `/mcp` with an OAuth access token (`userId:grantId:secret`) skips this
 *   middleware: the `/mcp` route validates it (workers/mcp/oauth.ts). It is
 *   never looked up as a session, and every other path is unaffected.
 * - Operators: Cloudflare Access on /ops/* only. Access identities are never
 *   app users, and app sessions never reach /ops.
 */

import { createMiddleware } from "hono/factory";
import { isPathAllowedForTokenScope, isPublicAuthPath } from "../lib/auth-paths";
import { isOAuthMcpRequest } from "../lib/mcp-oauth-token";
import type { Env } from "../types";
import { verifyOperator, type Operator } from "./operators";
import { principalFromHeaders, type RequestPrincipal } from "./principal";

type AuthEnv = { Bindings: Env; Variables: { principal?: RequestPrincipal; operator?: Operator } };

/**
 * Shipped iOS/Android builds sign out only on this exact text (their
 * `isExpiredSessionResponse`); tokens from before the cutover land here too.
 */
export const EXPIRED_SESSION_ERROR = "Invalid or expired mobile session token";

function hasBearer(headers: Headers): boolean {
	return /^Bearer\s+\S/i.test(headers.get("authorization") ?? "");
}

/** Does the request carry anything that could be a session (Bearer or cookie)? */
export function hasSessionCredentials(headers: Headers): boolean {
	if (hasBearer(headers)) return true;
	return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(headers.get("cookie") ?? "");
}

export const operatorMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
	const operator = await verifyOperator(c.env, c.req.raw.headers);
	if (!operator) return c.json({ error: "Operator access required" }, 403);
	c.set("operator", operator);
	await next();
});

export const sessionMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
	const pathname = new URL(c.req.url).pathname;
	if (pathname === "/ops" || pathname.startsWith("/ops/")) return next();
	if (isOAuthMcpRequest(pathname, c.req.raw.headers)) return next();

	const headers = c.req.raw.headers;
	const presented = hasSessionCredentials(headers);
	const principal = presented ? await principalFromHeaders(c.env, headers) : null;
	if (principal) {
		if (principal.scope && !isPathAllowedForTokenScope(principal.scope, c.req.method, pathname)) {
			return c.json({ error: "This session can only manage private emails" }, 403);
		}
		c.set("principal", principal);
		return next();
	}
	if (isPublicAuthPath(pathname)) return next();
	if (presented && hasBearer(headers)) return c.json({ error: EXPIRED_SESSION_ERROR }, 401);

	// A signed-out browser opening an app page gets the sign-in screen, not a
	// raw 401. API, agent and MCP callers get the 401.
	const wantsHtml = (c.req.header("accept") || "").includes("text/html");
	const isAppPage =
		c.req.method === "GET" &&
		!pathname.startsWith("/api/") &&
		!pathname.startsWith("/agents/") &&
		!pathname.startsWith("/mcp");
	if (wantsHtml && isAppPage) {
		const url = new URL(c.req.url);
		const target = `${url.pathname}${url.search}`;
		return c.redirect(target === "/" ? "/login" : `/login?next=${encodeURIComponent(target)}`, 302);
	}
	return c.json({ error: "Unauthorized" }, 401);
});
