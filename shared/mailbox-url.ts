// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Web app URLs carry no account details (AVE-126). Cloudflare Web Analytics
 * records every page path on inboxies.app (SPA route changes included, only
 * the query string is dropped), so:
 *
 * - A mailbox is named in the path by its position in the signed-in user's
 *   mailbox list, Gmail-style: `/mailbox/0/emails/inbox`. The list is sorted
 *   by address (the order GET /api/v1/mailboxes returns and the sidebar
 *   shows), so the same index means different mailboxes for different people
 *   and never identifies anyone. API calls keep using the real mailbox id.
 * - Invite links carry their token in the query string: `/invite?token=…`.
 *
 * Old links (`/mailbox/you@domain/...`, `/invite/<token>`) still work: the
 * Worker answers them with a redirect before any page loads, and the app
 * rewrites them with `replace` if one is reached client-side.
 */

/** Longest index accepted in a path; nobody has 10,000 mailboxes. */
const MAILBOX_INDEX = /^(0|[1-9]\d{0,3})$/;

/** Mailbox ids in URL-index order (sorted, like the server's ORDER BY mailbox_id). */
export function orderMailboxIds(ids: readonly string[]): string[] {
	return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The index a path segment names, or null when it isn't an index. */
export function parseMailboxIndex(segment: string | null | undefined): number | null {
	if (!segment || !MAILBOX_INDEX.test(segment)) return null;
	return Number(segment);
}

/** The path segment for `mailboxId`, or null when it isn't one of `ids`. */
export function mailboxRefFor(mailboxId: string, ids: readonly string[]): string | null {
	const index = orderMailboxIds(ids).indexOf(mailboxId);
	return index === -1 ? null : String(index);
}

/** `/mailbox/<index>` for a mailbox, or null when it isn't one of `ids`. */
export function mailboxHref(mailboxId: string, ids: readonly string[]): string | null {
	const ref = mailboxRefFor(mailboxId, ids);
	return ref === null ? null : `/mailbox/${ref}`;
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

export type MailboxRefResolution =
	/** An index of one of the user's mailboxes. */
	| { kind: "mailbox"; mailboxId: string; index: number }
	/** An old address-style segment for one of the user's mailboxes: rewrite to `index`. */
	| { kind: "legacy"; mailboxId: string; index: number }
	/** Not one of the user's mailboxes (out-of-range index or unknown address). */
	| { kind: "unknown" };

/** What a `/mailbox/<segment>` names, given the user's mailbox ids. */
export function resolveMailboxRef(
	segment: string | null | undefined,
	ids: readonly string[],
): MailboxRefResolution {
	const ordered = orderMailboxIds(ids);
	const index = parseMailboxIndex(segment);
	if (index !== null) {
		const mailboxId = ordered[index];
		return mailboxId === undefined ? { kind: "unknown" } : { kind: "mailbox", mailboxId, index };
	}
	if (!segment) return { kind: "unknown" };
	const wanted = decodeSegment(segment).trim().toLowerCase();
	const legacyIndex = ordered.findIndex((id) => id.toLowerCase() === wanted);
	return legacyIndex === -1
		? { kind: "unknown" }
		: { kind: "legacy", mailboxId: ordered[legacyIndex], index: legacyIndex };
}

const MAILBOX_PATH = /^\/mailbox\/([^/]+)(\/.*)?$/;

/** The `<segment>` of a `/mailbox/<segment>/...` path, or null for other paths. */
export function mailboxSegmentOf(pathname: string): string | null {
	return MAILBOX_PATH.exec(pathname)?.[1] ?? null;
}

/** `pathname` with its mailbox segment replaced by `ref` (other paths unchanged). */
export function withMailboxRef(pathname: string, ref: string): string {
	const match = MAILBOX_PATH.exec(pathname);
	if (!match) return pathname;
	return `/mailbox/${ref}${match[2] ?? ""}`;
}

/**
 * Where an old address-style mailbox URL should go: the same view at the
 * mailbox's index, or `/` when the address isn't one of the user's mailboxes
 * (the app then opens the last-used one). Null for index URLs and other paths,
 * which need no redirect.
 */
export function legacyMailboxRedirect(
	pathname: string,
	search: string,
	ids: readonly string[],
): string | null {
	const segment = mailboxSegmentOf(pathname);
	if (segment === null || parseMailboxIndex(segment) !== null) return null;
	const resolved = resolveMailboxRef(segment, ids);
	if (resolved.kind !== "legacy") return "/";
	return `${withMailboxRef(pathname, String(resolved.index))}${search}`;
}

/** The web app's invite page for `token`; the token stays out of the path. */
export function invitePath(token: string): string {
	return `/invite?token=${encodeURIComponent(token)}`;
}

/** `/invite?token=…` for an old `/invite/<token>` path, keeping other query params. */
export function legacyInviteRedirect(pathname: string, search: string): string | null {
	const match = /^\/invite\/([^/]+)\/?$/.exec(pathname);
	if (!match) return null;
	const params = new URLSearchParams(search);
	params.delete("token");
	const rest = params.toString();
	return `${invitePath(decodeSegment(match[1]))}${rest ? `&${rest}` : ""}`;
}

export type MailboxRefOutcome =
	/** Show this mailbox. */
	| { kind: "show"; mailboxId: string }
	/** Rewrite the URL's segment to `ref` (with `replace`); keep showing `mailboxId` meanwhile. */
	| { kind: "redirect"; ref: string; mailboxId: string }
	/** Not one of the user's mailboxes: go to `fallbackRef`, or `/` when there is none. */
	| { kind: "leave"; fallbackRef: string | null };

/**
 * What the mailbox route does with its URL segment.
 *
 * `pinned` is the mailbox that was on screen before the mailbox list last
 * changed (pass null when it hasn't changed). Indexes follow the sorted list,
 * so adding or removing a mailbox can shift them; the open mailbox then stays
 * open at its new index instead of the URL quietly naming another one.
 * `lastUsed` (AVE-90's remembered mailbox) is where an out-of-range index goes,
 * else the first mailbox.
 */
export function reconcileMailboxRef(
	segment: string | null | undefined,
	ids: readonly string[],
	pinned: string | null = null,
	lastUsed: string | null = null,
): MailboxRefOutcome {
	const ordered = orderMailboxIds(ids);
	if (pinned) {
		const pinnedIndex = ordered.indexOf(pinned);
		if (pinnedIndex !== -1 && parseMailboxIndex(segment) !== pinnedIndex) {
			return { kind: "redirect", ref: String(pinnedIndex), mailboxId: pinned };
		}
	}
	const resolved = resolveMailboxRef(segment, ordered);
	if (resolved.kind === "mailbox") return { kind: "show", mailboxId: resolved.mailboxId };
	if (resolved.kind === "legacy") {
		return { kind: "redirect", ref: String(resolved.index), mailboxId: resolved.mailboxId };
	}
	const fallback = lastUsed && ordered.includes(lastUsed) ? lastUsed : ordered[0];
	return { kind: "leave", fallbackRef: fallback === undefined ? null : String(ordered.indexOf(fallback)) };
}
