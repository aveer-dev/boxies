// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Icon, IconProps } from "@phosphor-icons/react";
import { forwardRef } from "react";

/**
 * The summary glyph (AVE-20), drawn after Apple's SF Symbol
 * `text.line.3.summary` — three text lines with an arrow curling out below
 * them — so web matches the native clients' summary affordance. Used only on
 * summary UI; other AI features keep their own icons.
 *
 * Shaped like a Phosphor icon (`size`, `className`, ref) so it drops into
 * `IconButton` and anywhere a Phosphor `Icon` is expected. `weight` is
 * accepted for that contract but the glyph has one weight.
 */
export const SummaryIcon = forwardRef<SVGSVGElement, IconProps>(function SummaryIcon(
	{ size = 16, color = "currentColor", weight: _weight, mirrored, children, ...rest },
	ref,
) {
	return (
		<svg
			ref={ref}
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			transform={mirrored ? "scale(-1, 1)" : undefined}
			{...rest}
		>
			{children}
			<path d="M8 4.25h10.5M8 8.5h10.5M8 12.75h6" />
			<path d="M3 4.25V13a4.5 4.5 0 0 0 4.5 4.5h10" />
			<path d="M17.25 14.75 21.25 17.5l-4 2.75z" fill={color} />
		</svg>
	);
}) as Icon;
