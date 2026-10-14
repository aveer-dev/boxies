// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useLayoutEffect, useRef } from "react";

/**
 * One highlight that glides to the current item (`selector`, by default
 * `aria-current="page"`) of a list instead of each row painting its own.
 * Render `markRef` as an absolute child of `railRef` (behind the rows); `dep`
 * is whatever moves the current item (e.g. the pathname). The first
 * placement doesn't animate.
 */
export function useSlidingHighlight<T extends HTMLElement>(
	dep: unknown,
	selector = '[aria-current="page"]',
) {
	const railRef = useRef<T>(null);
	const markRef = useRef<HTMLSpanElement>(null);

	useLayoutEffect(() => {
		const rail = railRef.current;
		const mark = markRef.current;
		if (!rail || !mark) return;
		const place = () => {
			const active = rail.querySelector<HTMLElement>(selector);
			if (!active) {
				mark.style.opacity = "0";
				return;
			}
			const r = rail.getBoundingClientRect();
			const a = active.getBoundingClientRect();
			mark.style.opacity = "1";
			mark.style.width = `${a.width}px`;
			mark.style.height = `${a.height}px`;
			mark.style.transform = `translate(${a.left - r.left}px, ${a.top - r.top}px)`;
		};
		place();
		const frame = requestAnimationFrame(() => {
			mark.dataset.ready = "true";
		});
		const resize = new ResizeObserver(place);
		resize.observe(rail);
		return () => {
			cancelAnimationFrame(frame);
			resize.disconnect();
		};
	}, [dep, selector]);

	return { railRef, markRef };
}

/** Classes for the highlight element itself. */
export const slidingMarkClass =
	"pointer-events-none absolute left-0 top-0 rounded-lg bg-kumo-fill opacity-0 data-[ready=true]:transition-[transform,width,height,opacity] data-[ready=true]:duration-[420ms] data-[ready=true]:ease-[var(--spring)]";
