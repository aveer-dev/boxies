// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { CSSProperties } from "react";

const BLURS = [1, 2, 4, 8, 16];
const BAND = 100 / BLURS.length;

// Each layer fades in over one band, holds for one, and fades out over the
// next; the strongest runs on to the edge.
function bandMask(i: number, toward: string) {
	const stops = [
		`transparent ${i * BAND}%`,
		`#000 ${(i + 1) * BAND}%`,
		i + 2 <= BLURS.length && `#000 ${(i + 2) * BAND}%`,
		i + 3 <= BLURS.length && `transparent ${(i + 3) * BAND}%`,
	].filter(Boolean);
	return `linear-gradient(${toward}, ${stops.join(", ")})`;
}

/**
 * A frosted edge for a bar floating over scrolling content (the site's
 * ProgressiveBlur): what passes beneath blurs harder toward `edge` and fades
 * into the background. One backdrop-filter only blurs evenly, so the ramp is
 * a stack of them, each twice as strong and masked to its own band. Fills its
 * positioned parent.
 */
export default function ProgressiveBlur({
	edge,
	className = "",
}: {
	edge: "top" | "bottom";
	className?: string;
}) {
	const toward = `to ${edge}`;
	return (
		<div aria-hidden className={`pointer-events-none absolute inset-0 ${className}`}>
			{BLURS.map((blur, i) => {
				const mask = bandMask(i, toward);
				const style: CSSProperties = {
					backdropFilter: `blur(${blur}px)`,
					WebkitBackdropFilter: `blur(${blur}px)`,
					maskImage: mask,
					WebkitMaskImage: mask,
				};
				return <div key={blur} className="absolute inset-0" style={style} />;
			})}
			{/* A wash of the page colour over the blur, eased so it has no hard start. */}
			<div
				className="absolute inset-0"
				style={{
					background: `linear-gradient(${toward}, transparent, color-mix(in srgb, var(--bg) 24%, transparent) 25%, color-mix(in srgb, var(--bg) 56%, transparent) 55%, color-mix(in srgb, var(--bg) 82%, transparent))`,
				}}
			/>
		</div>
	);
}
