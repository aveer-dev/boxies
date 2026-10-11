// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";
import { Outlet, useNavigate, useParams } from "react-router";
import AccountsColumn from "~/components/columns/AccountsColumn";
import ColumnCanvas from "~/components/columns/ColumnCanvas";
import FloatingDock from "~/components/columns/FloatingDock";
import FoldersColumn from "~/components/columns/FoldersColumn";
import { AgentColumn, ComposeColumn } from "~/components/columns/PlatformColumns";
import { useMailboxEvents } from "~/hooks/useMailboxEvents";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailbox } from "~/queries/mailboxes";
import { ApiError } from "~/services/api";

/**
 * Horizontal Miller columns:
 *   [Inboxies] [Folders & tags] [<Outlet/>: list → reader | settings → page] [Compose] [Agent]
 * plus the floating dock. Which list/reader/settings columns show is decided
 * by the child route; compose and agent are transient UI state.
 */
export default function MailboxRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const mailboxQuery = useMailbox(mailboxId);
	useMailboxEvents(mailboxId);
	const { isComposing, isAgentPanelOpen, resetColumns } = useUIStore();
	const prevMailboxIdRef = useRef<string | undefined>(undefined);

	// Switching mailbox drops a compose that belongs to the previous one.
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
				{isComposing && <ComposeColumn />}
				{isAgentPanelOpen && <AgentColumn />}
			</ColumnCanvas>
			<FloatingDock />
		</>
	);
}
