// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import {
	CheckIcon,
	CopyIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import PrivateEmailLogo from "~/components/PrivateEmailLogo";
import SettingsSubpage from "~/components/SettingsSubpage";
import {
	useAliases,
	useCreateAlias,
	useDeleteAlias,
	useUpdateAlias,
} from "~/queries/aliases";
import type { MaskedAlias } from "~/types";

type ExpiryChoice = "keep" | "never" | "24h" | "7d" | "30d";
type PausedAction = "drop" | "reject";

const EXPIRY_MS: Record<"24h" | "7d" | "30d", number> = {
	"24h": 24 * 3600 * 1000,
	"7d": 7 * 24 * 3600 * 1000,
	"30d": 30 * 24 * 3600 * 1000,
};

const LABEL_MAX = 100;

/** undefined = leave unchanged, null = never expires. */
function expiresAtFor(choice: ExpiryChoice): string | null | undefined {
	if (choice === "keep") return undefined;
	if (choice === "never") return null;
	return new Date(Date.now() + EXPIRY_MS[choice]).toISOString();
}

function isExpired(alias: MaskedAlias) {
	return Boolean(alias.expires_at && Date.parse(alias.expires_at) <= Date.now());
}

function statusLabel(alias: MaskedAlias) {
	if (isExpired(alias)) return "Expired";
	return alias.is_active ? "Active" : "Paused";
}

