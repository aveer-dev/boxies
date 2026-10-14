// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import type { Icon, IconWeight } from "@phosphor-icons/react";
import { type ButtonHTMLAttributes, forwardRef, type Key, type ReactElement, type ReactNode } from "react";

/** Every icon in a button is this size; boxes vary (sm 28px, md 32px, lg 40px). */
export const ICON_SIZE = 16;

type Side = "top" | "bottom" | "left" | "right";

/** Tooltip body: the label, plus the keyboard shortcut as a key cap. */
function TipContent({ label, shortcut }: { label: ReactNode; shortcut?: string }) {
	return (
		<span className="tip-content inline-flex items-center gap-2 whitespace-nowrap">
			{label}
			{shortcut && (
				<kbd className="rounded-md bg-[var(--bg-badge)] px-1.5 font-sans text-[11px] leading-[18px] text-kumo-subtle shadow-[inset_0_0_0_1px_var(--border-card)]">
					{shortcut}
				</kbd>
			)}
		</span>
	);
}

/**
 * The one tooltip style for the app: a small light card with the label and,
 * when there is one, its shortcut (styled via `.tip-content` in index.css;
 * Kumo's `className` lands on the trigger, not the popup). Wraps a single
 * focusable child.
 */
export function Tip({
	label,
	shortcut,
	side = "bottom",
	children,
}: {
	label: ReactNode;
	shortcut?: string;
	side?: Side;
	children: ReactElement;
}) {
	return (
		<Tooltip
			content={<TipContent label={label} shortcut={shortcut} />}
			side={side}
			asChild
		>
			{children}
		</Tooltip>
	);
}

const BOX = {
	sm: "h-7 w-7 rounded-lg",
	md: "h-8 w-8 rounded-lg",
	lg: "h-10 w-10 rounded-full",
} as const;

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
	/** Accessible name and tooltip text. */
	label: string;
	icon: Icon;
	shortcut?: string;
	size?: keyof typeof BOX;
	weight?: IconWeight;
	iconClassName?: string;
	/** Change it to remount the glyph (replays an animation such as a pop). */
	iconKey?: Key;
	/** ✕ buttons turn a quarter on hover. */
	close?: boolean;
	tooltipSide?: Side;
	/** Extra content inside the button (e.g. an indicator dot). */
	children?: ReactNode;
};

/** Icon-only button with the shared hover/press motion (`.icon-btn`) and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{
		label,
		icon: Glyph,
		shortcut,
		size = "sm",
		weight,
		iconClassName,
		iconKey,
		close = false,
		tooltipSide = "bottom",
		className = "",
		children,
		...rest
	},
	ref,
) {
	return (
		<Tip label={label} shortcut={shortcut} side={tooltipSide}>
			<button
				ref={ref}
				type="button"
				aria-label={label}
				className={`icon-btn ${close ? "icon-btn-close" : ""} ${BOX[size]} shrink-0 inline-flex items-center justify-center ${className}`}
				{...rest}
			>
				<Glyph key={iconKey} size={ICON_SIZE} weight={weight} className={iconClassName} />
				{children}
			</button>
		</Tip>
	);
});
