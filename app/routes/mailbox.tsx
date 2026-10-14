// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import AccountsColumn from "~/components/columns/AccountsColumn";
import ColumnCanvas from "~/components/columns/ColumnCanvas";
import FloatingDock from "~/components/columns/FloatingDock";
import FoldersColumn from "~/components/columns/FoldersColumn";
import { AgentColumn, ComposeColumn, ExtraReaderColumn } from "~/components/columns/PlatformColumns";
import SettingsColumns from "~/components/settings/SettingsColumns";
import ShortcutSheet from "~/components/ShortcutSheet";
import { useMailboxEvents } from "~/hooks/useMailboxEvents";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailbox } from "~/queries/mailboxes";
import { ApiError } from "~/services/api";

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
	const { panels, resetColumns } = useUIStore();
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
			navigate("/", { replace: true });
		}
	}, [mailboxQuery.error, navigate]);

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
			<FloatingDock />
			<ShortcutSheet />
		</>
	);
}
