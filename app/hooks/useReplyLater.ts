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
import { PILE_REPLY_LATER, PILE_SET_ASIDE, isSetAside, pileOf } from "~/lib/piles";
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
				{
					mailboxId,
					id: email.id,
					// Adding moves Set Aside mail over (one pile at a time).
					data: adding ? { reply_later: true, pile_id: "reply_later" } : { reply_later: false, pile_id: null },
				},
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

	/**
	 * Set Aside (AVE-201): the second pile, for mail to keep handy. A message
	 * is in one pile at a time, so Reply Later mail moves over (and loses its
	 * reminder); replying never takes it out.
	 */
	const toggleSetAside = useCallback(
		(email: Email) => {
			if (!mailboxId) return;
			const adding = !isSetAside(email);
			updateEmail.mutate(
				{
					mailboxId,
					id: email.id,
					data: adding
						? { pile: PILE_SET_ASIDE, pile_id: PILE_SET_ASIDE, reply_later: false, reply_later_remind_at: null }
						: { pile: null, pile_id: null },
				},
				{
					onSettled: refreshPiles,
					onError: () => toastManager.add({ title: "Couldn't update Set Aside", variant: "error" }),
				},
			);
			toastManager.add({ title: adding ? "Set aside" : "Removed from Set Aside" });
		},
		[mailboxId, updateEmail, refreshPiles, toastManager],
	);

	/**
	 * Any pile, including the ones people make (AVE-194): `pile` null takes
	 * the message out of its pile. One pile at a time, so joining moves it out
	 * of Reply Later or Set Aside (and drops a reminder). `name` is for the toast.
	 */
	const setPile = useCallback(
		(email: Email, pile: { id: string; name: string } | null) => {
			if (!mailboxId) return;
			if (pile?.id === PILE_REPLY_LATER) {
				if (!email.reply_later) toggleReplyLater(email);
				return;
			}
			const current = pileOf(email);
			if (pile && current === pile.id) return;
			if (!pile && !current) return;
			updateEmail.mutate(
				{
					mailboxId,
					id: email.id,
					data: pile
						? { pile: pile.id, pile_id: pile.id, reply_later: false, reply_later_remind_at: null }
						: { pile: null, pile_id: null, reply_later: false },
				},
				{
					onSettled: refreshPiles,
					onError: () => toastManager.add({ title: "Couldn't update the pile", variant: "error" }),
				},
			);
			toastManager.add({ title: pile ? `Moved to ${pile.name}` : "Removed from pile" });
		},
		[mailboxId, updateEmail, refreshPiles, toastManager, toggleReplyLater],
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
		() => ({ toggleReplyLater, toggleSetAside, setPile, setReminder, openReminderPicker }),
		[toggleReplyLater, toggleSetAside, setPile, setReminder, openReminderPicker],
	);
}
