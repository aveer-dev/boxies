// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Calendar invites (AVE-175): parse the VEVENT of a real `text/calendar`
 * MIME part or `.ics` attachment into the reader's `invite` card
 * (shared/mail-cards.ts EmailInvite). Free text is never parsed.
 *
 * Handles RFC 5545 line folding, TEXT escapes, quoted parameters, UTC "Z"
 * times, DATE-only (all-day) values, DURATION, and TZID resolved as an IANA
 * zone, a VTIMEZONE in the same file, or a common Windows zone name
 * (Outlook / Exchange).
 */

import type { EmailInvite, EmailInviteOrganizer } from "../../shared/mail-cards.ts";
import { normalizeEmailAddress } from "./mail-automations.ts";
import { isFreeMailDomain, senderRegistrableDomain } from "./sender-rules.ts";

/** Calendars larger than this are not parsed (real invites are a few KB). */
const MAX_ICS_BYTES = 256 * 1024;
const MAX_DESCRIPTION = 2000;
const MAX_TEXT = 500;

export interface CalendarAttachmentLike {
	filename?: string | null;
	mimeType?: string | null;
	/** postal-mime sets this from the Content-Type `method=` parameter. */
	method?: string | null;
	content?: ArrayBuffer | Uint8Array | string | null;
}

interface IcsProperty {
	name: string;
	params: Record<string, string>;
	value: string;
}

interface IcsComponent {
	type: string;
	props: IcsProperty[];
	children: IcsComponent[];
}

// ── Lexing ───────────────────────────────────────────────────────

function unfold(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function parseLine(line: string): IcsProperty | null {
	// The value starts at the first ":" outside a quoted parameter value.
	let inQuotes = false;
	let colon = -1;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') inQuotes = !inQuotes;
		else if (ch === ":" && !inQuotes) {
			colon = i;
			break;
		}
	}
	if (colon <= 0) return null;
	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const parts: string[] = [];
	let current = "";
	inQuotes = false;
	for (const ch of head) {
		if (ch === '"') inQuotes = !inQuotes;
		if (ch === ";" && !inQuotes) {
			parts.push(current);
			current = "";
		} else current += ch;
	}
	parts.push(current);
	const name = (parts.shift() ?? "").trim().toUpperCase();
	if (!name) return null;
	const params: Record<string, string> = {};
	for (const part of parts) {
		const eq = part.indexOf("=");
		if (eq <= 0) continue;
		const key = part.slice(0, eq).trim().toUpperCase();
		let paramValue = part.slice(eq + 1).trim();
		if (paramValue.startsWith('"') && paramValue.endsWith('"') && paramValue.length >= 2) {
			paramValue = paramValue.slice(1, -1);
		}
		params[key] = paramValue;
	}
	return { name, params, value };
}

function parseComponents(text: string): IcsComponent[] {
	const roots: IcsComponent[] = [];
	const stack: IcsComponent[] = [];
	for (const raw of unfold(text).split("\n")) {
		if (!raw.trim()) continue;
		const prop = parseLine(raw);
		if (!prop) continue;
		if (prop.name === "BEGIN") {
			const component: IcsComponent = { type: prop.value.trim().toUpperCase(), props: [], children: [] };
			const parent = stack[stack.length - 1];
			if (parent) parent.children.push(component);
			else roots.push(component);
			stack.push(component);
			if (stack.length > 8) return roots; // malformed nesting
		} else if (prop.name === "END") {
			stack.pop();
		} else {
			stack[stack.length - 1]?.props.push(prop);
		}
	}
	return roots;
}

function prop(component: IcsComponent, name: string): IcsProperty | undefined {
	return component.props.find((p) => p.name === name);
}

/** RFC 5545 §3.3.11 TEXT unescape. */
export function unescapeIcsText(value: string): string {
	return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === "n" || ch === "N" ? "\n" : ch));
}

