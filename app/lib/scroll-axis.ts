// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export type Axis = "x" | "y";

/** Wheel delta in pixels, whatever unit the device reported it in. */
export function wheelPixels(delta: number, mode: number, page: number): number {
	if (mode === 1) return delta * 16; // DOM_DELTA_LINE
	if (mode === 2) return delta * page; // DOM_DELTA_PAGE
	return delta;
}

function canScroll(el: Element, axis: Axis): boolean {
	const style = window.getComputedStyle(el);
	const overflow = axis === "y" ? style.overflowY : style.overflowX;
	if (overflow !== "auto" && overflow !== "scroll") return false;
	return axis === "y"
		? el.scrollHeight > el.clientHeight + 1
		: el.scrollWidth > el.clientWidth + 1;
}

/** Nearest element from `start` up to `stop` (inclusive) that scrolls along `axis`. */
export function scrollerFor(
	start: EventTarget | null,
	axis: Axis,
	stop?: Element | null,
): HTMLElement | null {
	let el = start instanceof Element ? start : null;
	while (el) {
		if (el instanceof HTMLElement && canScroll(el, axis)) return el;
		if (el === stop) break;
		el = el.parentElement;
	}
	return null;
}

/**
 * Locks each wheel gesture to the axis it starts on, so a vertical scroll
 * that drifts sideways never pans the canvas (and a sideways pan never
 * scrolls a column). Pure single-axis events stay native; only the mixed
 * ones are taken over. Returns the listener to attach (non-passive).
 */
export function axisLockedWheel(root: HTMLElement): (e: WheelEvent) => void {
	let axis: Axis = "y";
	let last = 0;
	return (e: WheelEvent) => {
		if (e.ctrlKey) return; // pinch zoom
		const now = e.timeStamp;
		if (now - last > 120 && (e.deltaX !== 0 || e.deltaY !== 0)) {
			axis = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "x" : "y";
		}
		last = now;
		const off = axis === "y" ? e.deltaX : e.deltaY;
		if (off === 0) return;
		e.preventDefault();
		const on = axis === "y" ? e.deltaY : e.deltaX;
		if (on === 0) return;
		const scroller = scrollerFor(e.target, axis, root);
		if (!scroller) return;
		const px = wheelPixels(on, e.deltaMode, axis === "y" ? scroller.clientHeight : scroller.clientWidth);
		if (axis === "y") scroller.scrollTop += px;
		else scroller.scrollLeft += px;
	};
}
