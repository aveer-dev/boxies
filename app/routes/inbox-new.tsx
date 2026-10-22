// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowsClockwiseIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatParticipants } from "shared/sender";
import ColumnPane from "~/components/columns/ColumnPane";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import ReaderColumn from "~/components/columns/ReaderColumn";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { IconButton } from "~/components/IconButton";
import { ListLoadError } from "~/components/ListLoadError";
import { hasUnread, useEmailActions } from "~/hooks/useEmailActions";
import { useEmailMenu } from "~/hooks/useEmailMenu";
import { useListShortcuts } from "~/hooks/useListShortcuts";
import { folderPath, useMailNavigation } from "~/hooks/useMailNavigation";
import { keysFor } from "~/lib/shortcuts";
import { getSnippetText } from "~/lib/utils";
import { useEmails } from "~/queries/emails";
import { queryKeys } from "~/queries/keys";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

/**
 * Column 3 for `/new` (+ the reader for `:emailId`): every New Inbox
 * conversation. The Inbox list caps New so Seen stays in view; its
 * "Show N more new" row lands here (AVE-23).
 */
export default function InboxNewRoute() {
	const { mailboxId = "" } = useParams<{ mailboxId: string }>();
	const { emailId, openEmail, closeEmail } = useMailNavigation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);

	const emailIdRef = useRef(emailId);
	emailIdRef.current = emailId;
	const closeEmailRef = useRef(closeEmail);
	closeEmailRef.current = closeEmail;
	const actions = useEmailActions(
		mailboxId,
		useCallback((email: Email) => {
			if (emailIdRef.current === email.id) closeEmailRef.current();
		}, []),
	);

	const params = useMemo(
		() => ({
			folder: Folders.INBOX,
			section: "new",
			page: String(page),
			limit: String(PAGE_SIZE),
		}),
		[page],
	);
	const {
		data: emailData,
		isFetching: isRefreshing,
		error: loadError,
		refetch,
	} = useEmails(mailboxId, params, { refetchInterval: 30_000 });
	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	useEffect(() => {
		setPage(1);
	}, [mailboxId]);

	const openMenu = useEmailMenu(mailboxId, actions);
	useListShortcuts(emails, actions);

	const handleOpen = (email: Email) => {
		openEmail(email.id);
		if (hasUnread(email)) actions.setRead(email, true);
	};

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
	};

	const backToInbox = () => navigate(folderPath(mailboxId, Folders.INBOX));

	return (
		<>
			<ColumnPane
				id="list"
				revealKey={`${mailboxId}/new`}
				title="New"
				counter={emailData?.newCount || undefined}
				onClose={backToInbox}
				closeLabel="Back to Inbox"
				actions={
					<IconButton
						label="Refresh"
						icon={ArrowsClockwiseIcon}
						iconClassName={isRefreshing ? "animate-spin" : ""}
						onClick={handleRefresh}
						disabled={isRefreshing}
					/>
				}
			>
				{isRefreshing && emails.length === 0 ? (
					<ThreadListSkeleton />
				) : loadError && emails.length === 0 ? (
					<ListLoadError error={loadError} onRetry={() => void refetch()} />
				) : emails.length === 0 ? (
					<ListEmptyState
						icon={<TrayIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="You’re caught up"
						description="Nothing new in your Inbox."
					/>
				) : (
					<>
						{emails.map((email, index) => {
							const unread = hasUnread(email);
							return (
								<ThreadRow
									key={email.id}
									onMenu={(from) => openMenu(email, from)}
									index={index}
									email={email}
									isSelected={emailId === email.id}
									isUnread={unread}
									onOpen={() => handleOpen(email)}
									sender={formatParticipants(email)}
									snippet={getSnippetText(email.snippet)}
									onToggleStar={() => actions.toggleStar(email)}
									hoverActions={
										<>
											<RowAction
												label={unread ? "Mark read" : "Mark unread"}
												shortcut={keysFor("toggleRead")}
												icon={unread ? EnvelopeOpenIcon : EnvelopeSimpleIcon}
												onClick={() => actions.toggleRead(email)}
											/>
											<RowAction
												label="Delete"
												shortcut={keysFor("delete")}
												icon={TrashIcon}
												onClick={() => actions.remove(email)}
											/>
										</>
									}
								/>
							);
						})}
						<ListPagination
							page={page}
							setPage={setPage}
							perPage={PAGE_SIZE}
							totalCount={totalCount}
						/>
					</>
				)}
			</ColumnPane>
			{emailId && <ReaderColumn emailId={emailId} />}
		</>
	);
}
