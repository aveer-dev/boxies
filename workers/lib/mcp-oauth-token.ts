// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Which credential a `/mcp` request carries (AVE-67). Kept free of the OAuth
 * library so the session middleware can import it.
 *
 * - An OAuth access token from our authorization server (workers/mcp/oauth.ts)
 *   is `userId:grantId:secret`: exactly three non-empty parts split by `:`.
 * - A Better Auth session token (cookie or `Authorization: Bearer`, the legacy
 *   MCP credential) never contains `:` (random alphanumerics, optionally
 *   `.signature` in base64).
 *
 * The shapes don't overlap, so each request takes exactly one auth path and an
 * OAuth token is never sent to Better Auth (or the other way round).
 */

/** The same Bearer syntax the OAuth library accepts (RFC 6750, one token). */
export function bearerTokenFromHeaders(headers: Headers): string | null {
	const header = headers.get("authorization");
	if (!header) return null;
	return /^Bearer[\t ]+([^\s,]+)$/i.exec(header)?.[1] ?? null;
}

export function isOAuthAccessTokenShape(token: string): boolean {
	const parts = token.split(":");
	return parts.length === 3 && parts.every((part) => part.length > 0);
}

/** `/mcp` and its sub-paths, not `/mcpfoo`. */
export function isMcpPath(pathname: string): boolean {
	return pathname === "/mcp" || pathname.startsWith("/mcp/");
}

/** True when this `/mcp` request must be authenticated as an OAuth access token. */
export function isOAuthMcpRequest(pathname: string, headers: Headers): boolean {
	if (!isMcpPath(pathname)) return false;
	const token = bearerTokenFromHeaders(headers);
	return token !== null && isOAuthAccessTokenShape(token);
}
