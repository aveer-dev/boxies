// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { SessionScope } from "../auth/principal";

const SEGMENT = "[^/]+";
const MAILBOX = `^/api/v1/mailboxes/${SEGMENT}`;
const MAILBOX_ALIASES_PATH = new RegExp(`${MAILBOX}/aliases$`);

/**
 * What a "watch" session may call (AVE-143, docs/watch-companion-plan.md):
 * read the inbox and threads, the phone notification actions (mark read,
 * Reply Later, archive / spam / back to Inbox) and quick reply. Nothing
 * else: no full reply or compose (no choosing a From address), no
 * forwarding, attachments, aliases, agents, MCP, admin, billing, settings,
 * device tokens or session management. Route handlers narrow some of these
 * further (`moveAllowedForWatch`).
 */
const WATCH_ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
	["GET", /^\/api\/v1\/me$/],
	["GET", /^\/api\/v1\/config$/],
	["GET", /^\/api\/v1\/mailboxes$/],
	// Folder list with unread counts (complications / tiles).
	["GET", new RegExp(`${MAILBOX}/folders$`)],
	["GET", new RegExp(`${MAILBOX}/emails$`)],
	["GET", new RegExp(`${MAILBOX}/emails/${SEGMENT}$`)],
	// read / starred / Reply Later flags.
	["PUT", new RegExp(`${MAILBOX}/emails/${SEGMENT}$`)],
	["POST", new RegExp(`${MAILBOX}/emails/${SEGMENT}/move$`)],
	["POST", new RegExp(`${MAILBOX}/emails/${SEGMENT}/quick-reply$`)],
	["GET", new RegExp(`${MAILBOX}/threads/${SEGMENT}$`)],
	["POST", new RegExp(`${MAILBOX}/threads/${SEGMENT}/read$`)],
	// A scoped session may end itself.
	["POST", /^\/api\/v1\/auth\/logout$/],
];

/** Folders a watch may move mail into: Archive, Report spam, and back to Inbox (undo / Not spam). */
export const WATCH_MOVE_FOLDERS: ReadonlySet<string> = new Set(["archive", "spam", "inbox"]);

/** A watch session's move: only to `WATCH_MOVE_FOLDERS`, and never with the one-click unsubscribe. */
export function moveAllowedForWatch(body: { folderId?: unknown; unsubscribe?: unknown }): boolean {
	return typeof body.folderId === "string" && WATCH_MOVE_FOLDERS.has(body.folderId) && body.unsubscribe !== true;
}

/**
 * What a scoped session token may call. Deny by default: anything not
 * listed for the token's scope is refused.
 * - "aliases" (browser extension, AutoFill): list mailboxes and create or
 *   list private emails — never read mail, send, or reach agents/MCP.
 * - "watch" (Apple Watch, Wear OS): `WATCH_ROUTES`.
 */
export function isPathAllowedForTokenScope(scope: SessionScope, method: string, pathname: string): boolean {
	const verb = method.toUpperCase();
	if (scope === "watch") {
		return WATCH_ROUTES.some(([routeVerb, pattern]) => routeVerb === verb && pattern.test(pathname));
	}
	if (scope !== "aliases") return false;
	if (verb === "GET" && (pathname === "/api/v1/mailboxes" || pathname === "/api/v1/me" || pathname === "/api/v1/config")) {
		return true;
	}
	// A scoped session may end itself (the app revokes AutoFill's on sign-out).
	if (verb === "POST" && pathname === "/api/v1/auth/logout") return true;
	return (verb === "GET" || verb === "POST") && MAILBOX_ALIASES_PATH.test(pathname);
}

/** API and SPA paths that work signed out (they still see the session when there is one). */
export function isPublicAuthPath(pathname: string): boolean {
	if (
		pathname === "/api/v1/auth/apple" ||
		pathname === "/api/v1/auth/google" ||
		pathname === "/api/v1/auth/dev" ||
		pathname === "/api/v1/auth/password" ||
		pathname === "/api/v1/auth/two-factor/verify" ||
		pathname === "/api/v1/auth/exchange" ||
		pathname === "/api/v1/auth/password/logout" ||
		pathname === "/api/v1/auth/logout" ||
		pathname === "/api/v1/auth/password/forgot" ||
		pathname === "/api/v1/auth/password/reset" ||
		pathname === "/api/v1/auth/signup-personal" ||
		pathname === "/api/v1/auth/signup-domain" ||
		pathname === "/api/v1/auth/domains/check" ||
		pathname === "/api/v1/billing/create-domain-checkout" ||
		pathname === "/api/v1/billing/checkout-return" ||
		pathname === "/api/v1/billing/checkout-cancel" ||
		pathname === "/api/v1/billing/checkout-status" ||
		pathname === "/api/v1/billing/renew-return" ||
		pathname === "/api/v1/billing/stripe-webhook"
	) {
		return true;
	}
	if (pathname.startsWith("/api/v1/invites/")) return true;
	// Public deployment config (mail domain) for native create-address UI.
	if (pathname === "/api/v1/config") return true;
	// React Router lazy route discovery; public pages (login, invite, reset)
	// fetch it on client-side navigation.
	if (pathname === "/__manifest") return true;
	// Invite accept + password login SPA shells (Access bypass required at edge too).
	if (pathname === "/login" || pathname.startsWith("/login/")) return true;
	// Onboarding (sign up) page shell; the signup APIs it calls are listed above.
	if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return true;
	if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) return true;
	if (pathname === "/invite" || pathname.startsWith("/invite/")) return true;
	if (pathname === "/checkout/success" || pathname.startsWith("/checkout/success/")) return true;
	if (pathname === "/checkout/cancel" || pathname.startsWith("/checkout/cancel/")) return true;
	return false;
}
