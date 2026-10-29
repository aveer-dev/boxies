// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reply Later reminders (AVE-86).
 *
 * A mail in Reply Later may carry `reply_later_remind_at` (UTC ISO). The
 * mailbox DO alarm fires due reminders once, server side, so every device
 * sees the same result and gets one push:
 * - the mail is marked unread and `reply_later_reminded_at` is stamped
 *   (unread + stamped = "due": clients light up the Reply Later button);
 * - it stays in Reply Later;
 * - if it was filed away (Archive, Promotions, Updates, a custom folder) it
 *   moves back to Inbox, where `max(date, reply_later_reminded_at)` lifts it
 *   to the top of New.
 * Mail in Trash / Spam / Drafts never fires; its reminder is dropped.
 */

import { Folders } from "../../shared/folders";

type SqlLike = {
	exec: (query: string, ...bindings: unknown[]) => Iterable<unknown>;
};

/**
 * DO storage key holding the mailbox id, written when a reminder is set: an
 * alarm invocation can't rely on `ctx.id.name`, and the push needs the id.
 */
export const REPLY_LATER_MAILBOX_ID_KEY = "reply_later_mailbox_id";

/** Furthest ahead a reminder may be set. */
export const REPLY_LATER_REMINDER_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** Most reminders fired per alarm run; the alarm re-arms right away for the rest. */
export const REPLY_LATER_REMINDER_BATCH = 50;

/** Folders a fired reminder leaves the mail in (everything else moves to Inbox). */
const STAY_PUT_FOLDERS: readonly string[] = [
	Folders.INBOX,
	Folders.SENT,
	Folders.SCREENER,
	Folders.SCREENED_OUT,
];

/** Folders where a reminder is dropped instead of fired. */
const NEVER_FIRE_FOLDERS: readonly string[] = [Folders.TRASH, Folders.SPAM, Folders.DRAFT];

export type ReminderInputResult =
	| { ok: true; remindAt: string | null }
	| { ok: false; error: string };

/**
 * Validate a client `reply_later_remind_at`. Null clears. A time in the past
 * is accepted and fires on the next alarm (an offline client may replay a
 * reminder late; firing beats failing).
 */
export function parseReminderInput(value: unknown, now: number = Date.now()): ReminderInputResult {
	if (value === null) return { ok: true, remindAt: null };
	if (typeof value !== "string" || value.trim() === "") {
		return { ok: false, error: "reply_later_remind_at must be an ISO 8601 date string or null" };
	}
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) {
		return { ok: false, error: "reply_later_remind_at is not a valid date" };
	}
	if (ms - now > REPLY_LATER_REMINDER_MAX_AHEAD_MS) {
		return { ok: false, error: "reply_later_remind_at is more than a year ahead" };
	}
	return { ok: true, remindAt: new Date(ms).toISOString() };
}

/** Earliest pending reminder (epoch ms), or null when none is set. */
export function nextReplyLaterReminderAt(sql: SqlLike): number | null {
	const row = [
		...sql.exec(
			`SELECT MIN(reply_later_remind_at) AS next FROM emails
			  WHERE reply_later_remind_at IS NOT NULL`,
		),
	][0] as { next: string | null } | undefined;
	if (!row?.next) return null;
	const ms = Date.parse(row.next);
	return Number.isNaN(ms) ? null : ms;
}

export interface FiredReminder {
	id: string;
	subject: string | null;
	sender: string | null;
	sender_name: string | null;
	snippet: string | null;
	thread_id: string | null;
	/** Folder before firing. */
	from_folder_id: string;
	/** Folder after firing (Inbox when it moved back). */
	folder_id: string;
}

export interface FireRemindersResult {
	fired: FiredReminder[];
	/** Reminders dropped because the mail sits in Trash / Spam / Drafts or left the pile. */
	dropped: number;
	/** True when the batch was full and more may be due. */
	more: boolean;
}

/**
 * Fire every reminder due at `now` (caller wraps this in a transaction).
 * Returns what fired so the caller can broadcast and push.
 */
export function fireDueReplyLaterReminders(
	sql: SqlLike,
	now: number = Date.now(),
	batch: number = REPLY_LATER_REMINDER_BATCH,
): FireRemindersResult {
	const nowIso = new Date(now).toISOString();
	const rows = [
		...sql.exec(
			`SELECT id, subject, sender, sender_name, snippet, thread_id, folder_id, reply_later
			   FROM emails
			  WHERE reply_later_remind_at IS NOT NULL AND reply_later_remind_at <= ?1
			  ORDER BY reply_later_remind_at ASC
			  LIMIT ?2`,
			nowIso,
			batch,
		),
	] as Array<{
		id: string;
		subject: string | null;
		sender: string | null;
		sender_name: string | null;
		snippet: string | null;
		thread_id: string | null;
		folder_id: string;
		reply_later: number;
	}>;

	const fired: FiredReminder[] = [];
	let dropped = 0;
	for (const row of rows) {
		if (!row.reply_later || NEVER_FIRE_FOLDERS.includes(row.folder_id)) {
			sql.exec(`UPDATE emails SET reply_later_remind_at = NULL WHERE id = ?1`, row.id);
			dropped++;
			continue;
		}
		const folderId = STAY_PUT_FOLDERS.includes(row.folder_id) ? row.folder_id : Folders.INBOX;
		sql.exec(
			`UPDATE emails
			    SET read = 0,
			        folder_id = ?2,
			        reply_later_remind_at = NULL,
			        reply_later_reminded_at = ?3
			  WHERE id = ?1`,
			row.id,
			folderId,
			nowIso,
		);
		fired.push({
			id: row.id,
			subject: row.subject,
			sender: row.sender,
			sender_name: row.sender_name,
			snippet: row.snippet,
			thread_id: row.thread_id,
			from_folder_id: row.folder_id,
			folder_id: folderId,
		});
	}
	return { fired, dropped, more: rows.length >= batch };
}

/** Number of due mails (fired, unread, still in the pile) for the bottom-bar attention state. */
export function countDueReplyLater(sql: SqlLike): number {
	const row = [
		...sql.exec(
			`SELECT COUNT(*) AS total FROM emails
			  WHERE reply_later = 1
			    AND read = 0
			    AND reply_later_reminded_at IS NOT NULL
			    AND folder_id NOT IN ('${Folders.TRASH}', '${Folders.SPAM}', '${Folders.DRAFT}')`,
		),
	][0] as { total: number } | undefined;
	return row?.total ?? 0;
}

/** Push copy for a fired reminder (sender stays visible like inbound pushes). */
export function reminderPushCopy(r: Pick<FiredReminder, "subject" | "sender" | "sender_name">): {
	title: string;
	subtitle: string;
	body: string;
	fcmBody: string;
} {
	const who = (r.sender_name ?? "").trim() || (r.sender ?? "").trim() || "Someone";
	const subject = (r.subject ?? "").trim() || "(No subject)";
	return {
		title: "Reply Later reminder",
		subtitle: who,
		body: subject,
		fcmBody: `${who}\n${subject}`,
	};
}
