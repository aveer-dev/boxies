// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Pure helpers for the reader's Code card and Invite card (AVE-178). Contract:
 * `shared/mail-cards.ts`. Design twins: iOS `Models/MailCards.swift` (AVE-176)
 * and Android `models/MailCards.kt` (AVE-177). No React or DOM here, so it is
 * unit tested directly (workers/test/mail-cards-web.test.mjs).
 *
 * Invite data comes from the sender and is untrusted: links are only ever
 * http(s), text is never rendered as HTML, and everything put into a URL is
 * percent-encoded. Join is only ever an https link on a known meeting host
 * (AVE-216, `shared/meeting-links.ts`); any other location link stays text.
 */

import { Folders } from "../../shared/folders";
import { mailCardsAllowed, type EmailInvite } from "../../shared/mail-cards";
import { findMeetingUrl, knownMeetingUrl } from "../../shared/meeting-links";
import { emailAuthTier } from "./email-auth";
import type { Email } from "~/types";

// region Which card the reader shows

type CardEmail = Pick<Email, "id" | "folder_id" | "auth" | "auth_tier" | "otp" | "invite">;

export type ReaderCard =
	| { kind: "code"; code: string; emailId: string }
	| { kind: "invite"; invite: EmailInvite; emailId: string };

/**
 * Mirrors `mailCardsAllowed`: no card in Spam or for senders that failed
 * authentication. The Worker already omits the fields; this keeps a cached
 * message honest after it moves to Spam.
 */
export function cardAllowed(email: Pick<Email, "folder_id" | "auth" | "auth_tier">): boolean {
	return mailCardsAllowed({ folder_id: email.folder_id, auth_tier: emailAuthTier(email) });
}

/**
 * The card for a conversation: the newest message (`messages` newest first, as
 * the reader sorts them) that carries one. An invite wins over a code.
 */
export function readerCard(messages: readonly CardEmail[], draftIds?: ReadonlySet<string>): ReaderCard | null {
	for (const msg of messages) {
		if (msg.folder_id === Folders.DRAFT || draftIds?.has(msg.id) || !cardAllowed(msg)) continue;
		if (msg.invite && typeof msg.invite.start === "string") return { kind: "invite", invite: msg.invite, emailId: msg.id };
		const code = msg.otp?.code?.trim();
		if (code) return { kind: "code", code, emailId: msg.id };
	}
	return null;
}

// endregion

// region Location: a link to join, an address to get directions to, or nothing

export type InviteVenue = { kind: "link"; url: string } | { kind: "address"; address: string } | { kind: "none" };

/** An absolute http(s) URL with a host, normalized; anything else is null. */
export function safeHttpUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed || /\s/.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** The first http(s) link in free text ("Zoom: https://…"), without trailing punctuation. */
export function firstHttpLink(text: string | null | undefined): string | null {
	for (const match of (text ?? "").matchAll(/https?:\/\/[^\s<>"']+/gi)) {
		const url = safeHttpUrl(match[0].replace(/[.,;:)\]!?>]+$/, ""));
		if (url) return url;
	}
	return null;
}

const VIRTUAL_PLACES = new Set([
	"zoom", "google meet", "meet", "microsoft teams", "teams", "webex", "cisco webex", "facetime",
	"skype", "slack huddle", "whereby", "jitsi", "online", "virtual", "remote", "video", "phone", "tbd", "tba",
]);

/** A call platform's name ("Microsoft Teams Meeting") rather than a place. */
export function isVirtualPlaceName(text: string): boolean {
	const name = text.trim().toLowerCase().replace(/ (video call|meeting|call)$/, "");
	return VIRTUAL_PLACES.has(name);
}

export function inviteTitle(invite: EmailInvite): string {
	return invite.title?.trim() || "Untitled event";
}

/** LOCATION, unless it is only the meeting link again. */
export function displayLocation(invite: EmailInvite): string | null {
	const location = invite.location?.trim();
	if (!location || location === invite.meetingUrl?.trim()) return null;
	return location;
}

/**
 * The link to join: `meetingUrl`, else a link in the location, and only when it
 * is https on a known meeting host (AVE-216). A stranger's LOCATION link to any
 * other site is never a Join button, nor a link in the calendar entry.
 */
export function joinLink(invite: EmailInvite): string | null {
	return knownMeetingUrl(invite.meetingUrl) ?? knownMeetingUrl(findMeetingUrl(invite.location));
}

