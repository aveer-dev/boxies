// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Letter timing, ms. Each letter fades over EXIT/ENTER; neighbours start STEP
 * apart, capped at SPREAD for the whole string so long titles take no longer.
 * The new text trails the old by LAG. Twins: iOS `MorphingTitle`, Android
 * `MorphingTitle`.
 */
const EXIT_MS = 140;
const ENTER_MS = 180;
const LAG_MS = 40;
const MAX_STEP_MS = 4;
const SPREAD_MS = 140;
const BLUR = "blur(4px)";
/** `--ease-out`, plus an ease-in for letters leaving. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";
/** Joined or reordered scripts (Arabic, Indic…) can't be split into letters: they move a word at a time. */
const SHAPED_SCRIPT = /[֐-ࣿऀ-෿ༀ-႟ក-᢯ꡀ-ꣿ]/;

type Layer = { id: number; text: string; leaving: boolean };

function motionAllowed() {
	return (
		typeof window !== "undefined" &&
		typeof Element.prototype.animate === "function" &&
		!window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/** The pieces that move on their own: letters (emoji and accents whole), or words for shaped scripts. */
function units(text: string): string[] {
	if (SHAPED_SCRIPT.test(text)) return text.split(/(\s+)/).filter(Boolean);
	if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
		return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (g) => g.segment);
	}
	return Array.from(text);
}

/**
 * Copies of the layer's letters, each placed exactly where the browser laid it
 * out (kerning and line breaks included), so nothing shifts when the plain
 * text takes over again.
 */
function placeLetters(layer: HTMLElement, overlay: HTMLElement, root: HTMLElement): HTMLElement[] {
	const node = layer.firstChild;
	if (!(node instanceof Text)) return [];
	const origin = root.getBoundingClientRect();
	const range = document.createRange();
	const letters: HTMLElement[] = [];
	let offset = 0;
	for (const unit of units(node.data)) {
		const start = offset;
		offset += unit.length;
		if (!unit.trim()) continue;
		range.setStart(node, start);
		range.setEnd(node, offset);
		const box = range.getBoundingClientRect();
		if (!box.width && !box.height) continue;
		const letter = document.createElement("span");
		letter.textContent = unit;
		letter.style.cssText = `position:absolute;left:${box.left - origin.left}px;top:${box.top - origin.top}px;line-height:${box.height}px;white-space:pre`;
		overlay.appendChild(letter);
		letters.push(letter);
	}
	return letters;
}

/**
 * Text that changes letter by letter: the old letters blur out and the new
 * ones sharpen in, left to right (~300 ms). Pass `from` to morph from text
 * shown before this mounted (the reader rebuilds per message). At rest it's
 * plain text; with reduced motion it just swaps.
 */
export default function MorphText({ text, from }: { text: string; from?: string | null }) {
	const morphOnMount = from != null && from !== text && motionAllowed();
	const [layers, setLayers] = useState<Layer[]>(() =>
		morphOnMount
			? [
					{ id: 0, text: from, leaving: true },
					{ id: 1, text, leaving: false },
				]
			: [{ id: 1, text, leaving: false }],
	);
	const [settledId, setSettledId] = useState<number | null>(morphOnMount ? null : 1);
	const settledRef = useRef(settledId);
	settledRef.current = settledId;
	const rootRef = useRef<HTMLSpanElement>(null);
	const layersRef = useRef(layers);
	layersRef.current = layers;
	const nextId = useRef(2);
	const started = useRef(new Set<string>());

	// A new text while mounted: the current one leaves, the new one enters.
	useEffect(() => {
		const current = layersRef.current.find((l) => !l.leaving);
		if (!current || current.text === text) return;
		const id = nextId.current++;
		if (!motionAllowed()) {
			setLayers([{ id, text, leaving: false }]);
			setSettledId(id);
			return;
		}
		setSettledId(null);
		setLayers([{ ...current, leaving: true }, { id, text, leaving: false }]);
	}, [text]);

	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		let leavingHeight: number | null = null;
		for (const layer of layers) {
			const key = `${layer.id}:${layer.leaving}`;
			if (started.current.has(key) || (!layer.leaving && layer.id === settledRef.current)) continue;
			const el = root.querySelector<HTMLElement>(`[data-layer="${layer.id}"]`);
			const overlay = root.querySelector<HTMLElement>(`[data-letters="${layer.id}"]`);
			if (!el || !overlay) continue;
			started.current.add(key);
			if (layer.leaving) leavingHeight = el.offsetHeight;
			// An entrance cut short keeps its letters and leaves from where they got to.
			const letters = overlay.children.length
				? (Array.from(overlay.children) as HTMLElement[])
				: placeLetters(el, overlay, root);
			const step = Math.min(MAX_STEP_MS, SPREAD_MS / Math.max(letters.length, 1));
			let last: Animation | undefined;
			letters.forEach((letter, i) => {
				if (layer.leaving) {
					for (const a of letter.getAnimations()) {
						try {
							a.commitStyles();
						} catch {}
						a.cancel();
					}
					last = letter.animate([{ opacity: 0, filter: BLUR, transform: "translateY(-3px)" }], {
						duration: EXIT_MS,
						delay: i * step,
						easing: EASE_IN,
						fill: "forwards",
					});
				} else {
					last = letter.animate(
						[
							{ opacity: 0, filter: BLUR, transform: "translateY(3px)" },
							{ opacity: 1, filter: "blur(0px)", transform: "translateY(0)" },
						],
						{ duration: ENTER_MS, delay: LAG_MS + i * step, easing: EASE_OUT, fill: "backwards" },
					);
				}
			});
			const { id, leaving } = layer;
			const done = () => (leaving ? setLayers((ls) => ls.filter((l) => l.id !== id)) : setSettledId(id));
			// A hidden tab never finishes its animations: settle anyway.
			const total = (leaving ? EXIT_MS : LAG_MS + ENTER_MS) + step * letters.length;
			const fallback = window.setTimeout(done, total + 400);
			last?.finished.then(() => {
				window.clearTimeout(fallback);
				done();
			}, () => {});
		}
		// A title gaining or losing a line eases to its new height instead of
		// jumping (or the old lines spilling over what's below).
		const current = root.querySelector<HTMLElement>("[data-layer]:not([aria-hidden])");
		if (leavingHeight !== null && current && Math.abs(current.offsetHeight - leavingHeight) > 1) {
			root.animate([{ height: `${leavingHeight}px` }, { height: `${current.offsetHeight}px` }], {
				duration: LAG_MS + ENTER_MS + SPREAD_MS / 2,
				easing: EASE_OUT,
			});
		}
	}, [layers]);

	// Hand back to the plain text in the same frame its colour returns.
	useLayoutEffect(() => {
		if (settledId === null) return;
		rootRef.current?.querySelector(`[data-letters="${settledId}"]`)?.replaceChildren();
	}, [settledId]);

	return (
		<span ref={rootRef} className="relative block">
			{layers.map((layer) => {
				const moving = layer.leaving || layer.id !== settledId;
				return (
					<Fragment key={layer.id}>
						<span
							data-layer={layer.id}
							aria-hidden={layer.leaving || undefined}
							className={layer.leaving ? "pointer-events-none absolute inset-x-0 top-0" : "block"}
							style={moving ? { color: "transparent" } : undefined}
						>
							{layer.text}
						</span>
						<span data-letters={layer.id} aria-hidden className="pointer-events-none absolute inset-0" />
					</Fragment>
				);
			})}
		</span>
	);
}
