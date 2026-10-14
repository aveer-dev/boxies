// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import api from "~/services/api";

/**
 * Sign out of the web session. The session cookie is HttpOnly, so only the
 * Worker can revoke it and clear it; then land on the sign-in screen.
 */
export async function signOut(): Promise<void> {
	try {
		await api.logout();
	} catch {
		// Already signed out or unreachable: still leave the app.
	}
	window.location.href = "/login";
}
