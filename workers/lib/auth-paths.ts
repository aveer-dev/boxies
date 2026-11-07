// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

const MAILBOX_ALIASES_PATH = /^\/api\/v1\/mailboxes\/[^/]+\/aliases$/;

/**
 * What a scoped session token may call. Browser-extension tokens live in a
 * less trusted place than the app, so they can list mailboxes and create or
 * list private emails — never read mail, send, or reach agents/MCP.
 */
export function isPathAllowedForTokenScope(
	scope: "aliases",
	method: string,
	pathname: string,
): boolean {
	if (scope !== "aliases") return false;
	const verb = method.toUpperCase();
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
