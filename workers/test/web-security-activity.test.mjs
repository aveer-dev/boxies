/**
 * Web "Recent security activity" labels (AVE-151): every kind the Worker
 * records gets a human label, and the time/detail helpers stay stable.
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import { relativeTime, securityEventDetail, securityEventTitle } from "../../app/lib/security-activity.ts";
import { SECURITY_EVENT_KINDS } from "../auth/security-activity.ts";

// ── Every recorded kind has its own label ──

const FALLBACK = "Account security change";
for (const kind of SECURITY_EVENT_KINDS) {
	const title = securityEventTitle({ kind, newDevice: false, provider: null });
	assert.notEqual(title, FALLBACK, `${kind} needs a label`);
	assert.ok(!title.includes("_"), `${kind} label looks raw: ${title}`);
}
assert.equal(securityEventTitle({ kind: "something_new" }), FALLBACK);

assert.equal(securityEventTitle({ kind: "sign_in", newDevice: false }), "Signed in");
assert.equal(securityEventTitle({ kind: "sign_in", newDevice: true }), "Signed in from a new device");
assert.equal(securityEventTitle({ kind: "password_changed" }), "Password changed");
assert.equal(securityEventTitle({ kind: "password_reset" }), "Password reset");
assert.equal(securityEventTitle({ kind: "two_factor_enabled" }), "Two-factor authentication turned on");
assert.equal(securityEventTitle({ kind: "two_factor_disabled" }), "Two-factor authentication turned off");
assert.equal(securityEventTitle({ kind: "recovery_email_set" }), "Recovery email changed");
assert.equal(securityEventTitle({ kind: "sign_in_method_added", provider: "google" }), "Google sign-in connected");
assert.equal(securityEventTitle({ kind: "sign_in_method_removed", provider: "apple" }), "Apple sign-in removed");
assert.equal(securityEventTitle({ kind: "sign_in_method_added", provider: "credential" }), "Password sign-in connected");
assert.equal(securityEventTitle({ kind: "sign_in_method_added", provider: "github" }), "Github sign-in connected");
assert.equal(securityEventTitle({ kind: "sign_in_method_removed", provider: null }), "Sign-in method removed");

// ── Detail: device and approximate location only ──

assert.equal(securityEventDetail({ device: "Chrome on macOS", location: "Lagos, Nigeria" }), "Chrome on macOS · Lagos, Nigeria");
assert.equal(securityEventDetail({ device: "Chrome on macOS", location: null }), "Chrome on macOS");
assert.equal(securityEventDetail({ device: null, location: "Nigeria" }), "Nigeria");
assert.equal(securityEventDetail({ device: "  ", location: null }), "");

// ── Relative time ──

const now = Date.parse("2026-11-02T12:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();
const MIN = 60_000;
assert.equal(relativeTime(ago(10_000), now), "Just now");
assert.equal(relativeTime(ago(-60_000), now), "Just now", "clock skew never reads as the future");
assert.equal(relativeTime(ago(5 * MIN), now), "5 min ago");
assert.equal(relativeTime(ago(3 * 60 * MIN), now), "3 hr ago");
assert.equal(relativeTime(ago(30 * 60 * MIN), now), "Yesterday");
assert.equal(relativeTime(ago(4 * 24 * 60 * MIN), now), "4 days ago");
assert.equal(relativeTime("not a date", now), "");

console.log("web-security-activity: ok");
