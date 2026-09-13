// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Input, Loader, Switch, useKumoToastManager } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import SettingsSubpage from "~/components/SettingsSubpage";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";

export default function AutoReplySettingsRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const updateMailboxMutation = useUpdateMailbox();

	const [enabled, setEnabled] = useState(false);
	const [subject, setSubject] = useState("");
	const [message, setMessage] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (mailbox) {
			setEnabled(Boolean(mailbox.settings?.autoReply?.enabled));
			setSubject(mailbox.settings?.autoReply?.subject || "");
			setMessage(mailbox.settings?.autoReply?.message || "");
		}
	}, [mailbox]);

	const handleSave = async () => {
		if (!mailbox || !mailboxId) return;
		if (enabled && !message.trim()) {
			toastManager.add({ title: "Enter an auto-reply message", variant: "error" });
			return;
		}
		setIsSaving(true);
		try {
			await updateMailboxMutation.mutateAsync({
				mailboxId,
				settings: {
					...mailbox.settings,
					autoReply: {
						enabled,
						subject: subject.trim(),
						message: message.trim(),
					},
				},
			});
			toastManager.add({ title: "Auto-reply saved" });
		} catch (e) {
			const title = e instanceof Error && e.message
				? e.message
				: "Failed to save auto-reply";
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
		<SettingsSubpage mailboxId={mailboxId} title="Auto-reply">
			<div className="rounded-lg border border-kumo-line bg-kumo-base p-5 space-y-4">
				<p className="text-sm text-kumo-default leading-relaxed">
					When this is on, people who email this mailbox get one automatic reply.
					You still receive their message.
				</p>
				<p className="text-xs text-kumo-subtle leading-relaxed">
					Each sender gets at most one auto-reply every 24 hours. Mail from
					lists, bulk senders, no-reply addresses, and other automated systems is
					skipped so this cannot loop. Replies are marked Auto-Submitted with
					Precedence: bulk.
				</p>
				<Switch
					label="Send automatic replies"
					checked={enabled}
					onCheckedChange={setEnabled}
					controlFirst={false}
				/>
				<Input
					label="Subject"
					value={subject}
					onChange={(e) => setSubject(e.target.value)}
					placeholder="Leave blank to use Re: original subject"
					disabled={!enabled}
				/>
				<div>
					<label className="block text-sm font-medium text-kumo-default mb-1.5">
						Message
					</label>
					<textarea
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="Thanks for your email. I am away and will reply when I return."
						rows={8}
						disabled={!enabled}
						className="w-full resize-y rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring leading-relaxed disabled:opacity-50"
					/>
				</div>
				<div className="flex justify-end pt-2">
					<Button variant="primary" onClick={handleSave} loading={isSaving}>
						Save
					</Button>
				</div>
			</div>
		</SettingsSubpage>
	);
}
