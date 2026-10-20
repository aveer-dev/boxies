// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Private Email product logo: the simplified Inboxies paper plane with a half-filled
 * shield badge at the bottom right. One colour (the current text colour), drawn on a
 * 32-unit grid so it stays legible at 14–40 px. Geometry comes from
 * `scripts/generate-logo-assets.mjs` (PRIVATE) — keep the two in sync.
 */
export default function PrivateEmailLogo({
	size = 20,
	className = "",
	showTile = false,
	alwaysLight = false,
}: {
	size?: number;
	className?: string;
	showTile?: boolean;
	alwaysLight?: boolean;
}) {
	const markSize = showTile ? Math.round(size * 0.8) : size;
	const svgContent = (
		<svg
			width={markSize}
			height={markSize}
			viewBox="0 0 32 32"
			className={showTile ? "" : className}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinejoin="round"
			strokeLinecap="round"
			xmlns="http://www.w3.org/2000/svg"
			style={alwaysLight ? { color: "#1F1F24" } : undefined}
			aria-hidden="true"
		>
			<path d="M 21.2 3.7 L 3.35 10.5 L 6.75 13.9 L 8.45 20.7 L 11.85 18.15 L 15.25 20.7 Z" />
			<path d="M 21.2 3.7 L 10.15 15.6 L 8.45 20.7" />
			<path d="M 10.15 15.6 L 13.55 19 L 11.85 18.15 L 8.45 20.7 Z" fill="currentColor" />
			<path
				d="M 24.1 16.1 L 28.6 17.85 V 22.1 C 28.6 25.1 26.6 27.2 24.1 28.35 C 21.6 27.2 19.6 25.1 19.6 22.1 V 17.85 Z"
				strokeWidth={1.5}
			/>
			<path
				d="M 24.1 16.1 L 28.6 17.85 V 22.1 C 28.6 25.1 26.6 27.2 24.1 28.35 Z"
				fill="currentColor"
				strokeWidth={1.5}
			/>
		</svg>
	);

	if (showTile) {
		return (
			<div
				className={`inline-flex items-center justify-center overflow-hidden ${
					alwaysLight
						? "bg-white border border-gray-200 shadow-sm"
						: "bg-kumo-base border border-kumo-line shadow-sm"
				} ${className}`}
				style={{ width: size, height: size, borderRadius: size * 0.22 }}
			>
				{svgContent}
			</div>
		);
	}

	return svgContent;
}
