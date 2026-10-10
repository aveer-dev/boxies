// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import api from "~/services/api";

/**
 * Sign out of whichever web session is active. The password-session cookie is
 * HttpOnly, so only the Worker can clear it; Cloudflare Access sessions end at
 * Access's logout endpoint.
 */
export async function signOut(): Promise<void> {
	let isPasswordSession = false;
	try {
		const me = await api.getMe();
		isPasswordSession = Boolean(me.sub?.startsWith("user:"));
	} catch {
		// Already signed out or unreachable: still clear the cookie below.
	}
	try {
		await api.passwordLogout();
	} catch {
		// Best effort; the redirect below still leaves the app.
	}
	window.location.href = isPasswordSession ? "/login" : "/cdn-cgi/access/logout";
}
