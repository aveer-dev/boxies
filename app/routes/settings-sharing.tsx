// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import SettingsSubpage from "~/components/SettingsSubpage";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import api from "~/services/api";
import type { MailboxAcl } from "~/types";

function displayAclKey(key: string): string {
	if (key.startsWith("email:")) return key.slice("email:".length);
	return key;
}

function canonicalEmailAclKey(key: string): string | null {
	if (!key.startsWith("email:")) return null;
	const email = key.slice("email:".length);
	const at = email.lastIndexOf("@");
	if (at <= 0) return null;
	const local = email.slice(0, at);
	const plus = local.indexOf("+");
	if (plus <= 0) return `email:${email}`;
	return `email:${local.slice(0, plus)}@${email.slice(at + 1)}`;
}

function viewerCanManage(
	owners: string[],
	viewerKeys: Set<string>,
	canManage?: boolean,
): boolean {
	if (typeof canManage === "boolean") return canManage;
	return owners.some((key) => {
		if (viewerKeys.has(key)) return true;
		const canonical = canonicalEmailAclKey(key);
		return Boolean(canonical && viewerKeys.has(canonical));
	});
}

function toEmailKey(raw: string): string | null {
	const trimmed = raw.trim().toLowerCase();
	if (!trimmed) return null;
	if (trimmed.startsWith("email:")) {
		const email = trimmed.slice("email:".length).trim();
		return email.includes("@") ? `email:${email}` : null;
	}
	if (trimmed.startsWith("sub:")) return trimmed;
	return trimmed.includes("@") ? `email:${trimmed}` : null;
}

export default function SharingSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();
	const { data: me } = useQuery({
		queryKey: ["me"],
		queryFn: () => api.getMe(),
		staleTime: 60_000,
	});

	const [owners, setOwners] = useState<string[]>([]);
	const [members, setMembers] = useState<string[]>([]);
	const [draft, setDraft] = useState("");
	const [addAsOwner, setAddAsOwner] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!mailbox) return;
		const acl = mailbox.settings?.acl;
		setOwners([...(acl?.owners ?? [])]);
		setMembers([...(acl?.members ?? [])]);
	}, [mailbox]);

	const viewerKeys = useMemo(() => new Set(me?.keys ?? []), [me?.keys]);
	const canManage = viewerCanManage(owners, viewerKeys, mailbox?.canManage);

	const handleRemove = (key: string, role: "owner" | "member") => {
		if (role === "owner") {
			if (owners.length <= 1) {
				toastManager.add({
					title: "Mailbox must have at least one owner",
					variant: "error",
				});
				return;
			}
			setOwners((prev) => prev.filter((item) => item !== key));
		} else {
			setMembers((prev) => prev.filter((item) => item !== key));
		}
	};

	const handleAdd = () => {
		const key = toEmailKey(draft);
		if (!key) {
			toastManager.add({
				title: "Enter a valid email address",
				variant: "error",
			});
			return;
		}
		if (owners.includes(key) || members.includes(key)) {
			toastManager.add({ title: "That person is already listed", variant: "error" });
			return;
		}
		if (addAsOwner) setOwners((prev) => [...prev, key]);
		else setMembers((prev) => [...prev, key]);
		setDraft("");
	};

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		if (owners.length === 0) {
			toastManager.add({
				title: "Mailbox must have at least one owner",
				variant: "error",
			});
			return;
		}
		const acl: MailboxAcl = { owners, members };
		setIsSaving(true);
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: {
					...mailbox.settings,
					acl,
				},
			});
			toastManager.add({ title: "Sharing saved" });
		} catch (e) {
			const title =
				e instanceof Error && e.message ? e.message : "Failed to save sharing";
			toastManager.add({ title, variant: "error" });
		} finally {
			setIsSaving(false);
		}
	};

	if (!mailbox || !mailboxId) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Sharing">
			<div className="space-y-4">
				<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
					<p className="text-sm text-kumo-default leading-relaxed">
						Owners can manage this list. Members can use the mailbox but cannot
						change who has access.
					</p>
					<p className="text-xs text-kumo-subtle leading-relaxed">
						Add people by the email on their Cloudflare Access or mobile sign-in
						account. That address may differ from the mailbox address.
					</p>
				</div>

				<section className="rounded-lg border border-kumo-line bg-kumo-base divide-y divide-kumo-line">
					<div className="px-5 py-3 text-sm font-medium text-kumo-default">
						Owners
					</div>
					{owners.length === 0 && (
						<p className="px-5 py-4 text-sm text-kumo-subtle">No owners yet.</p>
					)}
					{owners.map((key) => (
						<div key={key} className="px-5 py-3 flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<div className="text-sm text-kumo-default truncate">
									{displayAclKey(key)}
								</div>
								<p className="text-xs text-kumo-subtle">{key}</p>
							</div>
							{canManage && (
								<button
									type="button"
									className="p-2 text-kumo-subtle hover:text-kumo-default disabled:opacity-40"
									aria-label={`Remove owner ${displayAclKey(key)}`}
									disabled={owners.length <= 1}
									onClick={() => handleRemove(key, "owner")}
								>
									<TrashIcon size={16} />
								</button>
							)}
						</div>
					))}
				</section>

				<section className="rounded-lg border border-kumo-line bg-kumo-base divide-y divide-kumo-line">
					<div className="px-5 py-3 text-sm font-medium text-kumo-default">
						Members
					</div>
					{members.length === 0 && (
						<p className="px-5 py-4 text-sm text-kumo-subtle">No members yet.</p>
					)}
					{members.map((key) => (
						<div key={key} className="px-5 py-3 flex items-center gap-3">
							<div className="min-w-0 flex-1">
								<div className="text-sm text-kumo-default truncate">
									{displayAclKey(key)}
								</div>
								<p className="text-xs text-kumo-subtle">{key}</p>
							</div>
							{canManage && (
								<button
									type="button"
									className="p-2 text-kumo-subtle hover:text-kumo-default"
									aria-label={`Remove member ${displayAclKey(key)}`}
									onClick={() => handleRemove(key, "member")}
								>
									<TrashIcon size={16} />
								</button>
							)}
						</div>
					))}
				</section>

				{canManage && (
					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
						<div className="text-sm font-medium text-kumo-default">Add person</div>
						<Input
							label="Email"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder="ada@example.com"
						/>
						<label className="flex items-center gap-2 text-sm text-kumo-default">
							<input
								type="checkbox"
								checked={addAsOwner}
								onChange={(e) => setAddAsOwner(e.target.checked)}
							/>
							Add as owner
						</label>
						<Button
							variant="secondary"
							icon={<PlusIcon size={16} />}
							onClick={handleAdd}
						>
							Add
						</Button>
					</div>
				)}

				{canManage && (
					<div className="flex justify-end">
						<Button variant="primary" onClick={handleSave} loading={isSaving}>
							Save
						</Button>
					</div>
				)}
			</div>
		</SettingsSubpage>
	);
}
