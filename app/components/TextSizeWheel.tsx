// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { Keycap } from "~/components/ShortcutSheet";
import { keysFor, useShortcut } from "~/lib/shortcuts";
import {
	clampTextScale,
	TEXT_SCALE_MAX,
	TEXT_SCALE_MIN,
	TEXT_SCALE_STEP,
	useTextSize,
} from "~/lib/text-size";

/** Opens from Settings → Appearance or with T. */
export const useTextSizeWheel = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
	open: false,
	show: () => set({ open: true }),
	hide: () => set({ open: false }),
}));

/** Ruler pixels per percent. */
const PX = 9;
/** Within this many percent of a 5% mark, a release settles on the mark. */
const DETENT = 1.2;
const TICKS = Array.from({ length: TEXT_SCALE_MAX - TEXT_SCALE_MIN + 1 }, (_, i) => TEXT_SCALE_MIN + i);

/** Where a released wheel settles: a whole percent, pulled onto nearby 5% marks. */
function settle(value: number) {
	const mark = Math.round(value / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
	return clampTextScale(Math.abs(value - mark) <= DETENT ? mark : Math.round(value));
}

/**
 * A blur that's strongest behind the wheel and clears toward the screen's
 * edges: a stack of backdrop blurs, each stronger one masked to a smaller
 * circle, under a wash of the page colour that fades out the same way.
 */
function RadialBlur() {
	const layers = [
		{ blur: 2, reach: 95 },
		{ blur: 4, reach: 75 },
		{ blur: 8, reach: 58 },
		{ blur: 16, reach: 42 },
	];
	return (
		<div aria-hidden className="absolute inset-0">
			{layers.map(({ blur, reach }) => {
				const mask = `radial-gradient(ellipse at center, #000 ${reach * 0.45}%, transparent ${reach}%)`;
				const style: CSSProperties = {
					backdropFilter: `blur(${blur}px)`,
					WebkitBackdropFilter: `blur(${blur}px)`,
					maskImage: mask,
					WebkitMaskImage: mask,
				};
				return <div key={blur} className="absolute inset-0" style={style} />;
			})}
			<div
				className="absolute inset-0"
				style={{
					background:
						"radial-gradient(ellipse at center, color-mix(in srgb, var(--bg) 82%, transparent) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 35%, transparent 75%)",
				}}
			/>
		</div>
	);
}

export default function TextSizeWheelHost() {
	const open = useTextSizeWheel((s) => s.open);
	const show = useTextSizeWheel((s) => s.show);
	useShortcut("textSize", () => show());
	if (!open || typeof document === "undefined") return null;
	return createPortal(<TextSizeWheel />, document.body);
}

function TextSizeWheel() {
	const hide = useTextSizeWheel((s) => s.hide);
	const saved = useTextSize((s) => s.percent);
	const preview = useTextSize((s) => s.preview);
	const commit = useTextSize((s) => s.commit);
	const [value, setValue] = useState(saved);
	const valueRef = useRef(saved);
	const rootRef = useRef<HTMLDivElement>(null);
	const sliderRef = useRef<HTMLDivElement>(null);
	const needleRef = useRef<HTMLSpanElement>(null);
	const drag = useRef<{ x: number; from: number } | null>(null);
	const tween = useRef(0);
	/** Where a glide is heading, so repeated key presses build on it. */
	const target = useRef<number | null>(null);
	const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
	const closing = useRef(false);

	/** Moves the wheel (and the whole app's text) to `next`, live. */
	const set = useCallback(
		(next: number) => {
			const v = clampTextScale(next);
			const prev = valueRef.current;
			// The needle nods each time a 5% mark passes under it.
			if (Math.floor(prev / TEXT_SCALE_STEP) !== Math.floor(v / TEXT_SCALE_STEP) && needleRef.current) {
				needleRef.current.animate(
					[{ transform: "scaleY(1.35)" }, { transform: "scaleY(1)" }],
					{ duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
				);
			}
			valueRef.current = v;
			setValue(v);
			preview(v);
		},
		[preview],
	);

	/** Glides to `target` (a release, a key, a reset). */
	const glideTo = useCallback(
		(destination: number) => {
			cancelAnimationFrame(tween.current);
			const from = valueRef.current;
			const to = clampTextScale(destination);
			target.current = to;
			if (Math.abs(to - from) < 0.01 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				set(to);
				target.current = null;
				return;
			}
			const start = performance.now();
			const step = (now: number) => {
				const t = Math.min(1, (now - start) / 260);
				set(from + (to - from) * (1 - (1 - t) ** 3));
				if (t < 1) tween.current = requestAnimationFrame(step);
				else target.current = null;
			};
			tween.current = requestAnimationFrame(step);
		},
		[set],
	);

	const close = useCallback(() => {
		if (closing.current) return;
		closing.current = true;
		cancelAnimationFrame(tween.current);
		clearTimeout(idle.current);
		const final = settle(valueRef.current);
		commit(final);
		const root = rootRef.current;
		const done = () => hide();
		if (!root) return done();
		root.animate({ opacity: [1, 0] }, { duration: 180, easing: "ease-in", fill: "forwards" }).finished.then(done, done);
	}, [commit, hide]);

	// Open: fade in, take focus, make the app behind inert; give it all back on close.
	useLayoutEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		sliderRef.current?.focus({ preventScroll: true });
		rootRef.current?.animate({ opacity: [0, 1] }, { duration: 220, easing: "ease-out" });
		const behind = Array.from(document.querySelectorAll<HTMLElement>(".column-canvas, [data-app-chrome]"));
		for (const el of behind) el.inert = true;
		return () => {
			for (const el of behind) el.inert = false;
			cancelAnimationFrame(tween.current);
			clearTimeout(idle.current);
			opener?.focus({ preventScroll: true });
		};
	}, []);

	// Scroll: free movement, then it settles once the wheel goes quiet.
	useEffect(() => {
		const slider = sliderRef.current;
		if (!slider) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			cancelAnimationFrame(tween.current);
			target.current = null;
			const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			set(valueRef.current + delta / PX);
			clearTimeout(idle.current);
			idle.current = setTimeout(() => glideTo(settle(valueRef.current)), 160);
		};
		slider.addEventListener("wheel", onWheel, { passive: false });
		return () => slider.removeEventListener("wheel", onWheel);
	}, [set, glideTo]);

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		cancelAnimationFrame(tween.current);
		target.current = null;
		drag.current = { x: e.clientX, from: valueRef.current };
		e.currentTarget.setPointerCapture(e.pointerId);
		e.currentTarget.dataset.dragging = "true";
	};
	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		// The ruler follows the pointer: drag left to go up the scale.
		set(drag.current.from - (e.clientX - drag.current.x) / PX);
	};
	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		drag.current = null;
		delete e.currentTarget.dataset.dragging;
		glideTo(settle(valueRef.current));
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const by = e.shiftKey ? 1 : TEXT_SCALE_STEP;
		const current = target.current ?? settle(valueRef.current);
		switch (e.key) {
			case "ArrowRight":
			case "ArrowUp":
				e.preventDefault();
				glideTo(e.shiftKey ? current + by : (Math.floor(current / by) + 1) * by);
				break;
			case "ArrowLeft":
			case "ArrowDown":
				e.preventDefault();
				glideTo(e.shiftKey ? current - by : (Math.ceil(current / by) - 1) * by);
				break;
			case "Home":
				e.preventDefault();
				glideTo(TEXT_SCALE_MIN);
				break;
			case "End":
				e.preventDefault();
				glideTo(TEXT_SCALE_MAX);
				break;
			case "0":
				e.preventDefault();
				glideTo(100);
				break;
			case "Enter":
				e.preventDefault();
				close();
				break;
		}
	};

	const shown = Math.round(value);
	return (
		<div
			ref={rootRef}
			className="fixed inset-0 z-[90] flex items-center justify-center px-4"
			onPointerDown={(e) => {
				if (e.target === e.currentTarget) close();
			}}
			onKeyDown={(e) => {
				// A modal: global shortcuts stand down, so Esc is handled here.
				if (e.key === "Escape") {
					e.preventDefault();
					close();
				}
			}}
		>
			<RadialBlur />
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="text-size-title"
				className="relative flex w-full max-w-[520px] flex-col items-center text-center animate-reveal"
			>
				<h2 id="text-size-title" className="text-sm font-medium text-kumo-subtle">
					Text size
				</h2>
				<div className="mt-1 text-[length:calc(56px*var(--font-scale))] font-semibold leading-none tracking-tight text-kumo-default tabular-nums">
					{shown}
					<span className="text-kumo-subtle">%</span>
				</div>
				<p className="mt-4 max-w-[380px] text-base text-kumo-strong">
					Every message, list and menu follows this size, so everything stays in proportion.
				</p>

				<div
					ref={sliderRef}
					role="slider"
					tabIndex={0}
					aria-label="Text size"
					aria-valuemin={TEXT_SCALE_MIN}
					aria-valuemax={TEXT_SCALE_MAX}
					aria-valuenow={shown}
					aria-valuetext={`${shown}%`}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerCancel={onPointerUp}
					onDoubleClick={() => glideTo(100)}
					onKeyDown={onKeyDown}
					className="group/ruler relative mt-8 h-20 w-full cursor-grab touch-none select-none rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] data-[dragging=true]:cursor-grabbing"
					style={{
						maskImage: "linear-gradient(to right, transparent, #000 22%, #000 78%, transparent)",
						WebkitMaskImage: "linear-gradient(to right, transparent, #000 22%, #000 78%, transparent)",
					}}
				>
					{/* The scale slides under the fixed needle. */}
					<div
						className="absolute top-0 left-1/2 h-full"
						style={{ transform: `translateX(${-(value - TEXT_SCALE_MIN) * PX}px)` }}
					>
						{TICKS.map((tick) => {
							const major = tick % 10 === 0;
							const mid = tick % 5 === 0;
							// Ticks swell and brighten as they near the needle.
							const near = Math.max(0, 1 - Math.abs(tick - value) / 9);
							return (
								<div
									key={tick}
									className="absolute bottom-6 -translate-x-1/2"
									style={{ left: (tick - TEXT_SCALE_MIN) * PX }}
								>
									<span
										className="block w-px origin-bottom rounded-full bg-[var(--text-primary)]"
										style={{
											height: major ? 22 : mid ? 15 : 9,
											opacity: (major ? 0.5 : mid ? 0.35 : 0.2) + near * 0.5,
											transform: `scaleY(${1 + near * 0.35})`,
										}}
									/>
									{major && (
										<span
											className="absolute top-full mt-2 left-1/2 -translate-x-1/2 text-xs tabular-nums"
											style={{ color: "var(--text-muted)", opacity: 0.6 + near * 0.4 }}
										>
											{tick}
										</span>
									)}
								</div>
							);
						})}
					</div>
					<span
						ref={needleRef}
						aria-hidden
						className="pointer-events-none absolute bottom-6 left-1/2 h-10 w-[2px] -translate-x-1/2 origin-bottom rounded-full bg-kumo-contrast shadow-[0_0_0_3px_color-mix(in_srgb,var(--bg)_70%,transparent)]"
					/>
				</div>

				<p className="mt-3 text-xs text-kumo-subtle">
					Scroll or drag · <Keycap>←</Keycap> <Keycap>→</Keycap> · double-click for 100%
				</p>
				<div className="mt-6 flex items-center gap-2">
					<Button variant="ghost" size="sm" onClick={() => glideTo(100)} disabled={shown === 100}>
						Reset
					</Button>
					<Button variant="primary" size="sm" onClick={close}>
						Done
					</Button>
				</div>
				<p className="mt-4 text-xs text-kumo-subtle">
					<Keycap>{keysFor("textSize")}</Keycap> opens this anywhere
				</p>
			</div>
		</div>
	);
}
