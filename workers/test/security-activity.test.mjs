/**
 * Security notifications and recent security activity (AVE-151), on a real
 * SQLite AUTH_DB through the real session middleware and the request scope
 * workers/app.ts installs:
 * - the device fingerprint (browser/app + OS family, IP prefix, country) and
 *   the new-device rule: same family on the same prefix or in the same
 *   country is known; the very first sign-in never counts as new;
 * - every sign-in is recorded after the response; one from a new device mails
 *   the login and the verified recovery email, a known one doesn't, and a
 *   session a two-factor challenge deletes again isn't a sign-in at all;
 * - two-factor on/off and password resets mail and are recorded;
 * - recipients: login + verified recovery email + a replaced recovery address;
 * - GET /api/v1/me/security-activity: signed in only, the caller's own
 *   events, the last 30 days, newest first.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/security-activity.test.mjs
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { sessionMiddleware } from "../auth/middleware.ts";
import { handleBetterAuthRequest } from "../routes/better-auth.ts";
import { issueLinkToken } from "../auth/otp.ts";
import * as schema from "../auth/schema.ts";
import {
	ACTIVITY_WINDOW_MS,
	DEVICE_HISTORY_MS,
	classifySignIn,
	deleteOldSecurityEvents,
	deviceLabel,
	ipPrefix,
	isKnownDevice,
	locationLabel,
	recordSecurityEvent,
	requestDevice,
} from "../auth/security-activity.ts";
import { securityNoticeEmail, securityNoticeRecipients } from "../auth/security-notice.ts";
import { withSecurityScope } from "../auth/security-scope.ts";
import { addUser, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

const CHROME_MAC =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CHROME_MAC_NEWER =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";
const EDGE_WIN =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const SAFARI_IOS =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DAY = 24 * 60 * 60 * 1000;

// ── Device fingerprint ───────────────────────────────────────────
{
	assert.equal(deviceLabel(CHROME_MAC), "Chrome on macOS");
	assert.equal(deviceLabel(CHROME_MAC_NEWER), "Chrome on macOS", "versions don't matter");
	assert.equal(deviceLabel(FIREFOX_WIN), "Firefox on Windows");
	assert.equal(deviceLabel(EDGE_WIN), "Edge on Windows");
	assert.equal(deviceLabel(SAFARI_IOS), "Safari on iOS");
	assert.equal(deviceLabel("Inboxies/42 CFNetwork/1568.100.1 Darwin/24.0.0"), "Inboxies app on iOS");
	assert.equal(deviceLabel("okhttp/4.12.0"), "Inboxies app on Android");
	assert.equal(deviceLabel("curl/8.0"), "Unknown device");
	assert.equal(deviceLabel(""), null);
	assert.equal(deviceLabel(null), null);

	assert.equal(ipPrefix("203.0.113.42"), "203.0.113.0/24");
	assert.equal(ipPrefix("::ffff:203.0.113.42"), "203.0.113.0/24");
	assert.equal(ipPrefix("2001:db8:abcd:12::1"), "2001:db8:abcd::/48");
	assert.equal(ipPrefix("2001:0db8:abcd:0012:0000:0000:0000:0001"), "2001:db8:abcd::/48");
	assert.equal(ipPrefix("::1"), "0:0:0::/48");
	assert.equal(ipPrefix("999.1.1.1"), null);
	assert.equal(ipPrefix("not an ip"), null);
	assert.equal(ipPrefix(""), null);

	const req = new Request("https://inboxies.test/", {
		headers: { "user-agent": FIREFOX_WIN, "cf-connecting-ip": "198.51.100.7", "cf-ipcountry": "ng" },
	});
	assert.deepEqual(requestDevice(req), {
		device: "Firefox on Windows",
		ipPrefix: "198.51.100.0/24",
		country: "NG",
		city: null,
	});
	assert.equal(requestDevice(new Request("https://x.test/", { headers: { "cf-ipcountry": "XX" } })).country, null);
	assert.equal(locationLabel("NG", "Lagos"), "Lagos, Nigeria");
	assert.equal(locationLabel("DE", null), "Germany");
	assert.equal(locationLabel(null, null), null);
}

// ── The new-device rule ──────────────────────────────────────────
{
	const home = { device: "Chrome on macOS", ipPrefix: "203.0.113.0/24", country: "NG" };
	const seen = [home];
	assert.equal(isKnownDevice(home, seen), true, "same family, same network");
	assert.equal(isKnownDevice({ ...home, ipPrefix: "198.51.100.0/24" }, seen), true, "same family, new network, same country");
	assert.equal(isKnownDevice({ ...home, ipPrefix: null }, seen), true, "same family, unknown network, same country");
	assert.equal(isKnownDevice({ ...home, country: "DE" }, seen), true, "same family, same network (country moved)");
	assert.equal(
		isKnownDevice({ ...home, ipPrefix: "198.51.100.0/24", country: "DE" }, seen),
		false,
		"same family, new network in a new country",
	);
	assert.equal(isKnownDevice({ ...home, device: "Firefox on Windows" }, seen), false, "new family on a known network");
	assert.equal(isKnownDevice({ ...home, ipPrefix: null, country: null }, seen), false, "nothing to match on");
	assert.equal(isKnownDevice(home, []), false);
}

// ── Recipients: login, verified recovery email, replaced address ─
{
	const { env, db } = createAuthTestEnv();
	const ada = await addUser(db, { id: "ada", email: "ada@example.com" });
	assert.deepEqual(await securityNoticeRecipients(env, ada), ["ada@example.com"], "no recovery email yet");
	await db.insert(schema.recoveryEmail).values({ userId: "ada", email: "ada.pending@gmail.com", verifiedAt: null });
	assert.deepEqual(await securityNoticeRecipients(env, ada), ["ada@example.com"], "unverified recovery email doesn't get mail");
	await db.update(schema.recoveryEmail).set({ email: "ada.new@gmail.com", verifiedAt: new Date() });
	assert.deepEqual(
		(await securityNoticeRecipients(env, ada, { extra: ["Ada.Old@gmail.com", null, "ada@example.com"] })).sort(),
		["ada.new@gmail.com", "ada.old@gmail.com", "ada@example.com"],
		"login + verified recovery + the old recovery address, de-duplicated and lowercased",
	);
	const pia = await addUser(db, { id: "pia", email: "pia@users.inboxies.invalid" });
	assert.deepEqual(await securityNoticeRecipients(env, pia), [], "a placeholder login gets nothing");
}

// ── Notice body: device and approximate location, never an address ─
{
	const mail = securityNoticeEmail({
		change: { kind: "new_device_sign_in" },
		login: "ada@example.com",
		when: new Date("2026-10-31T09:15:00Z"),
		settingsUrl: "https://inboxies.test/settings/sign-in",
		device: { device: "Firefox on Windows", ipPrefix: "198.51.100.0/24", country: "NG", city: "Lagos" },
	});
	assert.equal(mail.subject, "New sign-in to your Inboxies account");
	assert.match(mail.text, /Device: Firefox on Windows/);
	assert.match(mail.text, /Location: Lagos, Nigeria \(approximate\)/);
	assert.match(mail.text, /When: 2026-10-31 09:15 UTC/);
	assert.match(mail.text, /https:\/\/inboxies\.test\/settings\/sign-in/);
	assert.doesNotMatch(mail.text + mail.html, /198\.51\.100/, "no IP in the mail");
}

// ── HTTP: the same stack as workers/app.ts (scope → Better Auth → session → API) ─
const { env, d1, db, email } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@example.com", password: "ada password 123" });
const bob = await addUser(db, { id: "bob", email: "bob@example.com", password: "bob password 123" });
await db.insert(schema.recoveryEmail).values({ userId: "ada", email: "ada.backup@gmail.com", verifiedAt: new Date() });

const app = new Hono();
app.use("*", (c, next) => withSecurityScope(c.env, c.req.raw, c.executionCtx, next));
app.on(["GET", "POST"], "/api/auth/*", (c) => handleBetterAuthRequest(c.env, c.req.raw, c.executionCtx));
app.use("*", sessionMiddleware);
app.route("/", apiApp);

const pending = [];
const executionCtx = { waitUntil: (p) => pending.push(p), passThroughOnException() {}, props: {} };
async function settle() {
	while (pending.length) await pending.shift();
}

const HOME = { ua: CHROME_MAC, ip: "203.0.113.10", country: "NG" };
async function call({ method = "GET", path, body, token, from = HOME }) {
	const headers = { "user-agent": from.ua, "cf-connecting-ip": from.ip, "cf-ipcountry": from.country };
	if (body !== undefined) headers["content-type"] = "application/json";
	if (token) headers.authorization = `Bearer ${token}`;
	const res = await app.fetch(
		new Request(`https://inboxies.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
		env,
		executionCtx,
	);
	const payload = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : await res.text();
	await settle();
	return { status: res.status, payload, headers: res.headers };
}
async function passwordSignIn(user, password, from) {
	const res = await call({ method: "POST", path: "/api/auth/sign-in/email", body: { email: user.email, password }, from });
	assert.equal(res.status, 200, JSON.stringify(res.payload));
	return res;
}
const signIns = (userId) =>
	d1.prepare("select * from security_event where user_id = ? and kind = 'sign_in' order by created_at").bind(userId).all().then((r) => r.results);
const newMail = (since) => email.sent.slice(since);

// First sign-in: recorded, nothing to compare against, no mail.
{
	const before = email.sent.length;
	const first = await passwordSignIn(ada, "ada password 123", HOME);
	assert.ok(first.headers.get("set-auth-token"));
	const rows = await signIns("ada");
	assert.equal(rows.length, 1);
	assert.equal(rows[0].device, "Chrome on macOS");
	assert.equal(rows[0].ip_prefix, "203.0.113.0/24");
	assert.equal(rows[0].country, "NG");
	assert.equal(rows[0].new_device, 0);
	assert.deepEqual(newMail(before), [], "the first sign-in doesn't mail");
	const all = await d1.prepare("select * from security_event").all();
	assert.ok(!JSON.stringify(all.results).includes("203.0.113.10"), "the full address isn't stored");
}

// A known device (same family, other network in the same country): no mail.
{
	const before = email.sent.length;
	await passwordSignIn(ada, "ada password 123", { ua: CHROME_MAC_NEWER, ip: "198.51.100.20", country: "NG" });
	assert.equal((await signIns("ada")).length, 2);
	assert.equal((await signIns("ada"))[1].new_device, 0);
	assert.deepEqual(newMail(before), []);
}

// A new device: recorded as such, mailed to the login and the recovery email.
{
	const before = email.sent.length;
	await passwordSignIn(ada, "ada password 123", { ua: FIREFOX_WIN, ip: "192.0.2.50", country: "DE" });
	const rows = await signIns("ada");
	assert.equal(rows.length, 3);
	assert.equal(rows[2].new_device, 1);
	const mails = newMail(before);
	assert.deepEqual(mails.map((m) => m.to).sort(), ["ada.backup@gmail.com", "ada@example.com"]);
	for (const m of mails) {
		assert.equal(m.subject, "New sign-in to your Inboxies account");
		assert.match(m.text, /Device: Firefox on Windows/);
		assert.match(m.text, /Location: Germany \(approximate\)/);
		assert.doesNotMatch(m.text, /192\.0\.2/);
	}
	// The same device again is known now.
	const again = email.sent.length;
	await passwordSignIn(ada, "ada password 123", { ua: FIREFOX_WIN, ip: "192.0.2.51", country: "DE" });
	assert.deepEqual(newMail(again), []);
}

// Sign-ins older than 90 days don't make a device known; the sweep drops them.
{
	const now = Date.now();
	await d1.prepare("delete from security_event where user_id = 'bob'").run();
	await d1.prepare("delete from session where user_id = 'bob'").run();
	await recordSecurityEvent(db, {
		userId: "bob",
		kind: "sign_in",
		device: { device: "Safari on iOS", ipPrefix: "203.0.113.0/24", country: "NG", city: null },
		at: new Date(now - DEVICE_HISTORY_MS - DAY),
	});
	const current = { device: "Safari on iOS", ipPrefix: "203.0.113.0/24", country: "NG" };
	assert.deepEqual(await classifySignIn(db, { userId: "bob", sessionId: "s-new", current, now }), {
		newDevice: false,
		firstSignIn: true,
	});
	await recordSecurityEvent(db, {
		userId: "bob",
		kind: "sign_in",
		device: { device: "Firefox on Windows", ipPrefix: "192.0.2.0/24", country: "DE", city: null },
		at: new Date(now - 10 * DAY),
	});
	assert.deepEqual(await classifySignIn(db, { userId: "bob", sessionId: "s-new", current, now }), {
		newDevice: true,
		firstSignIn: false,
	});
	// A live session counts as seen (activity from before this table existed).
	const live = await signIn(env, bob, { headers: new Headers({ "user-agent": SAFARI_IOS, "cf-connecting-ip": "203.0.113.99" }) });
	assert.equal((await classifySignIn(db, { userId: "bob", sessionId: "s-new", current, now })).newDevice, false);
	assert.equal(
		(await classifySignIn(db, { userId: "bob", sessionId: live.sessionId, current, now })).newDevice,
		true,
		"the session being judged doesn't vouch for itself",
	);
	await deleteOldSecurityEvents(db, now);
	assert.equal(await d1.prepare("select count(*) as n from security_event where user_id = 'bob'").first("n"), 1);
}

// Two-factor: turning it on/off mails and is recorded; a challenged password
// sign-in creates and deletes a session, which is no sign-in.
function base32Decode(input) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const ch of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
	const bytes = [];
	for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
	return Buffer.from(bytes);
}
function totp(secretBase32, at = Date.now()) {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
	const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
	const offset = mac[mac.length - 1] & 0xf;
	return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
{
	const { token } = await signIn(env, ada);
	const enable = await call({ method: "POST", path: "/api/auth/two-factor/enable", token, body: { password: "ada password 123" } });
	assert.equal(enable.status, 200);
	const secret = new URL(enable.payload.totpURI).searchParams.get("secret");
	const before = email.sent.length;
	const signInsAtSetup = (await signIns("ada")).length;
	const confirm = await call({ method: "POST", path: "/api/auth/two-factor/verify-totp", token, body: { code: totp(secret) } });
	assert.equal(confirm.status, 200);
	// Better Auth rotates the session on setup: not a sign-in.
	assert.equal((await signIns("ada")).length, signInsAtSetup, "a rotated session is not a sign-in");
	const rotated = confirm.headers.get("set-auth-token") ?? token;
	const on = newMail(before);
	assert.deepEqual(on.map((m) => m.to).sort(), ["ada.backup@gmail.com", "ada@example.com"]);
	assert.ok(on.every((m) => m.subject === "Two-factor authentication was turned on for your Inboxies account"));

	const signInsBefore = (await signIns("ada")).length;
	const challenged = await call({
		method: "POST",
		path: "/api/auth/sign-in/email",
		body: { email: ada.email, password: "ada password 123" },
		from: { ua: EDGE_WIN, ip: "100.64.0.1", country: "US" },
	});
	assert.equal(challenged.status, 200);
	assert.equal(challenged.payload.twoFactorRedirect, true);
	assert.equal((await signIns("ada")).length, signInsBefore, "a two-factor challenge is not a sign-in");

	const off0 = email.sent.length;
	const disable = await call({ method: "POST", path: "/api/auth/two-factor/disable", token: rotated, body: { password: "ada password 123" } });
	assert.equal(disable.status, 200);
	assert.ok(newMail(off0).length >= 1);
	assert.ok(newMail(off0).every((m) => m.subject === "Two-factor authentication was turned off for your Inboxies account"));
	const kinds = (await d1.prepare("select kind from security_event where user_id = 'ada'").all()).results.map((r) => r.kind);
	assert.ok(kinds.includes("two_factor_enabled") && kinds.includes("two_factor_disabled"));
}

// Password reset from a new device: one reset notice, the sign-in it makes is
// recorded without a second (new-device) mail.
{
	const token = await issueLinkToken(db, "password-reset", "ada", 60 * 60 * 1000);
	const before = email.sent.length;
	const reset = await call({
		method: "POST",
		path: "/api/v1/auth/password/reset",
		body: { token, newPassword: "a brand new password 456" },
		from: { ua: SAFARI_IOS, ip: "100.100.0.1", country: "JP" },
	});
	assert.equal(reset.status, 200, JSON.stringify(reset.payload));
	const mails = newMail(before);
	assert.deepEqual(mails.map((m) => m.subject), ["Your Inboxies password was reset", "Your Inboxies password was reset"]);
	assert.match(mails[0].text, /Device: Safari on iOS/);
	const last = (await signIns("ada")).at(-1);
	assert.equal(last.device, "Safari on iOS");
	assert.equal(last.new_device, 1, "still flagged in the activity list");
}

// ── GET /api/v1/me/security-activity ─────────────────────────────
{
	assert.equal((await call({ path: "/api/v1/me/security-activity" })).status, 401, "signed in only");

	const now = Date.now();
	await recordSecurityEvent(db, { userId: "ada", kind: "passkey_added", at: new Date(now - ACTIVITY_WINDOW_MS - DAY) });
	await recordSecurityEvent(db, {
		userId: "ada",
		kind: "sign_in_method_added",
		detail: { provider: "google" },
		at: new Date(now - 2 * DAY),
	});
	await recordSecurityEvent(db, { userId: "bob", kind: "password_changed", at: new Date(now - DAY) });

	const { token } = await signIn(env, ada);
	const res = await call({ path: "/api/v1/me/security-activity", token });
	assert.equal(res.status, 200, JSON.stringify(res.payload));
	const { since, events } = res.payload;
	assert.ok(Math.abs(Date.parse(since) - (now - ACTIVITY_WINDOW_MS)) < 60_000, "30-day window");
	assert.ok(events.length > 0);
	const ids = new Set(
		(await d1.prepare("select id from security_event where user_id = 'ada'").all()).results.map((r) => r.id),
	);
	assert.ok(events.every((e) => ids.has(e.id)), "only the caller's events");
	assert.ok(!events.some((e) => e.kind === "passkey_added"), "nothing older than 30 days");
	assert.ok(!events.some((e) => e.kind === "password_changed"), "not bob's");
	const sorted = [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
	assert.deepEqual(events, sorted, "newest first");
	for (const e of events) {
		assert.deepEqual(Object.keys(e).sort(), ["country", "createdAt", "device", "id", "kind", "location", "newDevice", "provider"]);
	}
	const linked = events.find((e) => e.kind === "sign_in_method_added");
	assert.equal(linked.provider, "google");
	const flagged = events.find((e) => e.kind === "sign_in" && e.newDevice);
	assert.equal(flagged.device, "Safari on iOS");
	assert.equal(flagged.location, "Japan");
	assert.equal(flagged.country, "JP");

	// Extension / AutoFill tokens can't read it.
	const scoped = await signIn(env, ada, { scope: "aliases", label: "Browser extension" });
	assert.equal((await call({ path: "/api/v1/me/security-activity", token: scoped.token })).status, 403);
}

console.log("security-activity: ok");
