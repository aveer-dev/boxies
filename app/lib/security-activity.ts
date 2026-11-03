// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Display helpers for Settings → Devices → "Recent security activity"
 * (`GET /api/v1/me/security-activity`, AVE-151). Same labels as the iOS
 * `SecurityActivity` and Android `securityEventTitle` helpers.
 */

/** Only the fields the labels read; see `SecurityActivityItem` in `~/types`. */
type ActivityLabelInput = {
	kind: string;
	newDevice?: boolean | null;
	provider?: string | null;
};

function providerName(provider: string | null | undefined): string | null {
	const p = provider?.trim().toLowerCase();
	if (!p) return null;
	if (p === "google") return "Google";
	if (p === "apple") return "Apple";
	if (p === "password" || p === "credential") return "Password";
	return p.charAt(0).toUpperCase() + p.slice(1);
}

/** "Signed in from a new device", "Password changed", "Google sign-in connected", … */
export function securityEventTitle(event: ActivityLabelInput): string {
	switch (event.kind) {
		case "sign_in":
			return event.newDevice ? "Signed in from a new device" : "Signed in";
		case "password_changed":
			return "Password changed";
		case "password_added":
			return "Password added";
		case "password_reset":
			return "Password reset";
		case "two_factor_enabled":
			return "Two-factor authentication turned on";
		case "two_factor_disabled":
			return "Two-factor authentication turned off";
		case "passkey_added":
			return "Passkey added";
		case "passkey_removed":
			return "Passkey removed";
		case "sign_in_method_added": {
			const name = providerName(event.provider);
			return name ? `${name} sign-in connected` : "Sign-in method connected";
		}
		case "sign_in_method_removed": {
			const name = providerName(event.provider);
			return name ? `${name} sign-in removed` : "Sign-in method removed";
		}
		case "recovery_email_set":
			return "Recovery email changed";
		case "recovery_email_removed":
			return "Recovery email removed";
		default:
			// A kind newer than this client.
			return "Account security change";
	}
}

/** "Chrome on macOS · Lagos, Nigeria"; empty when neither is known. */
export function securityEventDetail(event: {
	device?: string | null;
	location?: string | null;
}): string {
	return [event.device?.trim(), event.location?.trim()].filter(Boolean).join(" · ");
}

/** "Just now", "5 min ago", "3 hr ago", "Yesterday", "4 days ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) return "";
	const minutes = Math.floor(Math.max(0, now - at) / 60_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} hr ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "Yesterday";
	return `${days} days ago`;
}
