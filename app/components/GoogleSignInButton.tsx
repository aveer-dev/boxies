// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { buttonVariants, cn, Loader } from "@cloudflare/kumo";
import { useEffect, useRef } from "react";
import { loadGoogleIdentityScript } from "~/lib/google-identity";

type Size = "base" | "sm";

// GIS button heights are 40px (large) and 32px (medium); both cover our
// 36px (base) and 26px (sm) faces, and the overflow is clipped.
const GIS_SIZE: Record<Size, string> = { base: "large", sm: "medium" };

/**
 * "Continue with Google" drawn as a Kumo secondary button. GIS has no custom
 * button API that returns an ID token, so its real button is rendered
 * invisibly on top: clicks land on Google's iframe while people see ours.
 */
export function GoogleSignInButton({
	clientId,
	onCredential,
	busy = false,
	label = "Continue with Google",
	size = "base",
	className,
}: {
	clientId: string;
	onCredential: (idToken: string) => void;
	busy?: boolean;
	label?: string;
	size?: Size;
	className?: string;
}) {
	const gisRef = useRef<HTMLDivElement>(null);
	const onCredentialRef = useRef(onCredential);
	onCredentialRef.current = onCredential;

	useEffect(() => {
		let cancelled = false;
		let observer: ResizeObserver | undefined;
		(async () => {
			try {
				await loadGoogleIdentityScript();
				const container = gisRef.current;
				const gis = window.google?.accounts?.id;
				if (cancelled || !gis || !container) return;
				gis.initialize({
					client_id: clientId,
					callback: (response) => onCredentialRef.current(response.credential),
					auto_select: false,
					cancel_on_tap_outside: true,
				});
				// GIS takes a fixed pixel width (min 200, max 400), so re-render
				// when our face resizes or part of it stops being clickable.
				let renderedWidth = 0;
				const render = () => {
					const width = Math.min(400, Math.max(200, Math.round(container.offsetWidth)));
					if (width === renderedWidth) return;
					renderedWidth = width;
					container.innerHTML = "";
					gis.renderButton(container, {
						theme: "outline",
						size: GIS_SIZE[size],
						text: "continue_with",
						width,
					});
				};
				render();
				observer = new ResizeObserver(render);
				observer.observe(container);
			} catch {
				/* GIS unavailable (blocked or offline): other sign-in methods still work */
			}
		})();
		return () => {
			cancelled = true;
			observer?.disconnect();
		};
	}, [clientId, size]);

	return (
		<div className={cn("group/google relative", className)} aria-busy={busy}>
			<div
				aria-hidden
				className={cn(
					buttonVariants({ variant: "secondary", size }),
					"w-full pointer-events-none",
					"group-hover/google:bg-kumo-tint group-focus-within/google:ring-kumo-brand",
					busy && "opacity-50",
				)}
			>
				{busy ? <Loader size={size === "sm" ? 14 : 16} /> : <GoogleLogo size={size === "sm" ? 14 : 16} />}
				{label}
			</div>
			<div
				ref={gisRef}
				className={cn(
					"absolute inset-0 overflow-hidden opacity-0",
					size === "sm" ? "rounded-md" : "rounded-lg",
					busy && "pointer-events-none",
				)}
			/>
		</div>
	);
}

function GoogleLogo({ size }: { size: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
			<path
				fill="#EA4335"
				d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
			/>
			<path
				fill="#4285F4"
				d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
			/>
			<path
				fill="#FBBC05"
				d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
			/>
			<path
				fill="#34A853"
				d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
			/>
		</svg>
	);
}
