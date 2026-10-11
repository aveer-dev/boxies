// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowsClockwiseIcon,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Folders, getFolderDisplayName, SYSTEM_FOLDER_IDS } from "shared/folders";
import { formatParticipants } from "shared/sender";
import ColumnMenu from "~/components/columns/ColumnMenu";
import ColumnPane from "~/components/columns/ColumnPane";
import ReaderColumn from "~/components/columns/ReaderColumn";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { searchPath, useMailNavigation } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";
import { buildInboxListItems } from "~/lib/list-sections";
import { getSnippetText } from "~/lib/utils";
import {
	useDeleteEmail,
	useEmails,
	useMarkThreadRead,
	useUpdateEmail,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
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

function hasUnread(email: Email): boolean {
	if (email.folder_id === Folders.DRAFT) return false;
	if ((email.thread_unread_count ?? 0) > 0) return true;
	return !email.read;
}

/** Column 3 for `/emails/:folder` (+ the reader for `:emailId`). */
export default function EmailListRoute() {
	const { mailboxId = "", folder = Folders.INBOX } = useParams<{
		mailboxId: string;
		folder: string;
	}>();
	const { emailId, openEmail, closeEmail } = useMailNavigation();
	const startCompose = useUIStore((s) => s.startCompose);
	const navigate = useNavigate();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const deleteEmail = useDeleteEmail();

	const params = useMemo(
		() => ({ folder, page: String(page), limit: String(PAGE_SIZE) }),
		[folder, page],
	);
	const { data: emailData, isFetching: isRefreshing } = useEmails(mailboxId, params, {
		refetchInterval: 30_000,
	});

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;
	const showNewSeen = folder === Folders.INBOX;

	const listItems = useMemo(() => {
		if (!showNewSeen || emails.length === 0) {
			return emails.map((email) => ({ type: "email" as const, email }));
		}
		return buildInboxListItems(emails, {
			page,
			newCount: emailData?.newCount,
			seenCount: emailData?.seenCount,
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

	const markRead = (email: Email, read: boolean) => {
		if (read && email.thread_id && (email.thread_count ?? 1) > 1) {
			markThreadRead.mutate({ mailboxId, threadId: email.thread_id });
		} else {
			updateEmail.mutate({ mailboxId, id: email.id, data: { read } });
		}
	};

	const handleOpen = (email: Email) => {
		openEmail(email.id);
		if (hasUnread(email)) markRead(email, true);
	};

	const handleDelete = (email: Email) => {
		if (!window.confirm("Are you sure you want to delete this email?")) return;
		deleteEmail.mutate({ mailboxId, id: email.id });
		if (emailId === email.id) closeEmail();
	};

	const handleMarkAllRead = () => {
		for (const email of emails) if (hasUnread(email)) markRead(email, true);
	};

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
	};

	const filterBy = (operator: string) =>
		navigate(searchPath(mailboxId, `in:${folder} ${operator}`));

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
				title={folderName}
				counter={unreadCount || undefined}
				widthClassName="md:w-[400px]"
				actions={
					<>
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
						<button
							type="button"
							onClick={handleMarkAllRead}
							className="p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
							aria-label="Mark all as read"
							title="Mark all as read"
						>
							<ChecksIcon size={15} />
						</button>
						<ColumnMenu
							label="Filter"
							heading={`Filter ${folderName}`}
							trigger={<SlidersHorizontalIcon size={15} />}
							items={[
								{ label: "Unread", icon: <EnvelopeSimpleIcon size={15} />, onSelect: () => filterBy("is:unread") },
								{ label: "Starred", icon: <StarIcon size={15} />, onSelect: () => filterBy("is:starred") },
								{ label: "Has attachment", icon: <PaperclipIcon size={15} />, onSelect: () => filterBy("has:attachment") },
							]}
						/>
					</>
				}
			>
				{isRefreshing && emails.length === 0 ? (
					<ThreadListSkeleton />
				) : emails.length === 0 ? (
					<ListEmptyState
						{...emptyState}
						action={
							"showCompose" in emptyState && emptyState.showCompose ? (
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
						{listItems.map((item) => {
							if (item.type === "section") {
								return (
									<div
										key={`section-${item.id}`}
										className="sticky top-0 z-[1] flex items-center gap-2 bg-kumo-base/95 backdrop-blur-sm px-6 pt-3 pb-1.5 border-b border-kumo-line"
									>
										<span className="text-[10px] font-medium tracking-wider uppercase text-kumo-subtle">
											{item.label}
										</span>
										{item.count != null && (
											<span className="text-[10px] text-kumo-subtle">· {item.count}</span>
										)}
									</div>
								);
							}
							if (item.type === "empty-new") {
								return (
									<p key="empty-new" className="px-6 py-3 text-sm text-kumo-subtle border-b border-kumo-line">
										You’re caught up
									</p>
								);
							}
							const email = item.email;
							const unread = hasUnread(email);
							return (
								<ThreadRow
									key={email.id}
									email={email}
									isSelected={emailId === email.id}
									isUnread={unread}
									onOpen={() => handleOpen(email)}
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
										<>
											<RowAction
												label={email.read ? "Mark unread" : "Mark read"}
												icon={email.read ? <EnvelopeSimpleIcon size={14} /> : <EnvelopeOpenIcon size={14} />}
												onClick={() => markRead(email, !email.read)}
											/>
											<RowAction
												label="Delete"
												icon={<TrashIcon size={14} />}
												onClick={() => handleDelete(email)}
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
