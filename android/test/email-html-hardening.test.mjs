/**
 * Native HTML mail rendering must match web EmailIframe: sanitize + CSP +
 * opaque origin + link intercept, and must not expose a page-world JS bridge.
 * Run: node android/test/email-html-hardening.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");

const androidView = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/ui/email/EmailBodyView.kt"),
	"utf8",
);
const androidSanitizer = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/util/EmailHtmlSanitizer.kt"),
	"utf8",
);
const iosView = readFileSync(
	join(repo, "ios/AgenticInbox/Inboxies/Views/Email/EmailBodyView.swift"),
	"utf8",
);
const iosSanitizer = readFileSync(
	join(repo, "ios/AgenticInbox/Inboxies/Services/EmailHTMLSanitizer.swift"),
	"utf8",
);
const webIframe = readFileSync(
	join(repo, "app/components/EmailIframe.tsx"),
	"utf8",
);

const csp =
	"default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'unsafe-inline'";

assert.match(webIframe, /DOMPurify\.sanitize/);
// Web fills img-src per message: remote images are blocked until the reader
// opts in, and the opted-in policy is the shared one below.
assert.match(
	webIframe,
	/default-src 'none'; style-src 'unsafe-inline'; img-src \$\{imgSrc\}; script-src 'unsafe-inline'/,
);
assert.match(webIframe, /\? "data: cid: https:"/, "opted-in img-src matches native");
assert.match(webIframe, /`data: cid: \$\{window\.location\.origin\}`/, "default blocks remote images");

for (const [name, src] of [
	["android sanitizer", androidSanitizer],
	["ios sanitizer", iosSanitizer],
	["android EmailBodyView", androidView],
	["ios EmailBodyView", iosView],
]) {
	assert.match(src, /inboxies\.invalid/, `${name} keeps the opaque origin`);
}

assert.ok(androidSanitizer.includes(csp), "android CSP matches web's opted-in policy");
assert.ok(iosSanitizer.includes(csp), "ios CSP matches web's opted-in policy");
assert.match(androidSanitizer, /CONTENT_SECURITY_POLICY/);
assert.match(iosSanitizer, /contentSecurityPolicy/);
assert.match(androidView, /CONTENT_SECURITY_POLICY/);
assert.match(iosView, /contentSecurityPolicy/);
assert.match(androidView, /Content-Security-Policy/);
assert.match(iosView, /Content-Security-Policy/);

assert.match(androidView, /shouldOverrideUrlLoading/);
assert.match(androidView, /hasGesture\(\)/);
assert.match(iosView, /decidePolicyFor navigationAction/);
assert.match(iosView, /createWebViewWith/);
assert.match(iosView, /WKWebsiteDataStore\.nonPersistent|websiteDataStore = \.nonPersistent/);
assert.match(iosView, /contentWorld/);
assert.match(iosView, /WKContentWorld\.defaultClient/);
assert.match(androidView, /allowFileAccess = false/);
assert.match(androidView, /MIXED_CONTENT_NEVER_ALLOW/);
assert.match(androidView, /javaScriptCanOpenWindowsAutomatically = false/);
assert.match(iosView, /javaScriptCanOpenWindowsAutomatically = false/);
assert.match(androidView, /EmailHtmlSanitizer\.sanitize/);
assert.match(iosView, /EmailHTMLSanitizer\.sanitize/);

assert.doesNotMatch(
	androidView,
	/addJavascriptInterface/,
	"Android must not expose a page-world JavascriptInterface",
);
assert.doesNotMatch(androidView, /InboxiesNative/);
assert.doesNotMatch(androidView, /extractQuotedReplies/);
assert.doesNotMatch(iosView, /quotedContent/);
assert.doesNotMatch(iosView, /extractQuotedReplies/);

assert.match(androidSanitizer, /fun sanitize/);
assert.match(iosSanitizer, /static func sanitize/);
assert.match(androidSanitizer, /splitQuotedReplies/);
assert.match(iosSanitizer, /splitQuotedReplies/);
assert.match(androidSanitizer, /import org\.jsoup/);
assert.match(iosSanitizer, /import SwiftSoup/);

console.log("email-html-hardening contract ok");
