// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Input, useKumoToastManager } from "@cloudflare/kumo";
import { PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useColumnStack } from "~/hooks/useColumnStack";
import { useCreateMailbox, useMailboxes } from "~/queries/mailboxes";
import ColumnPane from "./ColumnPane";

export default function AccountsColumn() {
	const { data: mailboxes = [], isLoading } = useMailboxes();
	const { selectedMailboxId, selectMailbox } = useColumnStack();
	const createMailboxMut = useCreateMailbox();
	const toastManager = useKumoToastManager();
	const navigate = useNavigate();

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newEmail, setNewEmail] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);

	const handleCreateMailbox = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newEmail.trim()) return;
		setIsCreating(true);
		try {
			const created = await createMailboxMut.mutateAsync({
				email: newEmail.trim(),
				name: newName.trim() || newEmail.split("@")[0] || "Mailbox",
			});
			toastManager.add({ title: "Mailbox created successfully!" });
			setIsCreateOpen(false);
			setNewEmail("");
			setNewName("");
			if (created && created.id) {
				selectMailbox(created.id, created.name);
				navigate(`/mailbox/${encodeURIComponent(created.id)}`, { replace: true });
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to create mailbox";
			toastManager.add({ title: msg, variant: "error" });
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<>
			<ColumnPane
				id="accounts"
				width={300}
				closable={false}
				title={
					<span className="text-[11px] font-semibold text-kumo-subtle uppercase tracking-[0.036em]">
						Inboxies
					</span>
				}
				actions={
					<button
						type="button"
						onClick={() => setIsCreateOpen(true)}
						className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
						title="Add Mailbox"
					>
						<PlusIcon size={12} weight="bold" />
						<span>Add</span>
					</button>
				}
				contentClassName="p-2 space-y-1"
			>
				{isLoading && mailboxes.length === 0 ? (
					<div className="p-4 space-y-3">
						{[1, 2, 3].map((i) => (
							<div key={i} className="animate-pulse flex items-center gap-3 p-2 rounded-lg">
								<div className="w-2 h-2 rounded-full bg-kumo-line" />
								<div className="space-y-1.5 flex-1">
									<div className="h-3 w-28 bg-kumo-fill rounded" />
									<div className="h-2.5 w-36 bg-kumo-fill rounded" />
								</div>
							</div>
						))}
					</div>
				) : mailboxes.length === 0 ? (
					<div className="p-6 text-center text-xs text-kumo-subtle">
						<p className="mb-3">No mailboxes connected.</p>
						<Button size="sm" onClick={() => setIsCreateOpen(true)}>
							Create Mailbox
						</Button>
					</div>
				) : (
					mailboxes.map((mailbox) => {
						const isSelected = selectedMailboxId === mailbox.id;
						const unreadCount = (mailbox as any).unreadCount ?? (mailbox as any).unread_count ?? (mailbox as any).unread;
						return (
							<button
								key={mailbox.id}
								type="button"
								onClick={() => {
									selectMailbox(mailbox.id, mailbox.name);
									navigate(`/mailbox/${encodeURIComponent(mailbox.id)}`, { replace: true });
								}}
								className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between gap-3 transition-colors ${
									isSelected
										? "bg-kumo-fill shadow-sm text-kumo-default"
										: "hover:bg-kumo-tint text-kumo-strong"
								}`}
							>
								<div className="flex items-center gap-3 min-w-0 flex-1">
									{/* Active indicator dot (6x6) */}
									<span
										className={`w-1.5 h-1.5 rounded-full shrink-0 ${
											isSelected ? "bg-kumo-default ring-2 ring-kumo-line" : "bg-kumo-line"
										}`}
									/>
									<div className="min-w-0 flex-1">
										<div className="text-[13px] font-medium text-kumo-default truncate leading-tight">
											{mailbox.name || mailbox.email.split("@")[0]}
										</div>
										<div className="text-[11px] text-kumo-subtle truncate mt-0.5">
											{mailbox.email}
										</div>
									</div>
								</div>
								{unreadCount != null && unreadCount > 0 && (
									<Badge
										variant="secondary"
										className="text-xs text-kumo-subtle shrink-0 font-mono"
									>
										{unreadCount > 999 ? "999+" : unreadCount}
									</Badge>
								)}
							</button>
						);
					})
				)}
			</ColumnPane>

			{/* Create Mailbox Dialog */}
			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Add Connected Mailbox
					</Dialog.Title>
					<form onSubmit={handleCreateMailbox} className="space-y-4 pt-2">
						<Input
							label="Email Address"
							type="email"
							placeholder="user@yourdomain.com"
							value={newEmail}
							onChange={(e) => setNewEmail(e.target.value)}
							required
						/>
						<Input
							label="Display Name (Optional)"
							placeholder="Personal / Work"
							value={newName}
							onChange={(e) => setNewName(e.target.value)}
						/>
						<div className="flex justify-end gap-2 pt-2">
							{/* @ts-ignore */}
							<Dialog.Close asChild>
								<Button variant="secondary" type="button">
									Cancel
								</Button>
							</Dialog.Close>
							<Button type="submit" loading={isCreating}>
								Create Mailbox
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
