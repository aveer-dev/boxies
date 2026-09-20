// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbox New vs Seen list sections (HEY Imbox spirit).
 * New = conversation still has unread non-draft mail; Seen = fully read.
 */

import { Folders } from "./folders.ts";

export type ListSection = "new" | "seen";

export interface ListSectionRow {
	read?: boolean;
	thread_unread_count?: number | null;
	folder_id?: string | null;
	date?: string | null;
}

/** True when a threaded list row belongs in New. */
export function conversationIsNew(email: ListSectionRow): boolean {
	if (email.folder_id === Folders.DRAFT) return false;
	if ((email.thread_unread_count ?? 0) > 0) return true;
	return !email.read;
}

export function listSectionFor(email: ListSectionRow): ListSection {
	return conversationIsNew(email) ? "new" : "seen";
}

/** Annotate rows with list_section when enabled (inbox only). */
export function annotateListSections<T extends ListSectionRow>(
	emails: T[],
	enabled: boolean,
): Array<T & { list_section?: ListSection }> {
	if (!enabled) return emails;
	return emails.map((email) => ({
		...email,
		list_section: listSectionFor(email),
	}));
}

/** Sort New (date DESC) then Seen (date DESC). Stable within equal dates. */
export function sortNewThenSeen<T extends ListSectionRow>(emails: T[]): T[] {
	return emails
		.map((email, index) => ({ email, index }))
		.sort((a, b) => {
			const aNew = conversationIsNew(a.email) ? 0 : 1;
			const bNew = conversationIsNew(b.email) ? 0 : 1;
			if (aNew !== bNew) return aNew - bNew;
			const aDate = a.email.date ?? "";
			const bDate = b.email.date ?? "";
			if (aDate !== bDate) return bDate.localeCompare(aDate);
			return a.index - b.index;
		})
		.map(({ email }) => email);
}

export function countListSections(emails: ListSectionRow[]): {
	newCount: number;
	seenCount: number;
} {
	let newCount = 0;
	let seenCount = 0;
	for (const email of emails) {
		if (conversationIsNew(email)) newCount += 1;
		else seenCount += 1;
	}
	return { newCount, seenCount };
}

/** Whether the folder uses New/Seen IA. */
export function folderUsesNewSeen(folderId: string | null | undefined): boolean {
	return folderId === Folders.INBOX;
}
