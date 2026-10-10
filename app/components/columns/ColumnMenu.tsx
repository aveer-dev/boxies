// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type ReactNode, useEffect, useRef, useState } from "react";

export interface ColumnMenuItem {
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
}

/** Small header dropdown; closes on outside click, Esc, or selection. */
export default function ColumnMenu({
	trigger,
	label,
	heading,
	items,
	align = "right",
}: {
	trigger: ReactNode;
	label: string;
	heading?: string;
	items: ColumnMenuItem[];
	align?: "left" | "right";
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointer = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onPointer);
		window.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
				aria-label={label}
				aria-haspopup="menu"
				aria-expanded={open}
				title={label}
			>
				{trigger}
			</button>
			{open && (
				<div
					role="menu"
					className={`absolute top-full z-50 mt-1 min-w-[180px] rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg py-1 ${
						align === "right" ? "right-0" : "left-0"
					}`}
				>
					{heading && (
						<>
							<div className="px-3 py-1.5 text-xs font-medium text-kumo-subtle">{heading}</div>
							<div className="h-px bg-kumo-line my-1" />
						</>
					)}
					{items.map((item) => (
						<button
							key={item.label}
							type="button"
							role="menuitem"
							className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm text-kumo-default hover:bg-kumo-overlay transition-colors"
							onClick={() => {
								setOpen(false);
								item.onSelect();
							}}
						>
							{item.icon && <span className="text-kumo-subtle shrink-0">{item.icon}</span>}
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
