// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	ClockCounterClockwiseIcon,
} from "@phosphor-icons/react";
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
import { selectIsComposing, useUIStore } from "~/hooks/useUIStore";
import { getSnippetText } from "~/lib/utils";
import { useEmails, useUpdateEmail } from "~/queries/emails";
import { queryKeys } from "~/queries/keys";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

/** Column 3 for `/reply-later` (+ the reader for `:emailId`). */
export default function ReplyLaterRoute() {
	const mailboxId = useMailboxId();
	const { emailId, openEmail, closeEmail } = useMailNavigation();
	const startCompose = useUIStore((s) => s.startCompose);
	const isComposing = useUIStore(selectIsComposing);
	const [page, setPage] = useState(1);
	const [focusIndex, setFocusIndex] = useState(0);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();

	const params = useMemo(
		() => ({ reply_later: "true", page: String(page), limit: String(PAGE_SIZE) }),
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
	useListShortcuts(emails, actions);

	useEffect(() => {
		setPage(1);
		setFocusIndex(0);
	}, [mailboxId]);

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.workflowPiles.list(mailboxId) });
	};

	const focusOn = (index: number) => {
		const email = emails[index];
		if (!email) return;
		setFocusIndex(index);
		openEmail(email.id);
		startCompose({ mode: "reply", originalEmail: email });
	};

	const startFocus = () => {
		if (emails.length > 0) focusOn(Math.min(focusIndex, emails.length - 1));
	};

	const advanceFocus = () => {
		if (emails.length <= 1) {
			setFocusIndex(0);
			return;
		}
		focusOn((focusIndex + 1) % emails.length);
	};

	return (
		<>
			<ColumnPane
				id="list"
				revealKey={`${mailboxId}/reply-later`}
				title="Reply Later"
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
				{totalCount > 0 && (
					<div className="flex items-center justify-between gap-2 px-6 py-2.5 border-b border-kumo-line">
						<span className="text-xs text-kumo-subtle">
							{totalCount} waiting · Focus &amp; Reply works the queue
						</span>
						<div className="flex items-center gap-1 shrink-0">
							{isComposing && (
								<Button variant="ghost" size="sm" onClick={advanceFocus}>
									Skip
								</Button>
							)}
							<Button variant="secondary" size="sm" onClick={startFocus}>
								Focus &amp; Reply
							</Button>
						</div>
					</div>
				)}
				{isRefreshing && emails.length === 0 ? (
					<ThreadListSkeleton />
				) : loadError && emails.length === 0 ? (
					<ListLoadError error={loadError} onRetry={() => void refetch()} />
				) : emails.length === 0 ? (
					<ListEmptyState
						icon={<ClockCounterClockwiseIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="Nothing to reply to later"
						description="Queue messages you owe a reply without starring or marking unread."
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
										label="Remove from Reply Later"
										icon={ClockCounterClockwiseIcon}
										weight="fill"
										onClick={() =>
											updateEmail.mutate({
												mailboxId,
												id: email.id,
												data: { reply_later: !email.reply_later },
											})
										}
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
