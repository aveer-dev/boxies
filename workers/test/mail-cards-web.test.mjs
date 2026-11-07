// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Web reader Code card / Invite card helpers (AVE-178): gating, location
// sorting, times, repeat rules, the Google Calendar link and the .ics file.
import assert from "node:assert/strict";
import {
	buildIcs,
	calendarDates,
	cardAllowed,
	compactInviteTime,
	directionsUrl,
	escapeIcsText,
	foldIcsLine,
	googleCalendarUrl,
	icsFilename,
	inviteTimeSummary,
	inviteVenue,
	parseInviteTime,
	readerCard,
	recurrenceLabel,
	safeHttpUrl,
	simpleRecurrence,
} from "../../app/lib/mail-cards.ts";

let passed = 0;
const test = (name, fn) => {
	try {
		fn();
		passed++;
	} catch (e) {
		console.error(`✖ ${name}`);
		throw e;
	}
};

const invite = (over = {}) => ({
	method: "REQUEST", status: null, cancelled: false, uid: "evt-1@example.com", sequence: 0,
	title: "Team sync", start: "2026-11-05T16:00:00.000Z", end: "2026-11-05T17:00:00.000Z",
	allDay: false, timezone: "America/Chicago", location: null, organizer: null, meetingUrl: null,
	recurrence: null, description: null, ...over,
});
// Intl puts narrow / thin no-break spaces around times and ranges.
const plain = (s) => s?.replace(/[   ]/g, " ");
const fmt = { locale: "en-US", timeZone: "America/Chicago", now: new Date("2026-11-01T12:00:00Z") };

// region Gating

test("no card in Spam or for failed auth", () => {
	assert.equal(cardAllowed({ folder_id: "inbox", auth_tier: "verified" }), true);
	assert.equal(cardAllowed({ folder_id: "spam", auth_tier: "verified" }), false);
	assert.equal(cardAllowed({ folder_id: "inbox", auth_tier: "failed" }), false);
	// Older payloads: tier inside the auth snapshot, or a spoofed flag.
	assert.equal(cardAllowed({ folder_id: "inbox", auth: { authTier: "failed" } }), false);
	assert.equal(cardAllowed({ folder_id: "inbox", auth: { spoofed: true } }), false);
});

test("readerCard picks the newest allowed message, invite before code", () => {
	const msgs = [
		{ id: "draft", folder_id: "draft", otp: { code: "111111" } },
		{ id: "spam", folder_id: "spam", otp: { code: "222222" } },
		{ id: "both", folder_id: "inbox", otp: { code: "333333" }, invite: invite() },
		{ id: "old", folder_id: "inbox", otp: { code: "444444" } },
	];
	assert.deepEqual(readerCard(msgs), { kind: "invite", invite: invite(), emailId: "both" });
	assert.deepEqual(readerCard(msgs.slice(3)), { kind: "code", code: "444444", emailId: "old" });
	assert.equal(readerCard([{ id: "a", folder_id: "inbox", otp: { code: "555" }, auth_tier: "failed" }]), null);
	assert.equal(readerCard([{ id: "a", folder_id: "inbox", otp: { code: " " } }]), null);
	assert.equal(readerCard([{ id: "a", folder_id: "inbox", otp: { code: "555555" } }], new Set(["a"])), null);
});

// endregion

// region Location

test("meeting link → Join, address → Directions, platform name or nothing → none", () => {
	assert.deepEqual(inviteVenue(invite({ meetingUrl: "https://meet.google.com/abc-defg-hij" })), {
		kind: "link", url: "https://meet.google.com/abc-defg-hij",
	});
	assert.deepEqual(inviteVenue(invite({ location: "Zoom: https://zoom.us/j/123." })), {
		kind: "link", url: "https://zoom.us/j/123",
	});
	assert.deepEqual(inviteVenue(invite({ location: "1 Main St, Austin, TX" })), {
		kind: "address", address: "1 Main St, Austin, TX",
	});
	// A meeting link wins over an address.
	assert.equal(inviteVenue(invite({ location: "Room 4", meetingUrl: "https://zoom.us/j/1" })).kind, "link");
	for (const location of ["Zoom", "Microsoft Teams Meeting", "Google Meet", " online ", null, ""]) {
		assert.deepEqual(inviteVenue(invite({ location })), { kind: "none" }, String(location));
	}
});

test("only http(s) links are ever offered", () => {
	assert.equal(safeHttpUrl("javascript:alert(1)"), null);
	assert.equal(safeHttpUrl("data:text/html,hi"), null);
	assert.equal(safeHttpUrl("https://a b"), null);
	assert.equal(safeHttpUrl("http://example.com/x"), "http://example.com/x");
	assert.deepEqual(inviteVenue(invite({ meetingUrl: "javascript:alert(1)" })), { kind: "none" });
	assert.equal(
		directionsUrl("1 Main St & 2nd #4"),
		"https://www.google.com/maps/search/?api=1&query=1%20Main%20St%20%26%202nd%20%234",
	);
});

// endregion

// region Times

