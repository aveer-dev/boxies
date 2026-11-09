/**
 * AVE-216: the Invite card offers Join only for https links on known meeting
 * hosts, never for any other LOCATION link. iOS and Android run the same
 * fixtures (shared/meeting-links.fixtures.json) in their unit tests.
 * Run: pnpm test:unit meeting-links
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MEETING_HOSTS, findMeetingUrl, knownMeetingUrl } from "../../shared/meeting-links.ts";
import { buildIcs, calendarNotes, googleCalendarUrl, inviteVenue, joinLink } from "../../app/lib/mail-cards.ts";

const fixtures = JSON.parse(
	readFileSync(new URL("../../shared/meeting-links.fixtures.json", import.meta.url), "utf8"),
);

const invite = (over = {}) => ({
	method: "REQUEST", status: null, cancelled: false, uid: "evt-1@example.com", sequence: 0,
	title: "Team sync", start: "2026-11-05T16:00:00.000Z", end: "2026-11-05T17:00:00.000Z",
	allDay: false, timezone: "America/Chicago", location: null, organizer: null, meetingUrl: null,
	recurrence: null, description: null, ...over,
});

// The fixture's host list is the one every client mirrors.
assert.deepEqual(fixtures.hosts, { exact: [...MEETING_HOSTS.exact], withSubdomains: [...MEETING_HOSTS.withSubdomains] });

assert.ok(fixtures.urls.length >= 15, "fixtures load");
for (const { url, join, note } of fixtures.urls) {
	const label = `${url} ${note ?? ""}`;
	assert.equal(knownMeetingUrl(url), join, label);
	// Even a Worker-supplied meetingUrl is checked again (defense in depth).
	assert.equal(joinLink(invite({ meetingUrl: url })), join, `meetingUrl ${label}`);
	assert.equal(inviteVenue(invite({ meetingUrl: url })).kind, join ? "link" : "none", `venue ${label}`);
}

for (const { location, join } of fixtures.locations) {
	assert.equal(joinLink(invite({ location })), join, location);
	if (join) assert.deepEqual(inviteVenue(invite({ location })), { kind: "link", url: join }, location);
	else assert.notEqual(inviteVenue(invite({ location })).kind, "link", location);
}

// The issue's repro: a stranger's lookalike link is plain location text, no
// Join, and never the calendar entry's link (location text itself is kept).
const evil = "https://zoom-us.evil.test/j/123?login=1";
const stranger = invite({ location: evil });
assert.deepEqual(inviteVenue(stranger), { kind: "none" });
assert.equal(calendarNotes(stranger), null);
const google = new URL(googleCalendarUrl(stranger));
assert.equal(google.searchParams.get("details"), null);
assert.equal(google.searchParams.get("location"), evil);
assert.doesNotMatch(buildIcs(stranger), /^URL:/m);
assert.doesNotMatch(buildIcs(stranger), /Join:/);

// A known link still flows into the calendar entry.
const zoom = invite({ location: "Zoom: https://us02web.zoom.us/j/9." });
assert.equal(calendarNotes(zoom), "Join: https://us02web.zoom.us/j/9");
assert.match(buildIcs(zoom), /^URL:https:\/\/us02web\.zoom\.us\/j\/9\r?$/m);

// The Worker's finder shares the list and keeps the link as written.
assert.equal(findMeetingUrl("Join: https://acme.zoom.us/j/123456789."), "https://acme.zoom.us/j/123456789");
assert.equal(findMeetingUrl(evil), null);

console.log("meeting-links tests passed");
