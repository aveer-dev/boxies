// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Icon, IconWeight } from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import FloatingPanel from "~/components/FloatingPanel";
import { ICON_SIZE, IconButton } from "~/components/IconButton";

export interface ColumnMenuItem {
	label: string;
	icon?: Icon;
	onSelect: () => void;
}

/** Small header dropdown; closes on outside click, Esc, or selection. */
export default function ColumnMenu({
	icon,
	weight,
	label,
	heading,
	items,
	align = "right",
}: {
	icon: Icon;
	weight?: IconWeight;
	label: string;
	heading?: string;
	items: ColumnMenuItem[];
	align?: "left" | "right";
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);

	return (
		<>
			<IconButton
				ref={triggerRef}
				label={label}
				icon={icon}
				weight={weight}
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="menu"
				aria-expanded={open}
			/>
			<FloatingPanel
				anchorRef={triggerRef}
				open={open}
				onClose={close}
				align={align}
				role="menu"
				aria-label={heading ?? label}
				className="min-w-[200px]"
			>
				{heading && (
					<>
						<div className="px-2.5 py-1.5 text-xs font-medium text-kumo-subtle">{heading}</div>
						<div className="h-px bg-kumo-line my-1 -mx-1" />
					</>
				)}
				{items.map((item) => (
					<button
						key={item.label}
						type="button"
						role="menuitem"
						className="group/item w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg text-sm text-kumo-default hover:bg-kumo-overlay focus-visible:bg-kumo-overlay focus-visible:outline-none transition-colors duration-100"
						onClick={() => {
							setOpen(false);
							item.onSelect();
						}}
					>
						{item.icon && (
							<span className="text-kumo-subtle shrink-0 transition-[color,translate] duration-200 ease-[var(--ease-out)] group-hover/item:text-kumo-default group-hover/item:translate-x-px">
								<item.icon size={ICON_SIZE} />
							</span>
						)}
						{item.label}
					</button>
				))}
			</FloatingPanel>
		</>
	);
}