/**
 * Decides the primary action (AVE-176 review): Join for a known meeting link,
 * Directions for a physical address, nothing for no location, only a platform
 * name like "Zoom", or a link to another site. A link wins over an address.
 */
export function inviteVenue(invite: EmailInvite): InviteVenue {
	const url = joinLink(invite);
	if (url) return { kind: "link", url };
	const address = inviteAddress(invite);
	return address ? { kind: "address", address } : { kind: "none" };
}

/** The location when it is a place to get directions to: not a link, not a platform name. */
export function inviteAddress(invite: EmailInvite): string | null {
	const place = displayLocation(invite);
	return place && !firstHttpLink(place) && !isVirtualPlaceName(place) ? place : null;
}

export function directionsUrl(address: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
}

// endregion

// region Times

/**
 * One `start` / `end` value. Floating and all-day values are wall times: `date`
 * holds them as UTC fields and they are formatted in UTC, so they read the same
 * in every zone. Instants are formatted in the viewer's zone.
 */
export interface InviteMoment {
	date: Date;
	/** Wall time (floating or all-day), not an instant. */
	wall: boolean;
	dateOnly: boolean;
}

export function parseInviteTime(value: string | null | undefined): InviteMoment | null {
	const v = value?.trim() ?? "";
	let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
	if (m) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])), wall: true, dateOnly: true };
	m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(v);
	if (m) return { date: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))), wall: true, dateOnly: false };
	if (!/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(v)) return null;
	const date = new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
	return Number.isNaN(date.getTime()) ? null : { date, wall: false, dateOnly: false };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface InviteSpan {
	start: InviteMoment;
	/** Null when unknown or not after the start. */
	end: InviteMoment | null;
	allDay: boolean;
	/** All-day only: the inclusive last day (the end is exclusive). */
	lastDay: Date | null;
}

export function inviteSpan(invite: EmailInvite): InviteSpan | null {
	const start = parseInviteTime(invite.start);
	if (!start) return null;
	let end = parseInviteTime(invite.end);
	if (end && end.date.getTime() <= start.date.getTime()) end = null;
	const allDay = invite.allDay || start.dateOnly;
	if (!allDay) return { start, end, allDay, lastDay: null };
	// Nov 5 → Nov 6 is the single day Nov 5.
	const lastDay = end ? new Date(end.date.getTime() - DAY_MS) : start.date;
	return { start, end, allDay, lastDay };
}

export interface TimeFormatOptions {
	locale?: string;
	/** IANA zone for instants; the device's when unset. */
	timeZone?: string;
	now?: Date;
	hour12?: boolean;
}

function formatter(o: TimeFormatOptions, wall: boolean, opts: Intl.DateTimeFormatOptions) {
	return new Intl.DateTimeFormat(o.locale, { ...opts, timeZone: wall ? "UTC" : o.timeZone, hour12: opts.hour ? o.hour12 : undefined });
}

function yearOf(date: Date, wall: boolean, o: TimeFormatOptions): string {
	return formatter(o, wall, { year: "numeric" }).format(date);
}

/** Whether a date outside the current year needs its year shown. */
function needsYear(span: InviteSpan, o: TimeFormatOptions): boolean {
	const thisYear = yearOf(o.now ?? new Date(), false, o);
	const last = span.lastDay ?? span.end?.date ?? span.start.date;
	return yearOf(span.start.date, span.start.wall, o) !== thisYear || yearOf(last, span.start.wall, o) !== thisYear;
}

const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/** The collapsed line's time: "Nov 5 · 10:00 AM", or "Nov 5" for all-day. */
export function compactInviteTime(invite: EmailInvite, o: TimeFormatOptions = {}): string | null {
	const span = inviteSpan(invite);
	if (!span) return null;
	const { wall } = span.start;
	const day = formatter(o, wall, { month: "short", day: "numeric", year: needsYear(span, o) ? "numeric" : undefined }).format(span.start.date);
	return span.allDay ? day : `${day} · ${formatter(o, wall, TIME).format(span.start.date)}`;
}

/**
 * The details' time: "Thu, Nov 5 · 10:00 – 11:00 AM", "Thu, Nov 5 · All day",
 * "Thu, Nov 5 – Sat, Nov 7 · All day".
 */
