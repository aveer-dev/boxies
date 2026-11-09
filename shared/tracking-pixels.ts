// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Tracking pixels (AVE-195, HEY's Spy Pixel Blocker).
 *
 * Remote images load by default outside Spam (AVE-132, shared/remote-images.ts),
 * so a sender's open pixel would tell them when you read their mail. The
 * mailbox strips known pixels from the body when it serves a message
 * (MailboxDO getEmail / getThreadEmails), in every folder, and reports what it
 * removed as `blocked_trackers`. Web, iOS and Android only render a small note
 * from that (`trackerNote`; same strings in shared/tracker-note.fixtures.json),
 * so there is one list, in one place.
 *
 * Conservative on purpose: hiding a real image is worse than missing a
 * tracker. An `<img>` goes only when it is
 *   - a request to a known open-pixel endpoint (`TRACKER_ENDPOINTS`), or
 *   - remote and invisible: 1×1 or smaller, zero-sized, or hidden by its
 *     inline style with no visible size declared. Layout spacers
 *     (`spacer.gif`, `blank.gif`, …) on unknown hosts are left alone.
 * Every other image is untouched. Inline (`cid:`/`data:`) images are never
 * remote, so never touched. CSS background images are out of scope.
 */

import { Folders } from "./folders";

export interface BlockedTrackers {
	/** How many pixels were removed from the body. */
	count: number;
	/** Services named from the known list, in first-seen order. May be empty. */
	services: string[];
}

interface TrackerHost {
	/** Host, or a parent domain of it (`sendgrid.net` matches `u1.ct.sendgrid.net`). */
	host: string;
	service: string;
	/**
	 * Path prefix that is always an open pixel at this host. Without it the
	 * host only names an image already caught as invisible, except for
	 * `pixelOnly` hosts that serve nothing but tracking.
	 */
	path?: RegExp;
	/** The host serves only tracking (never real images). */
	pixelOnly?: boolean;
}

/** Known tracking services, by host. Order matters only for display names. */
export const TRACKER_HOSTS: readonly TrackerHost[] = [
	{ host: "list-manage.com", service: "Mailchimp", path: /^\/track\/open/i },
	{ host: "mailchimp.com", service: "Mailchimp" },
	{ host: "mandrillapp.com", service: "Mailchimp", path: /^\/track\/open/i },
	{ host: "sendgrid.net", service: "SendGrid", path: /^\/wf\/open/i },
	{ host: "awstrack.me", service: "Amazon SES", pixelOnly: true },
	{ host: "mailtrack.io", service: "Mailtrack", pixelOnly: true },
	{ host: "mailfoogae.appspot.com", service: "Streak", pixelOnly: true },
	{ host: "t.yesware.com", service: "Yesware", pixelOnly: true },
	{ host: "r.superhuman.com", service: "Superhuman", pixelOnly: true },
	{ host: "google-analytics.com", service: "Google Analytics", path: /^\/(?:collect|r\/collect)/i },
	{ host: "hubspot.com", service: "HubSpot" },
	{ host: "hubspotemail.net", service: "HubSpot" },
	{ host: "hubspotlinks.com", service: "HubSpot" },
	{ host: "klaviyo.com", service: "Klaviyo" },
	{ host: "klclick.com", service: "Klaviyo" },
	{ host: "klclick1.com", service: "Klaviyo" },
	{ host: "mailgun.org", service: "Mailgun" },
	{ host: "mailgun.net", service: "Mailgun" },
	{ host: "sparkpostmail.com", service: "SparkPost" },
	{ host: "exct.net", service: "Salesforce Marketing Cloud" },
	{ host: "exacttarget.com", service: "Salesforce Marketing Cloud" },
	{ host: "pardot.com", service: "Pardot" },
	{ host: "mktoresp.com", service: "Marketo" },
	{ host: "marketo.com", service: "Marketo" },
	{ host: "rs6.net", service: "Constant Contact" },
	{ host: "constantcontact.com", service: "Constant Contact" },
	{ host: "createsend.com", service: "Campaign Monitor" },
	{ host: "createsend1.com", service: "Campaign Monitor" },
	{ host: "customeriomail.com", service: "Customer.io" },
	{ host: "customer.io", service: "Customer.io" },
	{ host: "intercom-mail.com", service: "Intercom" },
	{ host: "intercom.io", service: "Intercom" },
	{ host: "sendibt2.com", service: "Brevo" },
	{ host: "sendibt3.com", service: "Brevo" },
	{ host: "brevo.com", service: "Brevo" },
	{ host: "sendinblue.com", service: "Brevo" },
	{ host: "convertkit-mail.com", service: "Kit" },
	{ host: "convertkit-mail2.com", service: "Kit" },
	{ host: "ck.page", service: "Kit" },
	{ host: "substack.com", service: "Substack" },
	{ host: "beehiiv.com", service: "beehiiv" },
	{ host: "postmarkapp.com", service: "Postmark" },
	{ host: "pstmrk.it", service: "Postmark" },
	{ host: "mixmax.com", service: "Mixmax" },
	{ host: "mixpanel.com", service: "Mixpanel" },
	{ host: "bananatag.com", service: "Bananatag" },
	{ host: "getnotify.com", service: "Notify" },
	{ host: "linkedin.com", service: "LinkedIn" },
	{ host: "facebook.com", service: "Facebook" },
];

