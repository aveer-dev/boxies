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

export type ListSectionRowWithId = ListSectionRow & {
	id?: string;
	thread_id?: string | null;
	list_section?: ListSection | null;
};

/** Apply read/unread to matching list rows (by id and/or thread_id). */
export function applyReadToEmails<T extends ListSectionRowWithId>(
	emails: T[],
	opts: { id?: string; threadId?: string; read: boolean },
): T[] {
	return emails.map((email) => {
		const match =
			(opts.id != null && email.id === opts.id) ||
			(opts.threadId != null &&
				email.thread_id != null &&
				email.thread_id === opts.threadId);
		if (!match) return email;
		return {
			...email,
			read: opts.read,
			thread_unread_count: opts.read
				? 0
				: Math.max(1, email.thread_unread_count ?? 1),
			list_section: (opts.read ? "seen" : "new") as ListSection,
		};
	});
}

export interface EmailListCacheLike<T extends ListSectionRowWithId> {
	emails: T[];
	totalCount: number;
	newCount?: number;
	seenCount?: number;
}

/** Reorder + recount an inbox list cache after a read-state change. */
export function patchEmailListCache<T extends ListSectionRowWithId>(
	cached: EmailListCacheLike<T>,
	folder: string | undefined,
	opts: { id?: string; threadId?: string; read: boolean },
): EmailListCacheLike<T> {
	const patched = applyReadToEmails(cached.emails, opts);
	if (!folderUsesNewSeen(folder)) {
		return { ...cached, emails: patched };
	}
	const ordered = annotateListSections(sortNewThenSeen(patched), true) as T[];
	const { newCount, seenCount } = countListSections(ordered);
	return {
		...cached,
		emails: ordered,
		newCount,
		seenCount,
		totalCount: newCount + seenCount,
	};
}

export type InboxListItem<T> =
	| { type: "section"; id: "new" | "seen"; label: string; count?: number }
	| { type: "empty-new" }
	| { type: "email"; email: T };

/** Build New/Seen list rows for the Inbox folder UI. */
export function buildInboxListItems<T extends ListSectionRowWithId>(
	emails: T[],
	opts: {
		page: number;
		newCount?: number;
		seenCount?: number;
	},
): InboxListItem<T>[] {
	const items: InboxListItem<T>[] = [];
	let lastSection: ListSection | null = null;
	let sawNew = false;
	let sawSeen = false;

	for (const email of emails) {
		const section: ListSection =
			email.list_section === "new" || email.list_section === "seen"
				? email.list_section
				: listSectionFor(email);
		if (section === "new") sawNew = true;
		if (section === "seen") sawSeen = true;
		if (section !== lastSection) {
			if (
				section === "seen" &&
				!sawNew &&
				opts.page === 1 &&
				(opts.newCount === 0 || opts.newCount === undefined)
			) {
				items.push({
					type: "section",
					id: "new",
					label: "New",
					count: opts.newCount ?? 0,
				});
				items.push({ type: "empty-new" });
			}
			items.push({
				type: "section",
				id: section,
				label: section === "new" ? "New" : "Seen",
				count: section === "new" ? opts.newCount : opts.seenCount,
			});
			lastSection = section;
		}
		items.push({ type: "email", email });
	}

	if (
		opts.page === 1 &&
		!sawNew &&
		sawSeen &&
		!items.some((i) => i.type === "empty-new")
	) {
		items.unshift(
			{ type: "section", id: "new", label: "New", count: opts.newCount ?? 0 },
			{ type: "empty-new" },
		);
	}

	return items;
}
