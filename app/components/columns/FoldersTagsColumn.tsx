// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ClockCounterClockwiseIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PlusIcon,
	StarIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useColumnStack } from "~/hooks/useColumnStack";
import { useCreateFolder, useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import ColumnPane from "./ColumnPane";

const CORE_SYSTEM_FOLDERS = [
	{ id: "inbox", label: "Inbox", icon: <TrayIcon size={16} weight="regular" /> },
	{ id: "priority", label: "Priority/VIP", icon: <StarIcon size={16} weight="regular" /> },
	{ id: "sent", label: "Sent", icon: <PaperPlaneTiltIcon size={16} weight="regular" /> },
	{ id: "drafts", label: "Drafts", icon: <FileIcon size={16} weight="regular" /> },
	{ id: "scheduled", label: "Scheduled", icon: <ClockCounterClockwiseIcon size={16} weight="regular" /> },
	{ id: "archive", label: "Archive", icon: <ArchiveIcon size={16} weight="regular" /> },
	{ id: "trash", label: "Trash", icon: <TrashIcon size={16} weight="regular" /> },
] as const;

const DEFAULT_HYPERION_TAGS = [
	{ id: "tag-engineering-prs", name: "Engineering-PRs" },
	{ id: "tag-design", name: "Design" },
	{ id: "tag-incidents", name: "Incidents" },
	{ id: "tag-customers", name: "Customers" },
	{ id: "tag-billing", name: "Billing" },
	{ id: "tag-personal", name: "Personal" },
];

interface FoldersTagsColumnProps {
	mailboxId?: string;
}

export default function FoldersTagsColumn({ mailboxId: propMailboxId }: FoldersTagsColumnProps) {
	const { selectedMailboxId, selectedFolderId, selectFolder } = useColumnStack();
	const mailboxId = propMailboxId || selectedMailboxId || undefined;

	const { data: currentMailbox } = useMailbox(mailboxId);
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMut = useCreateFolder();
	const toastManager = useKumoToastManager();

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	const folderCounts = useMemo(() => {
		const map: Record<string, number> = {};
		for (const f of folders) {
			map[f.id] = (f as any).unreadCount ?? (f as any).unread_count ?? (f as any).email_count ?? 0;
		}
		return map;
	}, [folders]);

	const customFolders = useMemo(() => {
		const coreIds = new Set([
			"inbox",
			"priority",
			"vip",
			"sent",
			"drafts",
			"draft",
			"scheduled",
			"reply_later",
			"archive",
			"trash",
			"screener",
			"promotions",
			"updates",
			"spam",
			"screened_out",
		]);
		return folders.filter((f) => !coreIds.has(f.id));
	}, [folders]);

	const allTags = useMemo(() => {
		const existingIds = new Set(customFolders.map((f) => f.id));
		const defaultsNotPresent = DEFAULT_HYPERION_TAGS.filter(
			(d) => !existingIds.has(d.id),
		);
		return [...customFolders, ...defaultsNotPresent];
	}, [customFolders]);

	const handleCreateFolder = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newFolderName.trim() || !mailboxId) return;
		setIsCreating(true);
		try {
			await createFolderMut.mutateAsync({
				mailboxId,
				name: newFolderName.trim(),
			});
			toastManager.add({ title: "Tag created successfully!" });
			setIsCreateOpen(false);
			setNewFolderName("");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to create tag";
			toastManager.add({ title: msg, variant: "error" });
		} finally {
			setIsCreating(false);
		}
	};

	const mailboxTitle = currentMailbox?.name || currentMailbox?.email?.split("@")[0] || "Folders & Tags";

	return (
		<>
			<ColumnPane
				id="folders"
				width={300}
				closable={false}
				title={
					<span className="text-[11px] font-semibold text-kumo-subtle uppercase tracking-[0.036em]">
						{mailboxTitle}
					</span>
				}
				contentClassName="p-2 space-y-4"
			>
				{/* Core System Folders */}
				<div className="space-y-0.5">
					{CORE_SYSTEM_FOLDERS.map((f) => {
						const isSelected =
							selectedFolderId === f.id ||
							(f.id === "drafts" && selectedFolderId === "draft") ||
							(f.id === "scheduled" && selectedFolderId === "reply_later");
						const count =
							folderCounts[f.id] ??
							(f.id === "drafts"
								? folderCounts["draft"]
								: f.id === "scheduled"
								? folderCounts["reply_later"]
								: 0) ??
							0;

						return (
							<button
								key={f.id}
								type="button"
								onClick={() => selectFolder(f.id, f.label)}
								className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer ${
									isSelected
										? "bg-kumo-fill text-kumo-default font-medium shadow-sm"
										: "text-kumo-strong hover:bg-kumo-tint"
								}`}
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<span className={`shrink-0 ${isSelected ? "text-kumo-default" : "text-kumo-subtle"}`}>
										{f.icon}
									</span>
									<span className="truncate">{f.label}</span>
								</div>
								{count > 0 && (
									<span
										className={`text-[11px] font-mono shrink-0 ${
											isSelected ? "text-kumo-default font-semibold" : "text-kumo-subtle"
										}`}
									>
										{count > 999 ? "999+" : count.toLocaleString()}
									</span>
								)}
							</button>
						);
					})}
				</div>

				{/* Custom Tags Section */}
				<div className="pt-2 border-t border-kumo-line">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-bold tracking-wider text-kumo-subtle uppercase px-4 pt-5 pb-2">
							HYPERION TAGS
						</span>
						<button
							type="button"
							onClick={() => setIsCreateOpen(true)}
							className="p-1 mr-2 mt-3 rounded text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors cursor-pointer"
							title="Add Tag"
						>
							<PlusIcon size={12} weight="bold" />
						</button>
					</div>

					<div className="space-y-0.5">
						{allTags.map((tag) => {
							const cleanName = tag.name.replace(/^#/, "");
							const fullLabel = `#${cleanName}`;
							const isSelected =
								selectedFolderId === tag.id ||
								selectedFolderId === fullLabel ||
								selectedFolderId === cleanName;
							const count = folderCounts[tag.id] ?? (tag as any).count ?? 0;

							return (
								<button
									key={tag.id}
									type="button"
									onClick={() => selectFolder(tag.id, fullLabel)}
									className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors cursor-pointer ${
										isSelected
											? "bg-kumo-fill text-kumo-default font-medium shadow-sm"
											: "text-kumo-strong hover:bg-kumo-tint"
									}`}
								>
									<div className="flex items-center gap-2 min-w-0">
										<span className="text-kumo-subtle font-mono text-[11px]">#</span>
										<span className="truncate">{cleanName}</span>
									</div>
									{count > 0 && (
										<span
											className={`text-[10px] font-mono shrink-0 px-1 rounded ${
												isSelected ? "text-kumo-default bg-kumo-fill" : "text-kumo-subtle"
											}`}
										>
											{count > 999 ? "999+" : count}
										</span>
									)}
								</button>
							);
						})}
					</div>
				</div>
			</ColumnPane>

			{/* Create Tag/Folder Dialog */}
			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Create New Tag
					</Dialog.Title>
					<form onSubmit={handleCreateFolder} className="space-y-4 pt-2">
						<Input
							label="Tag Name"
							placeholder="e.g. Engineering-PRs"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2 pt-2">
							{/* @ts-ignore */}
							<Dialog.Close asChild>
								<Button variant="secondary" type="button">
									Cancel
								</Button>
							</Dialog.Close>
							<Button type="submit" loading={isCreating}>
								Create Tag
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