test("parses UTC, offset, floating and date-only values", () => {
	assert.deepEqual(parseInviteTime("2026-11-05T15:00:00.000Z"), { date: new Date("2026-11-05T15:00:00Z"), wall: false, dateOnly: false });
	assert.equal(parseInviteTime("2026-11-05T15:00:00+0100").date.toISOString(), "2026-11-05T14:00:00.000Z");
	assert.deepEqual(parseInviteTime("2026-11-05T15:00:00"), { date: new Date("2026-11-05T15:00:00Z"), wall: true, dateOnly: false });
	assert.deepEqual(parseInviteTime("2026-11-05"), { date: new Date("2026-11-05T00:00:00Z"), wall: true, dateOnly: true });
	assert.equal(parseInviteTime("next tuesday"), null);
	assert.equal(parseInviteTime(null), null);
});

test("formats UTC instants in the viewer's zone", () => {
	assert.equal(plain(compactInviteTime(invite(), fmt)), "Nov 5 · 10:00 AM");
	assert.equal(plain(inviteTimeSummary(invite(), fmt)), "Thu, Nov 5 · 10:00 – 11:00 AM");
	assert.equal(plain(inviteTimeSummary(invite({ end: null }), fmt)), "Thu, Nov 5 · 10:00 AM");
	assert.equal(
		plain(inviteTimeSummary(invite({ end: "2026-11-06T17:00:00.000Z" }), fmt)),
		"Thu, Nov 5, 10:00 AM – Fri, Nov 6, 11:00 AM",
	);
	assert.equal(plain(compactInviteTime(invite({ start: "2027-01-04T16:00:00Z", end: null }), fmt)), "Jan 4, 2027 · 10:00 AM");
});

test("floating times read the same in every zone", () => {
	const floating = invite({ start: "2026-11-05T15:00:00", end: "2026-11-05T16:30:00" });
	for (const timeZone of ["America/Chicago", "Asia/Tokyo"]) {
		assert.equal(plain(inviteTimeSummary(floating, { ...fmt, timeZone })), "Thu, Nov 5 · 3:00 – 4:30 PM");
	}
});

test("all-day end is exclusive", () => {
	const oneDay = invite({ start: "2026-11-05", end: "2026-11-06", allDay: true });
	assert.equal(inviteTimeSummary(oneDay, fmt), "Thu, Nov 5 · All day");
	assert.equal(compactInviteTime(oneDay, { ...fmt, timeZone: "Asia/Tokyo" }), "Nov 5");
	const threeDays = invite({ start: "2026-11-05", end: "2026-11-08", allDay: true });
	assert.equal(inviteTimeSummary(threeDays, fmt), "Thu, Nov 5 – Sat, Nov 7 · All day");
	assert.equal(inviteTimeSummary(invite({ start: "2026-11-05", end: null, allDay: true }), fmt), "Thu, Nov 5 · All day");
	assert.equal(inviteTimeSummary(invite({ start: "garbage" }), fmt), null);
});

// endregion

// region Repeat rules

test("simple repeat rules map; complex ones are left off", () => {
	assert.equal(simpleRecurrence("FREQ=WEEKLY;BYDAY=TU,TH;WKST=MO").rule, "FREQ=WEEKLY;BYDAY=TU,TH");
	assert.equal(simpleRecurrence("RRULE:freq=daily;interval=2;count=5").rule, "FREQ=DAILY;INTERVAL=2;COUNT=5");
	assert.equal(simpleRecurrence("FREQ=MONTHLY;UNTIL=20261231T235959Z").rule, "FREQ=MONTHLY;UNTIL=20261231T235959Z");
	assert.equal(simpleRecurrence("FREQ=MONTHLY;BYDAY=2TU"), null);
	assert.equal(simpleRecurrence("FREQ=MONTHLY;BYMONTHDAY=15"), null);
	assert.equal(simpleRecurrence("FREQ=DAILY;COUNT=3;UNTIL=20261231"), null);
	assert.equal(simpleRecurrence("FREQ=HOURLY"), null);
	assert.equal(recurrenceLabel("FREQ=WEEKLY"), "Repeats weekly");
	assert.equal(recurrenceLabel("FREQ=WEEKLY;INTERVAL=2"), "Repeats every 2 weeks");
	assert.equal(recurrenceLabel("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR"), "Repeats");
	assert.equal(recurrenceLabel(null), null);
});

// endregion

// region Add to calendar

test("calendar dates: UTC, floating and all-day", () => {
	assert.deepEqual(calendarDates(invite()), { start: "20261105T160000Z", end: "20261105T170000Z", allDay: false });
	assert.deepEqual(calendarDates(invite({ end: null })), { start: "20261105T160000Z", end: "20261105T170000Z", allDay: false });
	assert.deepEqual(calendarDates(invite({ start: "2026-11-05T15:00:00", end: null })), {
		start: "20261105T150000", end: "20261105T160000", allDay: false,
	});
	assert.deepEqual(calendarDates(invite({ start: "2026-11-05", end: "2026-11-08", allDay: true })), {
		start: "20261105", end: "20261108", allDay: true,
	});
	assert.deepEqual(calendarDates(invite({ start: "2026-12-31", end: null, allDay: true })), {
		start: "20261231", end: "20270101", allDay: true,
	});
});

