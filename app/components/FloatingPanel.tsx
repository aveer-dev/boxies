// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const MARGIN = 8;
/** Keeps clear of the dock band at the bottom of the screen. */
const BOTTOM_CLEARANCE = 88;

/**
 * A dropdown rendered into `document.body`, anchored to `anchorRef`, so no
 * column, scroller or stacking context can clip or cover it. Opens below the
 * anchor (above when there's more room there), stays inside the viewport and
 * follows the anchor while anything scrolls. Closes on outside press or Esc.
 */
export default function FloatingPanel({
	anchorRef,
	open,
	onClose,
	align = "right",
	className = "",
	children,
	...rest
}: {
	anchorRef: RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	align?: "left" | "right";
	className?: string;
	children: ReactNode;
	role?: string;
	"aria-label"?: string;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [placement, setPlacement] = useState<"below" | "above">("below");

	useLayoutEffect(() => {
		if (!open) return;
		const anchor = anchorRef.current;
		const panel = panelRef.current;
		if (!anchor || !panel) return;

		const place = () => {
			const a = anchor.getBoundingClientRect();
			const width = panel.offsetWidth;
			const height = panel.scrollHeight;
			const below = window.innerHeight - BOTTOM_CLEARANCE - a.bottom - GAP;
			const above = a.top - GAP - MARGIN;
			const up = height > below && above > below;
			const room = Math.max(120, up ? above : below);
			let left = align === "right" ? a.right - width : a.left;
			left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
			panel.style.left = `${left}px`;
			panel.style.maxHeight = `${room}px`;
			if (up) {
				panel.style.top = "";
				panel.style.bottom = `${window.innerHeight - a.top + GAP}px`;
			} else {
				panel.style.bottom = "";
				panel.style.top = `${a.bottom + GAP}px`;
			}
			setPlacement(up ? "above" : "below");
		};
		place();

		const onPointer = (e: PointerEvent) => {
			const target = e.target as Node;
			if (panel.contains(target) || anchor.contains(target)) return;
			onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onClose();
			anchor.focus({ preventScroll: true });
		};
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		document.addEventListener("pointerdown", onPointer, true);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
			document.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [open, anchorRef, align, onClose]);

	if (!open || typeof document === "undefined") return null;
	const origin =
		placement === "below"
			? align === "right" ? "origin-top-right" : "origin-top-left"
			: align === "right" ? "origin-bottom-right" : "origin-bottom-left";
	return createPortal(
		<div
			ref={panelRef}
			{...rest}
			className={`fixed z-[70] overflow-y-auto overscroll-contain rounded-2xl bg-kumo-elevated shadow-[var(--shadow-menu)] p-1.5 animate-menu-in ${origin} ${className}`}
		>
			{children}
		</div>,
		document.body,
	);
}
