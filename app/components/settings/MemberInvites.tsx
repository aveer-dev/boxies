// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "~/queries/keys";
import { usePendingInvites } from "~/queries/members";
import api from "~/services/api";
import type { MailboxInviteRow } from "~/types";
import ConfirmDialog from "./ConfirmDialog";

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/** Owners: invite someone by email. They get a link and confirm with a code. */
export function InviteMemberCard({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const [asOwner, setAsOwner] = useState(false);
	const [sending, setSending] = useState(false);
	const [linkToShare, setLinkToShare] = useState<string | null>(null);

	const handleInvite = async () => {
		const inviteEmail = email.trim();
		if (!inviteEmail.includes("@")) {
			toastManager.add({ title: "Enter a valid email address", variant: "error" });
			return;
		}
		setSending(true);
		setLinkToShare(null);
		try {
			const result = await api.createMailboxInvite(mailboxId, {
				inviteEmail,
				inviteeName: name.trim() || undefined,
				role: asOwner ? "owner" : "member",
			});
			// The link is only ours to show when the email didn't go out.
			if (!result.emailSent) setLinkToShare(result.inviteUrl);
			toastManager.add({
				title: result.emailSent ? `Invite sent to ${inviteEmail}` : "Invite created — copy the link",
			});
			setEmail("");
			setName("");
			setAsOwner(false);
			await queryClient.invalidateQueries({ queryKey: queryKeys.members.invites(mailboxId) });
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't send the invite"), variant: "error" });
		} finally {
			setSending(false);
		}
	};

	return (
		<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5 space-y-3">
			<div>
				<div className="text-sm font-medium text-kumo-default">Invite someone</div>
				<p className="text-xs text-kumo-subtle mt-1">
					They get a link by email and confirm with a code sent to that address. New
					people choose a password; people with an Inboxies account sign in first.
				</p>
			</div>
			<Input
				label="Email"
				type="email"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				placeholder="person@example.com"
			/>
			<Input
				label="Name (optional)"
				value={name}
				onChange={(e) => setName(e.target.value)}
			/>
			<label className="flex items-center gap-2 text-sm text-kumo-default">
				<input
					type="checkbox"
					checked={asOwner}
					onChange={(e) => setAsOwner(e.target.checked)}
				/>
				Invite as owner
			</label>
			{linkToShare && (
				<div className="rounded-md bg-kumo-tint p-3 space-y-2">
					<code className="text-xs break-all text-kumo-default block">{linkToShare}</code>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							void navigator.clipboard.writeText(linkToShare);
							toastManager.add({ title: "Invite link copied" });
						}}
					>
						Copy link
					</Button>
				</div>
			)}
			<Button variant="primary" onClick={handleInvite} loading={sending}>
				Send invite
			</Button>
		</div>
	);
}

/** Owners: invites that haven't been accepted yet, with revoke. */
export function PendingInvitesCard({ mailboxId }: { mailboxId: string }) {
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: invites = [], isLoading } = usePendingInvites(mailboxId, true);
	const [revoking, setRevoking] = useState<MailboxInviteRow | null>(null);
	const [busy, setBusy] = useState(false);

	const handleRevoke = async () => {
		if (!revoking) return;
		setBusy(true);
		try {
			await api.revokeMailboxInvite(revoking.id);
			toastManager.add({ title: `Invite to ${revoking.inviteeEmail} revoked` });
			setRevoking(null);
			await queryClient.invalidateQueries({ queryKey: queryKeys.members.invites(mailboxId) });
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't revoke the invite"), variant: "error" });
		} finally {
			setBusy(false);
		}
	};

	if (isLoading || invites.length === 0) return null;

	return (
		<section className="rounded-2xl border border-kumo-line bg-kumo-base divide-y divide-kumo-line">
			<div className="px-5 py-3 text-sm font-medium text-kumo-default">Pending invites</div>
			{invites.map((invite) => (
				<div key={invite.id} className="px-5 py-3 flex items-center gap-3">
					<div className="min-w-0 flex-1">
						<div className="text-sm text-kumo-default truncate">
							{invite.inviteeName ? `${invite.inviteeName} · ` : ""}
							{invite.inviteeEmail}
						</div>
						<p className="text-xs text-kumo-subtle">
							Expires {new Date(invite.expiresAt).toLocaleDateString()}
						</p>
					</div>
					<Badge variant={invite.role === "owner" ? "primary" : "secondary"}>
						{invite.role === "owner" ? "Owner" : "Member"}
					</Badge>
					<Button variant="ghost" size="sm" onClick={() => setRevoking(invite)}>
						Revoke
					</Button>
				</div>
			))}
			<ConfirmDialog
				open={revoking !== null}
				title="Revoke invite?"
				description={`The link sent to ${revoking?.inviteeEmail ?? "them"} will stop working.`}
				confirmLabel="Revoke"
				busy={busy}
				onConfirm={handleRevoke}
				onCancel={() => setRevoking(null)}
			/>
		</section>
	);
}
