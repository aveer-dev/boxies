// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { legacyInviteRedirect, legacyMailboxRedirect, mailboxSegmentOf, parseMailboxIndex } from "../../shared/mailbox-url";

/**
 * Old web app links that put account details in the path (AVE-126):
 * `/invite/<token>` and `/mailbox/<address>/...`. They answer with a redirect
 * before any page (and so the Web Analytics beacon) loads, so the address or
 * token is never recorded as a page path. See shared/mailbox-url.ts.
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

/** True for `/mailbox/<segment>/...` page requests whose segment isn't an index. */
export function isLegacyMailboxPage(request: Request): boolean {
	if (!isPageRequest(request.method)) return false;
	const segment = mailboxSegmentOf(new URL(request.url).pathname);
	return segment !== null && parseMailboxIndex(segment) === null;
}

/**
 * `/mailbox/<address>/rest` → `/mailbox/<index>/rest` for a signed-in user,
 * given their mailbox ids; `/` when the address isn't theirs.
 */
export function legacyMailboxResponse(request: Request, mailboxIds: readonly string[]): Response | null {
	if (!isPageRequest(request.method)) return null;
	const url = new URL(request.url);
	const target = legacyMailboxRedirect(url.pathname, url.search, mailboxIds);
	return target ? redirect(target) : null;
}
