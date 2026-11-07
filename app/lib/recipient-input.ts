// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Splits a comma-separated recipient field into committed text and the token being typed. */
export function currentToken(value: string): { prefix: string; token: string } {
	const lastComma = value.lastIndexOf(",");
	if (lastComma === -1) {
		return { prefix: "", token: value };
	}
	return {
		prefix: value.slice(0, lastComma + 1),
		token: value.slice(lastComma + 1).replace(/^\s+/, ""),
	};
}

/**
 * Commits the token being typed: appends ", " so the next address starts fresh.
 * Leaves the value alone when there is nothing to commit (empty, or already separated).
 */
export function commitRecipientToken(value: string): string {
	if (!currentToken(value).token.trim()) return value;
	return `${value.replace(/\s+$/, "")}, `;
}

export interface RecipientKeyInput {
	key: string;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	/** True while an IME composition is in progress (Enter confirms the composition). */
	isComposing?: boolean;
	/** The suggestion list is visible. */
	listOpen: boolean;
	/** A suggestion is highlighted and can be picked. */
	hasHighlight: boolean;
}

export type RecipientKeyAction =
	| "none"
	| "next"
	| "prev"
	| "close"
	| "select"
	| "commit"
	| "send";

/**
 * Decides what a keydown in a To/Cc/Bcc field does (AVE-122). Plain Enter never
 * reaches the compose form's submit: it picks the highlighted suggestion or
 * commits the typed address. Only Cmd/Ctrl+Enter sends.
 */
export function recipientKeyAction(e: RecipientKeyInput): RecipientKeyAction {
	if (e.isComposing) return "none";
	if (e.key === "Enter") {
		if (e.metaKey || e.ctrlKey) return "send";
		if (e.listOpen && e.hasHighlight) return "select";
		return "commit";
	}
	if (!e.listOpen) return "none";
	if (e.key === "ArrowDown") return "next";
	if (e.key === "ArrowUp") return "prev";
	if (e.key === "Tab") return e.hasHighlight ? "select" : "none";
	if (e.key === "Escape") return "close";
	return "none";
}
