// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reader cards for one-time codes and calendar invites (AVE-174 / AVE-175).
 *
 * The Worker detects both when mail arrives (workers/lib/one-time-code.ts,
 * workers/lib/calendar-invite.ts) and returns them on the single-email and
 * thread reader payloads as `otp` and `invite`. Both are optional: absent or
 * null means "no card". List payloads never carry them.
 */

import { Folders } from "./folders.ts";

/** A one-time / verification code found in the message. */
export interface EmailOtp {
	/**
	 * The code to copy, exactly as it should be typed: 4–8 digits, or a short
	 * upper-case alphanumeric token. Separators in "482 913" / "482-913" are
	 * removed ("482913").
	 */
	code: string;
}

export interface EmailInviteOrganizer {
	/** Lower-cased address from `ORGANIZER:mailto:…`; null when it is not an email. */
	email: string | null;
	/** `CN=` display name; null when absent. */
	name: string | null;
}

/**
 * A calendar event parsed from a real `text/calendar` MIME part or `.ics`
 * attachment. Free-text "let's meet Tuesday" is never an invite.
 */
export interface EmailInvite {
	/**
	 * iTIP method, upper-case: "REQUEST" (an invite or update), "CANCEL" (the
	 * organizer cancelled it), "PUBLISH", "REPLY" (an attendee's answer),
	 * "COUNTER", … Null when the calendar has no METHOD.
	 */
	method: string | null;
	/** VEVENT STATUS: "CONFIRMED" | "TENTATIVE" | "CANCELLED", or null. */
	status: string | null;
	/** True when METHOD is CANCEL or STATUS is CANCELLED. Clients show "Cancelled" and hide "Add to calendar". */
	cancelled: boolean;
	/** iCalendar UID; stable across updates of the same event. */
	uid: string | null;
	/** SEQUENCE (higher = newer revision of the same UID), or null. */
	sequence: number | null;
	/** SUMMARY, unescaped. Null when the event has no title. */
	title: string | null;
	/**
	 * Start.
	 * - Timed event with a known zone (UTC "Z", an IANA or Windows TZID, or a
	 *   VTIMEZONE in the file): UTC ISO instant, e.g. "2026-11-05T15:00:00.000Z".
	 * - Floating time (no zone at all): local wall time without offset,
	 *   e.g. "2026-11-05T15:00:00"; show it in the device's zone.
	 * - All-day: date only, e.g. "2026-11-05".
	 */
	start: string;
	/**
	 * End, same format as `start`. For all-day events it is exclusive (a
	 * one-day event on Nov 5 ends "2026-11-06"), as in iCalendar. Derived from
	 * DURATION when DTEND is missing; null when neither is present on a
	 * timed event.
	 */
	end: string | null;
	allDay: boolean;
	/**
	 * IANA zone the organizer scheduled in ("America/New_York", "UTC"), for
	 * display and for handing to calendar APIs. Null for floating and all-day
	 * events, and when the TZID is not a zone we can name.
	 */
	timezone: string | null;
	/** LOCATION, unescaped; may itself be a meeting URL. */
	location: string | null;
	organizer: EmailInviteOrganizer | null;
	/**
	 * Whether `organizer` can be shown as who sent the invite (AVE-220): its
	 * address is the message's From, or the From passed authentication and the
	 * organizer is on the same domain. ORGANIZER is free text in the .ics, so
	 * when this is false clients show the real sender and label the organizer
	 * "Claims organizer". Set by the Worker on reader payloads; absent from
	 * older servers, where clients show the organizer as before.
	 */
	organizerMatchesSender?: boolean;
	/**
	 * https link to join online (Google Meet, Zoom, Microsoft Teams, Webex, …),
	 * taken from the conference properties, URL, LOCATION or DESCRIPTION.
	 */
	meetingUrl: string | null;
	/** Raw RRULE value ("FREQ=WEEKLY;BYDAY=TU") for recurring events, else null. */
	recurrence: string | null;
	/** DESCRIPTION, unescaped and capped at 2000 characters; null when absent. */
	description: string | null;
}

/** Folder / auth inputs that decide whether reader cards may be shown. */
export interface MailCardGate {
	folder_id?: string | null;
	auth_tier?: string | null;
}

/**
 * Codes and invites are never offered for mail in Spam, or for mail whose
 * sender failed authentication (DMARC fail under an enforcing policy / SPF
 * hard-fail — auth tier "failed", see workers/lib/email-auth.ts).
 */
export function mailCardsAllowed(gate: MailCardGate): boolean {
	if (gate.folder_id === Folders.SPAM) return false;
	if (gate.auth_tier === "failed") return false;
	return true;
}
