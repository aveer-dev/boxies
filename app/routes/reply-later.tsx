// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Pagination, Tooltip } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	ClockCounterClockwiseIcon,
	StarIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { formatListDate } from "shared/dates";
import { formatParticipants } from "shared/sender";
import MailboxSplitView from "~/components/MailboxSplitView";
import { getSnippetText } from "~/lib/utils";
import { useEmails, useUpdateEmail } from "~/queries/emails";
import { queryKeys } from "~/queries/keys";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

export default function ReplyLaterRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const {
		selectedEmailId,
		isComposing,
		selectEmail,
		closePanel,
		startCompose,
	} = useUIStore();
	const [page, setPage] = useState(1);
	const [focusIndex, setFocusIndex] = useState(0);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();

	const params = useMemo(
		() => ({
			reply_later: "true",
			page: String(page),
			limit: String(PAGE_SIZE),
		}),
		[page],
	);

	const { data: emailData, isFetching: isRefreshing } = useEmails(
		mailboxId,
		params,
		{ refetchInterval: 30_000 },
	);

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;
	const isPanelOpen = selectedEmailId !== null || isComposing;

	useEffect(() => {
		closePanel();
		setPage(1);
		setFocusIndex(0);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reset when mailbox changes
	}, [mailboxId]);

	const toggleStar = (e: React.MouseEvent, email: Email) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId) {
			updateEmail.mutate({
				mailboxId,
				id: email.id,
				data: { starred: !email.starred },
			});
		}
	};

	const toggleReplyLater = (e: React.MouseEvent, email: Email) => {
		e.preventDefault();
		e.stopPropagation();
		if (mailboxId) {
			updateEmail.mutate({
				mailboxId,
				id: email.id,
				data: { reply_later: !email.reply_later },
			});
		}
	};

	const handleRefresh = () => {
		if (!mailboxId) return;
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({
			queryKey: queryKeys.workflowPiles.list(mailboxId),
		});
	};

	const startFocus = () => {
		if (emails.length === 0) return;
		const idx = Math.min(focusIndex, emails.length - 1);
		const email = emails[idx];
		selectEmail(email.id);
		startCompose({ mode: "reply", originalEmail: email });
	};

	const advanceFocus = () => {
		if (emails.length <= 1) {
			setFocusIndex(0);
			return;
		}
		const next = (focusIndex + 1) % emails.length;
		setFocusIndex(next);
		const email = emails[next];
		selectEmail(email.id);
		startCompose({ mode: "reply", originalEmail: email });
	};

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
			<div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-kumo-line shrink-0 md:px-5">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold text-kumo-default">Reply Later</h1>
					<p className="text-sm text-kumo-subtle truncate">
						{totalCount === 0
							? "Nothing to reply to later"
							: `${totalCount} waiting · Focus & Reply works the queue`}
					</p>
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{totalCount > 0 && (
						<>
							<Button variant="secondary" size="sm" onClick={startFocus}>
								Focus & Reply
							</Button>
							{isComposing && (
								<Button variant="ghost" size="sm" onClick={advanceFocus}>
									Skip
								</Button>
							)}
						</>
					)}
					<Tooltip
						content={isRefreshing ? "Refreshing..." : "Refresh"}
						side="bottom"
						asChild
					>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							icon={
								<ArrowsClockwiseIcon
									size={18}
									className={isRefreshing ? "animate-spin" : ""}
								/>
							}
							onClick={handleRefresh}
							disabled={isRefreshing}
							aria-label="Refresh"
						/>
					</Tooltip>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				{isRefreshing && emails.length === 0 ? (
					<div className="animate-pulse space-y-1 p-2">
						{Array.from({ length: 6 }).map((_, i) => (
							<div key={i} className="h-14 rounded bg-kumo-fill mx-2" />
						))}
					</div>
				) : emails.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
						<ClockCounterClockwiseIcon
							size={48}
							weight="thin"
							className="text-kumo-subtle mb-4"
						/>
						<h3 className="text-base font-semibold text-kumo-default mb-1.5">
							Nothing to reply to later
						</h3>
						<p className="text-sm text-kumo-subtle max-w-xs">
							Queue messages you owe a reply without starring or marking unread.
						</p>
					</div>
				) : (
					<div>
						{emails.map((email) => {
							const isSelected = selectedEmailId === email.id;
							const snippet = getSnippetText(email.snippet);
							return (
								<div
									key={email.id}
									role="button"
									tabIndex={0}
									onClick={() => selectEmail(email.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											selectEmail(email.id);
										}
									}}
									className={`group flex items-center gap-3 w-full text-left cursor-pointer transition-colors border-b border-kumo-line px-4 py-2.5 md:px-6 md:py-3 ${
										isPanelOpen ? "md:px-4 md:py-2.5" : ""
									} ${isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"}`}
								>
									<button
										type="button"
										className="shrink-0 p-0.5 bg-transparent border-0 cursor-pointer"
										onClick={(e) => toggleReplyLater(e, email)}
										aria-label="Remove from Reply Later"
									>
										<ClockCounterClockwiseIcon
											size={16}
											weight="fill"
											className="text-kumo-accent"
										/>
									</button>
									<button
										type="button"
										className="shrink-0 p-0.5 bg-transparent border-0 cursor-pointer"
										onClick={(e) => toggleStar(e, email)}
									>
										<StarIcon
											size={16}
											weight={email.starred ? "fill" : "regular"}
											className={
												email.starred
													? "text-kumo-warning"
													: "text-kumo-subtle hover:text-kumo-warning"
											}
										/>
									</button>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<span className="truncate text-sm font-semibold text-kumo-default">
												{formatParticipants(email)}
											</span>
											<span className="ml-auto shrink-0 text-xs text-kumo-subtle">
												{formatListDate(email.date)}
											</span>
										</div>
										<div className="truncate text-sm text-kumo-strong">
											{email.subject || "(no subject)"}
										</div>
										{snippet && (
											<div className="truncate text-xs text-kumo-subtle">
												{snippet}
											</div>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>

			{totalCount > PAGE_SIZE && (
				<div className="border-t border-kumo-line px-4 py-2 shrink-0">
					<Pagination
						page={page}
						totalPages={Math.ceil(totalCount / PAGE_SIZE)}
						onPageChange={setPage}
					/>
				</div>
			)}
		</MailboxSplitView>
	);
}