export function inviteTimeSummary(invite: EmailInvite, o: TimeFormatOptions = {}): string | null {
	const span = inviteSpan(invite);
	if (!span) return null;
	const { wall } = span.start;
	const dayFmt = formatter(o, wall, { weekday: "short", month: "short", day: "numeric", year: needsYear(span, o) ? "numeric" : undefined });
	const timeFmt = formatter(o, wall, TIME);
	const start = span.start.date;
	if (span.allDay) {
		const first = dayFmt.format(start);
		const last = span.lastDay ? dayFmt.format(span.lastDay) : first;
		return `${last === first ? first : `${first} – ${last}`} · All day`;
	}
	const end = span.end?.date;
	if (!end) return `${dayFmt.format(start)} · ${timeFmt.format(start)}`;
	if (dayFmt.format(end) === dayFmt.format(start)) return `${dayFmt.format(start)} · ${timeFmt.formatRange(start, end)}`;
	return `${dayFmt.format(start)}, ${timeFmt.format(start)} – ${dayFmt.format(end)}, ${timeFmt.format(end)}`;
}

// endregion

// region Repeat rules

const FREQUENCIES = { DAILY: ["daily", "days"], WEEKLY: ["weekly", "weeks"], MONTHLY: ["monthly", "months"], YEARLY: ["yearly", "years"] } as const;
const WEEKDAYS = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

/**
 * The canonical RRULE for the simple shapes a calendar can take as-is: FREQ
 * with optional INTERVAL, COUNT or UNTIL, and plain BYDAY weekdays on a weekly
 * rule. Anything else (BYMONTHDAY, BYSETPOS, "2TU", …) is null, so the event
 * is added without a repeat rule rather than with a wrong one.
 */
export function simpleRecurrence(rrule: string | null | undefined): { rule: string; frequency: keyof typeof FREQUENCIES; interval: number } | null {
	const raw = rrule?.trim().replace(/^RRULE:/i, "");
	if (!raw) return null;
	const parts = new Map<string, string>();
	for (const piece of raw.split(";")) {
		if (!piece) continue;
		const [key, value, extra] = piece.split("=");
		if (value === undefined || extra !== undefined) return null;
		parts.set(key.trim().toUpperCase(), value.trim().toUpperCase());
	}
	const frequency = parts.get("FREQ") as keyof typeof FREQUENCIES | undefined;
	if (!frequency || !(frequency in FREQUENCIES)) return null;
	const positive = (v: string | undefined) => (v === undefined ? undefined : /^[1-9]\d{0,3}$/.test(v) ? Number(v) : NaN);
	const interval = positive(parts.get("INTERVAL")) ?? 1;
	const count = positive(parts.get("COUNT"));
	const until = parts.get("UNTIL");
	const byday = parts.get("BYDAY")?.split(",");
	for (const key of parts.keys()) if (!["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"].includes(key)) return null;
	if (Number.isNaN(interval) || Number.isNaN(count)) return null;
	if (until !== undefined && !/^\d{8}(T\d{6}Z?)?$/.test(until)) return null;
	if (count !== undefined && until !== undefined) return null;
	if (byday && (frequency !== "WEEKLY" || !byday.every((d) => WEEKDAYS.has(d)))) return null;
	const rule = [`FREQ=${frequency}`];
	if (interval !== 1) rule.push(`INTERVAL=${interval}`);
	if (count !== undefined) rule.push(`COUNT=${count}`);
	if (until !== undefined) rule.push(`UNTIL=${until}`);
	if (byday) rule.push(`BYDAY=${byday.join(",")}`);
	return { rule: rule.join(";"), frequency, interval };
}

/** "Repeats weekly", "Repeats every 2 weeks"; "Repeats" for a rule we don't map. */
export function recurrenceLabel(rrule: string | null | undefined): string | null {
	if (!rrule?.trim()) return null;
	const simple = simpleRecurrence(rrule);
	if (!simple) return "Repeats";
	const [single, plural] = FREQUENCIES[simple.frequency];
	return simple.interval === 1 ? `Repeats ${single}` : `Repeats every ${simple.interval} ${plural}`;
}

// endregion

// region Add to calendar

