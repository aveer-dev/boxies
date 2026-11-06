/**
 * Calendar invites (AVE-175): Google, Outlook / Exchange, iCloud, all-day,
 * folded lines, escapes, cancellations, and `.ics` attachments.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/calendar-invite.test.mjs
 */

import assert from "node:assert/strict";
import {
	decodeStoredInvite,
	findMeetingUrl,
	ianaZoneFor,
	inviteFromAttachments,
	parseCalendarInvite,
	parseIcsDuration,
	unescapeIcsText,
} from "../lib/calendar-invite.ts";

const crlf = (lines) => lines.join("\r\n") + "\r\n";

// ── Google Calendar ──────────────────────────────────────────────

const google = crlf([
	"BEGIN:VCALENDAR",
	"PRODID:-//Google Inc//Google Calendar 70.9054//EN",
	"VERSION:2.0",
	"CALSCALE:GREGORIAN",
	"METHOD:REQUEST",
	"BEGIN:VTIMEZONE",
	"TZID:America/New_York",
	"X-LIC-LOCATION:America/New_York",
	"BEGIN:DAYLIGHT",
	"TZOFFSETFROM:-0500",
	"TZOFFSETTO:-0400",
	"TZNAME:EDT",
	"DTSTART:19700308T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
	"END:DAYLIGHT",
	"BEGIN:STANDARD",
	"TZOFFSETFROM:-0400",
	"TZOFFSETTO:-0500",
	"TZNAME:EST",
	"DTSTART:19701101T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
	"END:STANDARD",
	"END:VTIMEZONE",
	"BEGIN:VEVENT",
	"DTSTART;TZID=America/New_York:20261105T100000",
	"DTEND;TZID=America/New_York:20261105T103000",
	"DTSTAMP:20261101T120000Z",
	"ORGANIZER;CN=Sam Rivera:mailto:Sam.Rivera@example.com",
	"UID:7kukuqrfedlm2f9t8b6p9c0kqc@google.com",
	"ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=",
	" TRUE;CN=pat@inboxies.email;X-NUM-GUESTS=0:mailto:pat@inboxies.email",
	"X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij",
	"CREATED:20261101T115959Z",
	"DESCRIPTION:Quick sync on the Q4 roadmap\\, launch plan and hiring.\\n\\nJoin",
	"  with Google Meet: https://meet.google.com/abc-defg-hij\\n\\n-::~:~::~:~:~:~:",
	" ~:~:~:~::~:~::-",
	"LAST-MODIFIED:20261101T120000Z",
	"LOCATION:",
	"SEQUENCE:0",
	"STATUS:CONFIRMED",
	"SUMMARY:Roadmap sync\\; Q4",
	"TRANSP:OPAQUE",
	"END:VEVENT",
	"END:VCALENDAR",
]);

{
	const invite = parseCalendarInvite(google);
	assert.ok(invite);
	assert.equal(invite.method, "REQUEST");
	assert.equal(invite.status, "CONFIRMED");
	assert.equal(invite.cancelled, false);
	assert.equal(invite.uid, "7kukuqrfedlm2f9t8b6p9c0kqc@google.com");
	assert.equal(invite.sequence, 0);
	assert.equal(invite.title, "Roadmap sync; Q4");
	// Nov 5 2026 is after DST ends (Nov 1): EST, UTC-5.
	assert.equal(invite.start, "2026-11-05T15:00:00.000Z");
	assert.equal(invite.end, "2026-11-05T15:30:00.000Z");
	assert.equal(invite.allDay, false);
	assert.equal(invite.timezone, "America/New_York");
	assert.equal(invite.location, null);
	assert.deepEqual(invite.organizer, { email: "sam.rivera@example.com", name: "Sam Rivera" });
	assert.equal(invite.meetingUrl, "https://meet.google.com/abc-defg-hij");
	assert.equal(invite.recurrence, null);
	assert.ok(invite.description.startsWith("Quick sync on the Q4 roadmap, launch plan and hiring.\n\nJoin with Google Meet"));
}

// ── Outlook / Exchange: Windows TZID + VTIMEZONE, Teams link ─────

