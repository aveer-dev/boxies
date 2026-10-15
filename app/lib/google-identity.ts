// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Google Identity Services (the "Sign in with Google" button) for the login
 * page and Settings → Connect Google. The button returns a Google ID token
 * (`credential`) whose audience is the Worker's `GOOGLE_CLIENT_ID`.
 */

declare global {
	interface Window {
		google?: {
			accounts: {
				id: {
					initialize: (config: {
						client_id: string;
						callback: (response: { credential: string }) => void;
						auto_select?: boolean;
						cancel_on_tap_outside?: boolean;
					}) => void;
					prompt: (
						momentListener?: (notification: {
							isNotDisplayed: () => boolean;
							isSkippedMoment: () => boolean;
							getNotDisplayedReason: () => string;
						}) => void,
					) => void;
					renderButton: (
						parent: HTMLElement,
						options: {
							theme?: string;
							size?: string;
							text?: string;
							width?: number;
						},
					) => void;
				};
			};
		};
	}
}

export function loadGoogleIdentityScript(): Promise<void> {
	if (window.google?.accounts?.id) return Promise.resolve();
	const existing = document.querySelector<HTMLScriptElement>(
		'script[data-google-gis="1"]',
	);
	if (existing) {
		return new Promise((resolve, reject) => {
			existing.addEventListener("load", () => resolve());
			existing.addEventListener("error", () =>
				reject(new Error("Failed to load Google Sign-In")),
			);
		});
	}
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = "https://accounts.google.com/gsi/client";
		script.async = true;
		script.defer = true;
		script.dataset.googleGis = "1";
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Failed to load Google Sign-In"));
		document.head.appendChild(script);
	});
}
