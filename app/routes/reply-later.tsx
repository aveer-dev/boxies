// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	ClockCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { formatParticipants } from "shared/sender";
import ColumnPane from "~/components/columns/ColumnPane";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import ReaderColumn from "~/components/columns/ReaderColumn";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";
import { getSnippetText } from "~/lib/utils";
import { useEmails, useUpdateEmail } from "~/queries/emails";
import { queryKeys } from "~/queries/keys";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

/** Column 3 for `/reply-later` (+ the reader for `:emailId`). */
export default function ReplyLaterRoute() {
	const { mailboxId = "" } = useParams<{ mailboxId: string }>();
	const { emailId, openEmail } = useMailNavigation();
	const { isComposing, startCompose } = useUIStore();
	const [page, setPage] = useState(1);
	const [focusIndex, setFocusIndex] = useState(0);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();

	const params = useMemo(
		() => ({ reply_later: "true", page: String(page), limit: String(PAGE_SIZE) }),
		[page],
	);
	const { data: emailData, isFetching: isRefreshing } = useEmails(mailboxId, params, {
		refetchInterval: 30_000,
	});
	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

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
				title="Reply Later"
				counter={totalCount || undefined}
				widthClassName="md:w-[400px]"
				actions={
					<button
						type="button"
						onClick={handleRefresh}
						disabled={isRefreshing}
						className="p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint disabled:opacity-60"
						aria-label="Refresh"
						title="Refresh"
					>
						<ArrowsClockwiseIcon size={15} className={isRefreshing ? "animate-spin" : ""} />
					</button>
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
				) : emails.length === 0 ? (
					<ListEmptyState
						icon={<ClockCounterClockwiseIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="Nothing to reply to later"
						description="Queue messages you owe a reply without starring or marking unread."
					/>
				) : (
					<>
						{emails.map((email: Email) => (
							<ThreadRow
								key={email.id}
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
										icon={<ClockCounterClockwiseIcon size={14} weight="fill" />}
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
