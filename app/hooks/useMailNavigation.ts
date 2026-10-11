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
 *   /mailbox/:id/settings/:page?            settings → sub-page
 *
 * Compose and agent columns are transient (`useUIStore`) and sit to the right.
 */
export function useMailNavigation() {
	const { mailboxId = "", emailId } = useParams<{
		mailboxId: string;
		emailId?: string;
	}>();
	const location = useLocation();
	const navigate = useNavigate();
	const { isComposing, closeCompose, isAgentPanelOpen, closeAgentPanel } =
		useUIStore();

	const listPath = useMemo(() => {
		const path = location.pathname.replace(/\/+$/, "");
		if (!emailId) return path;
		return path.slice(0, path.lastIndexOf("/"));
	}, [location.pathname, emailId]);

	const isSettings = location.pathname.startsWith(
		`${mailboxPath(mailboxId)}/settings`,
	);
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

	const openSettings = useCallback(
		() => navigate(`${mailboxPath(mailboxId)}/settings`),
		[navigate, mailboxId],
	);

	const closeSettings = useCallback(
		() => navigate(inboxPath),
		[navigate, inboxPath],
	);

	const closeSettingsPage = useCallback(
		() => navigate(`${mailboxPath(mailboxId)}/settings`),
		[navigate, mailboxId],
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
		if (isAgentPanelOpen) {
			closeAgentPanel();
			return true;
		}
		if (isComposing) {
			closeCompose();
			return true;
		}
		if (emailId) {
			closeEmail();
			return true;
		}
		if (isSettings) {
			const atRoot = /\/settings\/?$/.test(location.pathname);
			if (atRoot) closeSettings();
			else closeSettingsPage();
			return true;
		}
		if (isSearch) {
			closeSearch();
			return true;
		}
		return false;
	}, [
		isAgentPanelOpen,
		closeAgentPanel,
		isComposing,
		closeCompose,
		emailId,
		closeEmail,
		isSettings,
		location.pathname,
		closeSettings,
		closeSettingsPage,
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
		openSettings,
		closeSettings,
		closeSettingsPage,
		search,
		closeSearch,
		closeDeepest,
	};
}
