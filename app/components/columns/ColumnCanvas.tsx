// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type ReactNode, useEffect, useRef } from "react";
import { useColumnFocus } from "~/hooks/useColumnFocus";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { axisLockedWheel } from "~/lib/scroll-axis";

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

/** The canvas's in-flight glide: how to stop it, and the column it's bringing in. */
const glides = new WeakMap<HTMLElement, { stop: () => void; column: HTMLElement }>();

/**
 * Scrolls the canvas the least distance that shows `column` whole (its start,
 * when it's wider than the screen). On desktop that's a short ease-out glide
 * of fixed length, however far it goes; phones keep native snapping.
 */
function revealIn(column: HTMLElement) {
	const canvas = column.parentElement;
	const desktop = window.matchMedia("(min-width: 768px)").matches;
	if (!canvas || !desktop) {
		column.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
		return;
	}
	const view = canvas.getBoundingClientRect();
	const rect = column.getBoundingClientRect();
	let delta = 0;
	if (rect.left < view.left || rect.width > view.width) delta = rect.left - view.left;
	else if (rect.right > view.right) delta = rect.right - view.right;
	const from = canvas.scrollLeft;
	const to = Math.max(0, Math.min(canvas.scrollWidth - canvas.clientWidth, from + delta));
	glides.get(canvas)?.stop();
	if (Math.abs(to - from) < 1) return;
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		canvas.scrollLeft = to;
		return;
	}
	const duration = Math.min(560, 320 + Math.abs(to - from) * 0.12);
	const start = performance.now();
	let frame = requestAnimationFrame(function step(now) {
		const t = Math.min(1, (now - start) / duration);
		canvas.scrollLeft = from + (to - from) * (1 - (1 - t) ** 4);
		if (t < 1) frame = requestAnimationFrame(step);
		else stop();
	});
	// A sideways wheel or a touch from the user takes over; scrolling a column doesn't.
	const stop = () => {
		cancelAnimationFrame(frame);
		canvas.removeEventListener("wheel", onWheel);
		canvas.removeEventListener("pointerdown", stop);
		glides.delete(canvas);
	};
	const onWheel = (e: WheelEvent) => {
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stop();
	};
	canvas.addEventListener("wheel", onWheel, { passive: true });
	canvas.addEventListener("pointerdown", stop);
	glides.set(canvas, { stop, column });
}

/**
 * Scrolls a column fully into view. Returns false when it already was (or is
 * gliding in), so a toggle (dock buttons) can close a panel that is on screen
 * and bring back one that isn't.
 */
export function revealColumn(id: string): boolean {
	const column = document.getElementById(`column-${id}`);
	const canvas = column?.parentElement;
	if (!column || !canvas) return false;
	// Already on its way in.
	if (glides.get(canvas)?.column === column) return false;
	const view = canvas.getBoundingClientRect();
	const rect = column.getBoundingClientRect();
	if (rect.left >= view.left - 1 && rect.right <= view.right + 1) return false;
	revealIn(column);
	return true;
}

/**
 * Horizontal Miller-column canvas. Columns are its direct `<section>`
 * children (rendered by `ColumnPane`). Whenever a column appears, or its
 * `revealKey` changes (another message, settings page, compose target), it
 * is scrolled into view; nothing else is ever replaced to make room.
 */
export default function ColumnCanvas({ children }: { children: ReactNode }) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const { activeColumnId, setActiveColumn } = useColumnFocus();
	const { closeDeepest } = useMailNavigation();

	// Reveal new or re-targeted columns (right-most wins when several change).
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let seen = new Map<string, string>();
		let frame = 0;
		const reveal = () => {
			frame = 0;
			const next = new Map<string, string>();
			let target: HTMLElement | undefined;
			for (const column of columnsIn(canvas)) {
				const id = column.dataset.columnId ?? "";
				const key = column.dataset.revealKey ?? "";
				next.set(id, key);
				if (seen.get(id) !== key) target = column;
			}
			seen = next;
			if (!target) return;
			setActiveColumn(target.dataset.columnId ?? "");
			revealIn(target);
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(reveal);
		};
		// Two observers: re-observing one node replaces its options.
		const added = new MutationObserver(schedule);
		added.observe(canvas, { childList: true });
		const rekeyed = new MutationObserver(schedule);
		rekeyed.observe(canvas, { subtree: true, attributeFilter: ["data-reveal-key"] });
		schedule();
		return () => {
			added.disconnect();
			rekeyed.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [setActiveColumn]);

	// A vertical scroll never pans sideways, and a sideways pan never scrolls a column.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const onWheel = axisLockedWheel(canvas);
		canvas.addEventListener("wheel", onWheel, { passive: false });
		return () => canvas.removeEventListener("wheel", onWheel);
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
			revealIn(target);
			focusTargetIn(target)?.focus({ preventScroll: true });
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeColumnId, setActiveColumn, closeDeepest]);

	return (
		<>
			<div
				ref={canvasRef}
				className="column-canvas no-scrollbar h-dvh w-screen flex flex-row flex-nowrap overflow-x-auto overflow-y-hidden overscroll-x-contain bg-kumo-base snap-x snap-mandatory md:snap-none"
				role="region"
				aria-label="Mail columns"
			>
				{children}
				<EmptyRoom />
			</div>
			<CanvasScrollbar canvasRef={canvasRef} />
		</>
	);
}

