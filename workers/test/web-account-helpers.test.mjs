/**
 * Web account helpers: session labels and the settings blob the web PUTs.
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import { writableMailboxSettings } from "../../app/lib/mailbox-settings.ts";
import { describeSession, describeUserAgent } from "../../app/lib/session-label.ts";

// ── writableMailboxSettings: never echo the synthesized ACL back ──

{
	const settings = {
		fromName: "Ada",
		forwarding: { enabled: true, email: "ada@example.com" },
		acl: { owners: ["email:ada@example.com"], members: [] },
		canManage: true,
	};
	const out = writableMailboxSettings(settings);
	assert.deepEqual(out, { fromName: "Ada", forwarding: { enabled: true, email: "ada@example.com" } });
	assert.ok(!("acl" in out));
	assert.ok(!("canManage" in out));
	// The caller's object (often the cached query data) is left alone.
	assert.ok("acl" in settings);
}

assert.deepEqual(writableMailboxSettings(undefined), {});
assert.deepEqual(writableMailboxSettings(null), {});
assert.deepEqual(writableMailboxSettings([1, 2]), {});
assert.deepEqual(writableMailboxSettings("x"), {});
assert.deepEqual(writableMailboxSettings({}), {});

// ── describeUserAgent ──

const CHROME_MAC =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
const EDGE_WIN =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";
const CHROME_ANDROID =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const CHROME_IOS =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1";

assert.equal(describeUserAgent(CHROME_MAC), "Chrome on macOS");
assert.equal(describeUserAgent(SAFARI_IPHONE), "Safari on iOS");
assert.equal(describeUserAgent(FIREFOX_WIN), "Firefox on Windows");
assert.equal(describeUserAgent(EDGE_WIN), "Edge on Windows");
assert.equal(describeUserAgent(CHROME_ANDROID), "Chrome on Android");
assert.equal(describeUserAgent(CHROME_IOS), "Chrome on iOS");
assert.equal(describeUserAgent("AgenticInbox/42 CFNetwork/1568.100.1 Darwin/24.0.0"), "Inboxies for iOS");
assert.equal(describeUserAgent("okhttp/4.12.0"), "Inboxies for Android");
assert.equal(describeUserAgent("curl/8.7.1"), null);
assert.equal(describeUserAgent(""), null);
assert.equal(describeUserAgent(null), null);

// ── describeSession: label first, then device, then a fallback ──

assert.equal(describeSession({ label: "Browser extension", userAgent: CHROME_MAC }), "Browser extension");
assert.equal(describeSession({ label: "  ", userAgent: CHROME_MAC }), "Chrome on macOS");
assert.equal(describeSession({ label: null, userAgent: null }), "Unknown device");

console.log("web-account-helpers: ok");
