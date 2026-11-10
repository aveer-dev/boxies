// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Writing suggestions (AVE-189): a short grey continuation after the caret
 * while composing, accepted with Tab. Shared by the Worker and the web app.
 *
 * Route: POST /api/v1/mailboxes/:mailboxId/compose/suggest
 *   body  ComposeSuggestionRequest
 *   200   ComposeSuggestionResponse (`suggestion` may be "")
 *   403   { error } when the mailbox has writing suggestions turned off
 *   429   AiQuotaExceededError (bucket "suggest") plus `error`
 *
 * Off by default: the mailbox setting is `writingSuggestions: { enabled }`.
 */

export interface ComposeSuggestionRequest {
	/** Plain text of the draft up to the caret. Nothing after the caret. */
	draft: string;
	subject?: string;
	/** Id of the message being replied to; its text is the only other context. */
	inReplyTo?: string;
}

export interface ComposeSuggestionResponse {
	suggestion: string;
}

/** Drafts shorter than this (trimmed) get no suggestion and cost nothing. */
export const MIN_SUGGESTION_DRAFT_CHARS = 12;

/** Upper bound the route accepts for `draft`; clients send at most this tail. */
export const MAX_SUGGESTION_DRAFT_CHARS = 4_000;

/** Pause after the last keystroke before a suggestion is requested. */
export const SUGGESTION_DEBOUNCE_MS = 400;

/** Writing suggestions are off unless the mailbox turned them on. */
export function isWritingSuggestionsEnabled(settings: unknown): boolean {
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) return false;
	const value = (settings as Record<string, unknown>).writingSuggestions;
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return (value as Record<string, unknown>).enabled === true;
}

/** Validation for a settings PUT; null when `writingSuggestions` is absent or valid. */
export function writingSuggestionsSettingsError(settings: unknown): string | null {
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
	const value = (settings as Record<string, unknown>).writingSuggestions;
	if (value === undefined) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return "writingSuggestions settings must be an object";
	}
	const enabled = (value as Record<string, unknown>).enabled;
	if (enabled !== undefined && typeof enabled !== "boolean") {
		return "writingSuggestions.enabled must be a boolean";
	}
	return null;
}

/**
 * The tail of a draft worth sending: the last MAX_SUGGESTION_DRAFT_CHARS,
 * starting on a word boundary when it had to be cut.
 */
export function suggestionDraftTail(draft: string, max: number = MAX_SUGGESTION_DRAFT_CHARS): string {
	if (draft.length <= max) return draft;
	const tail = draft.slice(-max);
	const space = tail.search(/\s/);
	return space > 0 && space < 40 ? tail.slice(space + 1) : tail;
}
