// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	useKumoToastManager,
} from "@cloudflare/kumo";
import { ArrowElbowDownRightIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import ConfirmDialog from "~/components/settings/ConfirmDialog";
import {
	type AliasTargetMailbox,
	DOMAIN_ALIAS_COPY as COPY,
	type DomainAliasItem,
	aliasAddErrorMessage,
	aliasConflict,
	aliasDeleteConfirmMessage,
	aliasDeleteErrorMessage,
	aliasDeliversToFooter,
	aliasTargets,
	isValidAliasLocal,
	normalizedAliasLocal,
	sortedAliases,
} from "~/lib/domain-aliases";
import api, { ApiError } from "~/services/api";

export const domainAliasesQueryKey = (domain: string) =>
	["admin-domain-aliases", domain.toLowerCase()] as const;

function serverError(err: unknown): { status?: number; message?: string } {
	if (err instanceof ApiError) {
		const message = typeof err.body?.error === "string" ? err.body.error : undefined;
		return { status: err.status, message };
	}
	return {};
}

/**
 * Admin → Mailboxes → Aliases (AVE-239): list, add and delete domain aliases
 * (`sales@domain` → a mailbox). Web twin of the native Domain Admin section (AVE-219).
 */
export function DomainAliasesSection({
	domain,
	mailboxes,
}: {
	domain: string;
	mailboxes: AliasTargetMailbox[];
}) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const queryKey = domainAliasesQueryKey(domain);
	const {
		data: aliases = [],
		isLoading,
		isError,
		refetch,
	} = useQuery({
		queryKey,
		queryFn: async () => sortedAliases((await api.listDomainAliases(domain)).aliases),
		enabled: Boolean(domain),
	});

	const [isAddOpen, setIsAddOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<DomainAliasItem | null>(null);
	const [busyAliasLocal, setBusyAliasLocal] = useState<string | null>(null);

	const setAliases = (update: (prev: DomainAliasItem[]) => DomainAliasItem[]) =>
		queryClient.setQueryData<DomainAliasItem[]>(queryKey, (prev) => update(prev ?? []));

	const handleDelete = async () => {
		const alias = deleteTarget;
		if (!alias) return;
		setDeleteTarget(null);
		setBusyAliasLocal(alias.aliasLocal);
		try {
			await api.deleteDomainAlias(domain, alias.aliasLocal);
			setAliases((prev) => prev.filter((a) => a.aliasLocal !== alias.aliasLocal));
			toastManager.add({ title: COPY.deleted });
		} catch (err: unknown) {
			toastManager.add({
				title: aliasDeleteErrorMessage(serverError(err).message),
				variant: "error",
			});
		} finally {
			setBusyAliasLocal(null);
		}
	};

	return (
		<section className="mt-8" aria-labelledby="domain-aliases-heading">
			<div className="mb-3 flex items-end justify-between gap-4">
				<div>
					<h2
						id="domain-aliases-heading"
						className="text-base font-semibold text-kumo-default"
					>
						{COPY.sectionTitle}
					</h2>
					<p className="text-xs text-kumo-subtle mt-0.5">
						Extra addresses on {domain} that deliver into a mailbox
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					icon={<PlusIcon size={14} />}
					onClick={() => setIsAddOpen(true)}
					disabled={!domain}
				>
					{COPY.addTitle}
				</Button>
			</div>

			<div className="rounded-xl border border-kumo-line bg-kumo-base overflow-hidden">
				{isLoading && aliases.length === 0 ? (
					<div className="flex justify-center py-8">
						<Loader size="sm" />
					</div>
				) : isError && aliases.length === 0 ? (
					<div className="flex items-center justify-between gap-3 px-5 py-4">
						<p className="text-sm text-kumo-subtle">{COPY.loadFailed}</p>
						<Button variant="ghost" size="sm" onClick={() => void refetch()}>
							Retry
						</Button>
					</div>
				) : aliases.length === 0 ? (
					<p className="px-5 py-4 text-sm text-kumo-subtle">{COPY.emptyMessage}</p>
				) : (
					aliases.map((alias, idx) => (
						<div
							key={alias.aliasLocal}
							className={`flex items-center gap-3 px-5 py-3 ${
								idx > 0 ? "border-t border-kumo-line" : ""
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="text-sm font-medium text-kumo-default truncate">
									{alias.aliasEmail}
								</div>
								<div className="flex items-center gap-1 text-xs text-kumo-subtle min-w-0">
									<ArrowElbowDownRightIcon size={12} className="shrink-0" />
									<span className="truncate">{alias.targetMailboxId}</span>
								</div>
							</div>
							<Button
								variant="ghost"
								size="sm"
								shape="square"
								icon={<TrashIcon size={16} />}
								loading={busyAliasLocal === alias.aliasLocal}
								disabled={busyAliasLocal !== null}
								aria-label={`Delete alias ${alias.aliasEmail}`}
								onClick={() => setDeleteTarget(alias)}
							/>
						</div>
					))
				)}
			</div>

			<AddDomainAliasDialog
				open={isAddOpen}
				onOpenChange={setIsAddOpen}
				domain={domain}
				targets={aliasTargets(mailboxes, domain)}
				existing={aliases}
				onAdded={(created) => {
					setAliases((prev) =>
						sortedAliases([
							...prev.filter((a) => a.aliasLocal !== created.aliasLocal),
							created,
						]),
					);
					toastManager.add({ title: COPY.added });
				}}
			/>

			<ConfirmDialog
				open={Boolean(deleteTarget)}
				title={deleteTarget ? `Delete ${deleteTarget.aliasEmail}?` : ""}
				description={deleteTarget ? aliasDeleteConfirmMessage(deleteTarget) : ""}
				confirmLabel="Delete alias"
				onConfirm={() => void handleDelete()}
				onCancel={() => setDeleteTarget(null)}
			/>
		</section>
	);
}

function AddDomainAliasDialog({
	open,
	onOpenChange,
	domain,
	targets,
	existing,
	onAdded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	domain: string;
	targets: AliasTargetMailbox[];
	existing: DomainAliasItem[];
	onAdded: (alias: DomainAliasItem) => void;
}) {
	const toastManager = useKumoToastManager();
	const [draft, setDraft] = useState("");
	const [targetId, setTargetId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const local = normalizedAliasLocal(draft);
	const canAdd = !saving && local.length > 0 && targetId !== null;

	// Fresh form each time it opens; the first target is preselected (as on native).
	useEffect(() => {
		if (open) {
			setDraft("");
			setTargetId(targets[0]?.id ?? null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	const fail = (title: string) => toastManager.add({ title, variant: "error" });

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (saving) return;
		if (!isValidAliasLocal(local)) return fail(COPY.invalidLocal);
		if (!targetId) return fail(COPY.noTargets);
		const conflict = aliasConflict(local, domain, existing, targets);
		if (conflict) return fail(conflict);
		setSaving(true);
		try {
			await api.createDomainAlias(domain, { aliasLocal: local, targetMailboxId: targetId });
			onAdded({
				aliasLocal: local,
				aliasEmail: `${local}@${domain.toLowerCase()}`,
				targetMailboxId: targetId,
				createdAt: null,
			});
			onOpenChange(false);
		} catch (err: unknown) {
			const { status, message } = serverError(err);
			fail(aliasAddErrorMessage(status, message));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog.Root open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
			<Modal size="sm">
				<ModalHeader title={COPY.addTitle} />
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<span className="text-sm font-medium text-kumo-default mb-1.5 block">
							Alias
						</span>
						<div className="flex items-center gap-2">
							<div className="flex-1 min-w-0">
								<Input
									aria-label="Alias"
									placeholder="sales"
									size="sm"
									value={draft}
									onChange={(e) => setDraft(e.target.value)}
									autoCapitalize="none"
									autoCorrect="off"
									spellCheck={false}
									autoFocus
								/>
							</div>
							<span className="text-sm text-kumo-subtle truncate max-w-[50%]">
								@{domain}
							</span>
						</div>
					</div>
					<div>
						<span className="text-sm font-medium text-kumo-default mb-1.5 block">
							Delivers to
						</span>
						{targets.length === 0 ? (
							<p className="text-sm text-kumo-subtle">{COPY.noTargets}</p>
						) : (
							<Select
								aria-label="Delivers to"
								value={targetId ?? undefined}
								onValueChange={(value) => {
									if (typeof value === "string") setTargetId(value);
								}}
							>
								{targets.map((row) => (
									<Select.Option key={row.id} value={row.id}>
										{row.email}
									</Select.Option>
								))}
							</Select>
						)}
						<p className="text-xs text-kumo-subtle mt-1.5">
							{aliasDeliversToFooter(local, domain)}
						</p>
					</div>
					<div className="flex justify-end gap-2 pt-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary" size="sm" disabled={saving}>
									Cancel
								</Button>
							)}
						/>
						<Button
							type="submit"
							variant="primary"
							size="sm"
							loading={saving}
							disabled={!canAdd}
						>
							Add
						</Button>
					</div>
				</form>
			</Modal>
		</Dialog.Root>
	);
}
