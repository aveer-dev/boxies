// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import SettingsSubpage from "~/components/SettingsSubpage";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";

export default function ForwardingSettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [enabled, setEnabled] = useState(false);
	const [email, setEmail] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (mailbox) {
			setEnabled(Boolean(mailbox.settings?.forwarding?.enabled));
			setEmail(mailbox.settings?.forwarding?.email || "");
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		const dest = email.trim();
		if (enabled) {
			if (!dest || !dest.includes("@")) {
				toastManager.add({ title: "Enter a valid forwarding address", variant: "error" });
				return;
			}
			if (dest.toLowerCase() === mailbox.email.toLowerCase()) {
				toastManager.add({
					title: "Forwarding address cannot be this mailbox",
					variant: "error",
				});
				return;
			}
		}
		setIsSaving(true);
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: {
					...mailbox.settings,
					forwarding: { enabled, email: dest },
				},
			});
			toastManager.add({ title: "Forwarding saved" });
		} catch (e) {
			const title = e instanceof Error && e.message
				? e.message
				: "Failed to save forwarding";
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
		<SettingsSubpage mailboxId={mailboxId} title="Forwarding">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
				<p className="text-sm text-kumo-default leading-relaxed">
					When this is on, a copy of each incoming message is sent to another
					address. This mailbox still keeps the original.
				</p>
				<p className="text-xs text-kumo-subtle leading-relaxed">
					The destination must be a verified Email Routing destination in your
					Cloudflare account. Unverified addresses are skipped; the original
					still arrives here. Spam and messages already in a forwarding loop are
					not forwarded.
				</p>
				<Switch
					label="Forward incoming mail"
					checked={enabled}
					onCheckedChange={setEnabled}
					controlFirst={false}
				/>
				<Input
					label="Forward to"
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
					disabled={!enabled}
				/>
				<div className="flex justify-end pt-2">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save
					</Button>
				</div>
			</div>
		</SettingsSubpage>
	);
}