/** Layout spacer file names: tiny on purpose, not trackers. */
const SPACER_FILE = /\/(?:spacer|blank|clear|transparent|shim|pixel_?spacer|s)\.(?:gif|png)$/i;

const IMG_TAG = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function decodeEntities(value: string): string {
	return value
		.replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&");
}

function parseAttributes(tag: string): Map<string, string> {
	const attrs = new Map<string, string>();
	const inner = tag.replace(/^<img\b/i, "").replace(/\/?>$/, "");
	for (const match of inner.matchAll(ATTR)) {
		const name = match[1].toLowerCase();
		if (attrs.has(name)) continue;
		attrs.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ""));
	}
	return attrs;
}

/** `"1"`, `"1px"`, `" 0 "` → number; `"100%"`, `"auto"`, `""` → undefined. */
function pixelSize(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*(?:!important)?\s*$/i.exec(value);
	return match ? Number(match[1]) : undefined;
}

interface Visibility {
	width?: number;
	height?: number;
	hidden: boolean;
	collapsed: boolean;
}

function visibility(attrs: Map<string, string>): Visibility {
	let width = pixelSize(attrs.get("width"));
	let height = pixelSize(attrs.get("height"));
	let hidden = attrs.has("hidden");
	let collapsed = false;
	for (const declaration of (attrs.get("style") ?? "").split(";")) {
		const colon = declaration.indexOf(":");
		if (colon < 0) continue;
		const prop = declaration.slice(0, colon).trim().toLowerCase();
		const value = declaration.slice(colon + 1).trim().toLowerCase().replace(/\s*!important$/, "");
		// CSS wins over the attribute; a size that isn't plain px (100%, auto) is unknown.
		if (prop === "width") width = pixelSize(value);
		else if (prop === "height") height = pixelSize(value);
		else if ((prop === "max-width" || prop === "max-height") && pixelSize(value) === 0) collapsed = true;
		else if (prop === "display" && value === "none") hidden = true;
		else if (prop === "visibility" && value === "hidden") hidden = true;
		else if (prop === "opacity" && Number(value) === 0 && value !== "") hidden = true;
	}
	return { width, height, hidden, collapsed };
}

/** Invisible to the reader: 1×1 or smaller, zero-sized, or hidden with no visible size. */
function isInvisible(v: Visibility): boolean {
	if (v.width === 0 || v.height === 0 || v.collapsed) return true;
	if (v.width !== undefined && v.height !== undefined && v.width <= 1 && v.height <= 1) return true;
	if (v.hidden) return !((v.width ?? 0) > 1 || (v.height ?? 0) > 1);
	return false;
}

function remoteUrl(src: string | undefined): URL | null {
	if (!src) return null;
	const trimmed = src.trim();
	const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
	if (!/^https?:\/\//i.test(absolute)) return null;
	try {
		return new URL(absolute);
	} catch {
		return null;
	}
}

function knownHost(url: URL): TrackerHost | undefined {
	const host = url.hostname.toLowerCase().replace(/\.$/, "");
	return TRACKER_HOSTS.find((entry) => host === entry.host || host.endsWith(`.${entry.host}`));
}

/**
 * Whether this `<img>` tag is a tracking pixel, and the service if known.
 * Returns undefined for an ordinary image.
 */
export function trackingPixel(tag: string): { service: string | null } | undefined {
	const attrs = parseAttributes(tag);
	const url = remoteUrl(attrs.get("src"));
	if (!url) return undefined;
	const known = knownHost(url);
	if (known && (known.pixelOnly || (known.path && known.path.test(url.pathname)))) {
		return { service: known.service };
	}
	if (!isInvisible(visibility(attrs))) return undefined;
	if (!known && SPACER_FILE.test(url.pathname)) return undefined;
	return { service: known?.service ?? null };
}

/**
 * Removes tracking pixels from an HTML body. Returns the body unchanged (same
 * string) and `blocked: null` when there was nothing to remove.
 */
export function blockTrackingPixels(html: string): { html: string; blocked: BlockedTrackers | null } {
	if (!html || !/<img\b/i.test(html)) return { html, blocked: null };
	let count = 0;
	const services: string[] = [];
	const cleaned = html.replace(IMG_TAG, (tag) => {
		const pixel = trackingPixel(tag);
		if (!pixel) return tag;
		count++;
		if (pixel.service && !services.includes(pixel.service)) services.push(pixel.service);
		return "";
	});
	if (count === 0) return { html, blocked: null };
	return { html: cleaned, blocked: { count, services } };
}

/** Bodies the user wrote stay as they are (a draft being edited). */
export function shouldBlockTrackingPixels(folderId: string | null | undefined): boolean {
	return folderId !== Folders.DRAFT;
}

/**
 * The reader's note. iOS (`TrackerNote.text`) and Android (`TrackerNote.text`)
 * give the same strings for shared/tracker-note.fixtures.json.
 */
export function trackerNote(blocked: BlockedTrackers | null | undefined): string | null {
	if (!blocked || blocked.count < 1) return null;
	const services = blocked.services.filter((name) => name.trim() !== "");
	if (services.length > 0) return `Blocked tracking from ${joinNames(services)}`;
	return blocked.count === 1 ? "Blocked a tracking pixel" : `Blocked ${blocked.count} tracking pixels`;
}

function joinNames(names: string[]): string {
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