const outlook = crlf([
	"BEGIN:VCALENDAR",
	"METHOD:REQUEST",
	"PRODID:Microsoft Exchange Server 2010",
	"VERSION:2.0",
	"BEGIN:VTIMEZONE",
	"TZID:Pacific Standard Time",
	"BEGIN:STANDARD",
	"DTSTART:16010101T020000",
	"TZOFFSETFROM:-0700",
	"TZOFFSETTO:-0800",
	"RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11",
	"END:STANDARD",
	"BEGIN:DAYLIGHT",
	"DTSTART:16010101T020000",
	"TZOFFSETFROM:-0800",
	"TZOFFSETTO:-0700",
	"RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3",
	"END:DAYLIGHT",
	"END:VTIMEZONE",
	"BEGIN:VEVENT",
	"ORGANIZER;CN=\"Lee, Jordan\":mailto:jordan.lee@contoso.com",
	"ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Pat:mailto:pat@inboxies.email",
	"DESCRIPTION;LANGUAGE=en-US:\\n___________________________________________",
	" _____________________\\nMicrosoft Teams meeting\\nJoin on your computer\\, mob",
	" ile app or room device\\nJoin the meeting now<https://teams.microsoft.com/l/m",
	" eetup-join/19%3ameeting_NjQ5@thread.v2/0?context=%7b%22Tid%22%3a%22c3%22%7d>",
	" \\nMeeting ID: 245 123 456 789\\nPasscode: Xy7Bq2\\n",
	"UID:040000008200E00074C5B7101A82E00800000000F0A8B1C2D3E4DA01000000000000000010000000",
	"SUMMARY;LANGUAGE=en-US:Vendor review",
	"DTSTART;TZID=Pacific Standard Time:20261020T090000",
	"DTEND;TZID=Pacific Standard Time:20261020T100000",
	"CLASS:PUBLIC",
	"PRIORITY:5",
	"DTSTAMP:20261015T170405Z",
	"TRANSP:OPAQUE",
	"STATUS:CONFIRMED",
	"SEQUENCE:2",
	"LOCATION;LANGUAGE=en-US:Microsoft Teams Meeting",
	"X-MICROSOFT-CDO-BUSYSTATUS:TENTATIVE",
	"X-MICROSOFT-SKYPETEAMSMEETINGURL:https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQ5@thread.v2/0?context=%7b%22Tid%22%3a%22c3%22%7d",
	"END:VEVENT",
	"END:VCALENDAR",
]);

{
	const invite = parseCalendarInvite(outlook);
	assert.ok(invite);
	assert.equal(invite.title, "Vendor review");
	// Oct 20 2026 is daylight time: PDT, UTC-7.
	assert.equal(invite.start, "2026-10-20T16:00:00.000Z");
	assert.equal(invite.end, "2026-10-20T17:00:00.000Z");
	assert.equal(invite.timezone, "America/Los_Angeles");
	assert.equal(invite.location, "Microsoft Teams Meeting");
	assert.deepEqual(invite.organizer, { email: "jordan.lee@contoso.com", name: "Lee, Jordan" });
	assert.equal(
		invite.meetingUrl,
		"https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjQ5@thread.v2/0?context=%7b%22Tid%22%3a%22c3%22%7d",
	);
	assert.equal(invite.sequence, 2);
}

// Exchange "Customized Time Zone": only the VTIMEZONE says what it means.
{
	const custom = (start) =>
		crlf([
			"BEGIN:VCALENDAR",
			"METHOD:REQUEST",
			"BEGIN:VTIMEZONE",
			"TZID:Customized Time Zone",
			"BEGIN:STANDARD",
			"DTSTART:16010101T030000",
			"TZOFFSETFROM:+0200",
			"TZOFFSETTO:+0100",
			"RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10",
			"END:STANDARD",
			"BEGIN:DAYLIGHT",
			"DTSTART:16010101T020000",
			"TZOFFSETFROM:+0100",
			"TZOFFSETTO:+0200",
			"RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3",
			"END:DAYLIGHT",
			"END:VTIMEZONE",
			"BEGIN:VEVENT",
			"SUMMARY:Standup",
			`DTSTART;TZID="Customized Time Zone":${start}`,
			"DURATION:PT15M",
			"UID:custom-1",
			"END:VEVENT",
			"END:VCALENDAR",
		]);
	const winter = parseCalendarInvite(custom("20261102T140000"));
	assert.equal(winter.start, "2026-11-02T13:00:00.000Z");
	assert.equal(winter.end, "2026-11-02T13:15:00.000Z");
	assert.equal(winter.timezone, null);
	const summer = parseCalendarInvite(custom("20260715T140000"));
	assert.equal(summer.start, "2026-07-15T12:00:00.000Z");
}

