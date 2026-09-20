// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link as RouterLink, Navigate } from "react-router";
import api from "~/services/api";
import { queryKeys } from "~/queries/keys";

export function meta() {
	return [{ title: "Admin — Inboxies" }];
}

export default function AdminRoute() {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: me, isLoading: meLoading } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});
	const { data: config } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity,
	});
	const {
		data: rows = [],
		isLoading,
		refetch,
	} = useQuery({
		queryKey: ["admin-mailboxes"],
		queryFn: () => api.listAdminMailboxes(),
		enabled: Boolean(me?.isAdmin),
	});

	const domains = config?.domains ?? [];
	const mailDomain = config?.mailDomain ?? domains[0] ?? "";
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [prefix, setPrefix] = useState("");
	const [domain, setDomain] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [assignMode, setAssignMode] = useState<"self" | "invite">("self");
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteName, setInviteName] = useState("");
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [assignTarget, setAssignTarget] = useState<string | null>(null);

	useEffect(() => {
		if (!domain) {
			const preferred = mailDomain || domains[0];
			if (preferred) setDomain(preferred);
		}
	}, [domains, mailDomain, domain]);

	if (meLoading) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}
	if (!me?.isAdmin) {
		return <Navigate to="/" replace />;
	}

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		setLastInviteUrl(null);
		if (!prefix || !domain) {
			setCreateError("Enter a local part and domain");
			return;
		}
		if (assignMode === "invite" && !inviteEmail.trim()) {
			setCreateError("Enter an invite email");
			return;
		}
		const email = `${prefix}@${domain}`;
		setCreating(true);
		try {
			const result = await api.createAdminMailbox({
				email,
				name: displayName || prefix,
				assignTo:
					assignMode === "self"
						? "self"
						: {
								inviteEmail: inviteEmail.trim(),
								inviteeName: inviteName.trim() || undefined,
								role: "owner",
							},
			});
			if (result.invite?.inviteUrl) {
				setLastInviteUrl(result.invite.inviteUrl);
				toastManager.add({
					title: result.invite.emailSent
						? "Mailbox created — invite emailed"
						: "Mailbox created — copy invite link",
				});
			} else {
				toastManager.add({ title: "Mailbox created and assigned to you" });
				setIsCreateOpen(false);
			}
			setPrefix("");
			setDisplayName("");
			setInviteEmail("");
			setInviteName("");
			await refetch();
			await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes });
		} catch (err: unknown) {
			setCreateError(
				err instanceof Error ? err.message : "Failed to create mailbox",
			);
		} finally {
			setCreating(false);
		}
	};

	const handleAssignSelf = async (mailboxId: string) => {
		setAssignTarget(mailboxId);
		try {
			await api.assignAdminMailbox(mailboxId, "self");
			toastManager.add({ title: "Assigned to you" });
			await refetch();
			await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes });
		} catch (err: unknown) {
			toastManager.add({
				title: err instanceof Error ? err.message : "Assign failed",
				variant: "error",
			});
		} finally {
			setAssignTarget(null);
		}
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		setDeleting(true);
		try {
			await api.deleteAdminMailbox(deleteTarget.id);
			toastManager.add({ title: "Mailbox deleted" });
			setDeleteTarget(null);
			await refetch();
			await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes });
		} catch {
			toastManager.add({ title: "Delete failed", variant: "error" });
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
				<div className="mb-8 flex items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-bold text-kumo-default">Admin</h1>
						<p className="text-sm text-kumo-subtle mt-1">
							Domain mailboxes for {domains.join(", ") || "this deployment"}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<RouterLink
							to="/"
							className="text-sm text-kumo-subtle hover:text-kumo-default no-underline"
						>
							My mailboxes
						</RouterLink>
						<Button
							variant="primary"
							icon={<PlusIcon size={16} />}
							onClick={() => setIsCreateOpen(true)}
						>
							Create email
						</Button>
					</div>
				</div>

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : rows.length === 0 ? (
					<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6 text-center">
						<p className="text-sm text-kumo-subtle mb-4">
							No mailboxes on this domain yet.
						</p>
						<Button variant="primary" onClick={() => setIsCreateOpen(true)}>
							Create the first email
						</Button>
					</div>
				) : (
					<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
						<div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-5 py-3 text-xs font-medium text-kumo-subtle border-b border-kumo-line">
							<span>Address</span>
							<span>Owners</span>
							<span className="text-right">Actions</span>
						</div>
						{rows.map((row, idx) => (
							<div
								key={row.id}
								className={`grid grid-cols-[1fr_1fr_auto] gap-2 items-center px-5 py-4 ${
									idx > 0 ? "border-t border-kumo-line" : ""
								}`}
							>
								<div className="min-w-0">
									<div className="text-sm font-medium text-kumo-default truncate">
										{row.email}
									</div>
									<div className="text-xs text-kumo-subtle">
										{row.claimed ? "Claimed" : "Unclaimed"} · {row.name}
									</div>
								</div>
								<div className="text-xs text-kumo-subtle truncate">
									{(row.acl.owners ?? [])
										.map((k) =>
											k.startsWith("email:") ? k.slice(6) : k,
										)
										.join(", ") || "—"}
								</div>
								<div className="flex items-center gap-1 justify-end">
									<Button
										variant="secondary"
										size="sm"
										loading={assignTarget === row.id}
										onClick={() => handleAssignSelf(row.id)}
									>
										Assign to me
									</Button>
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										icon={<TrashIcon size={16} />}
										aria-label={`Delete ${row.email}`}
										onClick={() =>
											setDeleteTarget({ id: row.id, email: row.email })
										}
									/>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-5">
						Create email
					</Dialog.Title>
					<form onSubmit={handleCreate} className="space-y-4">
						{createError && (
							<Text variant="error" size="sm">
								{createError}
							</Text>
						)}
						{lastInviteUrl && (
							<div className="rounded-lg border border-kumo-line bg-kumo-tint p-3 space-y-2">
								<p className="text-xs text-kumo-subtle">Invite link</p>
								<code className="text-xs break-all text-kumo-default block">
									{lastInviteUrl}
								</code>
								<Button
									type="button"
									variant="secondary"
									size="sm"
									onClick={() => {
										void navigator.clipboard.writeText(lastInviteUrl);
										toastManager.add({ title: "Invite link copied" });
									}}
								>
									Copy link
								</Button>
							</div>
						)}
						<div>
							<span className="text-sm font-medium text-kumo-default mb-1.5 block">
								Address
							</span>
							<div className="flex items-center gap-2">
								<div className="flex-1">
									<Input
										aria-label="Local part"
										placeholder="alex"
										size="sm"
										value={prefix}
										onChange={(e) => setPrefix(e.target.value)}
										required
									/>
								</div>
								<span className="text-sm text-kumo-subtle">@</span>
								{domains.length > 1 ? (
									<div className="flex-1">
										<Select
											aria-label="Domain"
											value={domain}
											onValueChange={(value) => {
												if (value) setDomain(value);
											}}
										>
											{domains.map((d) => (
												<Select.Option key={d} value={d}>
													{d}
												</Select.Option>
											))}
										</Select>
									</div>
								) : (
									<span className="text-sm text-kumo-subtle">
										{domain || "—"}
									</span>
								)}
							</div>
						</div>
						<Input
							label="Display name (optional)"
							size="sm"
							value={displayName}
							onChange={(e) => setDisplayName(e.target.value)}
						/>
						<div className="space-y-2">
							<span className="text-sm font-medium text-kumo-default block">
								Assign to
							</span>
							<label className="flex items-center gap-2 text-sm text-kumo-default">
								<input
									type="radio"
									checked={assignMode === "self"}
									onChange={() => setAssignMode("self")}
								/>
								Me
							</label>
							<label className="flex items-center gap-2 text-sm text-kumo-default">
								<input
									type="radio"
									checked={assignMode === "invite"}
									onChange={() => setAssignMode("invite")}
								/>
								Invite someone
							</label>
						</div>
						{assignMode === "invite" && (
							<>
								<Input
									label="Invitee email"
									size="sm"
									type="email"
									value={inviteEmail}
									onChange={(e) => setInviteEmail(e.target.value)}
									placeholder="person@gmail.com"
									required
								/>
								<Input
									label="Invitee name (optional)"
									size="sm"
									value={inviteName}
									onChange={(e) => setInviteName(e.target.value)}
								/>
							</>
						)}
						<div className="flex justify-end gap-2 pt-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary" size="sm">
										{lastInviteUrl ? "Done" : "Cancel"}
									</Button>
								)}
							/>
							{!lastInviteUrl && (
								<Button
									type="submit"
									variant="primary"
									size="sm"
									loading={creating}
									disabled={!domain}
								>
									Create
								</Button>
							)}
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Delete mailbox
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Delete {deleteTarget?.email}? This cannot be undone.
					</Dialog.Description>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm">
									Cancel
								</Button>
							)}
						/>
						<Button
							variant="destructive"
							size="sm"
							loading={deleting}
							onClick={handleDelete}
						>
							Delete
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
