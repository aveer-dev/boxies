// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Security activity (AVE-151): what we record about sign-ins and account
 * changes (`security_event`), how a sign-in is judged to come from a new
 * device, and the read-only list behind Settings → Sessions → "Recent
 * security activity".
 *
 * A sign-in comes from a known device when a sign-in of the last 90 days (or
 * a live session) had the same browser/app + OS family and either the same
 * IP prefix (IPv4 /24, IPv6 /48) or the same country. Anything else is a new
 * device, except an account's very first sign-in, which has nothing to
 * compare against. Only the prefix of an address is stored.
 *
 * Sessions are noted per request (`noteSessionCreated`, from Better Auth's
 * session hook) and judged after the response (`auth/security-scope.ts`), so
 * sessions that a request creates and deletes again (a password sign-in that
 * turns into a two-factor challenge, a passkey re-auth) never count, nor do
 * sessions minted for a user who was already signed in on that request
 * (Better Auth rotates the session on 2FA setup and password change).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import type { AuthDb } from "./authz";
import * as schema from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a device counts as seen. Also how long rows are kept. */
export const DEVICE_HISTORY_MS = 90 * DAY_MS;
/** What the activity list shows. */
export const ACTIVITY_WINDOW_MS = 30 * DAY_MS;
const ACTIVITY_LIMIT = 200;

export const SECURITY_EVENT_KINDS = [
	"sign_in",
	"password_changed",
	"password_added",
	"password_reset",
	"two_factor_enabled",
	"two_factor_disabled",
	"passkey_added",
	"passkey_removed",
	"sign_in_method_added",
	"sign_in_method_removed",
	"recovery_email_set",
	"recovery_email_removed",
] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

/** Where a request came from, as much as we keep of it. */
export type RequestDevice = {
	/** "Chrome on macOS", "Inboxies app on iOS"; null without a User-Agent. */
	device: string | null;
	ipPrefix: string | null;
	country: string | null;
	city: string | null;
};

// ── Device fingerprint ───────────────────────────────────────────

function osFamily(ua: string): string | null {
	if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
	if (/Android/.test(ua)) return "Android";
	if (/CrOS/.test(ua)) return "ChromeOS";
	if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
	if (/Windows/.test(ua)) return "Windows";
	if (/Linux/.test(ua)) return "Linux";
	return null;
}