// ── Apple iCloud: IANA TZID, LF line endings, Zoom in URL ────────

const icloud = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Apple Inc.//iCloud 2.0//EN",
	"METHOD:REQUEST",
	"BEGIN:VEVENT",
	"UID:5D9C1E2A-1F0B-4C7E-9E1A-3B2C4D5E6F70",
	"DTSTAMP:20261120T101500Z",
	"DTSTART;TZID=Europe/London:20261201T183000",
	"DTEND;TZID=Europe/London:20261201T200000",
	"SUMMARY:Book club",
	"LOCATION:The Crown\\, 12 High St\\nLondon",
	"URL;VALUE=URI:https://us02web.zoom.us/j/85512345678?pwd=abc123",
	"ORGANIZER;CN=Alex;EMAIL=alex@icloud.com:mailto:alex@icloud.com",
	"RRULE:FREQ=MONTHLY;BYDAY=1TU",
	"SEQUENCE:1",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\n");

{
	const invite = parseCalendarInvite(icloud);
	assert.equal(invite.method, "REQUEST");
	assert.equal(invite.title, "Book club");
	assert.equal(invite.start, "2026-12-01T18:30:00.000Z");
	assert.equal(invite.end, "2026-12-01T20:00:00.000Z");
	assert.equal(invite.timezone, "Europe/London");
	assert.equal(invite.location, "The Crown, 12 High St\nLondon");
	assert.equal(invite.meetingUrl, "https://us02web.zoom.us/j/85512345678?pwd=abc123");
	assert.deepEqual(invite.organizer, { email: "alex@icloud.com", name: "Alex" });
	assert.equal(invite.recurrence, "FREQ=MONTHLY;BYDAY=1TU");
}

// ── All-day, UTC, floating, cancellation ─────────────────────────

