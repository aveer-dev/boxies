// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Folders, SYSTEM_FOLDER_IDS } from "./folders";
import { parseMailboxIndex } from "./mailbox-url";

/**
 * Tags (custom folders) are named in web app URLs by their index, never their
 * name (AVE-126, see shared/mailbox-url.ts for why): a tag's id is a slug of
 * the name the user chose, so `/emails/acme-invoices` would put that word in
 * every page path Web Analytics records.
 *
 *   /mailbox/0/emails/inbox          built-in folder: the same name for everyone
 *   /mailbox/0/tags/2/<emailId>      the mailbox's third tag
 *
 * The index is the tag's position among the mailbox's tags sorted by id. Ids
 * don't change when a tag is renamed, so a rename keeps every index; creating
 * or deleting a tag can shift them (the app keeps the open tag open at its new
 * index). Old `/emails/<tag-id>` links are rewritten to `/tags/<index>`: by the
 * Worker before the page loads, and by the app with `replace` otherwise.
 */

export function isSystemFolderId(folderId: string): boolean {
	return (SYSTEM_FOLDER_IDS as readonly string[]).includes(folderId);
}

/** The tag ids among `folderIds`, in URL-index order (sorted by id). */
export function orderTagIds(folderIds: readonly string[]): string[] {
	return folderIds
		.filter((id) => !isSystemFolderId(id))
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The URL index for tag `tagId`, or null when it isn't one of `folderIds`' tags. */
export function tagRefFor(tagId: string, folderIds: readonly string[]): string | null {
	const index = orderTagIds(folderIds).indexOf(tagId);
	return index === -1 ? null : String(index);
}

/**
 * The list part of a mailbox URL for a folder: `emails/<id>` for a built-in
 * folder, `tags/<index>` for a tag, or null for a tag `folderIds` doesn't have.
 */
export function folderListSegment(folderId: string, folderIds: readonly string[]): string | null {
	if (isSystemFolderId(folderId)) return `emails/${folderId}`;
	const ref = tagRefFor(folderId, folderIds);
	return ref === null ? null : `tags/${ref}`;
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** The tag an old `/emails/<tag-id>` segment named, by id (raw or %-encoded, any case). */
export function resolveLegacyTagSegment(
	segment: string,
	folderIds: readonly string[],
): { tagId: string; index: number } | null {
	const wanted = decodeSegment(segment).trim().toLowerCase();
	const ordered = orderTagIds(folderIds);
	const index = ordered.findIndex((id) => id.toLowerCase() === wanted);
	return index === -1 ? null : { tagId: ordered[index], index };
}

const LIST_PATH = /^(\/mailbox\/[^/]+)\/(emails|tags)\/([^/]+)(\/.*)?$/;

/**
 * The `<name>` of a `/mailbox/<ref>/emails/<name>/...` path when it isn't a
 * built-in folder (an old link naming a tag), else null.
 */
export function legacyTagSegmentOf(pathname: string): string | null {
	const match = LIST_PATH.exec(pathname);
	if (!match || match[2] !== "emails") return null;
	return isSystemFolderId(match[3]) ? null : match[3];
}

/**
 * `pathname` with its list part (`emails/<x>` or `tags/<x>`) replaced by
 * `list`. `keepRest` keeps what follows it (an open email); other paths are
 * returned unchanged.
 */
export function withListSegment(pathname: string, list: string, keepRest = true): string {
	const match = LIST_PATH.exec(pathname);
	if (!match) return pathname;
	return `${match[1]}/${list}${keepRest ? (match[4] ?? "") : ""}`;
}

/**
 * Where an old `/mailbox/<ref>/emails/<tag-id>/...` path goes: the same view at
 * `tags/<index>`, or the mailbox's Inbox when it has no such tag. Null for
 * paths that need no rewrite.
 */
export function legacyTagRedirect(pathname: string, folderIds: readonly string[]): string | null {
	const segment = legacyTagSegmentOf(pathname);
	if (segment === null) return null;
	const tag = resolveLegacyTagSegment(segment, folderIds);
	return tag
		? withListSegment(pathname, `tags/${tag.index}`)
		: withListSegment(pathname, `emails/${Folders.INBOX}`, false);
}

export type ListFolderOutcome =
	/** The folder list hasn't loaded yet and is needed to tell. */
	| { kind: "wait" }
	/** Show this folder's list. */
	| { kind: "show"; folderId: string }
	/**
	 * Rewrite the URL's list part to `list` (with `replace`), keeping what
	 * follows when `keepRest`. `folderId` is what to show meanwhile, if known.
	 */
	| { kind: "redirect"; list: string; keepRest: boolean; folderId: string | null };

const toInbox: ListFolderOutcome = {
	kind: "redirect",
	list: `emails/${Folders.INBOX}`,
	keepRest: false,
	folderId: null,
};

/**
 * What the folder list route does with its URL.
 *
 * `route` is which form the URL has: `emails/<segment>` (a built-in folder, or
 * an old link naming a tag) or `tags/<segment>` (a tag's index). `folderIds`
 * is the mailbox's folder ids, or null while they load. `pinned` is the tag
 * that was on screen before the folder list last changed (null when it
 * hasn't): it stays open at its new index, and if it was deleted the view goes
 * to the Inbox rather than the URL quietly naming another tag. An index the
 * mailbox doesn't have goes to the Inbox too.
 */
export function reconcileListFolder(
	route: "emails" | "tags",
	segment: string,
	folderIds: readonly string[] | null,
	pinned: string | null = null,
): ListFolderOutcome {
	if (route === "emails" && isSystemFolderId(segment)) return { kind: "show", folderId: segment };
	if (folderIds === null) return { kind: "wait" };
	const ordered = orderTagIds(folderIds);
	if (route === "emails") {
		const tag = resolveLegacyTagSegment(segment, ordered);
		return tag
			? { kind: "redirect", list: `tags/${tag.index}`, keepRest: true, folderId: tag.tagId }
			: toInbox;
	}
	if (pinned) {
		const pinnedIndex = ordered.indexOf(pinned);
		if (pinnedIndex === -1) return toInbox;
		if (parseMailboxIndex(segment) !== pinnedIndex) {
			return { kind: "redirect", list: `tags/${pinnedIndex}`, keepRest: true, folderId: pinned };
		}
		return { kind: "show", folderId: pinned };
	}
	const index = parseMailboxIndex(segment);
	const tagId = index === null ? undefined : ordered[index];
	return tagId === undefined ? toInbox : { kind: "show", folderId: tagId };
}
