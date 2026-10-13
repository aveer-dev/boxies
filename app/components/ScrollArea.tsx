// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type ReactNode, useEffect, useRef } from "react";

const EDGE = 4;
const MIN_THUMB = 28;
const IDLE_MS = 900;

/**
 * A vertical scroller with the native bar hidden and a slim thumb drawn in
 * the gutter instead, so it never sits on top of (or reflows) the content.
 * The thumb shows while scrolling or hovering, and can be dragged.
 */
export default function ScrollArea({
	children,
	className = "",
	contentClassName = "",
	trackInsetBottom = EDGE,
}: {
	children: ReactNode;
	/** Outer box (sizing: `flex-1`, `h-full`, …). */
	className?: string;
	/** Content wrapper (padding, spacing). */
	contentClassName?: string;
	/** Keeps the thumb clear of whatever floats over the bottom (the dock). */
	trackInsetBottom?: number;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const thumbRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const viewport = viewportRef.current;
		const content = contentRef.current;
		const thumb = thumbRef.current;
		if (!viewport || !content || !thumb) return;

		let frame = 0;
		let idle: ReturnType<typeof setTimeout> | undefined;
		let thumbHeight = 0;
		let track = 0;

		const layout = () => {
			frame = 0;
			const { scrollTop, scrollHeight, clientHeight } = viewport;
			const overflow = scrollHeight - clientHeight;
			track = clientHeight - EDGE - trackInsetBottom;
			if (overflow <= 1 || track <= MIN_THUMB) {
				thumb.dataset.scrollable = "false";
				return;
			}
			thumb.dataset.scrollable = "true";
			thumbHeight = Math.max(MIN_THUMB, (track * clientHeight) / scrollHeight);
			const y = EDGE + ((track - thumbHeight) * scrollTop) / overflow;
			thumb.style.height = `${thumbHeight}px`;
			thumb.style.transform = `translateY(${y}px)`;
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
			}, IDLE_MS);
		};

		const resize = new ResizeObserver(schedule);
		resize.observe(viewport);
		resize.observe(content);
		viewport.addEventListener("scroll", onScroll, { passive: true });
		// Entrance animations (translate) briefly change the overflow without a resize.
		viewport.addEventListener("animationend", schedule);
		layout();

		// Dragging the thumb scrolls proportionally.
		let startY = 0;
		let startTop = 0;
		const onPointerDown = (e: PointerEvent) => {
			e.preventDefault();
			e.stopPropagation();
			startY = e.clientY;
			startTop = viewport.scrollTop;
			thumb.dataset.dragging = "true";
			thumb.setPointerCapture(e.pointerId);
		};
		const onPointerMove = (e: PointerEvent) => {
			if (thumb.dataset.dragging !== "true") return;
			const ratio = (viewport.scrollHeight - viewport.clientHeight) / Math.max(1, track - thumbHeight);
			viewport.scrollTop = startTop + (e.clientY - startY) * ratio;
		};
		const onPointerUp = (e: PointerEvent) => {
			thumb.dataset.dragging = "false";
			if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId);
			onScroll();
		};
		thumb.addEventListener("pointerdown", onPointerDown);
		thumb.addEventListener("pointermove", onPointerMove);
		thumb.addEventListener("pointerup", onPointerUp);
		thumb.addEventListener("pointercancel", onPointerUp);

		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(idle);
			resize.disconnect();
			viewport.removeEventListener("scroll", onScroll);
			viewport.removeEventListener("animationend", schedule);
			thumb.removeEventListener("pointerdown", onPointerDown);
			thumb.removeEventListener("pointermove", onPointerMove);
			thumb.removeEventListener("pointerup", onPointerUp);
			thumb.removeEventListener("pointercancel", onPointerUp);
		};
	}, [trackInsetBottom]);

	return (
		<div className={`group/scroll relative min-h-0 ${className}`}>
			<div
				ref={viewportRef}
				data-scroll-viewport
				className="no-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-y-contain"
			>
				<div ref={contentRef} className={contentClassName}>
					{children}
				</div>
			</div>
			<div
				ref={thumbRef}
				aria-hidden
				data-scrollable="false"
				className="absolute top-0 right-[3px] z-20 w-[5px] rounded-full bg-[var(--scroll-thumb)] opacity-0 cursor-default touch-none transition-[opacity,width,background-color] duration-200 ease-[var(--ease-out)] hover:w-[7px] hover:bg-[color-mix(in_srgb,var(--text-primary)_36%,transparent)] data-[scrollable=false]:hidden group-hover/scroll:opacity-100 data-[active=true]:opacity-100 data-[dragging=true]:opacity-100 data-[dragging=true]:w-[7px]"
			/>
		</div>
	);
}
