// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog } from "@cloudflare/kumo";
import { Modal, ModalHeader } from "~/components/Modal";
import { AlarmIcon, CalendarBlankIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useMailboxId } from "~/hooks/useCurrentMailbox";
import { useReplyLater } from "~/hooks/useReplyLater";
import { useUIStore } from "~/hooks/useUIStore";
import {
	formatPresetTime,
	formatReminderLong,
	fromDateTimeLocalValue,
	pendingReminder,
	reminderPresets,
	toDateTimeLocalValue,
} from "~/lib/reply-later-reminders";

const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * "Remind me" picker for Reply Later (AVE-86): Later today / Tomorrow / Next
 * week, or a custom date and time. Twins: iOS `ReplyLaterReminderSheet`,
 * Android `ReplyLaterReminderSheet`. Mounted once per mailbox; opened through
 * `useUIStore.openReminderPicker`. Grey-scale only, on the shared `Modal`
 * sheet (the pop-out look).
 */
export default function ReplyLaterReminderDialog() {
	const mailboxId = useMailboxId();
	const email = useUIStore((s) => s.reminderEmail);
	const close = useUIStore((s) => s.closeReminderPicker);
	const { setReminder } = useReplyLater(mailboxId);

	const [now, setNow] = useState(() => new Date());
	const [custom, setCustom] = useState(false);
	const [value, setValue] = useState("");

	useEffect(() => {
		if (!email) return;
		const opened = new Date();
		setNow(opened);
		setCustom(false);
		const pending = pendingReminder(email);
		const start = pending && pending > opened ? pending : reminderPresets(opened)[1].at;
		setValue(toDateTimeLocalValue(start));
	}, [email]);

	const presets = useMemo(() => reminderPresets(now), [now]);
	const pending = email ? pendingReminder(email) : null;
	const customAt = fromDateTimeLocalValue(value);
	const customValid =
		customAt != null && customAt.getTime() > Date.now() && customAt.getTime() - Date.now() < MAX_AHEAD_MS;

	const choose = (at: Date | null) => {
		if (!email) return;
		setReminder(email, at);
		close();
	};

	return (
		<Dialog.Root open={email != null} onOpenChange={(open) => !open && close()}>
			<Modal size="sm">
				<ModalHeader
					className="mb-3"
					title={pending ? "Change reminder" : "Remind me"}
					description={
						pending
							? `Reminder set for ${formatReminderLong(pending, now)}`
							: "It comes back to the top of your Inbox, unread, and we'll notify you."
					}
				/>

				<ul className="-mx-3 flex flex-col" aria-label="Reminder times">
					{presets.map((p) => (
						<li key={p.id}>
							<button
								type="button"
								onClick={() => choose(p.at)}
								className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
							>
								<AlarmIcon size={16} className="shrink-0 text-kumo-subtle" />
								<span className="flex-1 font-medium">{p.label}</span>
								<span className="text-xs text-kumo-subtle tabular-nums">{formatPresetTime(p.at, now)}</span>
							</button>
						</li>
					))}
					<li>
						<button
							type="button"
							aria-expanded={custom}
							onClick={() => setCustom((c) => !c)}
							className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
						>
							<CalendarBlankIcon size={16} className="shrink-0 text-kumo-subtle" />
							<span className="flex-1 font-medium">Pick date &amp; time…</span>
						</button>
					</li>
				</ul>

				{custom && (
					<form
						className="flex items-center gap-2 pb-1 pt-2 animate-reveal"
						onSubmit={(e) => {
							e.preventDefault();
							if (customValid && customAt) choose(customAt);
						}}
					>
						<input
							type="datetime-local"
							aria-label="Reminder date and time"
							value={value}
							min={toDateTimeLocalValue(now)}
							onChange={(e) => setValue(e.target.value)}
							className="min-w-0 flex-1 rounded-lg border border-kumo-hairline bg-kumo-control px-2.5 py-1.5 text-sm text-kumo-default tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
						/>
						<Button type="submit" variant="primary" size="sm" disabled={!customValid}>
							Set reminder
						</Button>
					</form>
				)}

				{pending && (
					<>
						<div className="my-1 h-px bg-kumo-line" />
						<div className="-mx-3">
						<button
							type="button"
							onClick={() => choose(null)}
							className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
						>
							<TrashIcon size={16} className="shrink-0 text-kumo-subtle" />
							Remove reminder
						</button>
						</div>
					</>
				)}
			</Modal>
		</Dialog.Root>
	);
}
