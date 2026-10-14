// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";

/**
 * Text size: one factor that multiplies every type size in the app (the
 * `--text-*` tokens in index.css) and zooms mail bodies to match, so all
 * text grows or shrinks together whatever its own size. Saved per browser.
 */

export const TEXT_SCALE_MIN = 80;
export const TEXT_SCALE_MAX = 150;
/** Where the wheel settles: whole 5% steps. */
export const TEXT_SCALE_STEP = 5;

const STORAGE_KEY = "inboxies-text-size";

/** Percent, clamped to the wheel's range. */
export function clampTextScale(percent: number) {
	return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, percent));
}

function read(): number {
	try {
		const saved = Number(localStorage.getItem(STORAGE_KEY));
		if (Number.isFinite(saved) && saved > 0) return clampTextScale(saved);
	} catch {}
	return 100;
}

function apply(percent: number) {
	document.documentElement.style.setProperty("--font-scale", String(percent / 100));
}

/** Runs inline in <head> before first paint, so text never jumps size on load. */
export const TEXT_SIZE_BOOT_SCRIPT = `(function(){try{var v=Number(localStorage.getItem("${STORAGE_KEY}"));if(v>0)document.documentElement.style.setProperty("--font-scale",String(Math.min(${TEXT_SCALE_MAX},Math.max(${TEXT_SCALE_MIN},v))/100))}catch(e){}})()`;

interface TextSizeState {
	/** Percent of the default size (100). May be fractional while dragging. */
	percent: number;
	hydrate: () => void;
	/** Live update (dragging the wheel): applies, doesn't save. */
	preview: (percent: number) => void;
	/** Applies and saves. */
	commit: (percent: number) => void;
}

export const useTextSize = create<TextSizeState>((set) => ({
	percent: 100,
	hydrate: () => {
		const percent = read();
		apply(percent);
		set({ percent });
	},
	preview: (percent) => {
		const value = clampTextScale(percent);
		apply(value);
		set({ percent: value });
	},
	commit: (percent) => {
		const value = clampTextScale(percent);
		apply(value);
		set({ percent: value });
		try {
			localStorage.setItem(STORAGE_KEY, String(value));
		} catch {}
	},
}));
