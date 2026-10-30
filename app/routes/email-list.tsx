// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowsClockwiseIcon,
	CaretRightIcon,
	ChecksIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	MegaphoneIcon,
	NewspaperIcon,
	PaperclipIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	ProhibitIcon,
	ShieldCheckIcon,
	SlidersHorizontalIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
	Folders,
	folderRetentionNotice,
	getFolderDisplayName,
	SYSTEM_FOLDER_IDS,
} from "shared/folders";
import { formatParticipants } from "shared/sender";
import ColumnMenu from "~/components/columns/ColumnMenu";
import { IconButton } from "~/components/IconButton";
import ColumnPane from "~/components/columns/ColumnPane";
import ReaderColumn from "~/components/columns/ReaderColumn";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import { ListLoadError } from "~/components/ListLoadError";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { inboxNewPath, searchPath, useMailNavigation } from "~/hooks/useMailNavigation";
import { hasUnread, useEmailActions } from "~/hooks/useEmailActions";
import { useEmailMenu } from "~/hooks/useEmailMenu";
import { useListShortcuts } from "~/hooks/useListShortcuts";
import { useUIStore } from "~/hooks/useUIStore";
import { buildInboxListItems, INBOX_NEW_PREVIEW_LIMIT } from "~/lib/list-sections";
import { keysFor } from "~/lib/shortcuts";
import { getSnippetText } from "~/lib/utils";
import { useEmails } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "Your inbox is empty",
		description:
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SCREENER]: {
		icon: <ShieldCheckIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "Nobody waiting",
		description: "First-time senders wait here until you accept or decline them.",
	},
	[Folders.SENT]: {
		icon: <PaperPlaneTiltIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description: "Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.PROMOTIONS]: {
		icon: <MegaphoneIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "No promotions",
		description:
			"Newsletters and marketing you assign here. Move a message and set that sender’s default to keep them out of Inbox.",
	},
	[Folders.UPDATES]: {
		icon: <NewspaperIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "No updates",
		description:
			"Receipts and transactional mail you file here. Assign senders so they land here automatically.",
	},
	[Folders.SPAM]: {
		icon: <WarningIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "No spam",
		description: "Mail classified as spam is kept out of your inbox here.",
	},
	[Folders.SCREENED_OUT]: {
		icon: <ProhibitIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "Nothing screened out",
		description: "Senders you decline in the Screener end up here.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description: "Deleted emails will appear here.",
	},
};

