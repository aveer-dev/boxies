// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { Loader } from "@cloudflare/kumo";
import { useEffect, useMemo, useRef } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router";
import { orderMailboxIds, reconcileMailboxRef, withMailboxRef } from "shared/mailbox-url";
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
import ReplyLaterReminderDialog from "~/components/ReplyLaterReminderDialog";
import { useMailboxEvents } from "~/hooks/useMailboxEvents";
import { useUIStore } from "~/hooks/useUIStore";
import { forgetLastMailbox, readLastMailbox, rememberLastMailbox } from "~/lib/last-mailbox";
import { CurrentMailboxContext, useMailboxId } from "~/hooks/useCurrentMailbox";
import { useMailbox, useMailboxes } from "~/queries/mailboxes";
import api, { ApiError } from "~/services/api";

/**
 * `/mailbox/:mailboxRef`: the segment is the mailbox's index in the user's
 * mailbox list, never its address, so page analytics can't tie a URL to a
 * person (AVE-126, shared/mailbox-url.ts). This resolves it to the real id
 * for everything below (useMailboxId), rewrites old address-style URLs with
 * `replace`, and sends an index the user doesn't have to their last-used
 * (or first) mailbox.
 */
export default function MailboxRoute() {
	const { mailboxRef = "" } = useParams<{ mailboxRef: string }>();
	const location = useLocation();
	const navigate = useNavigate();
	const mailboxesQuery = useMailboxes();
	const { data: me } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});
	const ids = useMemo(
		() => orderMailboxIds((mailboxesQuery.data ?? []).map((m) => m.id)),
		[mailboxesQuery.data],
	);
	const idsKey = ids.join("\n");

	// The mailbox on screen, the list it was resolved against and the URL it
	// was shown at. When only the list changes (a mailbox added or removed),
	// indexes can shift: the open mailbox keeps its place instead of the
	// unchanged URL quietly naming another one. A navigation resolves afresh.
	const shownRef = useRef<{ idsKey: string; mailboxId: string; locationKey: string } | null>(null);
	const shown = shownRef.current;
	const pinned =
		shown && shown.idsKey !== idsKey && shown.locationKey === location.key ? shown.mailboxId : null;
	const outcome = mailboxesQuery.data
		? reconcileMailboxRef(mailboxRef, ids, pinned, readLastMailbox(me?.userId))
		: null;
	const mailboxId = outcome && outcome.kind !== "leave" ? outcome.mailboxId : null;

	useEffect(() => {
		if (outcome?.kind === "show") {
			shownRef.current = { idsKey, mailboxId: outcome.mailboxId, locationKey: location.key };
		}
	});

	const target =
		outcome?.kind === "redirect"
			? `${withMailboxRef(location.pathname, outcome.ref)}${location.search}${location.hash}`
			: outcome?.kind === "leave"
				? outcome.fallbackRef === null
					? "/"
					: `/mailbox/${outcome.fallbackRef}`
				: null;
	useEffect(() => {
		if (target) navigate(target, { replace: true });
	}, [target, navigate]);

	useEffect(() => {
		// The list couldn't load: the mailbox list page handles that.
		if (mailboxesQuery.isError) navigate("/", { replace: true });
	}, [mailboxesQuery.isError, navigate]);

	const currentRef = outcome?.kind === "redirect" ? outcome.ref : mailboxRef;
	const current = useMemo(
		() => (mailboxId ? { mailboxId, mailboxRef: currentRef } : null),
		[mailboxId, currentRef],
	);
	if (!current) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-kumo-recessed">
				<Loader size="lg" />
			</div>
		);
	}
	return (
		<CurrentMailboxContext.Provider value={current}>
			<MailboxShell />
		</CurrentMailboxContext.Provider>
	);
}

/**
 * Horizontal Miller columns:
 *   [Inboxies] [Folders & tags] [<Outlet/>: list → reader] [panels…]
 * plus the floating dock. Which list/reader columns show is decided by the
 * child route. Panels (compose, extra readers, agent, settings → page) are
 * transient UI state: each opens at the far right, beside whatever is
 * already open.
 */
function MailboxShell() {
	const mailboxId = useMailboxId();
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
			<ReplyLaterReminderDialog />
		</>
	);
}
