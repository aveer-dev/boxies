// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Writing suggestions while composing (AVE-189): after a pause in typing,
 * ask the Worker how the sentence at the caret continues and show it as
 * ghost text (`GhostSuggestion`). Any further typing or caret move cancels
 * the pending request (AbortController) and hides the suggestion.
 *
 * Only the draft up to the caret, the subject and the id of the message
 * being replied to are sent. No request is made when the selection isn't
 * empty, the caret isn't at the end of a paragraph, it sits in a quote, or
 * the draft is too short. A 403 (turned off) or 429 (daily cap) stops
 * suggestions for the rest of this compose session.
 */

import type { Editor } from "@tiptap/core";
import { useEffect, useRef } from "react";
import {
	MIN_SUGGESTION_DRAFT_CHARS,
	SUGGESTION_DEBOUNCE_MS,
	suggestionDraftTail,
} from "shared/compose-suggestions";
import api, { ApiError } from "~/services/api";

export interface WritingSuggestionsOptions {
	mailboxId: string | undefined;
	enabled: boolean;
	subject?: string;
	/** Id of the message being replied to (replies only). */
	inReplyTo?: string;
}

/** The draft text before the caret when a suggestion makes sense there, else null. */
export function suggestionDraftAt(editor: Editor): string | null {
	const { state } = editor;
	const { selection } = state;
	if (!selection.empty) return null;
	const $from = selection.$from;
	if (!$from.parent.isTextblock) return null;
	// End of a text run only: nothing after the caret in this paragraph.
	if ($from.parentOffset !== $from.parent.content.size) return null;
	if (!$from.parent.textContent.trim()) return null;
	for (let depth = $from.depth; depth > 0; depth--) {
		const name = $from.node(depth).type.name;
		if (name === "blockquote" || name === "codeBlock") return null;
	}
	const draft = state.doc.textBetween(0, selection.from, "\n", " ");
	if (draft.trim().length < MIN_SUGGESTION_DRAFT_CHARS) return null;
	return suggestionDraftTail(draft);
}

export function useWritingSuggestions(editor: Editor | null, options: WritingSuggestionsOptions) {
	const { mailboxId, enabled, inReplyTo } = options;
	const subjectRef = useRef(options.subject);
	subjectRef.current = options.subject;
	// Turned off or out of quota for this compose session.
	const stoppedRef = useRef(false);

	useEffect(() => {
		if (!editor || !enabled || !mailboxId) return;
		stoppedRef.current = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let controller: AbortController | null = null;

		const cancel = () => {
			if (timer) clearTimeout(timer);
			timer = undefined;
			controller?.abort();
			controller = null;
		};

		const request = async () => {
			if (editor.isDestroyed || !editor.isFocused || editor.view.composing) return;
			const draft = suggestionDraftAt(editor);
			if (!draft) return;
			const doc = editor.state.doc;
			const pos = editor.state.selection.from;
			const current = new AbortController();
			controller = current;
			try {
				const { suggestion } = await api.suggestCompose(
					mailboxId,
					{ draft, subject: subjectRef.current || undefined, inReplyTo: inReplyTo || undefined },
					{ signal: current.signal },
				);
				if (current.signal.aborted || editor.isDestroyed) return;
				// Stale: the user typed or moved on while it was in flight.
				if (editor.state.doc !== doc || editor.state.selection.from !== pos) return;
				if (suggestion) editor.commands.showGhostSuggestion(suggestion);
			} catch (error) {
				if (error instanceof ApiError && (error.status === 403 || error.status === 429)) {
					stoppedRef.current = true;
				}
			} finally {
				if (controller === current) controller = null;
			}
		};

		const schedule = () => {
			cancel();
			if (stoppedRef.current) return;
			timer = setTimeout(() => void request(), SUGGESTION_DEBOUNCE_MS);
		};

		const onUpdate = () => schedule();
		const onSelectionUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
			// Typing is handled by `update`; a caret move alone just dismisses.
			if (!transaction.docChanged) cancel();
		};
		const onBlur = () => {
			cancel();
			editor.commands.clearGhostSuggestion();
		};

		editor.on("update", onUpdate);
		editor.on("selectionUpdate", onSelectionUpdate);
		editor.on("blur", onBlur);
		return () => {
			editor.off("update", onUpdate);
			editor.off("selectionUpdate", onSelectionUpdate);
			editor.off("blur", onBlur);
			cancel();
			if (!editor.isDestroyed) editor.commands.clearGhostSuggestion();
		};
	}, [editor, enabled, mailboxId, inReplyTo]);
}
