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
const webRemoteImages = readFileSync(join(repo, "shared/remote-images.ts"), "utf8");
const webSingle = readFileSync(join(repo, "app/components/email-panel/SingleMessageView.tsx"), "utf8");
const webThread = readFileSync(join(repo, "app/components/email-panel/ThreadMessage.tsx"), "utf8");
// Both reader views render bodies through MessageBody (inline cid images, AVE-110).
const webMessageBody = readFileSync(join(repo, "app/components/email-panel/MessageBody.tsx"), "utf8");
const iosDetail = readFileSync(
	join(repo, "ios/AgenticInbox/Inboxies/Views/Email/EmailDetailView.swift"),
	"utf8",
);

const csp =
	"default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'unsafe-inline'";
// iOS runs no page script at all (its height probe is an app-world WKUserScript),
// so it keeps web's opted-in img-src but forbids every script.
const iosCsp =
	"default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: https:; script-src 'none'";

assert.match(webIframe, /DOMPurify\.sanitize/);
// Web fills img-src per message from shared/remote-images.ts: remote images
// load by default; Spam blocks them until the reader taps "Load images".
assert.match(
	webIframe,
	/default-src 'none'; style-src 'unsafe-inline'; img-src \$\{imgSrc\}; script-src 'unsafe-inline'/,
);
assert.match(webIframe, /emailImgSrc\(\{/, "web img-src comes from the shared Spam rule");
assert.match(webRemoteImages, /`data: cid: https: \$\{options\.origin\}`/, "default img-src allows https like native");
assert.match(webRemoteImages, /`data: cid: \$\{options\.origin\}`/, "Spam img-src blocks remote images");
assert.match(webRemoteImages, /folderId === Folders\.SPAM/, "web blocks only Spam");
assert.match(webIframe, /Load images/, "web keeps the Spam opt-in bar");
for (const [name, src] of [
	["web SingleMessageView", webSingle],
	["web ThreadMessage", webThread],
]) {
	assert.match(src, /<MessageBody email=\{email\}/, `${name} renders the body through MessageBody`);
}
assert.match(
	webMessageBody,
	/blockRemoteImages=\{blocksRemoteImages\(email\.folder_id\)\}/,
	"web MessageBody blocks by the message's own folder",
);

for (const [name, src] of [
	["android sanitizer", androidSanitizer],
	["ios sanitizer", iosSanitizer],
	["android EmailBodyView", androidView],
	["ios EmailBodyView", iosView],
]) {
	assert.match(src, /inboxies\.invalid/, `${name} keeps the opaque origin`);
}

assert.ok(androidSanitizer.includes(csp), "android CSP matches web's opted-in policy");
assert.ok(iosSanitizer.includes(iosCsp), "ios CSP matches web's opted-in policy with page script off");
assert.ok(
	iosSanitizer.includes("img-src data: cid:; script-src 'none'"),
	"ios has a Spam policy that blocks remote images",
);
assert.ok(
	androidSanitizer.includes("img-src data: cid:; script-src 'unsafe-inline'"),
	"android has a Spam policy that blocks remote images",
);
// Spam only (Gmail parity): same rule as web shared/remote-images.ts.
assert.match(iosSanitizer, /static func blocksRemoteImages\(folderId: String\?\) -> Bool \{\s*folderId == "spam"\s*\}/);
assert.match(androidSanitizer, /fun blocksRemoteImages\(folderId: String\?\): Boolean = folderId == "spam"/);
assert.match(iosDetail, /blocksRemoteImages: EmailHTMLSanitizer\.blocksRemoteImages\(folderId: message\.folderId\)/);
assert.match(androidView, /EmailHtmlSanitizer\.blocksRemoteImages\(email\.folderId\)/);
assert.match(androidView, /val allowRemoteImages = !blocksRemoteImages \|\| loadedRemoteImages/);
assert.match(iosView, /!blocksRemoteImages \|\| loadedRemoteImages/);
for (const [name, src] of [
	["android EmailBodyView", androidView],
	["ios EmailBodyView", iosView],
]) {
	assert.match(src, /Load images/, `${name} keeps the Spam opt-in bar`);
}
assert.doesNotMatch(iosSanitizer, /script-src 'unsafe-inline'/, "ios never allows page script");
assert.doesNotMatch(iosView, /allowsJavaScript: true/, "ios body views keep page JS off");
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
