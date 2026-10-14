// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import { useUIStore } from "~/hooks/useUIStore";

export function mailboxPath(mailboxId: string) {
	return `/mailbox/${mailboxId}`;
}

export function folderPath(mailboxId: string, folderId: string) {
	return `${mailboxPath(mailboxId)}/emails/${folderId}`;
}

export function searchPath(mailboxId: string, query: string) {
	return `${mailboxPath(mailboxId)}/search?q=${encodeURIComponent(query)}`;
}

/**
 * The URL decides which Miller columns are open:
 *
 *   /mailbox/:id/emails/:folder/:emailId?   folder list → reader
 *   /mailbox/:id/reply-later/:emailId?      Reply Later → reader
 *   /mailbox/:id/search/:emailId?q=…        results → reader
 *
 * Compose, extra readers, agent and settings are side panels (`useUIStore`):
 * they open to the right of these columns, in the order they were opened.
 */
export function useMailNavigation() {
	const { mailboxId = "", emailId } = useParams<{
		mailboxId: string;
		emailId?: string;
	}>();
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
		`${mailboxPath(mailboxId)}/search`,
	);
	const inboxPath = folderPath(mailboxId, Folders.INBOX);

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
		(query: string) => navigate(searchPath(mailboxId, query)),
		[navigate, mailboxId],
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
