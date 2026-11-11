// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowsClockwiseIcon, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatParticipants } from "shared/sender";
import ColumnPane from "~/components/columns/ColumnPane";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import ReaderColumn from "~/components/columns/ReaderColumn";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { IconButton } from "~/components/IconButton";
import { ListLoadError } from "~/components/ListLoadError";
import { type EmailActions, useEmailActions } from "~/hooks/useEmailActions";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { useEmailMenu } from "~/hooks/useEmailMenu";
import { useListShortcuts } from "~/hooks/useListShortcuts";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { getSnippetText } from "~/lib/utils";
import { useEmails, useUpdateEmail } from "~/queries/emails";
import { queryKeys } from "~/queries/keys";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

/**
 * Column 3 for a pile without Reply Later's extras (+ the reader for
 * `:emailId`): Set Aside (AVE-201) and the piles people make (AVE-194).
 * Oldest added first; each row's hover action takes it out of the pile.
 */
export default function PileColumn({
	pileId,
	title,
	icon: Icon,
	emptyTitle,
	emptyDescription,
	removeLabel,
	onRemove,
	menu,
	missing,
}: {
	pileId: string;
	title: string;
	icon: PhosphorIcon;
	emptyTitle: string;
	emptyDescription: string;
	removeLabel: string;
	onRemove: (email: Email, actions: EmailActions) => void;
	/** Column options (rename / delete for custom piles). */
	menu?: ReactNode;
	/** The pile is gone (deleted elsewhere): say so instead of listing. */
	missing?: ReactNode;
}) {
	const mailboxId = useMailboxId();
	const { emailId, openEmail, closeEmail } = useMailNavigation();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();

	const params = useMemo(
		() => ({ pile: pileId, page: String(page), limit: String(PAGE_SIZE) }),
		[pileId, page],
	);
	const {
		data: emailData,
		isFetching: isRefreshing,
		error: loadError,
		refetch,
	} = useEmails(missing ? undefined : mailboxId, params, { refetchInterval: 30_000 });
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
	}, [mailboxId, pileId]);

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.workflowPiles.list(mailboxId) });
	};

	return (
		<>
			<ColumnPane
				id="list"
				revealKey={`${mailboxId}/pile/${pileId}`}
				title={title}
				counter={(!missing && totalCount) || undefined}
				actions={
					missing ? undefined : (
						<>
							<IconButton
								label="Refresh"
								icon={ArrowsClockwiseIcon}
								iconClassName={isRefreshing ? "animate-spin" : ""}
								onClick={handleRefresh}
								disabled={isRefreshing}
							/>
							{menu}
						</>
					)
				}
			>
				{missing ? (
					missing
				) : isRefreshing && emails.length === 0 ? (
					<ThreadListSkeleton />
				) : loadError && emails.length === 0 ? (
					<ListLoadError error={loadError} onRetry={() => void refetch()} />
				) : emails.length === 0 ? (
					<ListEmptyState
						icon={<Icon size={40} weight="thin" className="text-kumo-subtle" />}
						title={emptyTitle}
						description={emptyDescription}
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
										label={removeLabel}
										icon={Icon}
										weight="fill"
										onClick={() => onRemove(email, actions)}
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
