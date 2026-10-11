// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { useColumnFocus } from "~/hooks/useColumnFocus";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";

export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target.isContentEditable
	);
}

/** A modal dialog is open (toasts are role=dialog too, but aria-modal=false). */
export function isModalOpen(): boolean {
	return Boolean(document.querySelector('[role=dialog]:not([aria-modal="false"]), [role=alertdialog]:not([aria-modal="false"])'));
}

function columnsIn(canvas: HTMLElement | null): HTMLElement[] {
	if (!canvas) return [];
	return Array.from(
		canvas.querySelectorAll<HTMLElement>(":scope > section[data-column-id]"),
	);
}

/** The column's current item (open folder / thread), else its first visible control. */
function focusTargetIn(column: HTMLElement): HTMLElement | undefined {
	const visible = (el: HTMLElement) => el.getClientRects().length > 0;
	const current = column.querySelector<HTMLElement>("[aria-current='page'], [aria-current='true']");
	if (current && visible(current)) return current;
	return Array.from(
		column.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']"),
	).find(visible);
}

/**
 * Horizontal Miller-column canvas. Columns are its direct `<section>`
 * children (rendered by `ColumnPane`); after every navigation the deepest
 * (right-most) column is scrolled into view.
 */
export default function ColumnCanvas({ children }: { children: ReactNode }) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const location = useLocation();
	const isComposing = useUIStore((s) => s.isComposing);
	const isAgentPanelOpen = useUIStore((s) => s.isAgentPanelOpen);
	const { activeColumnId, setActiveColumn } = useColumnFocus();
	const { closeDeepest } = useMailNavigation();

	// eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on every navigation and column toggle
	useEffect(() => {
		const raf = requestAnimationFrame(() => {
			const columns = columnsIn(canvasRef.current);
			const deepest = columns[columns.length - 1];
			if (!deepest) return;
			setActiveColumn(deepest.dataset.columnId ?? "");
			deepest.scrollIntoView({
				behavior: "smooth",
				inline: "nearest",
				block: "nearest",
			});
		});
		return () => cancelAnimationFrame(raf);
	}, [location.key, location.pathname, isComposing, isAgentPanelOpen, setActiveColumn]);

	// A vertical wheel over a non-scrolling area (headers, borders) pans sideways.
	const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
		let el = e.target as HTMLElement | null;
		while (el && el !== canvasRef.current) {
			const style = window.getComputedStyle(el);
			const scrollable = style.overflowY === "auto" || style.overflowY === "scroll";
			if (scrollable && el.scrollHeight > el.clientHeight) return;
			el = el.parentElement;
		}
		if (canvasRef.current) canvasRef.current.scrollLeft += e.deltaY;
	}, []);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
			if (isModalOpen()) return;

			if (e.key === "Escape") {
				if (closeDeepest()) e.preventDefault();
				return;
			}
			if (e.key !== "[" && e.key !== "]") return;
			e.preventDefault();
			const columns = columnsIn(canvasRef.current);
			if (columns.length === 0) return;
			const current = columns.findIndex((c) => c.dataset.columnId === activeColumnId);
			const fallback = e.key === "[" ? columns.length - 1 : 0;
			const nextIndex =
				current < 0
					? fallback
					: Math.min(columns.length - 1, Math.max(0, current + (e.key === "[" ? -1 : 1)));
			const target = columns[nextIndex];
			setActiveColumn(target.dataset.columnId ?? "");
			target.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
			focusTargetIn(target)?.focus({ preventScroll: true });
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeColumnId, setActiveColumn, closeDeepest]);

	return (
		<div
			ref={canvasRef}
			onWheel={handleWheel}
			className="h-dvh w-screen flex flex-row flex-nowrap overflow-x-auto overflow-y-hidden overscroll-x-contain bg-kumo-base snap-x snap-mandatory md:snap-none"
			role="region"
			aria-label="Mail columns"
		>
			{children}
		</div>
	);
}
