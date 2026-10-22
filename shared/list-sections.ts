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

/**
 * Inbox list shows at most this many New conversations; the rest open on the
 * "All new" page so Seen always stays in view right below.
 */
export const INBOX_NEW_PREVIEW_LIMIT = 5;

/** Optional New/Seen window on the threaded Inbox list (`section`, `new_limit`). */
export interface InboxSectionQuery {
	/** Only this section (date DESC). Wins over `newLimit`. */
	section?: ListSection;
	/** Keep only the newest N New rows, then every Seen row. */
	newLimit?: number;
}

/** Parse `section` / `new_limit` query params; unknown values are ignored. */
export function parseInboxSectionQuery(
	section: string | null | undefined,
	newLimit: string | number | null | undefined,
): InboxSectionQuery {
	const query: InboxSectionQuery = {};
	if (section === "new" || section === "seen") query.section = section;
	const n = typeof newLimit === "number" ? newLimit : Number.parseInt(newLimit ?? "", 10);
	if (Number.isFinite(n) && n >= 0) query.newLimit = Math.min(Math.floor(n), 100);
	return query;
}

/**
 * SQL filter over a row set exposing `is_new` (0/1) and `section_rank`
 * (1-based rank within its section by date DESC). Integers only — safe to inline.
 */
export function inboxSectionFilterSql(query: InboxSectionQuery): string {
	if (query.section === "new") return "is_new = 1";
	if (query.section === "seen") return "is_new = 0";
	if (query.newLimit !== undefined) {
		return `(is_new = 0 OR section_rank <= ${Math.max(0, Math.floor(query.newLimit))})`;
	}
	return "1 = 1";
}

/** Rows the windowed Inbox list holds in total (drives pagination). */
export function inboxSectionTotal(
	counts: { newCount: number; seenCount: number },
	query: InboxSectionQuery,
): number {
	if (query.section === "new") return counts.newCount;
	if (query.section === "seen") return counts.seenCount;
	if (query.newLimit !== undefined) {
		return Math.min(counts.newCount, query.newLimit) + counts.seenCount;
	}
	return counts.newCount + counts.seenCount;
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
	// The cache holds one page (and New may be capped), so shift the server's
	// section totals by what changed locally instead of recounting the page.
	const before = countListSections(cached.emails);
	const after = countListSections(ordered);
	const newCount = Math.max(
		0,
		(cached.newCount ?? before.newCount) + after.newCount - before.newCount,
	);
	const seenCount = Math.max(
		0,
		(cached.seenCount ?? before.seenCount) + after.seenCount - before.seenCount,
	);
	return {
		...cached,
		emails: ordered,
		newCount,
		seenCount,
	};
}

export type InboxListItem<T> =
	| { type: "section"; id: "new" | "seen"; label: string; count?: number }
	| { type: "empty-new" }
	| { type: "show-more-new"; hiddenCount: number }
	| { type: "email"; email: T };

/** Build New/Seen list rows for the Inbox folder UI. */
export function buildInboxListItems<T extends ListSectionRowWithId>(
	emails: T[],
	opts: {
		page: number;
		newCount?: number;
		seenCount?: number;
		/** Show at most this many New rows, then a "show more" row (page 1). */
		newPreviewLimit?: number;
	},
): InboxListItem<T>[] {
	const items: InboxListItem<T>[] = [];
	let lastSection: ListSection | null = null;
	let sawNew = false;
	let sawSeen = false;
	let shownNew = 0;
	let skippedNew = 0;
	let showMoreAdded = false;
	const limit = opts.newPreviewLimit;

	const addShowMore = () => {
		if (showMoreAdded || limit === undefined || opts.page !== 1) return;
		const total = Math.max(opts.newCount ?? 0, shownNew + skippedNew);
		if (total > shownNew) {
			items.push({ type: "show-more-new", hiddenCount: total - shownNew });
		}
		showMoreAdded = true;
	};

	for (const email of emails) {
		const section: ListSection =
			email.list_section === "new" || email.list_section === "seen"
				? email.list_section
				: listSectionFor(email);
		if (section === "new") {
			sawNew = true;
			// Over the cap (e.g. an older server ignoring new_limit): hide; the
			// "show more" row counts it.
			if (limit !== undefined && opts.page === 1 && shownNew >= limit) {
				skippedNew += 1;
				continue;
			}
		}
		if (section === "seen") sawSeen = true;
		if (section !== lastSection) {
			if (lastSection === "new") addShowMore();
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
		if (section === "new") shownNew += 1;
	}

	if (lastSection === "new") addShowMore();

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
