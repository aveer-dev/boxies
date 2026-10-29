// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useUIStore } from "~/hooks/useUIStore";
import { formatReminderLong } from "~/lib/reply-later-reminders";
import { queryKeys } from "~/queries/keys";
import { useUpdateEmail } from "~/queries/emails";
import type { Email } from "~/types";

/**
 * Reply Later toggling and reminders (AVE-86), shared by the reader toolbar,
 * the row menu, keyboard shortcuts and the reminder picker. Adding without a
 * reminder shows a toast with "Add reminder", which opens the picker.
 */
export function useReplyLater(mailboxId: string | undefined) {
	const toastManager = useKumoToastManager();
	const updateEmail = useUpdateEmail();
	const qc = useQueryClient();
	const openReminderPicker = useUIStore((s) => s.openReminderPicker);

	const refreshPiles = useCallback(() => {
		if (mailboxId) qc.invalidateQueries({ queryKey: queryKeys.workflowPiles.list(mailboxId) });
	}, [mailboxId, qc]);

	const toggleReplyLater = useCallback(
		(email: Email) => {
			if (!mailboxId) return;
			const adding = !email.reply_later;
			updateEmail.mutate(
				{ mailboxId, id: email.id, data: { reply_later: adding } },
				{ onSettled: refreshPiles },
			);
			if (!adding) return;
			let toastId: string | undefined;
			toastId = toastManager.add({
				title: "Added to Reply Later",
				timeout: 6000,
				actions: [
					{
						children: "Add reminder",
						variant: "secondary",
						size: "sm",
						onClick: () => {
							if (toastId) toastManager.close(toastId);
							openReminderPicker({ ...email, reply_later: true });
						},
					},
				],
			});
		},
		[mailboxId, updateEmail, refreshPiles, toastManager, openReminderPicker],
	);

	/** `at` sets (and adds to Reply Later); null removes the pending reminder. */
	const setReminder = useCallback(
		(email: Email, at: Date | null) => {
			if (!mailboxId) return;
			const iso = at ? at.toISOString() : null;
			updateEmail.mutate(
				{
					mailboxId,
					id: email.id,
					data: at
						? { reply_later: true, reply_later_remind_at: iso, reply_later_reminded_at: null }
						: { reply_later_remind_at: null },
				},
				{
					onSettled: refreshPiles,
					onError: () => toastManager.add({ title: "Couldn't update the reminder", variant: "error" }),
				},
			);
			toastManager.add({ title: at ? `Reminder set for ${formatReminderLong(at)}` : "Reminder removed" });
		},
		[mailboxId, updateEmail, refreshPiles, toastManager],
	);

	return useMemo(
		() => ({ toggleReplyLater, setReminder, openReminderPicker }),
		[toggleReplyLater, setReminder, openReminderPicker],
	);
}
