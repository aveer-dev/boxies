// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";
import type { SettingsPageId } from "~/components/settings/pages";
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

/** Columns that open to the right of the mail columns, without replacing them. */
export type PanelId = "compose" | "agent" | "settings";

/**
 * Transient UI state that does not belong in the URL. Which mailbox, folder,
 * thread or search is open lives in the route (see `useMailNavigation`);
 * this store tracks the side panels (compose, agent, settings). `panels` is
 * their left-to-right order: each one joins at the far right when opened.
 */
interface UIState {
	panels: PanelId[];
	/** Bumps each time a panel is (re)opened, so the canvas scrolls it into view again. */
	panelSession: Record<PanelId, number>;

	isComposing: boolean;
	composeOptions: ComposeOptions;
	startCompose: (options?: ComposeOptions) => void;
	closeCompose: () => void;

	isAgentPanelOpen: boolean;
	openAgentPanel: () => void;
	closeAgentPanel: () => void;
	toggleAgentPanel: () => void;

	isSettingsOpen: boolean;
	/** The settings sub-page open beside the Settings column, if any. */
	settingsPage: SettingsPageId | null;
	openSettings: (page?: SettingsPageId | null) => void;
	closeSettings: () => void;
	closeSettingsPage: () => void;

	/** Prompt to prefill in the agent chat (AI Assist); consumed once. */
	pendingAgentPrompt: string | null;
	askAgent: (prompt: string) => void;
	consumeAgentPrompt: () => string | null;

	/** Close the compose column (mailbox switch). */
	resetColumns: () => void;
}

const EMPTY_COMPOSE: ComposeOptions = { mode: "new", originalEmail: null };

const withoutPanel = (panels: PanelId[], id: PanelId) => panels.filter((p) => p !== id);

/** Opens `id` at the far right (or keeps its place) and marks it for reveal. */
const opened = (s: Pick<UIState, "panels" | "panelSession">, id: PanelId) => ({
	panels: s.panels.includes(id) ? s.panels : [...s.panels, id],
	panelSession: { ...s.panelSession, [id]: s.panelSession[id] + 1 },
});

export const useUIStore = create<UIState>((set, get) => ({
	panels: [],
	panelSession: { compose: 0, agent: 0, settings: 0 },

	isComposing: false,
	composeOptions: EMPTY_COMPOSE,
	isAgentPanelOpen: false,
	isSettingsOpen: false,
	settingsPage: null,
	pendingAgentPrompt: null,

	startCompose: (options) =>
		set((s) => ({
			isComposing: true,
			composeOptions: options || { ...EMPTY_COMPOSE },
			...opened(s, "compose"),
		})),

	closeCompose: () =>
		set((s) => ({
			isComposing: false,
			composeOptions: EMPTY_COMPOSE,
			panels: withoutPanel(s.panels, "compose"),
		})),

	openAgentPanel: () =>
		set((s) => ({ isAgentPanelOpen: true, ...opened(s, "agent") })),
	closeAgentPanel: () =>
		set((s) => ({ isAgentPanelOpen: false, panels: withoutPanel(s.panels, "agent") })),
	toggleAgentPanel: () =>
		get().isAgentPanelOpen ? get().closeAgentPanel() : get().openAgentPanel(),

	openSettings: (page = null) =>
		set((s) => ({
			isSettingsOpen: true,
			settingsPage: page,
			...opened(s, "settings"),
		})),
	closeSettings: () =>
		set((s) => ({
			isSettingsOpen: false,
			settingsPage: null,
			panels: withoutPanel(s.panels, "settings"),
		})),
	closeSettingsPage: () => set({ settingsPage: null }),

	askAgent: (prompt) =>
		set((s) => ({
			isAgentPanelOpen: true,
			pendingAgentPrompt: prompt,
			...opened(s, "agent"),
		})),

	consumeAgentPrompt: () => {
		const prompt = get().pendingAgentPrompt;
		if (prompt !== null) set({ pendingAgentPrompt: null });
		return prompt;
	},

	resetColumns: () =>
		set((s) => ({
			isComposing: false,
			composeOptions: EMPTY_COMPOSE,
			pendingAgentPrompt: null,
			panels: withoutPanel(s.panels, "compose"),
		})),
}));
