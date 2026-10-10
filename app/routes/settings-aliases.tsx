// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Badge,
	Button,
	Input,
	Loader,
	Switch,
	useKumoToastManager,
} from "@cloudflare/kumo";
import {
	CopyIcon,
	CheckIcon,
	ShieldCheckIcon,
	TrashIcon,
	PlusIcon,
	MagnifyingGlassIcon,
	ClockIcon,
	BrowsersIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import PrivateEmailLogo from "~/components/PrivateEmailLogo";
import SettingsSubpage from "~/components/SettingsSubpage";
import {
	useAliases,
	useCreateAlias,
	useUpdateAlias,
	useDeleteAlias,
} from "~/queries/aliases";
import { useMailbox } from "~/queries/mailboxes";
import type { MaskedAlias } from "~/types";

export default function AliasesSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: aliases = [], isLoading } = useAliases(mailboxId);
	const createMutation = useCreateAlias();
	const updateMutation = useUpdateAlias();
	const deleteMutation = useDeleteAlias();

	const [searchQuery, setSearchQuery] = useState("");
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [newLabel, setNewLabel] = useState("");
	const [newExpiry, setNewExpiry] = useState<"never" | "24h" | "7d" | "30d">("never");
	const [newPausedAction, setNewPausedAction] = useState<"drop" | "reject">("drop");
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const handleCopy = async (alias: MaskedAlias) => {
		try {
			await navigator.clipboard.writeText(alias.alias_email);
			setCopiedId(alias.id);
			toastManager.add({ title: "Alias copied to clipboard" });
			setTimeout(() => {
				setCopiedId((curr) => (curr === alias.id ? null : curr));
			}, 2000);
		} catch {
			toastManager.add({ title: "Failed to copy", variant: "error" });
		}
	};

	const handleCreate = async () => {
		if (!mailboxId) return;

		let expiresAt: string | null = null;
		const now = Date.now();
		if (newExpiry === "24h") {
			expiresAt = new Date(now + 24 * 3600 * 1000).toISOString();
		} else if (newExpiry === "7d") {
			expiresAt = new Date(now + 7 * 24 * 3600 * 1000).toISOString();
		} else if (newExpiry === "30d") {
			expiresAt = new Date(now + 30 * 24 * 3600 * 1000).toISOString();
		}

		try {
			const res = await createMutation.mutateAsync({
				mailboxId,
				label: newLabel.trim() || undefined,
				expiresAt,
				pausedAction: newPausedAction,
			});
			toastManager.add({
				title: "Private email created!",
				description: res.alias.alias_email,
			});
			setShowCreateModal(false);
			setNewLabel("");
			setNewExpiry("never");
		} catch (err: any) {
			toastManager.add({
				title: "Failed to create private email",
				description: err?.message || "Error generating private email",
				variant: "error",
			});
		}
	};

	const handleToggleActive = async (alias: MaskedAlias) => {
		if (!mailboxId) return;
		const nextState = !alias.is_active;
		try {
			await updateMutation.mutateAsync({
				mailboxId,
				aliasId: alias.id,
				isActive: nextState,
			});
			toastManager.add({
				title: nextState ? "Alias activated" : "Alias paused",
			});
		} catch {
			toastManager.add({ title: "Failed to update alias", variant: "error" });
		}
	};

	const handleDelete = async (alias: MaskedAlias) => {
		if (!mailboxId) return;
		if (!confirm(`Delete ${alias.alias_email}? Any future emails sent to it will be discarded.`)) {
			return;
		}
		try {
			await deleteMutation.mutateAsync({
				mailboxId,
				aliasId: alias.id,
			});
			toastManager.add({ title: "Alias deleted" });
		} catch {
			toastManager.add({ title: "Failed to delete alias", variant: "error" });
		}
	};

	const filteredAliases = aliases.filter((a) => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return true;
		return (
			a.alias_email.toLowerCase().includes(q) ||
			(a.label && a.label.toLowerCase().includes(q))
		);
	});

	const totalReceived = aliases.reduce((acc, a) => acc + (a.stats_received || 0), 0);
	const totalBlocked = aliases.reduce((acc, a) => acc + (a.stats_blocked || 0), 0);
	const activeCount = aliases.filter((a) => a.is_active).length;

	if (!mailboxId || isLoading) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Private email">
			<div className="space-y-6">
				{/* Top overview banner */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-1">
							<div className="flex items-center gap-2">
								<PrivateEmailLogo size={22} className="text-kumo-default shrink-0" />
								<h2 className="text-sm font-semibold text-kumo-default">
									Private email
								</h2>
							</div>
							<p className="text-xs text-kumo-subtle leading-relaxed">
								Private emails are randomly generated addresses on your dedicated{" "}
								<code className="text-sky-400 font-mono">private.&lt;domain&gt;</code> subdomain.
								Inbound emails land directly in this inbox, and outbound replies automatically preserve
								your alias address.
							</p>
						</div>
						<Button
							variant="primary"
							size="sm"
							onClick={() => setShowCreateModal(true)}
						>
							<span className="flex items-center gap-1.5">
								<PlusIcon size={14} />
								Generate Alias
							</span>
						</Button>
					</div>

					{/* Stats metrics */}
					<div className="grid grid-cols-3 gap-3 pt-2 border-t border-kumo-line">
						<div className="rounded-md bg-kumo-tint p-3">
							<div className="text-xs text-kumo-subtle font-medium">Active Aliases</div>
							<div className="text-lg font-semibold text-kumo-default">{activeCount}</div>
						</div>
						<div className="rounded-md bg-kumo-tint p-3">
							<div className="text-xs text-kumo-subtle font-medium">Delivered Emails</div>
							<div className="text-lg font-semibold text-kumo-default">{totalReceived}</div>
						</div>
						<div className="rounded-md bg-kumo-tint p-3">
							<div className="text-xs text-kumo-subtle font-medium">Blocked Spam</div>
							<div className="text-lg font-semibold text-rose-400">{totalBlocked}</div>
						</div>
					</div>
				</div>

				{/* Create Modal / Expansion */}
				{showCreateModal && (
					<div className="rounded-lg border border-sky-500/30 bg-sky-950/20 p-5 space-y-4">
						<h3 className="text-sm font-semibold text-kumo-default">
							Generate New Private Email
						</h3>
						<div className="space-y-3">
							<Input
								label="Service / Website Label (Optional)"
								placeholder="e.g. Airbnb, Nike, Newsletter"
								value={newLabel}
								onChange={(e) => setNewLabel(e.target.value)}
							/>
							<div className="space-y-1">
								<label className="text-xs font-medium text-kumo-subtle">
									Auto-Expiration Window
								</label>
								<div className="flex gap-2">
									{(
										[
											{ key: "never", label: "Permanent" },
											{ key: "24h", label: "24 Hours" },
											{ key: "7d", label: "7 Days" },
											{ key: "30d", label: "30 Days" },
										] as const
									).map((opt) => (
										<button
											key={opt.key}
											type="button"
											onClick={() => setNewExpiry(opt.key)}
											className={`px-3 py-1.5 text-xs rounded-md border transition-all ${
												newExpiry === opt.key
													? "bg-sky-500/20 border-sky-400 text-sky-300 font-medium"
													: "bg-kumo-tint border-kumo-line text-kumo-subtle hover:text-kumo-default"
											}`}
										>
											{opt.label}
										</button>
									))}
								</div>
							</div>
							<div className="space-y-1">
								<label className="text-xs font-medium text-kumo-subtle">
									When Paused or Expired
								</label>
								<div className="flex gap-2">
									<button
										type="button"
										onClick={() => setNewPausedAction("drop")}
										className={`px-3 py-1.5 text-xs rounded-md border transition-all ${
											newPausedAction === "drop"
												? "bg-sky-500/20 border-sky-400 text-sky-300 font-medium"
												: "bg-kumo-tint border-kumo-line text-kumo-subtle hover:text-kumo-default"
										}`}
									>
										Drop silently (black-hole)
									</button>
									<button
										type="button"
										onClick={() => setNewPausedAction("reject")}
										className={`px-3 py-1.5 text-xs rounded-md border transition-all ${
											newPausedAction === "reject"
												? "bg-sky-500/20 border-sky-400 text-sky-300 font-medium"
												: "bg-kumo-tint border-kumo-line text-kumo-subtle hover:text-kumo-default"
										}`}
									>
										Reject (Bounce 550)
									</button>
								</div>
							</div>
						</div>
						<div className="flex justify-end gap-2 pt-2">
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setShowCreateModal(false)}
							>
								Cancel
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={handleCreate}
								loading={createMutation.isPending}
							>
								Generate Address
							</Button>
						</div>
					</div>
				)}

				{/* Search & List */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
					<div className="flex items-center justify-between gap-3">
						<div className="relative flex-1 max-w-sm">
							<MagnifyingGlassIcon
								size={14}
								className="absolute left-3 top-1/2 -translate-y-1/2 text-kumo-subtle"
							/>
							<input
								type="text"
								placeholder="Search aliases..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-kumo-tint border border-kumo-line text-kumo-default placeholder:text-kumo-subtle outline-none focus:border-sky-500"
							/>
						</div>
						<div className="text-xs text-kumo-subtle">
							{filteredAliases.length} {filteredAliases.length === 1 ? "alias" : "aliases"}
						</div>
					</div>

					{filteredAliases.length === 0 ? (
						<div className="py-12 text-center text-xs text-kumo-subtle">
							{searchQuery ? "No aliases match your search" : "No private emails created yet."}
						</div>
					) : (
						<div className="divide-y divide-kumo-line -mx-1">
							{filteredAliases.map((alias) => (
								<div
									key={alias.id}
									className="flex items-center justify-between gap-4 py-3 px-1"
								>
									<div className="min-w-0 flex-1 space-y-1">
										<div className="flex items-center gap-2">
											<span className="font-mono text-sm font-medium text-kumo-default">
												{alias.alias_email}
											</span>
											<button
												type="button"
												onClick={() => handleCopy(alias)}
												title="Copy address"
												className="p-1 hover:bg-kumo-tint rounded text-kumo-subtle hover:text-kumo-default transition-colors"
											>
												{copiedId === alias.id ? (
													<CheckIcon size={14} className="text-emerald-400" />
												) : (
													<CopyIcon size={14} />
												)}
											</button>
											{alias.label && (
												<span className="px-2 py-0.5 text-[11px] rounded bg-kumo-tint text-kumo-subtle font-medium">
													{alias.label}
												</span>
											)}
										</div>
										<div className="flex items-center gap-3 text-[11px] text-kumo-subtle">
											<span>{alias.stats_received || 0} received</span>
											<span>•</span>
											<span>{alias.stats_blocked || 0} blocked</span>
											{alias.expires_at && (
												<>
													<span>•</span>
													<span className="flex items-center gap-1 text-amber-400/90">
														<ClockIcon size={12} />
														Expires {new Date(alias.expires_at).toLocaleDateString()}
													</span>
												</>
											)}
										</div>
									</div>

									<div className="flex items-center gap-3 shrink-0">
										<Switch
											checked={Boolean(alias.is_active)}
											onCheckedChange={() => handleToggleActive(alias)}
											size="sm"
										/>
										<button
											type="button"
											onClick={() => handleDelete(alias)}
											title="Delete alias"
											className="p-1.5 hover:bg-rose-500/10 hover:text-rose-400 rounded text-kumo-subtle transition-colors"
										>
											<TrashIcon size={16} />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
				</div>

				{/* Extension helper card */}
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-2">
					<div className="flex items-center gap-2 text-sm font-semibold text-kumo-default">
						<BrowsersIcon size={18} className="text-sky-400" />
						<span>Browser Extension for Safari, Chrome & Firefox</span>
					</div>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						Install the Private Email Web Extension from the <code className="text-sky-400 font-mono">extension/</code> directory to get 1-tap private email generation directly inside any website's signup form.
					</p>
				</div>
			</div>
		</SettingsSubpage>
	);
}
