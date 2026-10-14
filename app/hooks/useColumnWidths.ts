// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";

const STORAGE_KEY = "inboxies:column-widths";

function load(): Record<string, number> {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : null;
		if (!parsed || typeof parsed !== "object") return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
		) as Record<string, number>;
	} catch {
		return {};
	}
}

function save(widths: Record<string, number>) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
	} catch {
		// Private mode / blocked storage: widths just won't persist.
	}
}

/**
 * Widths the user dragged columns to (px, by column id), remembered on this
 * device. A column without an entry uses its fluid default.
 */
interface ColumnWidthsState {
	widths: Record<string, number>;
	hydrate: () => void;
	setWidth: (id: string, width: number) => void;
	resetWidth: (id: string) => void;
}

export const useColumnWidths = create<ColumnWidthsState>((set, get) => ({
	widths: {},
	hydrate: () => set({ widths: load() }),
	setWidth: (id, width) => {
		const widths = { ...get().widths, [id]: Math.round(width) };
		set({ widths });
		save(widths);
	},
	resetWidth: (id) => {
		const { [id]: _, ...widths } = get().widths;
		set({ widths });
		save(widths);
	},
}));
