// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
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
import { NavLink, useParams } from "react-router";
import {
	FOLDER_DISPLAY_NAMES,
	Folders,
	SYSTEM_FOLDER_IDS,
} from "shared/folders";
import { folderPath, mailboxPath } from "~/hooks/useMailNavigation";
import { mailboxDisplayName } from "~/lib/mailbox-display";
import { useCreateFolder, useFolders, useWorkflowPiles } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
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
}: {
	to: string;
	icon: ReactNode;
	label: string;
	count?: number;
	muted?: boolean;
}) {
	return (
		<NavLink
			to={to}
			className={({ isActive }) =>
				`flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-colors ${
					isActive
						? "bg-kumo-fill text-kumo-default"
						: `${muted ? "text-kumo-subtle" : "text-kumo-strong"} hover:bg-kumo-tint`
				}`
			}
		>
			<span className="shrink-0 w-4 flex justify-center text-kumo-subtle">{icon}</span>
			<span className="truncate flex-1">{label}</span>
			{count != null && count > 0 && (
				<span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
					{formatCount(count)}
				</span>
			)}
		</NavLink>
	);
}

function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
	return (
		<div className="flex items-center justify-between px-2 pt-5 pb-1.5">
			<span className="text-[10px] font-medium uppercase tracking-wider text-kumo-subtle truncate">
				{children}
			</span>
			{action}
		</div>
	);
}

/** Column 2 — the open mailbox's folders, workflow piles and tags. */
export default function FoldersColumn() {
	const { mailboxId = "" } = useParams<{ mailboxId: string }>();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: workflowPiles = [] } = useWorkflowPiles(mailboxId);
	const createFolder = useCreateFolder();
	const toastManager = useKumoToastManager();
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newTagName, setNewTagName] = useState("");

	const unreadById = useMemo(
		() => Object.fromEntries(folders.map((f) => [f.id, f.unreadCount])),
		[folders],
	);
	// Custom folders render as tags (a message carries one: the folder it's in).
	const tags = useMemo(
		() => folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
		[folders],
	);
	const replyLaterCount = workflowPiles.find((p) => p.id === "reply_later")?.count ?? 0;

	const displayName = mailboxDisplayName(mailbox, mailboxId);

	const handleCreateTag = (e: React.FormEvent) => {
		e.preventDefault();
		const name = newTagName.trim().replace(/^#/, "");
		if (!name || !mailboxId) return;
		createFolder.mutate(
			{ mailboxId, name },
			{
				onError: (err) =>
					toastManager.add({
						title: err instanceof Error ? err.message : "Failed to create tag",
						variant: "error",
					}),
			},
		);
		setNewTagName("");
		setIsCreateOpen(false);
	};

	return (
		<ColumnPane id="folders" title={displayName} bodyClassName="px-2 pt-1.5">
			<nav aria-label="Folders" className="space-y-px">
				{SYSTEM_FOLDER_IDS.map((id) => (
					<FolderRow
						key={id}
						to={folderPath(mailboxId, id)}
						icon={FOLDER_ICONS[id]}
						label={FOLDER_DISPLAY_NAMES[id] ?? id}
						count={unreadById[id]}
					/>
				))}
			</nav>

			<SectionLabel>Workflow</SectionLabel>
			<FolderRow
				to={`${mailboxPath(mailboxId)}/reply-later`}
				icon={<ClockCounterClockwiseIcon size={16} />}
				label="Reply Later"
				count={replyLaterCount}
			/>

			<SectionLabel
				action={
					<button
						type="button"
						onClick={() => setIsCreateOpen(true)}
						className="p-0.5 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
						aria-label="Create tag"
						title="Create tag"
					>
						<PlusIcon size={12} />
					</button>
				}
			>
				{displayName} tags
			</SectionLabel>
			<nav aria-label="Tags" className="space-y-px">
				{tags.length === 0 ? (
					<p className="px-2 py-1 text-xs text-kumo-subtle">
						No tags yet. Tags are folders you create.
					</p>
				) : (
					tags.map((tag) => (
						<FolderRow
							key={tag.id}
							to={folderPath(mailboxId, tag.id)}
							icon={<span className="text-xs">#</span>}
							label={tag.name.replace(/^#/, "")}
							count={tag.unreadCount}
							muted={!tag.unreadCount}
						/>
					))
				)}
			</nav>

			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">Create tag</Dialog.Title>
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
				</Dialog>
			</Dialog.Root>
		</ColumnPane>
	);
}