test("Google Calendar link escapes every field", () => {
	const url = googleCalendarUrl(invite({
		title: "Q&A / plan #1",
		location: "Room 4, HQ",
		meetingUrl: "https://zoom.us/j/1?pwd=a&b",
		description: "Agenda: 50% & more",
		recurrence: "FREQ=WEEKLY;BYDAY=TU",
	}));
	const parsed = new URL(url);
	assert.equal(parsed.origin + parsed.pathname, "https://calendar.google.com/calendar/render");
	assert.equal(parsed.searchParams.get("action"), "TEMPLATE");
	assert.equal(parsed.searchParams.get("text"), "Q&A / plan #1");
	assert.equal(parsed.searchParams.get("dates"), "20261105T160000Z/20261105T170000Z");
	assert.equal(parsed.searchParams.get("details"), "Join: https://zoom.us/j/1?pwd=a&b\n\nAgenda: 50% & more");
	assert.equal(parsed.searchParams.get("location"), "Room 4, HQ");
	assert.equal(parsed.searchParams.get("recur"), "RRULE:FREQ=WEEKLY;BYDAY=TU");
	assert.ok(!url.includes(" ") && !url.includes("#1"));
	assert.equal(googleCalendarUrl(invite({ cancelled: true })), null);
	// With only a link, the link is the location.
	assert.equal(new URL(googleCalendarUrl(invite({ meetingUrl: "https://meet.google.com/x" }))).searchParams.get("location"), "https://meet.google.com/x");
});

test("ics text escaping and folding", () => {
	assert.equal(escapeIcsText("a\\b;c,d\ne\r\nf"), "a\\\\b\\;c\\,d\\ne\\nf");
	assert.equal(escapeIcsText("bell\u0007"), "bell");
	const long = `DESCRIPTION:${"é".repeat(60)}`;
	const folded = foldIcsLine(long);
	for (const line of folded.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
	assert.equal(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), long);
});

test("ics for a timed event", () => {
	const ics = buildIcs(
		invite({
			title: "Sync; planning, Q4",
			location: "Room 4",
			meetingUrl: "https://meet.google.com/abc",
			description: "Line one\nLine two",
			recurrence: "FREQ=WEEKLY;BYDAY=TU",
		}),
		new Date("2026-11-01T08:09:10Z"),
	);
	const lines = ics.split("\r\n");
	assert.ok(ics.endsWith("\r\n"));
	assert.equal(lines[0], "BEGIN:VCALENDAR");
	for (const expected of [
		"VERSION:2.0",
		"BEGIN:VEVENT",
		"UID:evt-1@example.com",
		"DTSTAMP:20261101T080910Z",
		"DTSTART:20261105T160000Z",
		"DTEND:20261105T170000Z",
		"SUMMARY:Sync\\; planning\\, Q4",
		"LOCATION:Room 4",
		"DESCRIPTION:Join: https://meet.google.com/abc\\n\\nLine one\\nLine two",
		"URL:https://meet.google.com/abc",
		"RRULE:FREQ=WEEKLY;BYDAY=TU",
		"END:VEVENT",
		"END:VCALENDAR",
	]) {
		assert.ok(lines.includes(expected), expected);
	}
});

test("ics for all-day and floating events, and none when cancelled", () => {
	const allDay = buildIcs(invite({ start: "2026-11-05", end: "2026-11-06", allDay: true, uid: null }));
	assert.match(allDay, /\r\nDTSTART;VALUE=DATE:20261105\r\n/);
	assert.match(allDay, /\r\nDTEND;VALUE=DATE:20261106\r\n/);
	assert.match(allDay, /\r\nUID:[a-z0-9-]+@inboxies\r\n/);
	const floating = buildIcs(invite({ start: "2026-11-05T15:00:00", end: "2026-11-05T16:00:00" }));
	assert.match(floating, /\r\nDTSTART:20261105T150000\r\n/);
	assert.doesNotMatch(buildIcs(invite({ recurrence: "FREQ=MONTHLY;BYDAY=2TU" })), /RRULE/);
	assert.doesNotMatch(buildIcs(invite({ meetingUrl: "javascript:alert(1)" })), /URL:|javascript/);
	assert.equal(buildIcs(invite({ cancelled: true })), null);
	// A UID can't break out of its line.
	assert.doesNotMatch(buildIcs(invite({ uid: "a\r\nBEGIN:VALARM" })), /\r\nBEGIN:VALARM/);
});

test("ics filename", () => {
	assert.equal(icsFilename(invite({ title: "Q4: plan / review?" })), "Q4 plan review.ics");
	assert.equal(icsFilename(invite({ title: null })), "Untitled event.ics");
	assert.equal(icsFilename(invite({ title: "..." })), "event.ics");
});

// endregion

console.log(`✔ mail-cards-web: ${passed} tests`);