function formatExpiry(iso: string) {
	return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const selectClass =
	"rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default";

function ExpirySelect({
	value,
	onChange,
	allowKeep,
	id,
}: {
	value: ExpiryChoice;
	onChange: (value: ExpiryChoice) => void;
	allowKeep?: boolean;
	id: string;
}) {
	return (
		<select id={id} value={value} onChange={(e) => onChange(e.target.value as ExpiryChoice)} className={selectClass}>
			{allowKeep && <option value="keep">Keep current</option>}
			<option value="never">Never</option>
			<option value="24h">In 24 hours</option>
			<option value="7d">In 7 days</option>
			<option value="30d">In 30 days</option>
		</select>
	);
}

function PausedActionSelect({
	value,
	onChange,
	id,
}: {
	value: PausedAction;
	onChange: (value: PausedAction) => void;
	id: string;
}) {
	return (
		<select id={id} value={value} onChange={(e) => onChange(e.target.value as PausedAction)} className={selectClass}>
			<option value="drop">Drop it silently</option>
			<option value="reject">Bounce it back to the sender</option>
		</select>
	);
}

function AliasListItem({ mailboxId, alias }: { mailboxId: string; alias: MaskedAlias }) {
	const toastManager = useKumoToastManager();
	const updateMutation = useUpdateAlias();
	const deleteMutation = useDeleteAlias();
	const [copied, setCopied] = useState(false);
	const [editing, setEditing] = useState(false);
	const [label, setLabel] = useState(alias.label ?? "");
	const [expiry, setExpiry] = useState<ExpiryChoice>("keep");
	const [pausedAction, setPausedAction] = useState<PausedAction>(alias.paused_action);
	const expired = isExpired(alias);
	const busy = updateMutation.isPending || deleteMutation.isPending;

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(alias.alias_email);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			toastManager.add({ title: "Couldn't copy the address", variant: "error" });
		}
	};

	const handleToggleActive = async (checked: boolean) => {
		try {
			await updateMutation.mutateAsync({ mailboxId, aliasId: alias.id, isActive: checked });
			toastManager.add({ title: checked ? "Private email resumed" : "Private email paused" });
		} catch (err) {
			toastManager.add({
				title: "Failed to update private email",
				description: err instanceof Error ? err.message : undefined,
				variant: "error",
			});
		}
	};

	const handleSave = async () => {
		try {
			await updateMutation.mutateAsync({
				mailboxId,
				aliasId: alias.id,
				label: label.trim() || null,
				pausedAction,
				expiresAt: expiresAtFor(expiry),
			});
			setEditing(false);
			setExpiry("keep");
			toastManager.add({ title: "Private email updated" });
		} catch (err) {
			toastManager.add({
				title: "Failed to update private email",
				description: err instanceof Error ? err.message : undefined,
				variant: "error",
			});
		}
	};

	const handleDelete = async () => {
		if (
			!window.confirm(
				`Delete ${alias.alias_email}? Mail sent to it will bounce, and you won't be able to reply from it again.`,
			)
		) {
			return;
		}
		try {
			await deleteMutation.mutateAsync({ mailboxId, aliasId: alias.id });
			toastManager.add({ title: "Private email deleted" });
		} catch (err) {
			toastManager.add({
				title: "Failed to delete private email",
				description: err instanceof Error ? err.message : undefined,
				variant: "error",
			});
		}
	};

	const editId = `alias-${alias.id}`;

	return (
		<li className="px-4 py-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex items-center gap-1.5 min-w-0">
						<span className="text-sm font-medium text-kumo-default break-all">{alias.alias_email}</span>
						<Button
							variant="ghost"
							shape="square"
							size="sm"
							aria-label={`Copy ${alias.alias_email}`}
							icon={copied ? <CheckIcon size={14} className="text-kumo-success" /> : <CopyIcon size={14} />}
							onClick={handleCopy}
						/>
					</div>
					{alias.label && <div className="text-xs text-kumo-default truncate">{alias.label}</div>}
					<div className="text-xs text-kumo-subtle">
						<span className={expired ? "text-kumo-warning" : undefined}>{statusLabel(alias)}</span>
						{" · "}
						{alias.stats_received || 0} received · {alias.stats_blocked || 0} blocked
						{alias.expires_at && (
							<>
								{" · "}
								{expired ? "Expired" : "Expires"} {formatExpiry(alias.expires_at)}
							</>
						)}
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Switch
						checked={Boolean(alias.is_active)}
						onCheckedChange={handleToggleActive}
						disabled={busy}
						size="sm"
						aria-label={`${alias.is_active ? "Pause" : "Resume"} ${alias.alias_email}`}
					/>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						aria-label={`Edit ${alias.alias_email}`}
						aria-expanded={editing}
						icon={<PencilSimpleIcon size={16} />}
						onClick={() => {
							if (!editing) {
								setLabel(alias.label ?? "");
								setPausedAction(alias.paused_action);
								setExpiry("keep");
							}
							setEditing((v) => !v);
						}}
					/>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						aria-label={`Delete ${alias.alias_email}`}
						icon={<TrashIcon size={16} />}
						onClick={handleDelete}
						disabled={busy}
					/>
				</div>
			</div>

			{editing && (
				<div className="mt-3 space-y-3 rounded-md border border-kumo-line bg-kumo-tint p-3">
					<Input
						label="Label"
						placeholder="e.g. Airbnb, newsletter"
						value={label}
						maxLength={LABEL_MAX}
						onChange={(e) => setLabel(e.target.value)}
					/>
					<div className="flex flex-col gap-3 sm:flex-row">
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-kumo-subtle" htmlFor={`${editId}-expiry`}>
								Expires
							</label>
							<ExpirySelect id={`${editId}-expiry`} value={expiry} onChange={setExpiry} allowKeep />
						</div>
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-kumo-subtle" htmlFor={`${editId}-paused`}>
								When paused or expired
							</label>
							<PausedActionSelect id={`${editId}-paused`} value={pausedAction} onChange={setPausedAction} />
						</div>
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
							Cancel
						</Button>
						<Button variant="primary" size="sm" onClick={handleSave} loading={updateMutation.isPending}>
							Save
						</Button>
					</div>
				</div>
			)}
		</li>
	);
}

