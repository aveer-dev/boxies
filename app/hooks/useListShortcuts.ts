// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useRef } from "react";
import type { EmailActions } from "~/hooks/useEmailActions";
import { type ShortcutId, useShortcut } from "~/lib/shortcuts";
import { stepThread } from "~/lib/thread-step";
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

/** This list's rows, in on-screen order (Inbox's New and Seen sections included). */
function listRows(emails: Email[]): HTMLElement[] {
	const ids = new Set(emails.map((e) => e.id));
	return Array.from(document.querySelectorAll<HTMLElement>("[data-email-id]")).filter((row) =>
		ids.has(row.dataset.emailId ?? ""),
	);
}

/**
 * J / K: open the next or previous thread from the focused row, else the
 * open one, else the first. The row takes focus (so R, E… act on it) and
 * scrolls into view; the reader follows. Stops at the ends of what's loaded.
 *
 * Opening a New Inbox thread marks it read and moves it down into Seen, so a
 * run of J / K keeps the order the list had when the run started.
 */
function useStepShortcuts(
	emails: Email[],
	selectedId: string | null,
	open: (email: Email) => void,
) {
	const run = useRef<{ ids: string[]; at: string } | null>(null);
	const step = (dir: 1 | -1) => {
		const rows = listRows(emails);
		if (rows.length === 0) return false;
		const current = focusedRow(emails)?.email.id ?? selectedId;
		const onScreen = rows.map((row) => row.dataset.emailId ?? "");
		const ids =
			run.current && run.current.at === current
				? run.current.ids.filter((id) => onScreen.includes(id))
				: onScreen;
		const nextId = stepThread(ids, current, dir);
		const row = rows.find((r) => r.dataset.emailId === nextId);
		const email = emails.find((e) => e.id === nextId);
		if (!row || !email) return;
		run.current = { ids, at: email.id };
		row.focus({ preventScroll: true });
		row.scrollIntoView({ block: "nearest" });
		// The URL, not `selectedId`: right after a step React may not have
		// rendered the new route yet, and opening it again would push a duplicate.
		if (!window.location.pathname.endsWith(`/${encodeURIComponent(email.id)}`)) open(email);
	};
	useShortcut("nextThread", () => step(1));
	useShortcut("prevThread", () => step(-1));
}

/**
 * Mail shortcuts (R A F E # U S L O P) act on the focused row of this list;
 * J and K move through it, opening each thread with `open` (the row's click).
 */
export function useListShortcuts(
	emails: Email[],
	actions: EmailActions,
	{ selectedId, open }: { selectedId: string | null | undefined; open: (email: Email) => void },
) {
	useStepShortcuts(emails, selectedId ?? null, open);
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
