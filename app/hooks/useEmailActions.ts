// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { useCallback, useMemo } from "react";
import { Folders } from "shared/folders";
import { useUIStore } from "~/hooks/useUIStore";
import {
	useDeleteEmail,
	useMarkThreadRead,
	useMoveEmail,
	useUpdateEmail,
} from "~/queries/emails";
import type { Email } from "~/types";

/** Unread, counting the rest of its thread (drafts never are). */
export function hasUnread(email: Email): boolean {
	if (email.folder_id === Folders.DRAFT) return false;
	if ((email.thread_unread_count ?? 0) > 0) return true;
	return !email.read;
}

/**
 * The quick actions on one message, shared by the row menu, the keyboard
 * shortcuts and list rows, so each behaves the same wherever it's started.
 * `onGone` runs when a message leaves the list (archive, delete, move), so
 * an open reader can close.
 */
export function useEmailActions(mailboxId: string, onGone?: (email: Email) => void) {
	const toastManager = useKumoToastManager();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const deleteEmail = useDeleteEmail();
	const moveEmail = useMoveEmail();
	const startCompose = useUIStore((s) => s.startCompose);
	const openReader = useUIStore((s) => s.openReader);

	const setRead = useCallback(
		(email: Email, read: boolean) => {
			if (read && email.thread_id && (email.thread_count ?? 1) > 1) {
				markThreadRead.mutate({ mailboxId, threadId: email.thread_id });
			} else {
				updateEmail.mutate({ mailboxId, id: email.id, data: { read } });
			}
		},
		[mailboxId, markThreadRead, updateEmail],
	);

	return useMemo(
		() => ({
			reply: (email: Email) => startCompose({ mode: "reply", originalEmail: email }),
			replyAll: (email: Email) => startCompose({ mode: "reply-all", originalEmail: email }),
			forward: (email: Email) => startCompose({ mode: "forward", originalEmail: email }),
			setRead,
			toggleRead: (email: Email) => setRead(email, hasUnread(email)),
			toggleStar: (email: Email) =>
				updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } }),
			toggleReplyLater: (email: Email) =>
				updateEmail.mutate({ mailboxId, id: email.id, data: { reply_later: !email.reply_later } }),
			archive: (email: Email) => {
				if (email.folder_id === Folders.ARCHIVE) return;
				moveEmail.mutate({ mailboxId, id: email.id, folderId: Folders.ARCHIVE });
				onGone?.(email);
				toastManager.add({ title: "Archived" });
			},
			move: (email: Email, folderId: string) => {
				moveEmail.mutate({ mailboxId, id: email.id, folderId });
				onGone?.(email);
			},
			remove: (email: Email) => {
				// Outside Trash, delete just moves to Trash (restorable); only confirm the permanent one.
				if (
					email.folder_id === Folders.TRASH &&
					!window.confirm("Permanently delete this email? This can't be undone.")
				) {
					return;
				}
				deleteEmail.mutate({ mailboxId, id: email.id });
				onGone?.(email);
			},
			openInColumn: (email: Email) => {
				openReader(email.id);
				if (hasUnread(email)) setRead(email, true);
			},
		}),
		[mailboxId, setRead, updateEmail, moveEmail, deleteEmail, startCompose, openReader, onGone, toastManager],
	);
}

export type EmailActions = ReturnType<typeof useEmailActions>;
