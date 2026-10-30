// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useMailboxId, useMailboxRef } from "~/hooks/useCurrentMailbox";
import { Folders } from "shared/folders";
import { useUIStore } from "~/hooks/useUIStore";

/**
 * Paths take the mailbox's URL segment (`useMailboxRef()`, its index in the
 * user's list), never its id: page addresses carry no account details
 * (AVE-126, shared/mailbox-url.ts).
 */
export function mailboxPath(mailboxRef: string) {
	return `/mailbox/${mailboxRef}`;
}

export function folderPath(mailboxRef: string, folderId: string) {
	return `${mailboxPath(mailboxRef)}/emails/${folderId}`;
}

/** Every New Inbox conversation (the Inbox list shows only the newest few). */
export function inboxNewPath(mailboxRef: string) {
	return `${mailboxPath(mailboxRef)}/new`;
}

/** The query rides in `?q=`, which Web Analytics drops. */
export function searchPath(mailboxRef: string, query: string) {
	return `${mailboxPath(mailboxRef)}/search?q=${encodeURIComponent(query)}`;
}

/**
 * The URL decides which Miller columns are open:
 *
 *   /mailbox/:ref/emails/:folder/:emailId?   folder list → reader
 *   /mailbox/:ref/reply-later/:emailId?      Reply Later → reader
 *   /mailbox/:ref/new/:emailId?              all New Inbox mail → reader
 *   /mailbox/:ref/search/:emailId?q=…        results → reader
 *
 * `:ref` is the mailbox's index in the user's list (useMailboxRef).
 *
 * Compose, extra readers, agent and settings are side panels (`useUIStore`):
 * they open to the right of these columns, in the order they were opened.
 */
export function useMailNavigation() {
	const { emailId } = useParams<{ emailId?: string }>();
	const mailboxId = useMailboxId();
	const mailboxRef = useMailboxRef();
	const location = useLocation();
	const navigate = useNavigate();
	const {
		panels,
		closeCompose,
		closeReader,
		closeAgentPanel,
		isSettingsOpen: isSettings,
		settingsPage,
		openSettings,
		closeSettings,
		closeSettingsPage,
	} = useUIStore();

	const listPath = useMemo(() => {
		const path = location.pathname.replace(/\/+$/, "");
		if (!emailId) return path;
		return path.slice(0, path.lastIndexOf("/"));
	}, [location.pathname, emailId]);

	const isSearch = location.pathname.startsWith(
		`${mailboxPath(mailboxRef)}/search`,
	);
	const inboxPath = folderPath(mailboxRef, Folders.INBOX);

	const openEmail = useCallback(
		(id: string) =>
			navigate(`${listPath}/${encodeURIComponent(id)}${location.search}`),
		[navigate, listPath, location.search],
	);

	const closeEmail = useCallback(
		() => navigate(`${listPath}${location.search}`),
		[navigate, listPath, location.search],
	);

	const search = useCallback(
		(query: string) => navigate(searchPath(mailboxRef, query)),
		[navigate, mailboxRef],
	);

	const closeSearch = useCallback(
		() => navigate(inboxPath),
		[navigate, inboxPath],
	);

	/** Esc / mobile back: close the right-most column that can be closed. */
	const closeDeepest = useCallback((): boolean => {
		const panel = panels[panels.length - 1];
		switch (panel?.kind) {
			case "agent":
				closeAgentPanel();
				return true;
			case "compose":
				closeCompose(panel.key);
				return true;
			case "reader":
				closeReader(panel.key);
				return true;
			case "settings":
				if (settingsPage) closeSettingsPage();
				else closeSettings();
				return true;
		}
		if (emailId) {
			closeEmail();
			return true;
		}
		if (isSearch) {
			closeSearch();
			return true;
		}
		return false;
	}, [
		panels,
		closeAgentPanel,
		closeCompose,
		closeReader,
		settingsPage,
		closeSettingsPage,
		closeSettings,
		emailId,
		closeEmail,
		isSearch,
		closeSearch,
	]);

	return {
		mailboxId,
		mailboxRef,
		emailId,
		listPath,
		isSettings,
		isSearch,
		openEmail,
		closeEmail,
		openSettings: () => openSettings(),
		closeSettings,
		closeSettingsPage,
		search,
		closeSearch,
		closeDeepest,
	};
}
