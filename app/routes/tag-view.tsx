// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowsClockwiseIcon,
	ChecksIcon,
	DotsThreeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	PencilSimpleIcon,
	TagSimpleIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Folders } from "shared/folders";
import { formatParticipants } from "shared/sender";
import ColumnMenu from "~/components/columns/ColumnMenu";
import ColumnPane from "~/components/columns/ColumnPane";
import { ListEmptyState, ListPagination, ThreadListSkeleton } from "~/components/columns/ListParts";
import ReaderColumn from "~/components/columns/ReaderColumn";
import ThreadRow, { RowAction } from "~/components/columns/ThreadRow";
import { IconButton } from "~/components/IconButton";
import { ListLoadError } from "~/components/ListLoadError";
import { useTagEditor } from "~/components/TagDialogs";
import { hasUnread, useEmailActions } from "~/hooks/useEmailActions";
import { useEmailMenu } from "~/hooks/useEmailMenu";
import { useListShortcuts } from "~/hooks/useListShortcuts";
import { folderPath, useMailNavigation } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";
import { keysFor } from "~/lib/shortcuts";
import { tagThreadKey } from "~/lib/tags";
import { getSnippetText } from "~/lib/utils";
import { queryKeys } from "~/queries/keys";
import { useSetThreadTag, useTaggedEmails, useTags } from "~/queries/tags";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

/**
 * Column 3 for `/tagged/:tagId` (AVE-241): every conversation with the tag,
 * newest first, outside Trash, Spam and Drafts — plus the reader for
 * `:emailId`. The tag can be renamed or deleted from the header menu.
 */
export default function TagViewRoute() {
	const { tagId } = useParams<{ tagId: string }>();
	const { mailboxId, mailboxRef, emailId, openEmail, closeEmail } = useMailNavigation();
	const isReadOnly = useUIStore((s) => s.isReadOnly);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);

	const { data: tags, isSuccess: tagsLoaded } = useTags(mailboxId);
	const tag = tags?.find((t) => t.id === tagId);
	const params = useMemo(() => ({ page: String(page), limit: String(PAGE_SIZE) }), [page]);
	const {
		data: emailData,
		isFetching: isRefreshing,
		error: loadError,
		refetch,
	} = useTaggedEmails(mailboxId, tagId, params);
	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	// A different tag (or mailbox) starts on page 1.
	useEffect(() => setPage(1), [mailboxId, tagId]);

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
	const handleOpen = (email: Email) => {
		openEmail(email.id);
		if (hasUnread(email)) actions.setRead(email, true);
	};
	useListShortcuts(emails, actions, { selectedId: emailId, open: handleOpen });

	const setThreadTag = useSetThreadTag();
	const removeTag = (email: Email) => {
		if (!tag) return;
		if (emailIdRef.current === email.id) closeEmail();
		setThreadTag.mutate({
			mailboxId,
			threadId: tagThreadKey(email),
			tag: { id: tag.id, name: tag.name },
			on: false,
		});
	};

	const tagEditor = useTagEditor(mailboxId, {
		onDeleted: () => navigate(folderPath(mailboxRef, Folders.INBOX)),
	});

	const handleRefresh = () => {
		queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
		queryClient.invalidateQueries({ queryKey: queryKeys.tags.list(mailboxId) });
	};
	const handleMarkAllRead = () => {
		for (const email of emails) if (hasUnread(email)) actions.setRead(email, true);
	};

	const missing = tagsLoaded && !tag;
	const title = tag?.name ?? (missing ? "Tag not found" : "");

	return (
		<>
			<ColumnPane
				id="list"
				revealKey={`${mailboxId}/tagged/${tagId}`}
				title={title}
				counter={tag?.unreadCount || undefined}
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
							<IconButton label="Mark all as read" icon={ChecksIcon} onClick={handleMarkAllRead} />
							{tag && !isReadOnly && (
								<ColumnMenu
									label="Tag options"
									heading={tag.name}
									icon={DotsThreeIcon}
									weight="bold"
									items={[
										{ label: "Rename…", icon: PencilSimpleIcon, onSelect: () => tagEditor.startRename(tag) },
										{ label: "Delete tag", icon: TrashIcon, onSelect: () => tagEditor.startDelete(tag) },
									]}
								/>
							)}
						</>
					)
				}
			>
				{missing ? (
					<ListEmptyState
						icon={<TagSimpleIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="This tag no longer exists"
						description="It may have been deleted on another device. The mail it was on is still in its folders."
					/>
				) : isRefreshing && emails.length === 0 ? (
					<ThreadListSkeleton />
				) : loadError && emails.length === 0 ? (
					<ListLoadError error={loadError} onRetry={() => void refetch()} />
				) : emails.length === 0 ? (
					<ListEmptyState
						icon={<TagSimpleIcon size={40} weight="thin" className="text-kumo-subtle" />}
						title="Nothing tagged yet"
						description="Add this tag to a message from the reader’s Tags button, or a row’s menu."
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
									hideTagId={tagId}
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
											{!isReadOnly && (
												<RowAction label="Remove tag" icon={XIcon} onClick={() => removeTag(email)} />
											)}
										</>
									}
								/>
							);
						})}
						<ListPagination page={page} setPage={setPage} perPage={PAGE_SIZE} totalCount={totalCount} />
					</>
				)}
			</ColumnPane>
			{tagEditor.dialogs}
			{emailId && <ReaderColumn emailId={emailId} />}
		</>
	);
}
