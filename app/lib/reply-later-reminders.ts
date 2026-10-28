// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reply Later reminder presets and labels (AVE-86). Twins: iOS
 * `ReplyLaterReminder`, Android `ReplyLaterReminders`. Presets use the
 * device's local time; the server stores the result as UTC ISO.
 */

export type ReminderPresetId = "later_today" | "tomorrow" | "next_week";

export interface ReminderPreset {
	id: ReminderPresetId;
	label: string;
	at: Date;
}

/** Now + 3h, seconds zeroed, minutes rounded up to a multiple of 5. */
export function laterToday(now: Date): Date {
	const d = new Date(now.getTime() + 3 * 60 * 60 * 1000);
	d.setSeconds(0, 0);
	const rem = d.getMinutes() % 5;
	if (rem !== 0) d.setMinutes(d.getMinutes() + (5 - rem));
	return d;
}

/** Tomorrow at 09:00 local. */
export function tomorrowMorning(now: Date): Date {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
	return d;
}

/** The next Monday strictly after today, 09:00 local. */
export function nextWeekMorning(now: Date): Date {
	const day = now.getDay(); // 0 = Sunday … 1 = Monday
	const ahead = ((1 - day + 7) % 7) || 7;
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, 9, 0, 0, 0);
}

export function reminderPresets(now: Date = new Date()): ReminderPreset[] {
	return [
		{ id: "later_today", label: "Later today", at: laterToday(now) },
		{ id: "tomorrow", label: "Tomorrow", at: tomorrowMorning(now) },
		{ id: "next_week", label: "Next week", at: nextWeekMorning(now) },
	];
}

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayDiff(a: Date, b: Date): number {
	return Math.round((startOfDay(a) - startOfDay(b)) / 86_400_000);
}

const time = (d: Date, locale?: string) =>
	d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

/** Trailing time on a picker row: "8:25 PM" today, "Thu 9:00 AM" this week, "Nov 9, 9:00 AM" later. */
export function formatPresetTime(at: Date, now: Date = new Date(), locale?: string): string {
	const diff = dayDiff(at, now);
	if (diff === 0) return time(at, locale);
	if (diff > 0 && diff < 7) return `${at.toLocaleDateString(locale, { weekday: "short" })} ${time(at, locale)}`;
	return `${at.toLocaleDateString(locale, { month: "short", day: "numeric" })}, ${time(at, locale)}`;
}

/** Row chip: "Today 4:00 PM", "Tomorrow 9:00 AM", "Mon 9:00 AM", "Nov 9, 9:00 AM". */
export function formatReminderShort(at: Date, now: Date = new Date(), locale?: string): string {
	const diff = dayDiff(at, now);
	if (diff === 0) return `Today ${time(at, locale)}`;
	if (diff === 1) return `Tomorrow ${time(at, locale)}`;
	return formatPresetTime(at, now, locale);
}

/** Toast / header: "Thu, 9:00 AM" (adds the date beyond a week). */
export function formatReminderLong(at: Date, now: Date = new Date(), locale?: string): string {
	const diff = dayDiff(at, now);
	if (diff === 0) return `today, ${time(at, locale)}`;
	if (diff === 1) return `tomorrow, ${time(at, locale)}`;
	if (diff > 0 && diff < 7) return `${at.toLocaleDateString(locale, { weekday: "short" })}, ${time(at, locale)}`;
	return `${at.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" })}, ${time(at, locale)}`;
}

/** `<input type="datetime-local">` value for a Date, in local time. */
export function toDateTimeLocalValue(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a `datetime-local` value as local time; null when empty or invalid. */
export function fromDateTimeLocalValue(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
	return Number.isNaN(d.getTime()) ? null : d;
}

type ReminderFields = {
	reply_later?: boolean;
	read?: boolean;
	reply_later_remind_at?: string | null;
	reply_later_reminded_at?: string | null;
};

/** A pending reminder time, or null. */
export function pendingReminder(email: ReminderFields): Date | null {
	if (!email.reply_later || !email.reply_later_remind_at) return null;
	const d = new Date(email.reply_later_remind_at);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** In Reply Later, reminder fired, still unread. */
export function isReplyLaterDue(email: ReminderFields): boolean {
	return Boolean(email.reply_later && email.reply_later_reminded_at && !email.read);
}
