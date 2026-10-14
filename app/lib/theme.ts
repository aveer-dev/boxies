// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";

/** Same choices as the native apps' Theme setting. */
export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_PREFERENCES: { id: ThemePreference; label: string }[] = [
	{ id: "system", label: "System" },
	{ id: "light", label: "Light" },
	{ id: "dark", label: "Dark" },
];

const STORAGE_KEY = "inboxies-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === "light" || saved === "dark" || saved === "system") return saved;
	} catch {}
	return "system";
}

function resolve(preference: ThemePreference): ResolvedTheme {
	if (preference !== "system") return preference;
	return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** Kumo (and our tokens in index.css) key their dark palette off `data-mode`. */
function apply(theme: ResolvedTheme) {
	document.documentElement.dataset.mode = theme;
}

/**
 * Runs inline in <head> before first paint, so a dark page never flashes
 * light (and vice versa). Keep in sync with `readPreference` / `resolve`.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("${DARK_QUERY}").matches);document.documentElement.dataset.mode=d?"dark":"light"}catch(e){}})()`;

/**
 * Swaps the palette. Where the browser supports view transitions, the new
 * theme grows out of `origin` (the control that asked for it) as a circle;
 * otherwise, or with reduced motion, it switches at once.
 */
function transitionTo(theme: ResolvedTheme, origin?: { x: number; y: number }) {
	const root = document.documentElement;
	if (root.dataset.mode === theme) return;
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	if (reduce || typeof document.startViewTransition !== "function") {
		apply(theme);
		return;
	}
	const x = origin?.x ?? window.innerWidth / 2;
	const y = origin?.y ?? window.innerHeight / 2;
	const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
	root.dataset.themeTransition = "true";
	const transition = document.startViewTransition(() => apply(theme));
	transition.ready
		.then(() => {
			root.animate(
				{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
				{ duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)", pseudoElement: "::view-transition-new(root)" },
			);
		})
		.catch(() => {});
	transition.finished.finally(() => {
		delete root.dataset.themeTransition;
	});
}

interface ThemeState {
	preference: ThemePreference;
	resolved: ResolvedTheme;
	/** Reads the saved choice and follows the OS while on System. Call once on the client. */
	hydrate: () => () => void;
	setPreference: (preference: ThemePreference, origin?: { x: number; y: number }) => void;
	/** Light ⇄ dark (⇧T). Leaves System for an explicit choice. */
	toggle: (origin?: { x: number; y: number }) => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
	preference: "system",
	resolved: "light",

	hydrate: () => {
		const preference = readPreference();
		const resolved = resolve(preference);
		apply(resolved);
		set({ preference, resolved });
		const media = window.matchMedia(DARK_QUERY);
		const onChange = () => {
			if (get().preference !== "system") return;
			const next = resolve("system");
			transitionTo(next);
			set({ resolved: next });
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	},

	setPreference: (preference, origin) => {
		try {
			localStorage.setItem(STORAGE_KEY, preference);
		} catch {}
		const resolved = resolve(preference);
		transitionTo(resolved, origin);
		set({ preference, resolved });
	},

	toggle: (origin) => get().setPreference(get().resolved === "dark" ? "light" : "dark", origin),
}));
