// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Empty,
	Input,
	Loader,
	Select,
	Text,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { EnvelopeIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import api from "~/services/api";
import { OnboardingFlow } from "~/components/OnboardingFlow";
import {
	useCreateMailbox,
	useDeleteMailbox,
	useMailboxes,
} from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";

export function meta() {
	return [{ title: "Agentic Inbox" }];
}

export default function HomeRoute() {
	const toastManager = useKumoToastManager();
	const { data: mailboxes = [], refetch: refetchMailboxes, isFetched: mailboxesFetched } = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();

	const { data: configData } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity, // config rarely changes
	});

	const { data: me } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});
	const isAdmin = Boolean(me?.isAdmin);
	const navigate = useNavigate();

	const { data: adminDomainsData } = useQuery({
		queryKey: ["admin-domains"],
		queryFn: () => api.listAdminDomains(),
		enabled: isAdmin,
		staleTime: 60_000,
	});
	const pendingDomain = adminDomainsData?.domains?.find(
		(d) => d.status === "pending" || d.status === "pending_nameservers",
	);

	const handleOnboardingSuccess = async (mailboxId: string) => {
		await refetchMailboxes();
		navigate(`/mailbox/${encodeURIComponent(mailboxId)}`);
	};

	const { data: adminMailboxes = [] } = useQuery({
		queryKey: ["admin-mailboxes"],
		queryFn: () => api.listAdminMailboxes(),
		enabled: isAdmin && mailboxesFetched && mailboxes.length === 0,
	});

	const domains = configData?.domains ?? [];
	const mailDomain = configData?.mailDomain ?? domains[0] ?? "";
	const emailAddresses = configData?.emailAddresses ?? [];

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [isDeleteOpen, setIsDeleteOpen] = useState(false);
	const [mailboxToDelete, setMailboxToDelete] = useState<{
		id: string;
		email: string;
	} | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	// Set default domain when config loads
	useEffect(() => {
		if (!selectedDomain) {
			const preferred = mailDomain || domains[0];
			if (preferred) setSelectedDomain(preferred);
		}
	}, [domains, mailDomain, selectedDomain]);

	// Auto-create mailboxes from config (run once when both data sources are ready)
	const autoCreateDone = useRef(false);
	useEffect(() => {
		if (autoCreateDone.current) return;
		if (emailAddresses.length === 0 || !mailboxesFetched) return;
		const existingEmails = new Set(
			mailboxes.map((m) => m.email.toLowerCase()),
		);
		const toCreate = emailAddresses.filter(
			(addr) => !existingEmails.has(addr.toLowerCase()),
		);
		if (toCreate.length === 0) {
			autoCreateDone.current = true;
			return;
		}
		autoCreateDone.current = true;
		let cancelled = false;
		Promise.all(
			toCreate.map((addr) => {
				const localPart = addr.split("@")[0] || addr;
				return api.createMailbox(addr, localPart).catch(() => {});
			}),
		).then(() => { if (!cancelled) refetchMailboxes(); });
		return () => { cancelled = true; };
	}, [emailAddresses, mailboxes, refetchMailboxes]);

	const handleCreate = async (e: FormEvent) => {
		e.preventDefault();
		setCreateError(null);
		if (!newPrefix || !selectedDomain) {
			setCreateError("Please fill in all fields");
			return;
		}
		const email = `${newPrefix}@${selectedDomain}`;
		const name = newName || newPrefix;
		setIsCreating(true);
		try {
			await createMailbox.mutateAsync({ email, name });
			toastManager.add({ title: "Mailbox created successfully!" });
			setIsCreateOpen(false);
			setNewPrefix("");
			setNewName("");
		} catch (err: unknown) {
			const message = (err instanceof Error ? err.message : null) || "Failed to create mailbox";
			setCreateError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		setIsDeleting(true);
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "Mailbox deleted" });
			setIsDeleteOpen(false);
			setMailboxToDelete(null);
		} catch {
			toastManager.add({ title: "Failed to delete mailbox", variant: "error" });
		} finally {
			setIsDeleting(false);
		}
	};

	const isConfigured = emailAddresses.length > 0;
	const accounts = mailboxes;

	const isLoading = !configData;

	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8">
					<div className="flex items-center justify-between">
						<h1 className="text-2xl font-bold text-kumo-default">Mailboxes</h1>
						<div className="flex items-center gap-2">
							{isAdmin && (
								<RouterLink to="/admin" className="no-underline">
									<Button variant="secondary">Admin</Button>
								</RouterLink>
							)}
							{!isConfigured && !isAdmin && (
								<Button
									variant="primary"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateOpen(true)}
								>
									New Mailbox
								</Button>
							)}
							<Button
								variant="secondary"
								onClick={() => {
									window.location.href = "/cdn-cgi/access/logout";
								}}
							>
								Log out
							</Button>
						</div>
					</div>
					{domains.length > 0 && (
						<p className="text-sm text-kumo-subtle mt-1">
							{domains.join(", ")}
						</p>
					)}
				</div>

				{pendingDomain && (
					<div className="mb-6 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
						<div className="flex items-center gap-3">
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
								<GlobeIcon size={20} />
							</div>
							<div>
								<p className="text-sm font-semibold text-kumo-default">
									Domain Setup in Progress: {pendingDomain.domain}
								</p>
								<p className="text-xs text-kumo-subtle">
									Cloudflare is awaiting nameserver propagation. Inbound email will begin routing once active.
								</p>
							</div>
						</div>
						<RouterLink
							to={`/admin?tab=dns&domain=${encodeURIComponent(pendingDomain.domain)}`}
							className="no-underline shrink-0"
						>
							<Button variant="secondary" size="sm">
								View DNS Settings →
							</Button>
						</RouterLink>
					</div>
				)}

				{isLoading ? (
					<div className="flex justify-center py-20">
						<Loader size="lg" />
					</div>
				) : accounts.length > 0 ? (
					<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
						{accounts.map((account, idx) => (
							<RouterLink
								key={account.id}
								to={`/mailbox/${account.id}`}
								className={`group flex items-center gap-4 px-5 py-4 no-underline transition-colors hover:bg-kumo-tint ${
									idx > 0 ? "border-t border-kumo-line" : ""
								}`}
							>
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-sm font-bold text-kumo-default">
									{account.name.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0 flex-1">
									<div className="text-sm font-medium text-kumo-default truncate">
										{account.name}
									</div>
									<div className="text-sm text-kumo-subtle">
										{account.email}
									</div>
								</div>
								{!isConfigured && (
									<Button
										variant="ghost"
										size="sm"
										shape="square"
										icon={<TrashIcon size={16} />}
										aria-label={`Delete mailbox ${account.email}`}
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											setMailboxToDelete({
												id: account.id,
												email: account.email,
											});
											setIsDeleteOpen(true);
										}}
									/>
								)}
							</RouterLink>
						))}
					</div>
				) : (
					<div className="rounded-xl border border-kumo-line bg-kumo-base py-16 px-6">
						<div className="flex flex-col items-center text-center">
							<div className="mb-4">
								<EnvelopeIcon
									size={48}
									weight="thin"
									className="text-kumo-subtle"
								/>
							</div>
							{isAdmin && adminMailboxes.length > 0 ? (
								<>
									<h3 className="text-base font-semibold text-kumo-default mb-1.5">
										Manage domain mailboxes
									</h3>
									<p className="text-sm text-kumo-subtle max-w-sm mb-5">
										{adminMailboxes.length} mailbox
										{adminMailboxes.length === 1 ? "" : "es"} exist on this
										domain. Open Admin to assign one to yourself or invite
										someone.
									</p>
									<RouterLink to="/admin" className="no-underline">
										<Button variant="primary">Open Admin</Button>
									</RouterLink>
								</>
							) : (
								<>
									<h3 className="text-base font-semibold text-kumo-default mb-1.5">
										No mailboxes yet
									</h3>
									<p className="text-sm text-kumo-subtle max-w-sm mb-5">
										{isAdmin
											? "Create the first address for this domain from Admin."
											: isConfigured
												? "No mailboxes you can access yet. Configured addresses are created on first visit if they do not already exist. An owner must share existing mailboxes with your Access email."
												: "Create a mailbox to start sending and receiving emails with your domain."}
									</p>
									{isAdmin ? (
										<RouterLink to="/admin" className="no-underline">
											<Button variant="primary" icon={<PlusIcon size={16} />}>
												Open Admin
											</Button>
										</RouterLink>
									) : (
										!isConfigured && (
											<Button
												variant="primary"
												icon={<PlusIcon size={16} />}
												onClick={() => setIsCreateOpen(true)}
											>
												Create Mailbox
											</Button>
										)
									)}
								</>
							)}
						</div>
					</div>
				)}
			</div>

			{/* HEY-Style Onboarding Flow */}
			<OnboardingFlow
				isOpen={isCreateOpen}
				onClose={() => setIsCreateOpen(false)}
				mailDomain={mailDomain}
				onSuccess={handleOnboardingSuccess}
			/>

			{/* Delete Dialog */}
			<Dialog.Root
				open={isDeleteOpen}
				onOpenChange={(open) => {
					setIsDeleteOpen(open);
					if (!open) setMailboxToDelete(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Delete Mailbox
					</Dialog.Title>
					<Dialog.Description className="text-kumo-subtle text-sm mb-5">
						Are you sure you want to delete{" "}
						<strong className="text-kumo-default">
							{mailboxToDelete?.email}
						</strong>
						? This action cannot be undone.
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
							loading={isDeleting}
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
