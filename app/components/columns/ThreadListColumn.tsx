// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ChecksIcon, PaperclipIcon, SlidersHorizontalIcon, TrayIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { formatListDate } from "shared/dates";
import { FOLDER_DISPLAY_NAMES } from "shared/folders";
import { formatParticipants } from "shared/sender";
import { useColumnStack } from "~/hooks/useColumnStack";
import { getSnippetText, hasFileAttachment } from "~/lib/utils";
import { useEmails, useMarkThreadRead } from "~/queries/emails";
import type { Email } from "~/types";
import ColumnPane from "./ColumnPane";

interface ThreadListColumnProps {
	mailboxId?: string;
	folderId?: string;
}

export default function ThreadListColumn({
	mailboxId: propMailboxId,
	folderId: propFolderId,
}: ThreadListColumnProps) {
	const {
		selectedMailboxId,
		selectedFolderId,
		selectedEmailId,
		selectThread,
	} = useColumnStack();

	const mailboxId = propMailboxId || selectedMailboxId || undefined;
	const folder = propFolderId || selectedFolderId || "inbox";
	const [page, setPage] = useState(1);

	const { data, isLoading } = useEmails(
		mailboxId,
		{ folder, page: String(page), limit: "50" },
		{ enabled: !!mailboxId },
	);

	const emails = data?.emails ?? [];
	const totalCount = data?.totalCount ?? 0;
	const markThreadRead = useMarkThreadRead();

	const handleMarkAllRead = () => {
		if (!mailboxId) return;
		// Mark current page threads read
		const unreadThreadIds = new Set(
			emails.filter((e) => !e.read).map((e) => e.thread_id || e.id),
		);
		for (const tid of unreadThreadIds) {
			markThreadRead.mutate({ mailboxId, threadId: tid });
		}
	};

	const folderDisplayName = FOLDER_DISPLAY_NAMES[folder] || folder;

	return (
		<ColumnPane
			id="threads"
			width={400}
			closable={false}
			title={
				<div className="flex items-center gap-2">
					<span className="text-[11px] font-semibold text-kumo-subtle uppercase tracking-[0.036em]">
						{folderDisplayName}
					</span>
					{totalCount > 0 && (
						<span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-kumo-fill text-kumo-default border border-kumo-line">
							{totalCount}
						</span>
					)}
				</div>
			}
			actions={
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={handleMarkAllRead}
						className="p-1 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
						title="Mark all as read"
						aria-label="Mark all as read"
					>
						<ChecksIcon size={14} weight="bold" />
					</button>
					<button
						type="button"
						className="p-1 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
						title="Filter & sort"
						aria-label="Filter & sort"
					>
						<SlidersHorizontalIcon size={14} weight="regular" />
					</button>
				</div>
			}
			contentClassName="divide-y divide-kumo-line/50"
		>
			{isLoading && emails.length === 0 ? (
				<div className="p-4 space-y-4">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="animate-pulse space-y-2 py-2">
							<div className="flex justify-between">
								<div className="h-3 w-28 bg-kumo-fill rounded" />
								<div className="h-2.5 w-12 bg-kumo-fill rounded" />
							</div>
							<div className="h-3 w-48 bg-kumo-fill rounded" />
							<div className="h-2.5 w-full bg-kumo-fill rounded" />
						</div>
					))}
				</div>
			) : emails.length === 0 ? (
				<div className="py-16 px-6 text-center text-kumo-subtle">
					<TrayIcon size={32} weight="thin" className="mx-auto mb-2 opacity-50" />
					<p className="text-xs font-medium text-kumo-default mb-1">No messages</p>
					<p className="text-[11px]">This folder is currently empty.</p>
				</div>
			) : (
				emails.map((email: Email) => {
					const isSelected = selectedEmailId === email.id;
					const isUnread = !email.read;
					const senderName = formatParticipants(email);
					const dateStr = formatListDate(email.date);
					const snippet = getSnippetText(email.snippet || email.body);
					const hasAttachment =
						hasFileAttachment(email) ||
						((email as any).attachmentsCount ?? 0) > 0 ||
						(email.attachments && email.attachments.length > 0);
					const attachmentCount =
						(email as any).attachmentsCount ?? email.attachments?.length ?? 0;
					const tags: string[] = (email as any).tags
						? (email as any).tags
						: (email as any).category
						? [(email as any).category]
						: [];

					return (
						<button
							key={email.id}
							type="button"
							onClick={() => selectThread(email.id, email.subject || "(no subject)")}
							className={`w-full text-left p-3 relative flex gap-2.5 transition-colors cursor-pointer border-b border-kumo-line ${
								isSelected
									? "bg-kumo-tint ring-1 ring-inset ring-kumo-line text-kumo-default"
									: "bg-kumo-base hover:bg-kumo-tint text-kumo-strong"
							}`}
						>
							{/* Active selection vertical bar */}
							{isSelected && (
								<span className="absolute left-0 top-0 bottom-0 w-0.5 bg-kumo-default rounded-r" />
							)}

							{/* Unread indicator dot (6x6) */}
							<div className="pt-1.5 shrink-0">
								<span
									className={`block w-1.5 h-1.5 rounded-full ${
										isUnread ? "bg-kumo-brand" : "bg-transparent"
									}`}
								/>
							</div>

							<div className="flex-1 min-w-0 space-y-1">
								{/* Line 1: Sender & Time */}
								<div className="flex items-center justify-between gap-2">
									<span
										className={`text-xs truncate ${
											isUnread ? "font-semibold text-kumo-default" : "font-medium text-kumo-strong"
										}`}
									>
										{senderName}
									</span>
									<span className="text-[10px] text-kumo-subtle font-mono shrink-0">
										{dateStr}
									</span>
								</div>

								{/* Line 2: Subject */}
								<div
									className={`text-xs truncate ${
										isUnread ? "font-medium text-kumo-default" : "text-kumo-strong"
									}`}
								>
									{email.subject || "(no subject)"}
								</div>

								{/* Line 3: Body snippet */}
								<div className="text-[11px] text-kumo-subtle line-clamp-1 truncate leading-relaxed">
									{snippet || "No preview text"}
								</div>

								{/* Line 4: Metadata chips */}
								{(tags.length > 0 || hasAttachment) && (
									<div className="flex items-center gap-1.5 pt-1 flex-wrap">
										{tags.map((t, idx) => (
											<span
												key={idx}
												className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-kumo-fill text-kumo-default font-medium mr-1"
											>
												{t.startsWith("#") ? t : `#${t}`}
											</span>
										))}
										{hasAttachment && (
											<span className="inline-flex items-center gap-1 text-[10px] text-kumo-subtle">
												<PaperclipIcon size={11} className="shrink-0" />
												<span>
													{attachmentCount > 1
														? `${attachmentCount} files`
														: attachmentCount === 1
														? "1 file"
														: "file"}
												</span>
											</span>
										)}
									</div>
								)}
							</div>
						</button>
					);
				})
			)}
		</ColumnPane>
	);
}
