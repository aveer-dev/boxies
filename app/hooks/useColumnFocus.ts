// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";

/** Which Miller column has keyboard focus, for `[` / `]` navigation. */
interface ColumnFocusState {
	activeColumnId: string | null;
	setActiveColumn: (id: string) => void;
}

export const useColumnFocus = create<ColumnFocusState>((set) => ({
	activeColumnId: null,
	setActiveColumn: (id) => set({ activeColumnId: id }),
}));