{
	const allDay = parseCalendarInvite(
		crlf([
			"BEGIN:VCALENDAR",
			"METHOD:PUBLISH",
			"BEGIN:VEVENT",
			"UID:offsite@example.com",
			"SUMMARY:Team offsite",
			"DTSTART;VALUE=DATE:20261112",
			"DTEND;VALUE=DATE:20261114",
			"END:VEVENT",
			"END:VCALENDAR",
		]),
	);
	assert.equal(allDay.allDay, true);
	assert.equal(allDay.start, "2026-11-12");
	assert.equal(allDay.end, "2026-11-14");
	assert.equal(allDay.timezone, null);
	assert.equal(allDay.method, "PUBLISH");

	const oneDay = parseCalendarInvite(
		crlf(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Holiday", "DTSTART:20261225", "END:VEVENT", "END:VCALENDAR"]),
	);
	assert.equal(oneDay.allDay, true);
	assert.equal(oneDay.end, "2026-12-26", "all-day without DTEND lasts one day (exclusive end)");
	assert.equal(oneDay.method, null);
}

{
	const utc = parseCalendarInvite(
		crlf([
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"SUMMARY:Call",
			"DTSTART:20261103T170000Z",
			"DURATION:PT1H30M",
			"END:VEVENT",
			"END:VCALENDAR",
		]),
		"request",
	);
	assert.equal(utc.start, "2026-11-03T17:00:00.000Z");
	assert.equal(utc.end, "2026-11-03T18:30:00.000Z");
	assert.equal(utc.timezone, "UTC");
	assert.equal(utc.method, "REQUEST", "MIME method= is the fallback");

	const floating = parseCalendarInvite(
		crlf([
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"SUMMARY:Dentist",
			"DTSTART:20261104T090000",
			"DTEND:20261104T094500",
			"END:VEVENT",
			"END:VCALENDAR",
		]),
	);
	assert.equal(floating.start, "2026-11-04T09:00:00");
	assert.equal(floating.end, "2026-11-04T09:45:00");
	assert.equal(floating.timezone, null);
}

{
	const cancel = parseCalendarInvite(
		crlf([
			"BEGIN:VCALENDAR",
			"METHOD:CANCEL",
			"BEGIN:VEVENT",
			"UID:7kukuqrfedlm2f9t8b6p9c0kqc@google.com",
			"SEQUENCE:1",
			"STATUS:CANCELLED",
			"SUMMARY:Roadmap sync",
			"DTSTART;TZID=America/New_York:20261105T100000",
			"DTEND;TZID=America/New_York:20261105T103000",
			"END:VEVENT",
			"END:VCALENDAR",
		]),
	);
	assert.equal(cancel.method, "CANCEL");
	assert.equal(cancel.status, "CANCELLED");
	assert.equal(cancel.cancelled, true);
	assert.equal(cancel.timezone, "America/New_York", "IANA TZID works without a VTIMEZONE");
	assert.equal(cancel.start, "2026-11-05T15:00:00.000Z");
}

// Recurrence override + master: the master event wins.
{
	const invite = parseCalendarInvite(
		crlf([
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:weekly",
			"RECURRENCE-ID:20261110T150000Z",
			"SUMMARY:Weekly (moved)",
			"DTSTART:20261111T150000Z",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"UID:weekly",
			"SUMMARY:Weekly",
			"RRULE:FREQ=WEEKLY;BYDAY=TU",
			"DTSTART:20261103T150000Z",
			"END:VEVENT",
			"END:VCALENDAR",
		]),
	);
	assert.equal(invite.title, "Weekly");
	assert.equal(invite.recurrence, "FREQ=WEEKLY;BYDAY=TU");
}

// Not invites.
assert.equal(parseCalendarInvite(""), null);
assert.equal(parseCalendarInvite("let's meet Tuesday at 3pm"), null);
assert.equal(
	parseCalendarInvite(crlf(["BEGIN:VCALENDAR", "BEGIN:VTODO", "SUMMARY:x", "END:VTODO", "END:VCALENDAR"])),
	null,
);
assert.equal(
	parseCalendarInvite(crlf(["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:No start", "END:VEVENT", "END:VCALENDAR"])),
	null,
);

// ── Attachments (postal-mime shape) ──────────────────────────────

{
	const enc = new TextEncoder();
	const fromParts = inviteFromAttachments([
		{ filename: "logo.png", mimeType: "image/png", content: new Uint8Array([137, 80, 78, 71]).buffer },
		{ filename: null, mimeType: "text/calendar", method: "REQUEST", content: enc.encode(google) },
	]);
	assert.equal(fromParts?.title, "Roadmap sync; Q4");

	const octet = inviteFromAttachments([
		{ filename: "invite.ics", mimeType: "application/octet-stream", content: enc.encode(icloud).buffer },
	]);
	assert.equal(octet?.title, "Book club");

	assert.equal(inviteFromAttachments([{ filename: "notes.txt", mimeType: "text/plain", content: enc.encode(google) }]), null);
	assert.equal(inviteFromAttachments([{ filename: "broken.ics", mimeType: "text/calendar", content: enc.encode("garbage") }]), null);
	assert.equal(inviteFromAttachments(undefined), null);
}

// ── Helpers ──────────────────────────────────────────────────────

assert.equal(unescapeIcsText("a\\, b\\; c\\\\d\\ne\\Nf"), "a, b; c\\d\ne\nf");
assert.equal(parseIcsDuration("PT1H30M"), 90 * 60 * 1000);
assert.equal(parseIcsDuration("P1W"), 7 * 24 * 3600 * 1000);
assert.equal(parseIcsDuration("P1DT2H"), 26 * 3600 * 1000);
assert.equal(parseIcsDuration("P"), null);
assert.equal(parseIcsDuration("bogus"), null);
assert.equal(ianaZoneFor("Europe/Berlin"), "Europe/Berlin");
assert.equal(ianaZoneFor("W. Europe Standard Time"), "Europe/Berlin");
assert.equal(ianaZoneFor("/mozilla.org/20050126_1/America/New_York"), "America/New_York");
assert.equal(ianaZoneFor("Customized Time Zone"), null);
assert.equal(ianaZoneFor("Not/AZone"), null);
assert.equal(findMeetingUrl("Join: https://acme.zoom.us/j/123456789."), "https://acme.zoom.us/j/123456789");
assert.equal(findMeetingUrl("See https://example.com/agenda"), null);
assert.equal(findMeetingUrl("http://meet.google.com/abc-defg-hij"), null, "https only");

assert.equal(decodeStoredInvite(null), null);
assert.equal(decodeStoredInvite("{not json"), null);
assert.equal(decodeStoredInvite(JSON.stringify(parseCalendarInvite(icloud))).title, "Book club");

console.log("calendar-invite: ok");