/** Notes for the calendar entry: "Join: <link>" ahead of the description. */
export function calendarNotes(invite: EmailInvite): string | null {
	const link = joinLink(invite);
	const notes = invite.description?.trim() || null;
	if (!link) return notes;
	if (!notes) return `Join: ${link}`;
	return notes.includes(link) ? notes : `Join: ${link}\n\n${notes}`;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const hms = (d: Date) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

/**
 * Start and end in iCalendar basic form, as both Google Calendar and .ics take
 * them: all-day "20261105" / exclusive "20261106", instants "…T150000Z",
 * floating "…T150000" (no zone). A timed event without an end lasts an hour.
 */
export function calendarDates(invite: EmailInvite): { start: string; end: string; allDay: boolean } | null {
	const span = inviteSpan(invite);
	if (!span) return null;
	if (span.allDay) {
		const last = span.lastDay ?? span.start.date;
		return { start: ymd(span.start.date), end: ymd(new Date(last.getTime() + DAY_MS)), allDay: true };
	}
	const stamp = (d: Date) => `${ymd(d)}T${hms(d)}${span.start.wall ? "" : "Z"}`;
	const end = span.end?.date ?? new Date(span.start.date.getTime() + HOUR_MS);
	return { start: stamp(span.start.date), end: stamp(end), allDay: false };
}

/** Google Calendar's prefilled "create event" page. Null for a cancelled or unreadable invite. */
export function googleCalendarUrl(invite: EmailInvite): string | null {
	if (invite.cancelled) return null;
	const dates = calendarDates(invite);
	if (!dates) return null;
	const params: [string, string | null][] = [
		["text", inviteTitle(invite)],
		["dates", `${dates.start}/${dates.end}`],
		// Long descriptions would push the URL past what browsers and Google accept.
		["details", calendarNotes(invite)?.slice(0, 1500) ?? null],
		["location", displayLocation(invite) ?? joinLink(invite)],
		["recur", simpleRecurrence(invite.recurrence) ? `RRULE:${simpleRecurrence(invite.recurrence)!.rule}` : null],
	];
	const query = params
		.filter((p): p is [string, string] => !!p[1])
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join("&");
	return `https://calendar.google.com/calendar/render?action=TEMPLATE&${query}`;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeIcsText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r\n|\r|\n/g, "\\n")
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
	const encoder = new TextEncoder();
	const out: string[] = [];
	let current = "";
	let bytes = 0;
	for (const ch of line) {
		const size = encoder.encode(ch).length;
		const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
		if (bytes + size > limit) {
			out.push(current);
			current = "";
			bytes = 0;
		}
		current += ch;
		bytes += size;
	}
	out.push(current);
	return out.join("\r\n ");
}

/**
 * A minimal VCALENDAR with one VEVENT for the invite, to open in any calendar
 * app. Null for a cancelled or unreadable invite.
 */
export function buildIcs(invite: EmailInvite, now: Date = new Date()): string | null {
	if (invite.cancelled) return null;
	const dates = calendarDates(invite);
	if (!dates) return null;
	const uid = invite.uid?.replace(/[^\x21-\x7e]/g, "") || `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2)}@inboxies`;
	const valueDate = dates.allDay ? ";VALUE=DATE" : "";
	const location = displayLocation(invite) ?? joinLink(invite);
	const notes = calendarNotes(invite);
	const link = joinLink(invite);
	const rule = simpleRecurrence(invite.recurrence)?.rule;
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Inboxies//Web reader//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		`UID:${escapeIcsText(uid)}`,
		`DTSTAMP:${ymd(now)}T${hms(now)}Z`,
		`DTSTART${valueDate}:${dates.start}`,
		`DTEND${valueDate}:${dates.end}`,
		`SUMMARY:${escapeIcsText(inviteTitle(invite))}`,
		location ? `LOCATION:${escapeIcsText(location)}` : null,
		notes ? `DESCRIPTION:${escapeIcsText(notes)}` : null,
		link ? `URL:${link}` : null,
		rule ? `RRULE:${rule}` : null,
		"END:VEVENT",
		"END:VCALENDAR",
	];
	return `${lines.filter((l): l is string => l !== null).map(foldIcsLine).join("\r\n")}\r\n`;
}

/** "Team sync.ics" from the title; safe on every file system. */
export function icsFilename(invite: EmailInvite): string {
	const base = inviteTitle(invite)
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 60)
		.replace(/^\.+/, "");
	return `${base || "event"}.ics`;
}

// endregion
