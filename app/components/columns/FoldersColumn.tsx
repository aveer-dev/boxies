// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import { Modal, ModalHeader } from "~/components/Modal";
import {
	BookmarkSimpleIcon,
	ArchiveIcon,
	AlarmIcon,
	ClockCounterClockwiseIcon,
	FileIcon,
	FolderSimpleIcon,
	PencilSimpleIcon,
	MegaphoneIcon,
	NewspaperIcon,
	ReceiptIcon,
	PaperPlaneTiltIcon,
	PlusIcon,
	ProhibitIcon,
	ShieldCheckIcon,
	TagSimpleIcon,
	TrashIcon,
	TrayIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { type MouseEvent, type ReactNode, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useContextMenu } from "~/components/ContextMenu";
import { useTagEditor } from "~/components/TagDialogs";
import { useMailboxId, useMailboxRef } from "~/hooks/useCurrentMailbox";
import {
	FOLDER_DISPLAY_NAMES,
	Folders,
	SYSTEM_FOLDER_IDS,
} from "shared/folders";
import { folderPath, mailboxPath, taggedPath, tagPath } from "~/hooks/useMailNavigation";
import { isScreenerEnabled } from "~/lib/mailbox-settings";
import { slidingMarkClass, useSlidingHighlight } from "~/hooks/useSlidingHighlight";
import { mailboxDisplayName } from "~/lib/mailbox-display";
import { orderTagIds } from "shared/tag-url";
import { useCreateFolder, useFolders, useWorkflowPiles } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import { useTags } from "~/queries/tags";
import type { TagRef } from "shared/tags";
import { IconButton } from "~/components/IconButton";
import { folderUnread } from "~/types";
import ColumnPane from "./ColumnPane";

const FOLDER_ICONS: Record<string, ReactNode> = {
	[Folders.INBOX]: <TrayIcon size={16} />,
	[Folders.SCREENER]: <ShieldCheckIcon size={16} />,
	[Folders.PROMOTIONS]: <MegaphoneIcon size={16} />,
	[Folders.UPDATES]: <NewspaperIcon size={16} />,
	[Folders.PAPER_TRAIL]: <ReceiptIcon size={16} />,
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
	onContextMenu,
}: {
	to: string;
	icon: ReactNode;
	label: string;
	count?: number;
	muted?: boolean;
	/** Reply Later reminders due (AVE-86): attention colour, a soft breathing glow and a "N due" pill. */
	attention?: number;
	onContextMenu?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
	const due = attention != null && attention > 0;
	return (
		<NavLink
			to={to}
			aria-description={due ? `${attention} due` : undefined}
			onContextMenu={onContextMenu}
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

/**
 * Column 2 — the open mailbox's folders, workflow piles, the folders you
 * create (once shown as "tags": a message is in one) and tags (AVE-241: a
 * message can carry many).
 */
export default function FoldersColumn() {
	const mailboxId = useMailboxId();
	const mailboxRef = useMailboxRef();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: workflowPiles = [] } = useWorkflowPiles(mailboxId);
	const createFolder = useCreateFolder();
	const toastManager = useKumoToastManager();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const { data: labelTags = [] } = useTags(mailboxId);
	const navigate = useNavigate();
	const openMenu = useContextMenu((s) => s.open);
	const { pathname } = useLocation();
	const tagEditor = useTagEditor(mailboxId, {
		// Deleting the tag on screen leaves its (now empty) view.
		onDeleted: (tag) => {
			if (pathname.startsWith(taggedPath(mailboxRef, tag.id))) navigate(folderPath(mailboxRef, Folders.INBOX));
		},
	});
	const openTagMenu = (tag: TagRef) => (e: MouseEvent<HTMLAnchorElement>) => {
		if (mailbox?.readOnly) return;
		e.preventDefault();
		openMenu({
			x: e.clientX,
			y: e.clientY,
			label: `Actions for tag ${tag.name}`,
			returnFocus: e.currentTarget,
			entries: [
				{ type: "item", label: "Rename…", icon: PencilSimpleIcon, onSelect: () => tagEditor.startRename(tag) },
				{ type: "item", label: "Delete tag", icon: TrashIcon, danger: true, onSelect: () => tagEditor.startDelete(tag) },
			],
		});
	};
	const { railRef, markRef } = useSlidingHighlight<HTMLDivElement>(pathname);

	const unreadById = useMemo(
		() => Object.fromEntries(folders.map((f) => [f.id, folderUnread(f)])),
		[folders],
	);
	// Custom folders: each links by its index, never its name (AVE-126,
	// shared/tag-url.ts; the route is still `/tags/<index>` from when the web
	// app called them tags).
	const customFolders = useMemo(() => {
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
	const setAsideCount = workflowPiles.find((p) => p.id === "set_aside")?.count ?? 0;

	const displayName = mailboxDisplayName(mailbox, mailboxId);

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		const name = newFolderName.trim().replace(/^#/, "");
		if (!name || !mailboxId) return;
		createFolder.mutate(
			{ mailboxId, name },
			{
				onSuccess: () => {
					setNewFolderName("");
					setIsCreateOpen(false);
				},
				// Keep the dialog open with the name so the user can fix it.
				onError: (err) =>
					toastManager.add({
						title: err instanceof Error ? err.message : "Failed to create folder",
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
				<FolderRow
					to={`${mailboxPath(mailboxRef)}/set-aside`}
					icon={<BookmarkSimpleIcon size={16} />}
					label="Set Aside"
					count={setAsideCount}
				/>

				<SectionLabel
					action={
						mailbox?.readOnly ? undefined : (
							<IconButton
								label="Create folder"
								icon={PlusIcon}
								onClick={() => setIsCreateOpen(true)}
								className="-my-1.5 -mr-1"
							/>
						)
					}
				>
					Folders
				</SectionLabel>
				<nav aria-label="Your folders" className="space-y-0.5">
					{customFolders.length === 0 ? (
						<p className="px-2.5 py-1 text-xs text-kumo-subtle">
							No folders yet. A message lives in one folder.
						</p>
					) : (
						customFolders.map((folder) => (
							<FolderRow
								key={folder.id}
								to={tagPath(mailboxRef, folder.ref)}
								icon={<FolderSimpleIcon size={16} />}
								label={folder.name.replace(/^#/, "")}
								count={folderUnread(folder)}
								muted={!folderUnread(folder)}
							/>
						))
					)}
				</nav>

				<SectionLabel
					action={
						mailbox?.readOnly ? undefined : (
							<IconButton
								label="Create tag"
								icon={PlusIcon}
								onClick={tagEditor.startCreate}
								className="-my-1.5 -mr-1"
							/>
						)
					}
				>
					Tags
				</SectionLabel>
				<nav aria-label="Tags" className="space-y-0.5">
					{labelTags.length === 0 ? (
						<p className="px-2.5 py-1 text-xs text-kumo-subtle">
							No tags yet. A message can have several.
						</p>
					) : (
						labelTags.map((tag) => (
							<FolderRow
								key={tag.id}
								to={taggedPath(mailboxRef, tag.id)}
								icon={<TagSimpleIcon size={16} />}
								label={tag.name}
								count={tag.unreadCount}
								muted={!tag.unreadCount}
								onContextMenu={openTagMenu(tag)}
							/>
						))
					)}
				</nav>
			</div>
			{tagEditor.dialogs}

			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Modal size="sm">
					<ModalHeader
						title="Create folder"
					/>
					<form onSubmit={handleCreateFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Engineering-PRs"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
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
							<Button type="submit" variant="primary" disabled={!newFolderName.trim()}>
								Create
							</Button>
						</div>
					</form>
				</Modal>
			</Dialog.Root>
		</ColumnPane>
	);
}
