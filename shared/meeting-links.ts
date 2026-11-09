// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Known video-meeting links (AVE-216). The Worker sets an invite's
 * `meetingUrl` only for these hosts, and every client offers the Invite
 * card's Join button only for these hosts too, so a stranger's LOCATION link
 * to any other site is never an app-styled Join button or a calendar URL.
 *
 * Design twins: iOS `Models/MailCards.swift` (`MeetingLinks`) and Android
 * `models/MailCards.kt` (`MeetingLinks`). All three are checked against
 * `shared/meeting-links.fixtures.json`, which also carries this host list.
 */

export const MEETING_HOSTS = {
	/** Only this exact host. */
	exact: [
		"meet.google.com",
		"teams.microsoft.com",
		"teams.live.com",
		"meet.jit.si",
		"whereby.com",
		"facetime.apple.com",
		"chime.aws",
		"meet.goto.com",
		"app.slack.com",
	],
	/** This host or any subdomain of it ("us02web.zoom.us"). */
	withSubdomains: ["zoom.us", "zoomgov.com", "webex.com", "gotomeeting.com"],
} as const;

/** True for a lower-cased hostname on the known meeting host list. */
export function isMeetingHost(host: string): boolean {
	const h = host.toLowerCase();
	return (
		(MEETING_HOSTS.exact as readonly string[]).includes(h) ||
		MEETING_HOSTS.withSubdomains.some((d) => h === d || h.endsWith(`.${d}`))
	);
}

/**
 * `value` normalized when it is an https URL on a known meeting host, with no
 * user info ("https://zoom.us@evil.test" is a link to evil.test); else null.
 */
export function knownMeetingUrl(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed || /[\s\\]/.test(trimmed)) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "https:" || url.username || url.password) return null;
		return isMeetingHost(url.hostname) ? url.href : null;
	} catch {
		return null;
	}
}

const URL_PATTERN = /https:\/\/[^\s<>"'\\)\]]+/gi;

/**
 * First https link on a known meeting host in free text ("Zoom: https://…"),
 * as written there, without trailing punctuation.
 */
export function findMeetingUrl(text: string | null | undefined): string | null {
	if (!text) return null;
	for (const match of text.matchAll(URL_PATTERN)) {
		const candidate = match[0].replace(/[.,;:!?]+$/, "");
		if (knownMeetingUrl(candidate)) return candidate;
	}
	return null;
}
