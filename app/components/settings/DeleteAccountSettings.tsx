// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, useKumoToastManager } from "@cloudflare/kumo";
import { useState } from "react";
import { useParams } from "react-router";
import { useMe } from "~/queries/account";
import api from "~/services/api";
import SettingsSubpage from "./SettingsSubpage";

const CONFIRM_WORD = "DELETE";

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
					<div className="text-sm font-medium text-kumo-default mb-1">
						Delete {me?.email ?? "your account"}
					</div>
					<ul className="text-xs text-kumo-subtle list-disc pl-4 space-y-1">
						<li>Mailboxes only you own are deleted with all their mail.</li>
						<li>Mailboxes shared with other owners stay; you're removed from them.</li>
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