const HINTS: [string, string][] = [
	["C", "New message"],
	["⌘K", "Search"],
	["[  ]", "Move between columns"],
	["Esc", "Close the last column"],
];

/** Fills the free width until a message (or settings page) opens there. */
function EmptyRoom() {
	return (
		<div aria-hidden className="column-filler @container hidden md:flex flex-1 min-w-0 overflow-hidden items-center justify-center pb-[var(--dock-h)]">
			{/* Only when there's real room; a sliver of free width stays blank. */}
			<dl className="hidden @min-[280px]:grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[11px] leading-4 text-[var(--text-subtle)] animate-reveal">
				{HINTS.map(([keys, label]) => (
					<div key={label} className="contents">
						<dt className="justify-self-end">
							<kbd className="inline-block min-w-5 rounded-[5px] bg-[var(--bg-badge)] px-1.5 text-center font-sans text-[10px] leading-[18px] text-[var(--text-muted)] shadow-[inset_0_0_0_1px_var(--border-card)]">
								{keys}
							</kbd>
						</dt>
						<dd>{label}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

/**
 * The canvas hides its native bar; this slim thumb along the bottom edge
 * shows where you are across the columns and can be dragged (for mice,
 * which have no sideways wheel). Hidden on touch screens and when nothing
 * overflows.
 */
function CanvasScrollbar({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
	const thumbRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const thumb = thumbRef.current;
		if (!canvas || !thumb) return;
		let frame = 0;
		let idle: ReturnType<typeof setTimeout> | undefined;
		let width = 0;
		const EDGE = 8;

		const layout = () => {
			frame = 0;
			const { scrollLeft, scrollWidth, clientWidth } = canvas;
			const overflow = scrollWidth - clientWidth;
			if (overflow <= 1) {
				thumb.dataset.scrollable = "false";
				return;
			}
			thumb.dataset.scrollable = "true";
			const track = clientWidth - EDGE * 2;
			width = Math.max(48, (track * clientWidth) / scrollWidth);
			thumb.style.width = `${width}px`;
			thumb.style.transform = `translateX(${EDGE + ((track - width) * scrollLeft) / overflow}px)`;
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(layout);
		};
		const onScroll = () => {
			schedule();
			thumb.dataset.active = "true";
			clearTimeout(idle);
			idle = setTimeout(() => {
				if (thumb.dataset.dragging !== "true") thumb.dataset.active = "false";
			}, 1000);
		};
		const resize = new ResizeObserver(schedule);
		resize.observe(canvas);
		const mutations = new MutationObserver(schedule);
		mutations.observe(canvas, { childList: true });
		for (const column of Array.from(canvas.children)) resize.observe(column);
		canvas.addEventListener("scroll", onScroll, { passive: true });
		layout();

		let startX = 0;
		let startLeft = 0;
		const onDown = (e: PointerEvent) => {
			e.preventDefault();
			glides.get(canvas)?.stop();
			startX = e.clientX;
			startLeft = canvas.scrollLeft;
			thumb.dataset.dragging = "true";
			thumb.setPointerCapture(e.pointerId);
		};
		const onMove = (e: PointerEvent) => {
			if (thumb.dataset.dragging !== "true") return;
			const track = canvas.clientWidth - EDGE * 2;
			const ratio = (canvas.scrollWidth - canvas.clientWidth) / Math.max(1, track - width);
			canvas.scrollLeft = startLeft + (e.clientX - startX) * ratio;
		};
		const onUp = (e: PointerEvent) => {
			thumb.dataset.dragging = "false";
			if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId);
			onScroll();
		};
		thumb.addEventListener("pointerdown", onDown);
		thumb.addEventListener("pointermove", onMove);
		thumb.addEventListener("pointerup", onUp);
		thumb.addEventListener("pointercancel", onUp);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(idle);
			resize.disconnect();
			mutations.disconnect();
			canvas.removeEventListener("scroll", onScroll);
			thumb.removeEventListener("pointerdown", onDown);
			thumb.removeEventListener("pointermove", onMove);
			thumb.removeEventListener("pointerup", onUp);
			thumb.removeEventListener("pointercancel", onUp);
		};
	}, [canvasRef]);

	return (
		<div aria-hidden className="group/hbar pointer-coarse:hidden fixed inset-x-0 bottom-0 z-50 h-3">
			<div
				ref={thumbRef}
				data-scrollable="false"
				className="absolute left-0 bottom-[3px] h-[5px] rounded-full bg-[var(--scroll-thumb)] opacity-0 transition-[opacity,height,background-color] duration-200 ease-[var(--ease-out)] group-hover/hbar:opacity-100 hover:h-[7px] hover:bg-[color-mix(in_srgb,var(--text-primary)_36%,transparent)] data-[scrollable=false]:hidden data-[active=true]:opacity-100 data-[dragging=true]:opacity-100 data-[dragging=true]:h-[7px]"
			/>
		</div>
	);
}
