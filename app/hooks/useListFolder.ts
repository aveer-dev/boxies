// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import { isSystemFolderId, orderTagIds, reconcileListFolder, withListSegment } from "shared/tag-url";
import { useFolders } from "~/queries/folders";

/**
 * The folder id whose list is open (`/emails/:folder` or `/tags/:tagRef`),
 * resolved from the URL by routes/email-list.tsx. Null outside a folder list.
 */
export const ListFolderContext = createContext<string | null>(null);

/**
 * The open folder list's real folder id (a tag's id, not its URL index), or
 * null. Columns outside the list route (extra readers, pop-out) see a
 * built-in folder from the URL; a tag there would need the folder list.
 */
export function useListFolderId(): string | null {
	const resolved = useContext(ListFolderContext);
	const { folder } = useParams<{ folder?: string }>();
	if (resolved !== null) return resolved;
	return folder !== undefined && isSystemFolderId(folder) ? folder : null;
}

/**
 * Resolve the folder list route's URL to a folder id (AVE-126,
 * shared/tag-url.ts). Built-in folders are named in the path; a tag by its
 * index among the mailbox's tags. Old `/emails/<tag-id>` links are rewritten
 * to `/tags/<index>` with `replace`; an index the mailbox doesn't have goes to
 * the Inbox. When only the folder list changes (a tag created or deleted), the
 * open tag keeps its place at its new index. Null until it's known.
 */
export function useResolvedListFolder(mailboxId: string): string | null {
	const { folder, tagRef } = useParams<{ folder?: string; tagRef?: string }>();
	const location = useLocation();
	const navigate = useNavigate();
	const foldersQuery = useFolders(mailboxId);
	const tagIds = useMemo(
		() => (foldersQuery.data ? orderTagIds(foldersQuery.data.map((f) => f.id)) : null),
		[foldersQuery.data],
	);
	const idsKey = tagIds?.join("\n") ?? null;

	const route = tagRef !== undefined ? "tags" : "emails";
	const segment = tagRef ?? folder ?? Folders.INBOX;

	// The tag on screen, the list it was resolved against and the URL it was
	// shown at (as in routes/mailbox.tsx): a list change pins it, a navigation
	// resolves afresh.
	const shownRef = useRef<{ idsKey: string; tagId: string; locationKey: string } | null>(null);
	const shown = shownRef.current;
	const pinned =
		route === "tags" && shown && idsKey !== null && shown.idsKey !== idsKey && shown.locationKey === location.key
			? shown.tagId
			: null;
	// The list couldn't load: a tag can't be resolved, so go to the Inbox.
	const outcome = reconcileListFolder(route, segment, foldersQuery.isError ? [] : tagIds, pinned);

	useEffect(() => {
		if (route === "tags" && outcome.kind === "show" && idsKey !== null) {
			shownRef.current = { idsKey, tagId: outcome.folderId, locationKey: location.key };
		}
	});

	const target =
		outcome.kind === "redirect"
			? `${withListSegment(location.pathname, outcome.list, outcome.keepRest)}${location.search}${location.hash}`
			: null;
	useEffect(() => {
		if (target) navigate(target, { replace: true });
	}, [target, navigate]);

	if (outcome.kind === "show") return outcome.folderId;
	if (outcome.kind === "redirect") return outcome.folderId;
	return null;
}
