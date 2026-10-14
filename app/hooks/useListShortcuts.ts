// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { EmailActions } from "~/hooks/useEmailActions";
import { type ShortcutId, useShortcut } from "~/lib/shortcuts";
import type { Email } from "~/types";

/** Beats the open reader: a focused row is what the user is pointing at. */
export const ROW_PRIORITY = 10;

/** The list row that has keyboard focus, if it belongs to `emails`. */
function focusedRow(emails: Email[]): { email: Email; row: HTMLElement } | null {
	const row = document.activeElement?.closest<HTMLElement>("[data-email-id]");
	const email = row && emails.find((e) => e.id === row.dataset.emailId);
	return row && email ? { email, row } : null;
}

/** Keeps the keyboard in the list: the next row (or the previous at the end) takes focus. */
function focusNeighbour(row: HTMLElement) {
	const rows = Array.from(
		row.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-email-id]") ?? [],
	);
	const i = rows.indexOf(row);
	(rows[i + 1] ?? rows[i - 1])?.focus({ preventScroll: false });
}

function useRowShortcut(
	id: ShortcutId,
	emails: Email[],
	run: (email: Email, row: HTMLElement) => void,
) {
	useShortcut(
		id,
		() => {
			const target = focusedRow(emails);
			if (!target) return false;
			run(target.email, target.row);
		},
		{ priority: ROW_PRIORITY },
	);
}

/** Mail shortcuts (R A F E # U S L O P) act on the focused row of this list. */
export function useListShortcuts(emails: Email[], actions: EmailActions) {
	useRowShortcut("reply", emails, (email) => actions.reply(email));
	useRowShortcut("replyAll", emails, (email) => actions.replyAll(email));
	useRowShortcut("forward", emails, (email) => actions.forward(email));
	useRowShortcut("toggleRead", emails, (email) => actions.toggleRead(email));
	useRowShortcut("star", emails, (email) => actions.toggleStar(email));
	useRowShortcut("replyLater", emails, (email) => actions.toggleReplyLater(email));
	useRowShortcut("openInColumn", emails, (email) => actions.openInColumn(email));
	useRowShortcut("popOut", emails, (email) => actions.popOut(email));
	useRowShortcut("archive", emails, (email, row) => {
		focusNeighbour(row);
		actions.archive(email);
	});
	useRowShortcut("delete", emails, (email, row) => {
		focusNeighbour(row);
		actions.remove(email);
	});
}
