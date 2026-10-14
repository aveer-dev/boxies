// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { mailboxesPurgedOnDelete } from "~/lib/account-deletion";
import { useMe } from "~/queries/account";
import { queryKeys } from "~/queries/keys";
import { useMailboxes } from "~/queries/mailboxes";
import api from "~/services/api";
import type { MailboxMember } from "~/types";
import SettingsSubpage from "./SettingsSubpage";

const CONFIRM_WORD = "DELETE";

/** Mailboxes the deletion purges (you're their only owner), with who else loses them. */
function usePurgedMailboxes() {
	const { data: mailboxes, isLoading } = useMailboxes();
	const owned = (mailboxes ?? []).filter((m) => m.role === "owner");
	const members = useQueries({
		queries: owned.map((m) => ({
			queryKey: queryKeys.members.list(m.id),
			queryFn: () => api.listMailboxMembers(m.id),
		})),
	});
	const membersByMailbox: Record<string, MailboxMember[] | undefined> = {};
	owned.forEach((m, i) => {
		membersByMailbox[m.id] = members[i]?.data;
	});
	return {
		purged: mailboxesPurgedOnDelete(mailboxes ?? [], membersByMailbox),
		isLoading: isLoading || members.some((q) => q.isLoading),
	};
}

function PurgedMailboxList() {
	const { purged, isLoading } = usePurgedMailboxes();
	if (isLoading) return <Loader />;
	if (purged.length === 0) {
		return (
			<p className="text-xs text-kumo-subtle">
				No mailbox is deleted: each one you use has another owner.
			</p>
		);
	}
	return (
		<div className="space-y-2">
			<p className="text-xs text-kumo-default">
				You're the only owner of these, so they're deleted with all their mail — for
				everyone who uses them:
			</p>
			<ul className="text-xs text-kumo-default list-disc pl-4 space-y-1">
				{purged.map((m) => (
					<li key={m.mailboxId}>
						<strong>{m.mailboxId}</strong>
						{m.othersLosingAccess > 0 &&
							` — ${m.othersLosingAccess} other ${
								m.othersLosingAccess === 1 ? "person loses" : "people lose"
							} access`}
					</li>
				))}
			</ul>
			<p className="text-xs text-kumo-subtle">
				To keep a shared one, make someone else an owner in Members first.
			</p>
		</div>
	);
}

/** Danger zone: permanently delete the signed-in account (type-to-confirm). */
export default function DeleteAccountSettings() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: me } = useMe();
	const [typed, setTyped] = useState("");
	const [deleting, setDeleting] = useState(false);

	const handleDelete = async () => {
		if (typed !== CONFIRM_WORD) return;
		setDeleting(true);
		try {
			await api.deleteAccount();
			// The server cleared the session cookie; leave the app entirely.
			window.location.href = "/login";
		} catch (err) {
			toastManager.add({
				title: err instanceof Error && err.message ? err.message : "Couldn't delete your account",
				variant: "error",
			});
			setDeleting(false);
		}
	};

	if (!mailboxId) return null;

	return (
		<SettingsSubpage mailboxId={mailboxId} title="Delete account">
			<div className="rounded-lg border border-kumo-danger bg-kumo-base p-5 space-y-4">
				<div>
					<div className="text-sm font-medium text-kumo-default mb-2">
						Delete {me?.email ?? "your account"}
					</div>
					<PurgedMailboxList />
					<ul className="text-xs text-kumo-subtle list-disc pl-4 space-y-1 mt-3">
						<li>Mailboxes with another owner stay; you're removed from them.</li>
						<li>Every device and the browser extension are signed out.</li>
						<li>This can't be undone. Export anything you want to keep first.</li>
					</ul>
				</div>
				<Input
					label={`Type ${CONFIRM_WORD} to confirm`}
					value={typed}
					onChange={(e) => setTyped(e.target.value)}
					autoComplete="off"
					spellCheck={false}
				/>
				<Button
					variant="destructive"
					disabled={typed !== CONFIRM_WORD}
					loading={deleting}
					onClick={() => void handleDelete()}
				>
					Delete account
				</Button>
			</div>
		</SettingsSubpage>
	);
}
