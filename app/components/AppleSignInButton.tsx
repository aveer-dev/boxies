// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { cn, Loader } from "@cloudflare/kumo";
import { useEffect, useRef, useState } from "react";
import {
	type AppleSignInResponse,
	isAppleSignInCancelled,
	loadAppleIdentityScript,
	randomNonce,
} from "~/lib/apple-identity";

export type AppleCredential = {
	identityToken: string;
	/** Raw nonce passed to Apple; the Worker checks it against the token. */
	nonce: string;
	/**
	 * Apple's one-time code. The Worker exchanges it (as the Services ID) for
	 * a refresh token so deleting the account can revoke Apple's grant.
	 */
	authorizationCode?: string;
	fullName?: { givenName?: string; familyName?: string };
};

/**
 * "Continue with Apple", sized like GoogleSignInButton. Apple's guidelines
 * want a black button (white on dark backgrounds) with the Apple logo, so it
 * isn't a Kumo button. Clicking opens Apple's popup (Apple JS,
 * `usePopup: true`) with a fresh nonce.
 */
export function AppleSignInButton({
	clientId,
	onCredential,
	onError,
	busy = false,
	label = "Continue with Apple",
	className,
}: {
	clientId: string;
	onCredential: (credential: AppleCredential) => void;
	onError?: (message: string) => void;
	busy?: boolean;
	label?: string;
	className?: string;
}) {
	const [ready, setReady] = useState(false);
	const [popupOpen, setPopupOpen] = useState(false);
	const onCredentialRef = useRef(onCredential);
	onCredentialRef.current = onCredential;
	const onErrorRef = useRef(onError);
	onErrorRef.current = onError;

	useEffect(() => {
		let cancelled = false;
		loadAppleIdentityScript()
			.then(() => {
				if (!cancelled) setReady(Boolean(window.AppleID?.auth));
			})
			.catch(() => {
				/* Apple JS unavailable (blocked or offline): other sign-in methods still work */
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleClick = async () => {
		const auth = window.AppleID?.auth;
		if (!auth || busy || popupOpen) return;
		const nonce = randomNonce();
		// init is synchronous; signIn must run in the same click so the popup isn't blocked.
		auth.init({
			clientId,
			scope: "name email",
			// Must be a Return URL registered on the Services ID. The Worker
			// exchanges the code with `${APP_BASE_URL}/login` as redirect_uri;
			// other hosts redirect /login there, so the two match.
			redirectURI: `${window.location.origin}/login`,
			state: randomNonce(8),
			nonce,
			usePopup: true,
		});
		setPopupOpen(true);
		let response: AppleSignInResponse;
		try {
			response = await auth.signIn();
		} catch (err) {
			if (!isAppleSignInCancelled(err)) onErrorRef.current?.("Apple sign-in failed");
			return;
		} finally {
			setPopupOpen(false);
		}
		const identityToken = response.authorization?.id_token;
		if (!identityToken) {
			onErrorRef.current?.("Apple sign-in failed");
			return;
		}
		const name = response.user?.name;
		onCredentialRef.current({
			identityToken,
			nonce,
			authorizationCode: response.authorization?.code || undefined,
			fullName: name ? { givenName: name.firstName, familyName: name.lastName } : undefined,
		});
	};

	const disabled = !ready || busy || popupOpen;

	return (
		<button
			type="button"
			onClick={() => void handleClick()}
			disabled={disabled}
			aria-busy={busy}
			className={cn(
				// Same shape as Kumo's base button (and so the Google face above it).
				"flex h-9 w-full shrink-0 select-none items-center gap-1.5 rounded-lg px-3 text-base font-medium shadow-xs",
				"cursor-pointer bg-black text-white hover:bg-neutral-800",
				"dark:bg-white dark:text-black dark:hover:bg-neutral-200",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
		>
			{busy ? <Loader size={16} /> : <AppleLogo size={16} />}
			{label}
		</button>
	);
}

function AppleLogo({ size }: { size: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 814 1000" fill="currentColor" aria-hidden>
			<path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
		</svg>
	);
}