function browserFamily(ua: string): string | null {
	if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
	if (/OPR\/|Opera/.test(ua)) return "Opera";
	if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
	if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
	if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return "Chrome";
	if (/Safari\//.test(ua)) return "Safari";
	return null;
}

/**
 * The browser/app and OS family of a User-Agent, without versions: what
 * "the same device" means for the new-device check and what mails show.
 */
export function deviceLabel(userAgent: string | null | undefined): string | null {
	const ua = (userAgent ?? "").trim();
	if (!ua) return null;
	// Native apps: URLSession (iOS) and OkHttp (Android) defaults.
	if (/CFNetwork\//.test(ua) && /Darwin\//.test(ua)) return "Inboxies app on iOS";
	if (/^okhttp\//i.test(ua) || /Dalvik\//.test(ua)) return "Inboxies app on Android";
	const os = osFamily(ua);
	const browser = browserFamily(ua);
	if (browser && os) return `${browser} on ${os}`;
	if (browser) return browser;
	if (os) return `Browser on ${os}`;
	return "Unknown device";
}

function expandIpv6(ip: string): number[] | null {
	const [head, tail, ...rest] = ip.split("::");
	if (rest.length) return null;
	const parse = (s: string) => (s ? s.split(":") : []);
	const left = parse(head);
	const right = tail === undefined ? [] : parse(tail);
	// Embedded IPv4 (`::ffff:1.2.3.4`) is handled by the caller.
	const missing = 8 - left.length - right.length;
	if (tail === undefined ? missing !== 0 : missing < 1) return null;
	const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
	const out: number[] = [];
	for (const g of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
		out.push(parseInt(g, 16));
	}
	return out;
}

/** IPv4 → its /24, IPv6 → its /48; null for anything else. */
export function ipPrefix(ip: string | null | undefined): string | null {
	const raw = (ip ?? "").trim();
	if (!raw) return null;
	const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(raw);
	if (v4) {
		const parts = v4.slice(1).map(Number);
		if (parts.some((n) => n > 255)) return null;
		return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
	}
	if (!raw.includes(":")) return null;
	const groups = expandIpv6(raw.split("%")[0]);
	if (!groups) return null;
	return `${groups
		.slice(0, 3)
		.map((g) => g.toString(16))
		.join(":")}::/48`;
}

function countryCode(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const code = value.trim().toUpperCase();
	// XX: unknown to Cloudflare.
	return /^[A-Z][A-Z0-9]$/.test(code) && code !== "XX" ? code : null;
}

/** The device fingerprint of a request (Cloudflare's `cf` geolocation when present). */
export function requestDevice(request: Request): RequestDevice {
	const headers = request.headers;
	const cf = (request as { cf?: { country?: unknown; city?: unknown } }).cf;
	const city = typeof cf?.city === "string" && cf.city.trim() ? cf.city.trim().slice(0, 80) : null;
	return {
		device: deviceLabel(headers.get("user-agent")),
		ipPrefix: ipPrefix(headers.get("cf-connecting-ip")),
		country: countryCode(cf?.country) ?? countryCode(headers.get("cf-ipcountry")),
		city,
	};
}

/** "Lagos, Nigeria" (English, approximate); null when unknown. */
export function locationLabel(country: string | null, city: string | null): string | null {
	let name: string | null = null;
	if (country === "T1") name = "Tor network";
	else if (country) {
		try {
			name = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
		} catch {
			name = country;
		}
	}
	if (city && name) return `${city}, ${name}`;
	return name ?? city;
}

type SeenDevice = Pick<RequestDevice, "device" | "ipPrefix" | "country">;

/** True when `seen` holds the same device family on the same network prefix or in the same country. */
export function isKnownDevice(current: SeenDevice, seen: SeenDevice[]): boolean {
	return seen.some(
		(s) =>
			(s.device ?? "") === (current.device ?? "") &&
			((current.ipPrefix !== null && s.ipPrefix === current.ipPrefix) ||
				(current.country !== null && s.country === current.country)),
	);
}

/**
 * Judge a sign-in against the user's sign-ins of the last 90 days and live
 * sessions (other than `sessionId`, the one being judged). `firstSignIn`:
 * nothing to compare against (a new account, or the first sign-in since
 * activity was recorded); such a sign-in is never "new device".
 */
export async function classifySignIn(
	db: AuthDb,
	opts: { userId: string; sessionId: string; current: SeenDevice; now?: number },
): Promise<{ newDevice: boolean; firstSignIn: boolean }> {
	const now = opts.now ?? Date.now();
	const events = await db
		.select({
			device: schema.securityEvent.device,
			ipPrefix: schema.securityEvent.ipPrefix,
			country: schema.securityEvent.country,
		})
		.from(schema.securityEvent)
		.where(
			and(
				eq(schema.securityEvent.userId, opts.userId),
				eq(schema.securityEvent.kind, "sign_in"),
				gte(schema.securityEvent.createdAt, new Date(now - DEVICE_HISTORY_MS)),
			),
		)
		.all();
	const sessions = await db
		.select({ userAgent: schema.session.userAgent, ipAddress: schema.session.ipAddress })
		.from(schema.session)
		.where(
			and(
				eq(schema.session.userId, opts.userId),
				ne(schema.session.id, opts.sessionId),
				isNull(schema.session.scope),
			),
		)
		.all();
	const seen: SeenDevice[] = [
		...events,
		...sessions.map((s) => ({ device: deviceLabel(s.userAgent), ipPrefix: ipPrefix(s.ipAddress), country: null })),
	];
	if (seen.length === 0) return { newDevice: false, firstSignIn: true };
	return { newDevice: !isKnownDevice(opts.current, seen), firstSignIn: false };
}

// ── Recording and listing ────────────────────────────────────────

export async function recordSecurityEvent(
	db: AuthDb,
	opts: {
		userId: string;
		kind: SecurityEventKind;
		device?: RequestDevice | null;
		newDevice?: boolean;
		detail?: Record<string, string> | null;
		at?: Date;
	},
): Promise<void> {
	await db.insert(schema.securityEvent).values({
		id: crypto.randomUUID(),
		userId: opts.userId,
		kind: opts.kind,
		device: opts.device?.device ?? null,
		ipPrefix: opts.device?.ipPrefix ?? null,
		country: opts.device?.country ?? null,
		city: opts.device?.city ?? null,
		newDevice: opts.newDevice ?? false,
		detail: opts.detail && Object.keys(opts.detail).length ? JSON.stringify(opts.detail) : null,
		...(opts.at ? { createdAt: opts.at } : {}),
	});
}

/** One entry of `GET /api/v1/me/security-activity` (stable shape for the clients). */
export type SecurityActivityItem = {
	id: string;
	kind: SecurityEventKind;
	createdAt: string;
	/** "Chrome on macOS"; null when unknown. */
	device: string | null;
	/** "Lagos, Nigeria" (approximate); null when unknown. */
	location: string | null;
	/** ISO country code behind `location`. */
	country: string | null;
	/** Sign-ins only: from a device not seen in the last 90 days. */
	newDevice: boolean;
	/** Sign-in method events: "google", "apple", "password". */
	provider: string | null;
};

function parseDetail(raw: string | null): Record<string, unknown> {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw);
		return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** The user's security events of the last 30 days, newest first. */
export async function listSecurityActivity(
	db: AuthDb,
	userId: string,
	now = Date.now(),
): Promise<{ since: string; events: SecurityActivityItem[] }> {
	const since = new Date(now - ACTIVITY_WINDOW_MS);
	const rows = await db
		.select()
		.from(schema.securityEvent)
		.where(and(eq(schema.securityEvent.userId, userId), gte(schema.securityEvent.createdAt, since)))
		.orderBy(desc(schema.securityEvent.createdAt))
		.limit(ACTIVITY_LIMIT)
		.all();
	return {
		since: since.toISOString(),
		events: rows
			.filter((r) => (SECURITY_EVENT_KINDS as readonly string[]).includes(r.kind))
			.map((r) => {
				const provider = parseDetail(r.detail).provider;
				return {
					id: r.id,
					kind: r.kind as SecurityEventKind,
					createdAt: r.createdAt.toISOString(),
					device: r.device,
					location: locationLabel(r.country, r.city),
					country: r.country,
					newDevice: r.newDevice,
					provider: typeof provider === "string" ? provider : null,
				};
			}),
	};
}

/** Drop rows past the device history window (scheduled maintenance). */
export async function deleteOldSecurityEvents(db: AuthDb, now = Date.now()): Promise<void> {
	await db.delete(schema.securityEvent).where(lt(schema.securityEvent.createdAt, new Date(now - DEVICE_HISTORY_MS)));
}

// ── Per-request scope ────────────────────────────────────────────

export type SecurityScope = {
	request: Request;
	/** Sessions Better Auth created during the request. */
	sessions: { sessionId: string; userId: string }[];
	/** Users a "was this you?" notice already went to during the request. */
	noticed: Set<string>;
	/** Users whose full session the request presented: new sessions for them are rotations. */
	signedIn: Set<string>;
};

const scopeStorage = new AsyncLocalStorage<SecurityScope>();

/** Run `fn` with a fresh scope for `request`; the scope is returned for judging afterwards. */
export async function runInSecurityScope(request: Request, fn: () => Promise<unknown>): Promise<SecurityScope> {
	const scope: SecurityScope = { request, sessions: [], noticed: new Set(), signedIn: new Set() };
	await scopeStorage.run(scope, fn);
	return scope;
}

/** Better Auth's session create hook. Outside a request scope (cron, tests) it's a no-op. */
export function noteSessionCreated(session: { id: string; userId: string }): void {
	scopeStorage.getStore()?.sessions.push({ sessionId: session.id, userId: session.userId });
}

/** The request presented a full session of `userId` (`principalFromHeaders`). */
export function noteSignedInRequest(userId: string): void {
	scopeStorage.getStore()?.signedIn.add(userId);
}

/** A notice went to `userId` in this request: its sign-in doesn't need a second mail. */
export function noteSecurityNotice(userId: string): void {
	scopeStorage.getStore()?.noticed.add(userId);
}
