// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Public API + SPA paths that must work without Access / Bearer (token-gated later). */
export function isPublicAuthPath(pathname: string): boolean {
	if (
		pathname === "/api/v1/auth/apple" ||
		pathname === "/api/v1/auth/google" ||
		pathname === "/api/v1/auth/dev" ||
		pathname === "/api/v1/auth/password" ||
		pathname === "/api/v1/auth/password/logout" ||
		pathname === "/api/v1/auth/password/forgot" ||
		pathname === "/api/v1/auth/password/reset" ||
		pathname === "/api/v1/auth/signup-personal" ||
		pathname === "/api/v1/auth/signup-domain" ||
		pathname === "/api/v1/auth/domains/check" ||
		pathname === "/api/v1/billing/create-domain-checkout" ||
		pathname === "/api/v1/billing/checkout-return" ||
		pathname === "/api/v1/billing/stripe-webhook"
	) {
		return true;
	}
	if (pathname.startsWith("/api/v1/invites/")) return true;
	// Public deployment config (mail domain) for native create-address UI.
	if (pathname === "/api/v1/config") return true;
	// Invite accept + password login SPA shells (Access bypass required at edge too).
	if (pathname === "/login" || pathname.startsWith("/login/")) return true;
	if (pathname === "/reset-password" || pathname.startsWith("/reset-password/")) return true;
	if (pathname === "/invite" || pathname.startsWith("/invite/")) return true;
	return false;
}