function textValue(component: IcsComponent, name: string, max = MAX_TEXT): string | null {
	const p = prop(component, name);
	if (!p) return null;
	const text = unescapeIcsText(p.value).trim();
	if (!text) return null;
	return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// ── Time zones ───────────────────────────────────────────────────

/**
 * Windows zone names Outlook / Exchange put in TZID, mapped to IANA (from the
 * CLDR windowsZones table, territory 001). Covers the common zones; anything
 * else falls back to the file's VTIMEZONE.
 */
const WINDOWS_ZONES: Record<string, string> = {
	"dateline standard time": "Etc/GMT+12",
	"hawaiian standard time": "Pacific/Honolulu",
	"alaskan standard time": "America/Anchorage",
	"pacific standard time": "America/Los_Angeles",
	"us mountain standard time": "America/Phoenix",
	"mountain standard time": "America/Denver",
	"central standard time": "America/Chicago",
	"central america standard time": "America/Guatemala",
	"canada central standard time": "America/Regina",
	"central standard time (mexico)": "America/Mexico_City",
	"eastern standard time": "America/New_York",
	"us eastern standard time": "America/Indiana/Indianapolis",
	"atlantic standard time": "America/Halifax",
	"newfoundland standard time": "America/St_Johns",
	"e. south america standard time": "America/Sao_Paulo",
	"sa pacific standard time": "America/Bogota",
	"argentina standard time": "America/Buenos_Aires",
	"utc": "UTC",
	"coordinated universal time": "UTC",
	"gmt standard time": "Europe/London",
	"greenwich standard time": "Atlantic/Reykjavik",
	"w. europe standard time": "Europe/Berlin",
	"romance standard time": "Europe/Paris",
	"central europe standard time": "Europe/Budapest",
	"central european standard time": "Europe/Warsaw",
	"w. central africa standard time": "Africa/Lagos",
	"gtb standard time": "Europe/Bucharest",
	"e. europe standard time": "Europe/Chisinau",
	"fle standard time": "Europe/Kiev",
	"south africa standard time": "Africa/Johannesburg",
	"egypt standard time": "Africa/Cairo",
	"israel standard time": "Asia/Jerusalem",
	"turkey standard time": "Europe/Istanbul",
	"russian standard time": "Europe/Moscow",
	"e. africa standard time": "Africa/Nairobi",
	"arabian standard time": "Asia/Dubai",
	"arab standard time": "Asia/Riyadh",
	"iran standard time": "Asia/Tehran",
	"pakistan standard time": "Asia/Karachi",
	"india standard time": "Asia/Kolkata",
	"nepal standard time": "Asia/Kathmandu",
	"bangladesh standard time": "Asia/Dhaka",
	"se asia standard time": "Asia/Bangkok",
	"china standard time": "Asia/Shanghai",
	"singapore standard time": "Asia/Singapore",
	"taipei standard time": "Asia/Taipei",
	"w. australia standard time": "Australia/Perth",
	"tokyo standard time": "Asia/Tokyo",
	"korea standard time": "Asia/Seoul",
	"cen. australia standard time": "Australia/Adelaide",
	"aus eastern standard time": "Australia/Sydney",
	"e. australia standard time": "Australia/Brisbane",
	"new zealand standard time": "Pacific/Auckland",
};

const zoneValidity = new Map<string, boolean>();

function isIanaZone(zone: string): boolean {
	const cached = zoneValidity.get(zone);
	if (cached !== undefined) return cached;
	let ok = false;
	if (/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(zone)) {
		try {
			new Intl.DateTimeFormat("en-US", { timeZone: zone });
			ok = true;
		} catch {
			ok = false;
		}
	}
	zoneValidity.set(zone, ok);
	return ok;
}

/** Name a TZID as an IANA zone, or null. */
export function ianaZoneFor(tzid: string | null | undefined): string | null {
	if (!tzid) return null;
	let id = tzid.trim().replace(/^"|"$/g, "");
	// Some producers prefix a path ("/mozilla.org/20050126_1/America/New_York").
	if (id.startsWith("/")) {
		const segments = id.split("/").filter(Boolean);
		for (let i = 0; i < segments.length; i++) {
			const candidate = segments.slice(i).join("/");
			if (candidate.includes("/") && isIanaZone(candidate)) return candidate;
		}
		id = segments[segments.length - 1] ?? id;
	}
	const upper = id.toUpperCase();
	if (upper === "UTC" || upper === "GMT" || upper === "Z" || upper === "ETC/UTC") return "UTC";
	const windows = WINDOWS_ZONES[id.toLowerCase()];
	if (windows) return windows;
	if (id.includes("/") && isIanaZone(id)) return id;
	return null;
}

interface WallTime {
	year: number;
	month: number; // 1-12
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function wallToEpoch(w: WallTime): number {
	return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Offset (ms) of `zone` at instant `epoch`: local wall time minus UTC. */
function zoneOffsetAt(zone: string, epoch: number): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(epoch));
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
	return local - Math.floor(epoch / 1000) * 1000;
}

function wallInIanaToEpoch(w: WallTime, zone: string): number {
	const guess = wallToEpoch(w);
	let epoch = guess - zoneOffsetAt(zone, guess);
	// Second pass settles instants near a DST transition.
	epoch = guess - zoneOffsetAt(zone, epoch);
	return epoch;
}

/** "+0530" / "-0800" → ms. */
function parseUtcOffset(value: string | undefined): number | null {
	const m = value?.trim().match(/^([+-])(\d{2})(\d{2})(\d{2})?$/);
	if (!m) return null;
	const sign = m[1] === "-" ? -1 : 1;
	return sign * ((Number(m[2]) * 60 + Number(m[3])) * 60 + Number(m[4] ?? 0)) * 1000;
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Day of month for "2SU" / "-1SU" in a given month. */
function nthWeekday(year: number, month: number, spec: string): number | null {
	const m = spec.match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/);
	if (!m) return null;
	const n = m[1] ? Number(m[1]) : 1;
	const weekday = WEEKDAYS[m[2]];
	if (n > 0) {
		const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
		return 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
	}
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
	return lastDay - ((lastDow - weekday + 7) % 7) + (n + 1) * 7;
}

/**
 * Offset from a VTIMEZONE at a local wall time: the most recent STANDARD /
 * DAYLIGHT onset (DTSTART, repeated yearly by its RRULE BYMONTH/BYDAY) wins.
 */
function vtimezoneOffset(vtz: IcsComponent, w: WallTime): number | null {
	const local = wallToEpoch(w);
	let best: { at: number; offset: number } | null = null;
	let earliest: { at: number; offsetFrom: number } | null = null;
	for (const obs of vtz.children) {
		if (obs.type !== "STANDARD" && obs.type !== "DAYLIGHT") continue;
		const offset = parseUtcOffset(prop(obs, "TZOFFSETTO")?.value);
		const offsetFrom = parseUtcOffset(prop(obs, "TZOFFSETFROM")?.value);
		const start = parseDateTimeValue(prop(obs, "DTSTART")?.value ?? "");
		if (offset == null || !start || start.date) continue;
		const rrule = prop(obs, "RRULE")?.value ?? "";
		const rule = Object.fromEntries(
			rrule.split(";").map((part) => part.split("=") as [string, string]).filter((kv) => kv.length === 2),
		) as Record<string, string>;
		const onsets: number[] = [];
		if (rule.FREQ === "YEARLY" && rule.BYMONTH && rule.BYDAY) {
			const month = Number(rule.BYMONTH);
			for (const year of [w.year - 1, w.year]) {
				if (year < start.wall.year) continue;
				const day = nthWeekday(year, month, rule.BYDAY.split(",")[0]);
				if (day == null) continue;
				onsets.push(wallToEpoch({ ...start.wall, year, month, day }));
			}
		} else {
			onsets.push(wallToEpoch(start.wall));
		}
		for (const at of onsets) {
			if (at <= local && (!best || at > best.at)) best = { at, offset };
			if (!earliest || at < earliest.at) earliest = { at, offsetFrom: offsetFrom ?? offset };
		}
	}
	if (best) return best.offset;
	return earliest ? earliest.offsetFrom : null;
}

// ── Values ───────────────────────────────────────────────────────

interface ParsedDateTime {
	date: boolean;
	utc: boolean;
	wall: WallTime;
}

function parseDateTimeValue(value: string): ParsedDateTime | null {
	const v = value.trim();
	const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
	if (dateOnly) {
		return {
			date: true,
			utc: false,
			wall: { year: +dateOnly[1], month: +dateOnly[2], day: +dateOnly[3], hour: 0, minute: 0, second: 0 },
		};
	}
	const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i);
	if (!dt) return null;
	return {
		date: false,
		utc: Boolean(dt[7]),
		wall: { year: +dt[1], month: +dt[2], day: +dt[3], hour: +dt[4], minute: +dt[5], second: +(dt[6] ?? 0) },
	};
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function isoDate(w: WallTime): string {
	return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

function isoFloating(w: WallTime): string {
	return `${isoDate(w)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
}

function validWall(w: WallTime): boolean {
	return (
		w.month >= 1 && w.month <= 12 && w.day >= 1 && w.day <= 31 &&
		w.hour <= 24 && w.minute <= 59 && w.second <= 60
	);
}

interface ResolvedTime {
	iso: string;
	allDay: boolean;
	/** Epoch ms for timed values with a zone; local-epoch for floating / dates. */
	epoch: number;
	zoned: boolean;
	timezone: string | null;
}

function resolveTime(p: IcsProperty | undefined, timezones: Map<string, IcsComponent>): ResolvedTime | null {
	if (!p) return null;
	const parsed = parseDateTimeValue(p.value);
	if (!parsed || !validWall(parsed.wall)) return null;
	if (parsed.date || p.params.VALUE?.toUpperCase() === "DATE") {
		return { iso: isoDate(parsed.wall), allDay: true, epoch: wallToEpoch(parsed.wall), zoned: false, timezone: null };
	}
	if (parsed.utc) {
		const epoch = wallToEpoch(parsed.wall);
		return { iso: new Date(epoch).toISOString(), allDay: false, epoch, zoned: true, timezone: "UTC" };
	}
	const tzid = p.params.TZID;
	if (tzid) {
		const iana = ianaZoneFor(tzid);
		const vtz = timezones.get(tzid);
		let epoch: number | null = null;
		// A VTIMEZONE in the file is what the organizer's client meant; Intl
		// covers IANA ids and known Windows names when it's missing.
		if (vtz) {
			const offset = vtimezoneOffset(vtz, parsed.wall);
			if (offset != null) epoch = wallToEpoch(parsed.wall) - offset;
		}
		if (epoch == null && iana) epoch = wallInIanaToEpoch(parsed.wall, iana);
		if (epoch != null) {
			return { iso: new Date(epoch).toISOString(), allDay: false, epoch, zoned: true, timezone: iana };
		}
	}
	return { iso: isoFloating(parsed.wall), allDay: false, epoch: wallToEpoch(parsed.wall), zoned: false, timezone: null };
}

/** RFC 5545 DURATION ("PT1H30M", "P1D", "P2W") → ms; null when malformed. */
export function parseIcsDuration(value: string | undefined): number | null {
	const m = value?.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
	if (!m || value!.trim().toUpperCase().replace(/^[+-]/, "") === "P") return null;
	const sign = m[1] === "-" ? -1 : 1;
	const [w, d, h, min, s] = [m[2], m[3], m[4], m[5], m[6]].map((x) => Number(x ?? 0));
	return sign * ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
}

function shiftedIso(start: ResolvedTime, ms: number): string {
	const epoch = start.epoch + ms;
	if (start.allDay) return new Date(epoch).toISOString().slice(0, 10);
	if (start.zoned) return new Date(epoch).toISOString();
	return new Date(epoch).toISOString().slice(0, 19);
}

function organizerOf(component: IcsComponent): EmailInviteOrganizer | null {
	const p = prop(component, "ORGANIZER");
	if (!p) return null;
	const raw = p.value.trim();
	const email = /^mailto:/i.test(raw) ? raw.replace(/^mailto:/i, "").trim().toLowerCase() || null : null;
	const cn = p.params.CN ? unescapeIcsText(p.params.CN).trim() : "";
	const name = cn && cn.toLowerCase() !== email ? cn : null;
	if (!email && !name) return null;
	return { email, name };
}

const MEETING_HOSTS = [
	/^meet\.google\.com$/,
	/(^|\.)zoom\.us$/,
	/(^|\.)zoomgov\.com$/,
	/^teams\.microsoft\.com$/,
	/^teams\.live\.com$/,
	/(^|\.)webex\.com$/,
	/^meet\.jit\.si$/,
	/^whereby\.com$/,
	/^facetime\.apple\.com$/,
	/^chime\.aws$/,
	/(^|\.)gotomeeting\.com$/,
	/^meet\.goto\.com$/,
	/^app\.slack\.com$/,
];

const URL_PATTERN = /https:\/\/[^\s<>"'\\)\]]+/gi;

/** First https link on a known video-meeting host in `text`. */
export function findMeetingUrl(text: string | null | undefined): string | null {
	if (!text) return null;
	for (const match of text.matchAll(URL_PATTERN)) {
		const candidate = match[0].replace(/[.,;:!?]+$/, "");
		let host: string;
		try {
			host = new URL(candidate).hostname.toLowerCase();
		} catch {
			continue;
		}
		if (MEETING_HOSTS.some((re) => re.test(host))) return candidate;
	}
	return null;
}

function meetingUrlOf(event: IcsComponent): string | null {
	const sources = [
		"X-GOOGLE-CONFERENCE",
		"X-MICROSOFT-SKYPETEAMSMEETINGURL",
		"X-MICROSOFT-ONLINEMEETINGCONFLINK",
		"X-MICROSOFT-ONLINEMEETINGEXTERNALLINK",
		"CONFERENCE",
		"URL",
		"LOCATION",
		"DESCRIPTION",
		"X-ALT-DESC",
	];
	for (const name of sources) {
		for (const p of event.props) {
			if (p.name !== name) continue;
			const url = findMeetingUrl(unescapeIcsText(p.value));
			if (url) return url;
		}
	}
	return null;
}

// ── Entry points ─────────────────────────────────────────────────

/**
 * Parse an iCalendar text into the reader's invite card. `methodHint` is the
 * MIME `method=` parameter, used when the VCALENDAR has no METHOD. Returns
 * null when there is no VEVENT with a usable DTSTART.
 */
export function parseCalendarInvite(ics: string, methodHint?: string | null): EmailInvite | null {
	if (!ics || ics.length > MAX_ICS_BYTES) return null;
	const roots = parseComponents(ics);
	const calendar = roots.find((c) => c.type === "VCALENDAR");
	if (!calendar) return null;
	const events = calendar.children.filter((c) => c.type === "VEVENT");
	// The master event, not a single-occurrence override (RECURRENCE-ID).
	const event = events.find((e) => !prop(e, "RECURRENCE-ID")) ?? events[0];
	if (!event) return null;

	const timezones = new Map<string, IcsComponent>();
	for (const child of calendar.children) {
		if (child.type !== "VTIMEZONE") continue;
		const id = prop(child, "TZID")?.value.trim();
		if (id) timezones.set(id, child);
	}

	const start = resolveTime(prop(event, "DTSTART"), timezones);
	if (!start) return null;
	const end = resolveTime(prop(event, "DTEND"), timezones);
	let endIso: string | null = end && end.allDay === start.allDay ? end.iso : null;
	if (!endIso) {
		const duration = parseIcsDuration(prop(event, "DURATION")?.value);
		if (duration != null) endIso = shiftedIso(start, duration);
		else if (start.allDay) endIso = shiftedIso(start, 24 * 60 * 60 * 1000);
	}

	const method = (prop(calendar, "METHOD")?.value || methodHint || "").trim().toUpperCase() || null;
	const status = prop(event, "STATUS")?.value.trim().toUpperCase() || null;
	const sequenceRaw = prop(event, "SEQUENCE")?.value.trim();
	const sequence = sequenceRaw && /^\d+$/.test(sequenceRaw) ? Number(sequenceRaw) : null;

	return {
		method,
		status,
		cancelled: method === "CANCEL" || status === "CANCELLED",
		uid: prop(event, "UID")?.value.trim() || null,
		sequence,
		title: textValue(event, "SUMMARY"),
		start: start.iso,
		end: endIso,
		allDay: start.allDay,
		timezone: start.allDay ? null : start.timezone,
		location: textValue(event, "LOCATION"),
		organizer: organizerOf(event),
		meetingUrl: meetingUrlOf(event),
		recurrence: prop(event, "RRULE")?.value.trim() || null,
		description: textValue(event, "DESCRIPTION", MAX_DESCRIPTION),
	};
}

function isCalendarAttachment(att: CalendarAttachmentLike): boolean {
	const type = (att.mimeType ?? "").toLowerCase().split(";")[0].trim();
	if (type === "text/calendar" || type === "application/ics" || type === "text/x-vcalendar") return true;
	return /\.(ics|ical|ifb|icalendar)$/i.test((att.filename ?? "").trim());
}

function decodeContent(content: CalendarAttachmentLike["content"]): string | null {
	if (content == null) return null;
	if (typeof content === "string") return content;
	const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
	if (bytes.byteLength > MAX_ICS_BYTES) return null;
	return new TextDecoder("utf-8").decode(bytes);
}

/**
 * The invite card for a parsed message: the first `text/calendar` part or
 * `.ics` attachment that holds a VEVENT. postal-mime surfaces inline
 * calendar alternatives as attachments too.
 */
export function inviteFromAttachments(
	attachments: readonly CalendarAttachmentLike[] | null | undefined,
): EmailInvite | null {
	for (const att of attachments ?? []) {
		if (!isCalendarAttachment(att)) continue;
		const text = decodeContent(att.content);
		if (!text) continue;
		try {
			const invite = parseCalendarInvite(text, att.method);
			if (invite) return invite;
		} catch (e) {
			console.warn("Calendar invite parse failed:", (e as Error).message);
		}
	}
	return null;
}

/**
 * AVE-220: may the invite's ORGANIZER be presented as who sent it? ORGANIZER
 * is free text in the .ics, so a stranger can name anyone.
 * - Same address as the From: yes; it shows nothing the header doesn't.
 * - Same registrable domain (subdomains included): only when the From
 *   authenticated (auth tier "verified"), and never on a shared free-mail
 *   domain, where one gmail.com user can't vouch for another.
 * - Anything else, a failed sender, or no organizer address: no.
 */
export function organizerMatchesSender(
	organizer: EmailInviteOrganizer | null | undefined,
	sender: string | null | undefined,
	authTier: string | null | undefined,
): boolean {
	const org = normalizeEmailAddress(organizer?.email);
	const from = normalizeEmailAddress(sender);
	if (!org || !from || authTier === "failed") return false;
	if (org === from) return true;
	if (authTier !== "verified") return false;
	const domain = senderRegistrableDomain(org);
	return domain != null && domain === senderRegistrableDomain(from) && !isFreeMailDomain(domain);
}

/** Stored JSON → invite; null for missing or corrupt values. */
export function decodeStoredInvite(raw: unknown): EmailInvite | null {
	if (typeof raw !== "string" || !raw) return null;
	try {
		const value = JSON.parse(raw) as EmailInvite;
		return value && typeof value === "object" && typeof value.start === "string" ? value : null;
	} catch {
		return null;
	}
}
