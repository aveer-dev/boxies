// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import AccountsColumn from "~/components/columns/AccountsColumn";
import ColumnCanvas from "~/components/columns/ColumnCanvas";
import FloatingDock from "~/components/columns/FloatingDock";
import FoldersColumn from "~/components/columns/FoldersColumn";
import ServiceBanner from "~/components/ServiceBanner";
import { AgentColumn, ComposeColumn, ExtraReaderColumn } from "~/components/columns/PlatformColumns";
import SettingsColumns from "~/components/settings/SettingsColumns";
import { ContextMenuHost } from "~/components/ContextMenu";
import PopOutReader from "~/components/PopOutReader";
import TextSizeWheelHost from "~/components/TextSizeWheel";
import ShortcutSheet from "~/components/ShortcutSheet";
import { useMailboxEvents } from "~/hooks/useMailboxEvents";
import { useUIStore } from "~/hooks/useUIStore";
import { forgetLastMailbox, readLastMailbox, rememberLastMailbox } from "~/lib/last-mailbox";
import { useMailbox } from "~/queries/mailboxes";
import api, { ApiError } from "~/services/api";

/**
 * Horizontal Miller columns:
 *   [Inboxies] [Folders & tags] [<Outlet/>: list → reader] [panels…]
 * plus the floating dock. Which list/reader columns show is decided by the
 * child route. Panels (compose, extra readers, agent, settings → page) are
 * transient UI state: each opens at the far right, beside whatever is
 * already open.
 */
export default function MailboxRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const mailboxQuery = useMailbox(mailboxId);
	useMailboxEvents(mailboxId);
	const { panels, resetColumns, setReadOnly } = useUIStore();
	const readOnly = Boolean(mailboxQuery.data?.readOnly);
	const { data: me } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});
	const userId = me?.userId;
	const openedMailboxId = mailboxQuery.data ? mailboxId : undefined;

	// The next visit to `/` reopens this mailbox (AVE-90). Only once it has
	// loaded, so a link to a mailbox the user can't open isn't remembered.
	useEffect(() => {
		if (openedMailboxId) rememberLastMailbox(userId, openedMailboxId);
	}, [openedMailboxId, userId]);

	// A mailbox whose domain's subscription ended can't compose or use the agent.
	useEffect(() => {
		setReadOnly(readOnly);
	}, [readOnly, setReadOnly]);
	useEffect(() => () => setReadOnly(false), [setReadOnly]);
	const prevMailboxIdRef = useRef<string | undefined>(undefined);

	// Switching mailbox drops the compose and reader columns of the previous one.
	useEffect(() => {
		if (prevMailboxIdRef.current && mailboxId && prevMailboxIdRef.current !== mailboxId) {
			resetColumns();
		}
		prevMailboxIdRef.current = mailboxId;
	}, [mailboxId, resetColumns]);

	useEffect(() => {
		const err = mailboxQuery.error;
		if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
			if (mailboxId && readLastMailbox(userId) === mailboxId) forgetLastMailbox(userId);
			navigate("/", { replace: true });
		}
	}, [mailboxQuery.error, mailboxId, userId, navigate]);

	return (
		<>
			<ColumnCanvas>
				<AccountsColumn />
				<FoldersColumn />
				<Outlet />
				{panels.map((panel) => {
					switch (panel.kind) {
						case "compose":
							return <ComposeColumn key={panel.key} panelKey={panel.key} options={panel.options} />;
						case "reader":
							return <ExtraReaderColumn key={panel.key} panelKey={panel.key} emailId={panel.emailId} />;
						case "agent":
							return <AgentColumn key="agent" />;
						case "settings":
							// Remount per mailbox so its forms reload.
							return <SettingsColumns key={`settings-${mailboxId}`} />;
					}
				})}
			</ColumnCanvas>
			<ServiceBanner mailboxId={mailboxId} billed={Boolean(mailboxQuery.data?.service)} />
			<FloatingDock />
			<ShortcutSheet />
			<ContextMenuHost />
			<PopOutReader />
			<TextSizeWheelHost />
		</>
	);
}
