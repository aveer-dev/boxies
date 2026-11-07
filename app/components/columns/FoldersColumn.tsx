// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import { Modal, ModalHeader } from "~/components/Modal";
import {
	ArchiveIcon,
	AlarmIcon,
	ClockCounterClockwiseIcon,
	FileIcon,
	MegaphoneIcon,
	NewspaperIcon,
	PaperPlaneTiltIcon,
	PlusIcon,
	ProhibitIcon,
	ShieldCheckIcon,
	TrashIcon,
	TrayIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router";
import { useMailboxId, useMailboxRef } from "~/hooks/useCurrentMailbox";
import {
	FOLDER_DISPLAY_NAMES,
	Folders,
	SYSTEM_FOLDER_IDS,
} from "shared/folders";
import { folderPath, mailboxPath, tagPath } from "~/hooks/useMailNavigation";
import { isScreenerEnabled } from "~/lib/mailbox-settings";
import { slidingMarkClass, useSlidingHighlight } from "~/hooks/useSlidingHighlight";
import { mailboxDisplayName } from "~/lib/mailbox-display";
import { orderTagIds } from "shared/tag-url";
import { useCreateFolder, useFolders, useWorkflowPiles } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import { IconButton } from "~/components/IconButton";
import ColumnPane from "./ColumnPane";

const FOLDER_ICONS: Record<string, ReactNode> = {
	[Folders.INBOX]: <TrayIcon size={16} />,
	[Folders.SCREENER]: <ShieldCheckIcon size={16} />,
	[Folders.PROMOTIONS]: <MegaphoneIcon size={16} />,
	[Folders.UPDATES]: <NewspaperIcon size={16} />,
	[Folders.SENT]: <PaperPlaneTiltIcon size={16} />,
	[Folders.DRAFT]: <FileIcon size={16} />,
	[Folders.ARCHIVE]: <ArchiveIcon size={16} />,
	[Folders.SPAM]: <WarningIcon size={16} />,
	[Folders.SCREENED_OUT]: <ProhibitIcon size={16} />,
	[Folders.TRASH]: <TrashIcon size={16} />,
};

function formatCount(count: number) {
	return count > 999 ? `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(count);
}

function FolderRow({
	to,
	icon,
	label,
	count,
	muted = false,
	attention,
}: {
	to: string;
	icon: ReactNode;
	label: string;
	count?: number;
	muted?: boolean;
	/** Reply Later reminders due (AVE-86): attention colour, a soft breathing glow and a "N due" pill. */
	attention?: number;
}) {
	const due = attention != null && attention > 0;
	return (
		<NavLink
			to={to}
			aria-description={due ? `${attention} due` : undefined}
			className={({ isActive }) =>
				`group/folder relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-150 ${
					due
						? "reply-later-due text-[var(--attention)] hover:text-[var(--attention)]"
						: isActive
							? "text-kumo-default"
							: `${muted ? "text-kumo-subtle" : "text-kumo-strong"} hover:bg-kumo-tint hover:text-kumo-default`
				}`
			}
		>
			<span
				className={`shrink-0 w-4 flex justify-center transition-colors ${
					due
						? "text-[var(--attention)]"
						: "text-kumo-subtle group-hover/folder:text-kumo-default group-aria-[current=page]/folder:text-kumo-default"
				}`}
			>
				{icon}
			</span>
			<span className="truncate flex-1">{label}</span>
			{due && (
				<span
					key={`due-${attention}`}
					className="shrink-0 rounded-full bg-[var(--attention-soft)] px-1.5 text-2xs font-semibold leading-[16px] text-[var(--attention)] tabular-nums animate-reveal"
				>
					{formatCount(attention)} due
				</span>
			)}
			{count != null && count > 0 && (
				<span key={count} className="shrink-0 text-xs text-kumo-subtle tabular-nums animate-reveal">
					{formatCount(count)}
				</span>
			)}
		</NavLink>
	);
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
	return (
		<div className="flex items-center justify-between px-2.5 pt-6 pb-2">
			<span className="text-2xs font-medium uppercase tracking-wider text-kumo-subtle truncate">
				{children}
			</span>
			{action}
		</div>
	);
}

/** Column 2 — the open mailbox's folders, workflow piles and tags. */
export default function FoldersColumn() {
	const mailboxId = useMailboxId();
	const mailboxRef = useMailboxRef();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: workflowPiles = [] } = useWorkflowPiles(mailboxId);
	const createFolder = useCreateFolder();
	const toastManager = useKumoToastManager();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newTagName, setNewTagName] = useState("");
	const { pathname } = useLocation();
	const { railRef, markRef } = useSlidingHighlight<HTMLDivElement>(pathname);

	const unreadById = useMemo(
		() => Object.fromEntries(folders.map((f) => [f.id, f.unreadCount])),
		[folders],
	);
	// Custom folders render as tags (a message carries one: the folder it's in).
	// Each links by its index, never its name (AVE-126, shared/tag-url.ts).
	const tags = useMemo(() => {
		const refs = new Map(orderTagIds(folders.map((f) => f.id)).map((id, i) => [id, String(i)]));
		return folders.flatMap((f) => {
			const ref = refs.get(f.id);
			return ref === undefined ? [] : [{ ...f, ref }];
		});
	}, [folders]);
	// Screener off (AVE-104): hide its row unless something is still unread there.
	const screenerOn = isScreenerEnabled(mailbox?.settings);
	const visibleSystemFolders = useMemo(
		() =>
			SYSTEM_FOLDER_IDS.filter(
				(id) => id !== Folders.SCREENER || screenerOn || Boolean(unreadById[id]),
			),
		[screenerOn, unreadById],
	);
	const replyLaterPile = workflowPiles.find((p) => p.id === "reply_later");
	const replyLaterCount = replyLaterPile?.count ?? 0;
	const replyLaterDue = replyLaterPile?.due_count ?? 0;

	const displayName = mailboxDisplayName(mailbox, mailboxId);

	const handleCreateTag = (e: React.FormEvent) => {
		e.preventDefault();
		const name = newTagName.trim().replace(/^#/, "");
		if (!name || !mailboxId) return;
		createFolder.mutate(
			{ mailboxId, name },
			{
				onSuccess: () => {
					setNewTagName("");
					setIsCreateOpen(false);
				},
				// Keep the dialog open with the name so the user can fix it.
				onError: (err) =>
					toastManager.add({
						title: err instanceof Error ? err.message : "Failed to create tag",
						variant: "error",
					}),
			},
		);
	};

	return (
		<ColumnPane id="folders" title={displayName} bodyClassName="px-2 pt-1.5">
			<div ref={railRef} className="relative">
				<span ref={markRef} aria-hidden className={slidingMarkClass} />
				<nav aria-label="Folders" className="space-y-0.5">
					{visibleSystemFolders.map((id) => (
						<FolderRow
							key={id}
							to={folderPath(mailboxRef, id)}
							icon={FOLDER_ICONS[id]}
							label={FOLDER_DISPLAY_NAMES[id] ?? id}
							count={unreadById[id]}
						/>
					))}
				</nav>

				<SectionLabel>Workflow</SectionLabel>
				<FolderRow
					to={`${mailboxPath(mailboxRef)}/reply-later`}
					icon={
						replyLaterDue > 0 ? <AlarmIcon size={16} weight="fill" /> : <ClockCounterClockwiseIcon size={16} />
					}
					label="Reply Later"
					count={replyLaterCount}
					attention={replyLaterDue}
				/>

				<SectionLabel
					action={
						mailbox?.readOnly ? undefined : (
							<IconButton
								label="Create tag"
								icon={PlusIcon}
								onClick={() => setIsCreateOpen(true)}
								className="-my-1.5 -mr-1"
							/>
						)
					}
				>
					{displayName} tags
				</SectionLabel>
				<nav aria-label="Tags" className="space-y-0.5">
					{tags.length === 0 ? (
						<p className="px-2.5 py-1 text-xs text-kumo-subtle">
							No tags yet. Tags are folders you create.
						</p>
					) : (
						tags.map((tag) => (
							<FolderRow
								key={tag.id}
								to={tagPath(mailboxRef, tag.ref)}
								icon={<span className="text-xs">#</span>}
								label={tag.name.replace(/^#/, "")}
								count={tag.unreadCount}
								muted={!tag.unreadCount}
							/>
						))
					)}
				</nav>
			</div>

			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Modal size="sm">
					<ModalHeader
						title="Create tag"
					/>
					<form onSubmit={handleCreateTag} className="space-y-4">
						<Input
							label="Tag name"
							placeholder="e.g. Engineering-PRs"
							value={newTagName}
							onChange={(e) => setNewTagName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button type="submit" variant="primary" disabled={!newTagName.trim()}>
								Create
							</Button>
						</div>
					</form>
				</Modal>
			</Dialog.Root>
		</ColumnPane>
	);
}
