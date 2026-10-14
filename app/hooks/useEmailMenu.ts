// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowsOutSimpleIcon,
	ChatCircleIcon,
	ClockCounterClockwiseIcon,
	ColumnsPlusRightIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	StarIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { type MouseEvent, useCallback } from "react";
import { Folders } from "shared/folders";
import { type MenuEntry, useContextMenu } from "~/components/ContextMenu";
import { type EmailActions, hasUnread } from "~/hooks/useEmailActions";
import { keysFor } from "~/lib/shortcuts";
import { useFolders } from "~/queries/folders";
import type { Email } from "~/types";

/**
 * The mail-row menu: the native apps' long-press menu (reply group, star and
 * read state, delete in red), with the actions they keep in "More options"
 * shown inline — there's room on a desktop.
 */
export function buildEmailMenu(
	email: Email,
	actions: EmailActions,
	moveTargets: { id: string; name: string }[],
): MenuEntry[] {
	const isDraft = email.folder_id === Folders.DRAFT;
	const unread = hasUnread(email);
	const entries: MenuEntry[] = [];

	if (!isDraft) {
		entries.push(
			{ type: "item", label: "Reply", icon: ArrowBendUpLeftIcon, shortcut: keysFor("reply"), onSelect: () => actions.reply(email) },
			{ type: "item", label: "Reply all", icon: ChatCircleIcon, shortcut: keysFor("replyAll"), onSelect: () => actions.replyAll(email) },
			{ type: "item", label: "Forward", icon: ArrowBendUpRightIcon, shortcut: keysFor("forward"), onSelect: () => actions.forward(email) },
			{ type: "separator" },
		);
	}

	entries.push(
		{
			type: "item",
			label: email.starred ? "Unstar" : "Star",
			icon: StarIcon,
			shortcut: keysFor("star"),
			onSelect: () => actions.toggleStar(email),
		},
		{
			type: "item",
			label: unread ? "Mark as read" : "Mark as unread",
			icon: unread ? EnvelopeOpenIcon : EnvelopeSimpleIcon,
			shortcut: keysFor("toggleRead"),
			onSelect: () => actions.toggleRead(email),
		},
		{
			type: "item",
			label: email.reply_later ? "Remove from Reply Later" : "Reply later",
			icon: ClockCounterClockwiseIcon,
			shortcut: keysFor("replyLater"),
			onSelect: () => actions.toggleReplyLater(email),
		},
		{ type: "separator" },
		{
			type: "item",
			label: "Open in new column",
			icon: ColumnsPlusRightIcon,
			shortcut: keysFor("openInColumn"),
			onSelect: () => actions.openInColumn(email),
		},
		{
			type: "item",
			label: "Pop out",
			icon: ArrowsOutSimpleIcon,
			shortcut: keysFor("popOut"),
			onSelect: () => actions.popOut(email),
		},
		{ type: "separator" },
	);

	if (email.folder_id !== Folders.ARCHIVE) {
		entries.push({
			type: "item",
			label: "Archive",
			icon: ArchiveIcon,
			shortcut: keysFor("archive"),
			onSelect: () => actions.archive(email),
		});
	}
	const targets = moveTargets.filter((f) => f.id !== email.folder_id);
	if (targets.length > 0) {
		entries.push({
			type: "submenu",
			label: "Move to",
			icon: FolderSimpleIcon,
			items: targets.map((f) => ({ type: "item", label: f.name, onSelect: () => actions.move(email, f.id) })),
		});
	}
	entries.push(
		{ type: "separator" },
		{
			type: "item",
			label: email.folder_id === Folders.TRASH ? "Delete permanently" : "Delete message",
			icon: TrashIcon,
			shortcut: keysFor("delete"),
			danger: true,
			onSelect: () => actions.remove(email),
		},
	);
	return entries;
}

/**
 * Opens the mail-row menu at the pointer (right-click), beside the ⋯ button,
 * or under a focused row (context-menu key / ⇧F10).
 */
export function useEmailMenu(mailboxId: string, actions: EmailActions) {
	const { data: folders = [] } = useFolders(mailboxId);
	const open = useContextMenu((s) => s.open);

	return useCallback(
		(email: Email, from: MouseEvent<HTMLElement> | HTMLElement) => {
			const entries = buildEmailMenu(email, actions, folders);
			const label = `Actions for ${email.subject || "message"}`;
			if (from instanceof HTMLElement) {
				// Keyboard (row) or the ⋯ button: anchor to the element.
				const rect = from.getBoundingClientRect();
				const isRow = from.matches("[data-email-id]");
				open({
					x: isRow ? rect.left + 24 : rect.right,
					y: isRow ? rect.top + rect.height / 2 : rect.bottom,
					anchor: isRow ? undefined : rect,
					entries,
					label,
					returnFocus: from,
					viaKeyboard: isRow,
				});
				return;
			}
			from.preventDefault();
			open({
				x: from.clientX,
				y: from.clientY,
				entries,
				label,
				returnFocus: from.currentTarget,
				// A right-click from the keyboard's menu key has no pointer position.
				viaKeyboard: from.detail === 0 && from.clientX === 0 && from.clientY === 0,
			});
		},
		[actions, folders, open],
	);
}