/** Column 3 for `/emails/:folder` (+ the reader for `:emailId`). */
export default function EmailListRoute() {
	const { folder = Folders.INBOX } = useParams<{ folder: string }>();
	const { mailboxId, mailboxRef, emailId, openEmail, closeEmail } = useMailNavigation();
	const startCompose = useUIStore((s) => s.startCompose);
	const isReadOnly = useUIStore((s) => s.isReadOnly);
	const navigate = useNavigate();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const emailIdRef = useRef(emailId);
	emailIdRef.current = emailId;
	const closeEmailRef = useRef(closeEmail);
	closeEmailRef.current = closeEmail;
	// A message leaving the list closes the reader if it was open there.
	const actions = useEmailActions(
		mailboxId,
		useCallback((email: Email) => {
			if (emailIdRef.current === email.id) closeEmailRef.current();
		}, []),
	);

	const showNewSeen = folder === Folders.INBOX;
	// Inbox: only the newest few New conversations, then Seen (AVE-23), so
	// Seen stays in view however much is unread. "Show all" opens the rest.
	const params = useMemo(
		() => ({
			folder,
			page: String(page),
			limit: String(PAGE_SIZE),
			...(showNewSeen ? { new_limit: String(INBOX_NEW_PREVIEW_LIMIT) } : {}),
		}),
		[folder, page, showNewSeen],
	);
	const {
		data: emailData,
		isFetching: isRefreshing,
		error: loadError,
		refetch,
	} = useEmails(mailboxId, params, { refetchInterval: 30_000 });

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	const listItems = useMemo(() => {
		if (!showNewSeen || emails.length === 0) {
			return emails.map((email) => ({ type: "email" as const, email }));
		}
		return buildInboxListItems(emails, {
			page,
			newCount: emailData?.newCount,
			seenCount: emailData?.seenCount,
			newPreviewLimit: INBOX_NEW_PREVIEW_LIMIT,
		});
	}, [emails, showNewSeen, emailData?.newCount, emailData?.seenCount, page]);

	const { data: folders = [] } = useFolders(mailboxId);
	const isTag = !(SYSTEM_FOLDER_IDS as readonly string[]).includes(folder);
	const folderName = useMemo(() => {
		const found = folders.find((f) => f.id === folder);
		if (found) return isTag ? `#${found.name.replace(/^#/, "")}` : found.name;
		return getFolderDisplayName(folder);
	}, [folders, folder, isTag]);
	const unreadCount = folders.find((f) => f.id === folder)?.unreadCount;

	// New folder (or mailbox) → back to page 1.
	const prevFolderRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		const key = `${mailboxId}/${folder}`;
		if (prevFolderRef.current !== undefined && prevFolderRef.current !== key) setPage(1);
		prevFolderRef.current = key;
	}, [mailboxId, folder]);

	const handleOpen = (email: Email) => {
		openEmail(email.id);
		if (hasUnread(email)) actions.setRead(email, true);
	};

	const openMenu = useEmailMenu(mailboxId, actions);
	useListShortcuts(emails, actions);

	const [emptyingTrash, setEmptyingTrash] = useState(false);
	const handleEmptyTrash = async () => {
		if (!window.confirm("Permanently delete everything in Trash? This can't be undone.")) return;
		setEmptyingTrash(true);
		try {
			await api.emptyTrash(mailboxId);
			closeEmail();
		} finally {
			setEmptyingTrash(false);
			handleRefresh();
		}
	};

	const handleMarkAllRead = () => {
		for (const email of emails) if (hasUnread(email)) actions.setRead(email, true);
	};

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
	};

	const filterBy = (operator: string) =>
		navigate(searchPath(mailboxRef, `in:${folder} ${operator}`));

	const retentionNotice = folderRetentionNotice(folder);

	const emptyState = FOLDER_EMPTY_STATES[folder] ?? {
		icon: <EnvelopeSimpleIcon size={40} weight="thin" className="text-kumo-subtle" />,
		title: isTag ? "Nothing tagged yet" : "No emails",
		description: isTag
			? "Move a message here from the reader’s Move to menu."
			: "This folder is empty.",
	};

	return (
		<>
			<ColumnPane
				id="list"
				revealKey={`${mailboxId}/${folder}`}
				title={folderName}
				counter={unreadCount || undefined}
				actions={
					<>
						<IconButton
							label="Refresh"
							icon={ArrowsClockwiseIcon}
							iconClassName={isRefreshing ? "animate-spin" : ""}
							onClick={handleRefresh}
							disabled={isRefreshing}
						/>
						<IconButton label="Mark all as read" icon={ChecksIcon} onClick={handleMarkAllRead} />
						{folder === Folders.TRASH && totalCount > 0 && (
							<IconButton
								label="Empty Trash"
								icon={TrashIcon}
								onClick={handleEmptyTrash}
								disabled={emptyingTrash}
							/>
						)}
						<ColumnMenu
							label="Filter"
							heading={`Filter ${folderName}`}
							icon={SlidersHorizontalIcon}
							items={[
								{ label: "Unread", icon: EnvelopeSimpleIcon, onSelect: () => filterBy("is:unread") },
								{ label: "Starred", icon: StarIcon, onSelect: () => filterBy("is:starred") },
								{ label: "Has attachment", icon: PaperclipIcon, onSelect: () => filterBy("has:attachment") },
							]}
						/>
					</>
				}
			>
				{isRefreshing && emails.length === 0 ? (
					<ThreadListSkeleton />
				) : loadError && emails.length === 0 ? (
					<ListLoadError error={loadError} onRetry={() => void refetch()} />
				) : emails.length === 0 ? (
					<ListEmptyState
						{...emptyState}
						action={
							"showCompose" in emptyState && emptyState.showCompose && !isReadOnly ? (
								<Button
									variant="primary"
									size="sm"
									icon={<PencilSimpleIcon size={16} />}
									onClick={() => startCompose()}
								>
									Compose
								</Button>
							) : undefined
						}
					/>
				) : (
					<>
						{retentionNotice && (
							<p className="pl-10 pr-4 pt-3 pb-1 text-xs text-kumo-subtle">
								{retentionNotice}
							</p>
						)}
						{listItems.map((item, index) => {
							if (item.type === "section") {
								return (
									<div
										key={`section-${item.id}`}
										className="sticky top-0 z-[1] flex items-center gap-2 bg-kumo-base/95 backdrop-blur-sm pl-10 pr-4 pt-4 pb-2"
									>
										<span className="text-2xs font-medium tracking-wider uppercase text-kumo-subtle">
											{item.label}
										</span>
										{item.count != null && (
											<span className="text-2xs text-kumo-subtle">· {item.count}</span>
										)}
									</div>
								);
							}
							if (item.type === "empty-new") {
								return (
									<p key="empty-new" className="pl-10 pr-4 py-3 text-sm text-kumo-subtle">
										You’re caught up
									</p>
								);
							}
							if (item.type === "show-more-new") {
								return (
									<button
										key="show-more-new"
										type="button"
										onClick={() => navigate(inboxNewPath(mailboxRef))}
										className="flex w-full items-center gap-1 pl-10 pr-4 py-3 text-left text-sm font-medium text-kumo-link hover:underline focus-visible:underline outline-none"
									>
										Show {item.hiddenCount} more new
										<CaretRightIcon size={12} weight="bold" aria-hidden />
									</button>
								);
							}
							const email = item.email;
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
