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
export type Panel =
	| { kind: "compose"; key: string; options: ComposeOptions }
	/** A message opened in its own column (beside the route's reader). */
	| { kind: "reader"; key: string; emailId: string }
	| { kind: "agent"; key: "agent" }
	| { kind: "settings"; key: "settings" };

export type PanelKind = Panel["kind"];

/**
 * Transient UI state that does not belong in the URL. Which mailbox, folder,
 * thread or search is open lives in the route (see `useMailNavigation`);
 * this store tracks the side panels (compose, extra readers, agent,
 * settings). `panels` is their left-to-right order: each one joins at the
 * far right when opened.
 */
interface UIState {
	panels: Panel[];
	/** Bumps each time a panel is (re)opened, so the canvas scrolls it into view again. */
	panelSession: Record<string, number>;

	/** Opens a compose column (see `startCompose` for how it reuses one). */
	startCompose: (options?: ComposeOptions) => void;
	/** Closes one compose column, or every one when no key is given. */
	closeCompose: (key?: string) => void;
	/**
	 * Compose columns report whether they hold anything the user wrote, so a
	 * new compose can reuse an empty one instead of stacking another.
	 */
	composeDirty: Record<string, boolean>;
	setComposeDirty: (key: string, dirty: boolean) => void;

	openReader: (emailId: string) => void;
	closeReader: (key: string) => void;

	/**
	 * A message popped out of its column into a modal over the canvas. `from`
	 * is the column it came out of (and morphs back into).
	 */
	popOut: { emailId: string; from?: string } | null;
	openPopOut: (emailId: string, from?: string) => void;
	closePopOut: () => void;

	/** Mail whose Reply Later reminder picker is open (AVE-86). */
	reminderEmail: Email | null;
	openReminderPicker: (email: Email) => void;
	closeReminderPicker: () => void;

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

	/** Close the columns that belong to one mailbox (mailbox switch). */
	resetColumns: () => void;

	/**
	 * The open mailbox's subscription ended: no composing and no agent. Set by
	 * the mailbox route; while true, compose and agent requests are ignored.
	 */
	isReadOnly: boolean;
	setReadOnly: (readOnly: boolean) => void;
}

const without = (panels: Panel[], key: string) => panels.filter((p) => p.key !== key);

/** Opens `panel` at the far right (or keeps its place, updated) and marks it for reveal. */
const opened = (s: Pick<UIState, "panels" | "panelSession">, panel: Panel) => ({
	panels: s.panels.some((p) => p.key === panel.key)
		? s.panels.map((p) => (p.key === panel.key ? panel : p))
		: [...s.panels, panel],
	panelSession: { ...s.panelSession, [panel.key]: (s.panelSession[panel.key] ?? 0) + 1 },
});

/** A fresh "New message": nothing to reply to, no draft, no carried-over text. */
const isBlankNew = (o: ComposeOptions) =>
	o.mode === "new" && !o.originalEmail && !o.draftEmail && !o.initialBody;

let nextKey = 0;
const newKey = (kind: string) => `${kind}-${++nextKey}`;

export const useUIStore = create<UIState>((set, get) => ({
	panels: [],
	panelSession: {},
	composeDirty: {},

	isAgentPanelOpen: false,
	isSettingsOpen: false,
	settingsPage: null,
	pendingAgentPrompt: null,
	isReadOnly: false,

	startCompose: (options) =>
		set((s) => {
			if (s.isReadOnly) return s;
			const next = options || { mode: "new" as const, originalEmail: null };
			// An empty compose is reused: a blank new message is just brought
			// back into view, anything else takes it over. A compose holding the
			// user's words is never cleared; the new one opens beside it.
			const empty = [...s.panels]
				.reverse()
				.find((p): p is Extract<Panel, { kind: "compose" }> => p.kind === "compose" && !s.composeDirty[p.key]);
			if (empty && isBlankNew(next) && isBlankNew(empty.options)) {
				return opened(s, empty);
			}
			const key = empty?.key ?? newKey("compose");
			return {
				...opened(s, { kind: "compose", key, options: next }),
				composeDirty: { ...s.composeDirty, [key]: false },
			};
		}),

	closeCompose: (key) =>
		set((s) => {
			const closing = s.panels.filter((p) => p.kind === "compose" && (!key || p.key === key));
			const composeDirty = { ...s.composeDirty };
			for (const p of closing) delete composeDirty[p.key];
			return {
				panels: s.panels.filter((p) => !closing.includes(p)),
				composeDirty,
			};
		}),

	setComposeDirty: (key, dirty) =>
		set((s) => (s.composeDirty[key] === dirty ? s : { composeDirty: { ...s.composeDirty, [key]: dirty } })),

	openReader: (emailId) =>
		set((s) => {
			const existing = s.panels.find((p) => p.kind === "reader" && p.emailId === emailId);
			return opened(s, existing ?? { kind: "reader", key: newKey("reader"), emailId });
		}),
	closeReader: (key) => set((s) => ({ panels: without(s.panels, key) })),

	popOut: null,
	openPopOut: (emailId, from) => set({ popOut: { emailId, from } }),
	closePopOut: () => set({ popOut: null }),

	reminderEmail: null,
	openReminderPicker: (email) => set({ reminderEmail: email }),
	closeReminderPicker: () => set({ reminderEmail: null }),

	openAgentPanel: () =>
		set((s) => (s.isReadOnly ? s : { isAgentPanelOpen: true, ...opened(s, { kind: "agent", key: "agent" }) })),
	closeAgentPanel: () =>
		set((s) => ({ isAgentPanelOpen: false, panels: without(s.panels, "agent") })),
	toggleAgentPanel: () =>
		get().isAgentPanelOpen ? get().closeAgentPanel() : get().openAgentPanel(),

	openSettings: (page = null) =>
		set((s) => ({
			isSettingsOpen: true,
			settingsPage: page,
			...opened(s, { kind: "settings", key: "settings" }),
		})),
	closeSettings: () =>
		set((s) => ({
			isSettingsOpen: false,
			settingsPage: null,
			panels: without(s.panels, "settings"),
		})),
	closeSettingsPage: () => set({ settingsPage: null }),

	askAgent: (prompt) =>
		set((s) =>
			s.isReadOnly
				? s
				: {
						isAgentPanelOpen: true,
						pendingAgentPrompt: prompt,
						...opened(s, { kind: "agent", key: "agent" }),
					},
		),

	consumeAgentPrompt: () => {
		const prompt = get().pendingAgentPrompt;
		if (prompt !== null) set({ pendingAgentPrompt: null });
		return prompt;
	},

	resetColumns: () =>
		set((s) => ({
			pendingAgentPrompt: null,
			popOut: null,
			reminderEmail: null,
			composeDirty: {},
			panels: s.panels.filter((p) => p.kind !== "compose" && p.kind !== "reader"),
		})),

	setReadOnly: (readOnly) =>
		set((s) =>
			readOnly
				? {
						isReadOnly: true,
						isAgentPanelOpen: false,
						pendingAgentPrompt: null,
						composeDirty: {},
						panels: s.panels.filter((p) => p.kind !== "compose" && p.kind !== "agent"),
					}
				: { isReadOnly: false },
		),
}));

/** Any compose column is open (Reply Later's Focus & Reply shows Skip). */
export const selectIsComposing = (s: UIState) => s.panels.some((p) => p.kind === "compose");
