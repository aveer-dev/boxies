// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, Select, useKumoToastManager } from "@cloudflare/kumo";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { queryKeys } from "~/queries/keys";
import { useMailbox } from "~/queries/mailboxes";
import { useMailboxMembers } from "~/queries/members";
import api from "~/services/api";
import type { MailboxMember, MailboxRole } from "~/types";
import ConfirmDialog from "./ConfirmDialog";
import { InviteMemberCard, PendingInvitesCard } from "./MemberInvites";
import SettingsSubpage from "./SettingsSubpage";

const ROLE_LABELS: Record<MailboxRole, string> = { owner: "Owner", member: "Member" };

function errorMessage(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

function MemberRow({
	member,
	canManage,
	busy,
	onRoleChange,
	onRemove,
}: {
	member: MailboxMember;
	canManage: boolean;
	busy: boolean;
	onRoleChange: (role: MailboxRole) => void;
	onRemove: () => void;
}) {
	const title = member.name?.trim() || member.email;
	return (
		<div className="px-5 py-3 flex items-center gap-3">
			<div className="min-w-0 flex-1">
				<div className="text-sm text-kumo-default truncate flex items-center gap-2">
					<span className="truncate">{title}</span>
					{member.you && <Badge variant="neutral">You</Badge>}
				</div>
				{title !== member.email && (
					<p className="text-xs text-kumo-subtle truncate">{member.email}</p>
				)}
			</div>
			{canManage ? (
				<div className="w-28 shrink-0">
					<Select
						size="sm"
						aria-label={`Role for ${member.email}`}
						value={member.role}
						items={ROLE_LABELS}
						disabled={busy}
						onValueChange={(value) => {
							if (value && value !== member.role) onRoleChange(value as MailboxRole);
						}}
					>
						<Select.Option value="owner">Owner</Select.Option>
						<Select.Option value="member">Member</Select.Option>
					</Select>
				</div>
			) : (
				<Badge variant={member.role === "owner" ? "primary" : "secondary"}>
					{member.role === "owner" ? "Owner" : "Member"}
				</Badge>
			)}
			{canManage && !member.you && (
				<button
					type="button"
					className="p-2 text-kumo-subtle hover:text-kumo-default disabled:opacity-40"
					aria-label={`Remove ${member.email}`}
					disabled={busy}
					onClick={onRemove}
				>
					<TrashIcon size={16} />
				</button>
			)}
		</div>
	);
}

/** Members of this mailbox: owners manage them; anyone can leave. */
export default function SharingSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const toastManager = useKumoToastManager();
	const queryClient = useQueryClient();
	const closeSettings = useUIStore((s) => s.closeSettings);
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: members, isLoading, error } = useMailboxMembers(mailboxId);
	const [busyUserId, setBusyUserId] = useState<string | null>(null);
	const [removing, setRemoving] = useState<MailboxMember | null>(null);
	const [demotingSelf, setDemotingSelf] = useState<MailboxMember | null>(null);
	const [confirmLeave, setConfirmLeave] = useState(false);
	const [leaving, setLeaving] = useState(false);

	const canManage = Boolean(mailbox?.canManage);
	const you = members?.find((m) => m.you);
	const ownerCount = members?.filter((m) => m.role === "owner").length ?? 0;
	const soleOwner = you?.role === "owner" && ownerCount <= 1;

	const refreshMembers = async () => {
		if (!mailboxId) return;
		await queryClient.invalidateQueries({ queryKey: queryKeys.members.list(mailboxId) });
		await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) });
	};

	const handleRoleChange = async (member: MailboxMember, role: MailboxRole) => {
		if (!mailboxId) return;
		setBusyUserId(member.userId);
		try {
			await api.setMailboxMemberRole(mailboxId, member.userId, role);
			toastManager.add({
				title: `${member.email} is now ${role === "owner" ? "an owner" : "a member"}`,
			});
			await refreshMembers();
			// Stepping yourself down also changes what you can manage here.
			if (member.you) await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't change the role"), variant: "error" });
		} finally {
			setBusyUserId(null);
		}
	};

	const handleRemove = async () => {
		if (!mailboxId || !removing) return;
		setBusyUserId(removing.userId);
		try {
			await api.removeMailboxMember(mailboxId, removing.userId);
			toastManager.add({ title: `${removing.email} removed` });
			setRemoving(null);
			await refreshMembers();
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't remove them"), variant: "error" });
		} finally {
			setBusyUserId(null);
		}
	};

	const handleLeave = async () => {
		if (!mailboxId || !you) return;
		setLeaving(true);
		try {
			await api.removeMailboxMember(mailboxId, you.userId);
			toastManager.add({ title: `You left ${mailbox?.email ?? mailboxId}` });
			closeSettings();
			queryClient.removeQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) });
			await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
			navigate("/", { replace: true });
		} catch (err) {
			toastManager.add({ title: errorMessage(err, "Couldn't leave the mailbox"), variant: "error" });
			setLeaving(false);
			setConfirmLeave(false);
		}
	};

	if (!mailboxId) return null;

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Members">
			<div className="space-y-4">
				<p className="text-sm text-kumo-subtle leading-relaxed">
					People who can use {mailbox?.email ?? "this mailbox"}. Owners invite and remove
					people and change forwarding, auto-reply, filters, and the agent prompt.
				</p>

				{isLoading ? (
					<div className="flex justify-center py-12">
						<Loader size="lg" />
					</div>
				) : error || !members ? (
					<p className="text-sm text-kumo-subtle">
						{errorMessage(error, "Couldn't load members.")}
					</p>
				) : (
					<section className="rounded-lg border border-kumo-line bg-kumo-base divide-y divide-kumo-line">
						<div className="px-5 py-3 text-sm font-medium text-kumo-default">
							{members.length === 1 ? "1 person" : `${members.length} people`}
						</div>
						{members.map((member) => (
							<MemberRow
								key={member.userId}
								member={member}
								canManage={canManage}
								busy={busyUserId === member.userId}
								onRoleChange={(role) => {
									// Only another owner can undo stepping yourself down.
									if (member.you && role === "member") setDemotingSelf(member);
									else void handleRoleChange(member, role);
								}}
								onRemove={() => setRemoving(member)}
							/>
						))}
					</section>
				)}

				{canManage && <PendingInvitesCard mailboxId={mailboxId} />}
				{canManage && <InviteMemberCard mailboxId={mailboxId} />}

				{you && (
					<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-3">
						<div>
							<div className="text-sm font-medium text-kumo-default">Leave this mailbox</div>
							<p className="text-xs text-kumo-subtle mt-1">
								{soleOwner
									? "You're the only owner. Make someone else an owner before you leave."
									: "It disappears from your mailbox list on every device. An owner can invite you back."}
							</p>
						</div>
						<Button
							variant="secondary"
							size="sm"
							disabled={soleOwner}
							onClick={() => setConfirmLeave(true)}
						>
							Leave mailbox
						</Button>
					</div>
				)}
			</div>

			<ConfirmDialog
				open={removing !== null}
				title="Remove from mailbox?"
				description={`${removing?.email ?? "They"} will lose access to this mailbox on every device.`}
				confirmLabel="Remove"
				busy={busyUserId !== null && busyUserId === removing?.userId}
				onConfirm={() => void handleRemove()}
				onCancel={() => setRemoving(null)}
			/>
			<ConfirmDialog
				open={demotingSelf !== null}
				title="Become a member?"
				description="You'll stop managing members, forwarding, auto-reply, filters, and the agent prompt here. Only another owner can make you an owner again."
				confirmLabel="Become a member"
				busy={busyUserId !== null && busyUserId === demotingSelf?.userId}
				onConfirm={() => {
					if (!demotingSelf) return;
					void handleRoleChange(demotingSelf, "member").finally(() => setDemotingSelf(null));
				}}
				onCancel={() => setDemotingSelf(null)}
			/>
			<ConfirmDialog
				open={confirmLeave}
				title={`Leave ${mailbox?.email ?? "this mailbox"}?`}
				description="You'll lose access to its mail on every device until an owner invites you again."
				confirmLabel="Leave"
				busy={leaving}
				onConfirm={() => void handleLeave()}
				onCancel={() => setConfirmLeave(false)}
			/>
		</SettingsSubpage>
	);
}