export default function AliasesSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: aliases = [], isLoading, isError, error, refetch } = useAliases(mailboxId);
	const createMutation = useCreateAlias();

	const [searchQuery, setSearchQuery] = useState("");
	const [creating, setCreating] = useState(false);
	const [newLabel, setNewLabel] = useState("");
	const [newExpiry, setNewExpiry] = useState<ExpiryChoice>("never");
	const [newPausedAction, setNewPausedAction] = useState<PausedAction>("drop");

	if (!mailboxId) return null;
	const mailboxDomain = mailboxId.slice(mailboxId.lastIndexOf("@") + 1);

	const handleCreate = async () => {
		try {
			const res = await createMutation.mutateAsync({
				mailboxId,
				label: newLabel.trim() || null,
				expiresAt: expiresAtFor(newExpiry) ?? null,
				pausedAction: newPausedAction,
			});
			try {
				await navigator.clipboard.writeText(res.alias.alias_email);
			} catch {
				// Clipboard is best-effort; the address is in the toast and the list.
			}
			toastManager.add({ title: "Private email created and copied", description: res.alias.alias_email });
			setCreating(false);
			setNewLabel("");
			setNewExpiry("never");
			setNewPausedAction("drop");
		} catch (err) {
			toastManager.add({
				title: "Failed to create private email",
				description: err instanceof Error ? err.message : undefined,
				variant: "error",
			});
		}
	};

	const q = searchQuery.toLowerCase().trim();
	const filteredAliases = q
		? aliases.filter((a) => a.alias_email.toLowerCase().includes(q) || a.label?.toLowerCase().includes(q))
		: aliases;
	const activeCount = aliases.filter((a) => a.is_active && !isExpired(a)).length;
	const totalReceived = aliases.reduce((acc, a) => acc + (a.stats_received || 0), 0);
	const totalBlocked = aliases.reduce((acc, a) => acc + (a.stats_blocked || 0), 0);

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Private email">
			<div className="flex items-start gap-3 mb-4">
				<PrivateEmailLogo size={28} className="shrink-0 text-kumo-default" />
				<p className="text-sm text-kumo-subtle">
					Give sites a random address on @{mailboxDomain} instead of your real one. Mail to it lands
					here, replies go out from the private email, and you can pause or delete it any time.
				</p>
			</div>

			<div className="flex items-center justify-between gap-3 mb-4">
				<div className="text-xs text-kumo-subtle">
					{activeCount} active · {totalReceived} received · {totalBlocked} blocked
				</div>
				{!creating && (
					<Button variant="primary" size="sm" onClick={() => setCreating(true)}>
						<span className="flex items-center gap-1.5">
							<PlusIcon size={14} aria-hidden />
							New private email
						</span>
					</Button>
				)}
			</div>

			{creating && (
				<div className="mb-4 space-y-3 rounded-lg border border-kumo-line bg-kumo-base p-4">
					<Input
						label="Label (optional)"
						placeholder="e.g. Airbnb, newsletter"
						value={newLabel}
						maxLength={LABEL_MAX}
						onChange={(e) => setNewLabel(e.target.value)}
					/>
					<div className="flex flex-col gap-3 sm:flex-row">
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-kumo-subtle" htmlFor="new-alias-expiry">
								Expires
							</label>
							<ExpirySelect id="new-alias-expiry" value={newExpiry} onChange={setNewExpiry} />
						</div>
						<div className="flex flex-col gap-1">
							<label className="text-xs font-medium text-kumo-subtle" htmlFor="new-alias-paused">
								When paused or expired
							</label>
							<PausedActionSelect id="new-alias-paused" value={newPausedAction} onChange={setNewPausedAction} />
						</div>
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
							Cancel
						</Button>
						<Button variant="primary" size="sm" onClick={handleCreate} loading={createMutation.isPending}>
							Create
						</Button>
					</div>
				</div>
			)}

			{aliases.length > 0 && (
				<input
					type="search"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					placeholder="Search private emails"
					aria-label="Search private emails"
					className="w-full mb-4 rounded-md border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle"
				/>
			)}

			{isLoading ? (
				<div className="flex justify-center py-12">
					<Loader size="lg" />
				</div>
			) : isError ? (
				<div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-8 text-center" role="alert">
					<p className="text-sm text-kumo-default mb-1">Couldn't load private emails</p>
					<p className="text-xs text-kumo-subtle mb-3">{error instanceof Error ? error.message : "Try again."}</p>
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						Retry
					</Button>
				</div>
			) : filteredAliases.length === 0 ? (
				<div className="rounded-lg border border-kumo-line bg-kumo-base px-4 py-8 text-center">
					<p className="text-sm text-kumo-default mb-1">
						{q ? "No private emails match your search" : "No private emails yet"}
					</p>
					{!q && (
						<p className="text-xs text-kumo-subtle">
							Create one for the next site that asks for your email.
						</p>
					)}
				</div>
			) : (
				<ul className="divide-y divide-kumo-line rounded-lg border border-kumo-line bg-kumo-base">
					{filteredAliases.map((alias) => (
						<AliasListItem key={alias.id} mailboxId={mailboxId} alias={alias} />
					))}
				</ul>
			)}

			<p className="mt-4 text-xs text-kumo-subtle">
				The Inboxies Chrome extension and the iOS and Android apps can create private emails right
				from a sign-up form.
			</p>
		</SettingsSubpage>
	);
}
