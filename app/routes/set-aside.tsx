// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowsClockwiseIcon, BookmarkSimpleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { formatParticipants } from "shared/sender";
import ColumnPane from "~/components/columns/ColumnPane";
import { IconButton } from "~/components/IconButton";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import { ListLoadError } from "~/components/ListLoadError";
import ReaderColumn from "~/components/columns/ReaderColumn";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { useEmailActions } from "~/hooks/useEmailActions";
import { useEmailMenu } from "~/hooks/useEmailMenu";
import { useListShortcuts } from "~/hooks/useListShortcuts";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { PILE_SET_ASIDE } from "~/lib/piles";
import { getSnippetText } from "~/lib/utils";
import { useEmails, useUpdateEmail } from "~/queries/emails";
import { queryKeys } from "~/queries/keys";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

/**
 * Column 3 for `/set-aside` (+ the reader for `:emailId`): the Set Aside
 * pile (AVE-201), mail to keep handy until you take it out. Unlike Reply
 * Later there's no reply owed, so no Focus & Reply and no reminders.
 */
export default function SetAsideRoute() {
	const mailboxId = useMailboxId();
	const { emailId, openEmail, closeEmail } = useMailNavigation();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();

	const params = useMemo(
		() => ({ pile: PILE_SET_ASIDE, page: String(page), limit: String(PAGE_SIZE) }),
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
	const openMenu = useEmailMenu(mailboxId, actions);
	useListShortcuts(emails, actions, {
		selectedId: emailId,
		open: (email) => openEmail(email.id),
	});

	useEffect(() => {
		setPage(1);
	}, [mailboxId]);

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.workflowPiles.list(mailboxId) });
	};

	return (
		<>
			<ColumnPane
				id="list"
				revealKey={`${mailboxId}/set-aside`}
				title="Set Aside"
				counter={totalCount || undefined}
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
						icon={<BookmarkSimpleIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="Nothing set aside"
						description="Keep mail you need handy, like tickets or a document you're waiting on."
					/>
				) : (
					<>
						{emails.map((email: Email, index) => (
							<ThreadRow
								key={email.id}
								onMenu={(from) => openMenu(email, from)}
								index={index}
								email={email}
								isSelected={emailId === email.id}
								isUnread={false}
								onOpen={() => openEmail(email.id)}
								sender={formatParticipants(email)}
								snippet={getSnippetText(email.snippet)}
								onToggleStar={() =>
									updateEmail.mutate({
										mailboxId,
										id: email.id,
										data: { starred: !email.starred },
									})
								}
								hoverActions={
									<RowAction
										label="Remove from Set Aside"
										icon={BookmarkSimpleIcon}
										weight="fill"
										onClick={() => actions.toggleSetAside(email)}
									/>
								}
							/>
						))}
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
