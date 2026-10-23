// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Sign in with Apple JS for the login page. The popup returns an Apple ID
 * token whose audience is the Worker's `APPLE_WEB_SERVICES_ID` (exposed as
 * `appleWebClientId` on /api/v1/config). The script is loaded only when the
 * button is shown.
 */

export type AppleSignInResponse = {
	authorization: { code: string; id_token: string; state?: string };
	/** Only on the first authorization for this Services ID. */
	user?: { email?: string; name?: { firstName?: string; lastName?: string } };
};

declare global {
	interface Window {
		AppleID?: {
			auth: {
				init: (config: {
					clientId: string;
					scope?: string;
					redirectURI: string;
					state?: string;
					nonce?: string;
					usePopup?: boolean;
				}) => void;
				signIn: () => Promise<AppleSignInResponse>;
			};
		};
	}
}

const APPLE_JS_SRC =
	"https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

export function loadAppleIdentityScript(): Promise<void> {
	if (window.AppleID?.auth) return Promise.resolve();
	const existing = document.querySelector<HTMLScriptElement>('script[data-apple-js="1"]');
	if (existing) {
		return new Promise((resolve, reject) => {
			existing.addEventListener("load", () => resolve());
			existing.addEventListener("error", () => reject(new Error("Failed to load Sign in with Apple")));
		});
	}
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = APPLE_JS_SRC;
		script.async = true;
		script.dataset.appleJs = "1";
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Failed to load Sign in with Apple"));
		document.head.appendChild(script);
	});
}

/** A fresh random nonce (hex) for one sign-in attempt. */
export function randomNonce(bytes = 16): string {
	const buf = crypto.getRandomValues(new Uint8Array(bytes));
	return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Apple JS rejects with `{ error: "popup_closed_by_user" }` when people back out. */
export function isAppleSignInCancelled(err: unknown): boolean {
	const code = (err as { error?: unknown } | null)?.error;
	return code === "popup_closed_by_user" || code === "user_cancelled_authorize";
}
