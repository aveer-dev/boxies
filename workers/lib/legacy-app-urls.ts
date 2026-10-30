// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	legacyInviteRedirect,
	mailboxSegmentOf,
	parseMailboxIndex,
	resolveMailboxRef,
	withMailboxRef,
} from "../../shared/mailbox-url";
import { legacyTagRedirect, legacyTagSegmentOf } from "../../shared/tag-url";

/**
 * Old web app links that put account details in the path (AVE-126):
 * `/invite/<token>`, `/mailbox/<address>/...` and `/mailbox/<ref>/emails/<tag>/...`
 * (a tag's id is a slug of the name its owner chose). They answer with a redirect
 * before any page (and so the Web Analytics beacon) loads, so the address,
 * token or tag name is never recorded as a page path. See shared/mailbox-url.ts
 * and shared/tag-url.ts.
 */

const isPageRequest = (method: string) => method === "GET" || method === "HEAD";

const redirect = (location: string) =>
	new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });

/** `/invite/<token>` → `/invite?token=<token>`. Public: needs no session. */
export function legacyInviteResponse(request: Request): Response | null {
	if (!isPageRequest(request.method)) return null;
	const url = new URL(request.url);
	const target = legacyInviteRedirect(url.pathname, url.search);
	return target ? redirect(target) : null;
}

/**
 * True for `/mailbox/<segment>/...` page requests whose segment isn't an index,
 * or whose `emails/<folder>` names a tag rather than a built-in folder.
 */
export function isLegacyMailboxPage(request: Request): boolean {
	if (!isPageRequest(request.method)) return false;
	const pathname = new URL(request.url).pathname;
	const segment = mailboxSegmentOf(pathname);
	if (segment === null) return false;
	return parseMailboxIndex(segment) === null || legacyTagSegmentOf(pathname) !== null;
}

/**
 * Both rewrites in one redirect, for a signed-in user given their mailbox ids:
 * the mailbox address becomes its index, and a tag name becomes the tag's
 * index (`tags/<n>`, read from that mailbox's folders with `loadFolderIds`) or
 * the Inbox when the mailbox has no such tag. A mailbox that isn't theirs
 * goes to `/`. If the folders can't be read, the app rewrites the tag part
 * client-side instead.
 */
export async function legacyAppPageResponse(
	request: Request,
	mailboxIds: readonly string[],
	loadFolderIds: (mailboxId: string) => Promise<readonly string[]>,
): Promise<Response | null> {
	if (!isLegacyMailboxPage(request)) return null;
	const url = new URL(request.url);
	const segment = mailboxSegmentOf(url.pathname);
	if (segment === null) return null;
	const resolved = resolveMailboxRef(segment, mailboxIds);
	if (resolved.kind === "unknown") return redirect("/");
	let path = withMailboxRef(url.pathname, String(resolved.index));
	if (legacyTagSegmentOf(path) !== null) {
		try {
			path = legacyTagRedirect(path, await loadFolderIds(resolved.mailboxId)) ?? path;
		} catch {
			// The folder list route rewrites it once the app has the folders.
		}
	}
	return path === url.pathname ? null : redirect(`${path}${url.search}`);
}
