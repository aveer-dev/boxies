// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";
import type { Email } from "~/types";

export type ComposeMode = "new" | "reply" | "reply-all" | "forward";

export interface ComposeOptions {
	mode: ComposeMode;
	originalEmail?: Email | null;
	/** When editing a draft, this holds the draft email to pre-fill the composer */
	draftEmail?: Email | null;
	/** Plain text typed in the quick reply before popping out to the composer */
	initialBody?: string;
}

/**
 * Transient UI state that does not belong in the URL. Which mailbox, folder,
 * thread, search or settings page is open lives in the route (see
 * `useMailNavigation`); this store only tracks the compose and agent columns.
 */
interface UIState {
	isComposing: boolean;
	composeOptions: ComposeOptions;
	startCompose: (options?: ComposeOptions) => void;
	closeCompose: () => void;

	isAgentPanelOpen: boolean;
	openAgentPanel: () => void;
	closeAgentPanel: () => void;
	toggleAgentPanel: () => void;

	/** Prompt to prefill in the agent chat (AI Assist); consumed once. */
	pendingAgentPrompt: string | null;
	askAgent: (prompt: string) => void;
	consumeAgentPrompt: () => string | null;

	/** Close compose + agent columns (mailbox switch). */
	resetColumns: () => void;
}

const EMPTY_COMPOSE: ComposeOptions = { mode: "new", originalEmail: null };

export const useUIStore = create<UIState>((set, get) => ({
	isComposing: false,
	composeOptions: EMPTY_COMPOSE,
	isAgentPanelOpen: false,
	pendingAgentPrompt: null,

	startCompose: (options) =>
		set({
			isComposing: true,
			composeOptions: options || { ...EMPTY_COMPOSE },
		}),

	closeCompose: () =>
		set({ isComposing: false, composeOptions: EMPTY_COMPOSE }),

	openAgentPanel: () => set({ isAgentPanelOpen: true }),
	closeAgentPanel: () => set({ isAgentPanelOpen: false }),
	toggleAgentPanel: () => set({ isAgentPanelOpen: !get().isAgentPanelOpen }),

	askAgent: (prompt) =>
		set({ isAgentPanelOpen: true, pendingAgentPrompt: prompt }),

	consumeAgentPrompt: () => {
		const prompt = get().pendingAgentPrompt;
		if (prompt !== null) set({ pendingAgentPrompt: null });
		return prompt;
	},

	resetColumns: () =>
		set({
			isComposing: false,
			composeOptions: EMPTY_COMPOSE,
			pendingAgentPrompt: null,
		}),
}));
