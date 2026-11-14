// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Grey "ghost" text after the caret for writing suggestions (AVE-189).
 *
 * The suggestion is a widget decoration, never part of the document, so it
 * can't be saved or sent by accident. It is tied to the exact document and
 * caret it was made for: any edit or caret move hides it on the next render.
 * Tab (or a click on it) inserts it; Escape dismisses it. Fetching lives in
 * `useWritingSuggestions`; this extension only shows and accepts.
 */

import { Decoration, Extension, type Editor } from "@tiptap/core";

type Doc = Editor["state"]["doc"];

export interface GhostSuggestionStorage {
	text: string;
	pos: number;
	/** The document the suggestion was made for (ProseMirror docs are immutable). */
	doc: Doc | null;
	/** Bumped per suggestion so the widget remounts with new text. */
	seq: number;
}

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		ghostSuggestion: {
			/** Show `text` after the caret (empty selection only). */
			showGhostSuggestion: (text: string) => ReturnType;
			clearGhostSuggestion: () => ReturnType;
			/** Insert the visible suggestion at the caret. False when there is none. */
			acceptGhostSuggestion: () => ReturnType;
		};
	}
	interface Storage {
		ghostSuggestion: GhostSuggestionStorage;
	}
}

type StateLike = Editor["state"];

/** The suggestion still matches this state: same document, caret where it was. */
function visibleSuggestion(storage: GhostSuggestionStorage, state: StateLike): string | null {
	if (!storage.text || storage.doc !== state.doc) return null;
	const { selection } = state;
	if (!selection.empty || selection.from !== storage.pos) return null;
	return storage.text;
}

export function hasGhostSuggestion(editor: Editor): boolean {
	const storage = editor.storage.ghostSuggestion as GhostSuggestionStorage | undefined;
	return !!storage && visibleSuggestion(storage, editor.state) !== null;
}

export const GhostSuggestion = Extension.create<Record<string, never>, GhostSuggestionStorage>({
	name: "ghostSuggestion",
	// Ahead of list keymaps, which also bind Tab.
	priority: 1000,

	addStorage() {
		return { text: "", pos: 0, doc: null, seq: 0 };
	},

	addCommands() {
		return {
			showGhostSuggestion:
				(text: string) =>
				({ state, commands }) => {
					const storage = this.storage;
					if (!text || !state.selection.empty) return false;
					storage.text = text;
					storage.pos = state.selection.from;
					storage.doc = state.doc;
					storage.seq += 1;
					return commands.updateDecorations(this.name);
				},
			clearGhostSuggestion:
				() =>
				({ commands }) => {
					const storage = this.storage;
					if (!storage.text) return false;
					storage.text = "";
					storage.doc = null;
					return commands.updateDecorations(this.name);
				},
			acceptGhostSuggestion:
				() =>
				({ state, tr, dispatch }) => {
					const storage = this.storage;
					const text = visibleSuggestion(storage, state);
					if (!text) return false;
					if (dispatch) {
						tr.insertText(text, storage.pos);
						tr.scrollIntoView();
					}
					storage.text = "";
					storage.doc = null;
					return true;
				},
		};
	},

	addKeyboardShortcuts() {
		return {
			Tab: () => this.editor.commands.acceptGhostSuggestion(),
			Escape: () => hasGhostSuggestion(this.editor) && this.editor.commands.clearGhostSuggestion(),
		};
	},

	addDecorations() {
		const storage = this.storage;
		return {
			// Cheap: at most one widget, and it must vanish on any edit or caret move.
			shouldUpdate: () => true,
			create: ({ state, editor }) => {
				const text = visibleSuggestion(storage, state);
				if (!text) return [];
				return [
					Decoration.Widget(
						storage.pos,
						() => {
							const span = document.createElement("span");
							span.className = "ghost-suggestion text-kumo-subtle cursor-pointer select-none";
							span.setAttribute("contenteditable", "false");
							span.setAttribute("aria-hidden", "true");
							span.setAttribute("data-testid", "ghost-suggestion");
							span.title = "Press Tab to accept";
							span.textContent = text;
							span.addEventListener("mousedown", (event) => {
								event.preventDefault();
								editor.commands.acceptGhostSuggestion();
							});
							return span;
						},
						{ key: `ghost-suggestion-${storage.seq}`, side: 1, ignoreSelection: true },
					),
				];
			},
		};
	},
});
