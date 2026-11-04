/**
 * Push alert copy: preview as body, subject as subtitle / FCM first line.
 * Run: node --experimental-strip-types workers/test/push-payload.test.mjs
 */

import assert from "node:assert/strict";
import { composePushAlert } from "../lib/push-payload.ts";

const withPreview = composePushAlert({
	subject: "Quarterly report",
	snippet: "<p>Here are the numbers for Q3.</p>",
});
assert.equal(withPreview.subtitle, "Quarterly report");
assert.equal(withPreview.body, "Here are the numbers for Q3.");
assert.equal(withPreview.fcmBody, "Quarterly report\nHere are the numbers for Q3.");

const noPreview = composePushAlert({
	subject: "Hello",
	snippet: "",
});
assert.equal(noPreview.subtitle, undefined);
assert.equal(noPreview.body, "Hello");
assert.equal(noPreview.fcmBody, "Hello");

const emptySubject = composePushAlert({
	subject: "   ",
	snippet: "Just a body preview",
});
assert.equal(emptySubject.subtitle, "(No subject)");
assert.equal(emptySubject.body, "Just a body preview");
assert.equal(emptySubject.fcmBody, "(No subject)\nJust a body preview");

const neither = composePushAlert({ subject: null, snippet: null });
assert.equal(neither.body, "(No subject)");
assert.equal(neither.fcmBody, "(No subject)");

// AVE-180: Uber-style preheader padding must not leak into the notification.
const padding = "&shy; &zwnj; &#847; &nbsp; ".repeat(12);
const uber = composePushAlert({
	subject: "Flexible earnings",
	snippet: `Flexible earnings are waiting for you. ${padding}­​‌⁠﻿͏ You could earn $40 this week.`,
});
assert.equal(uber.body, "Flexible earnings are waiting for you. You could earn $40 this week.");
assert.doesNotMatch(uber.body, /&[a-z#0-9]+;/i);
assert.doesNotMatch(uber.body, /[­͏᠎​-‍⁠﻿]/);
assert.equal(uber.fcmBody, `Flexible earnings\n${uber.body}`);

// Padding long enough to hit the 140-char cut still truncates to visible text.
const longPadded = composePushAlert({
	subject: "s",
	snippet: `Hi ${"&shy; ".repeat(200)}${"word ".repeat(40)}`,
});
assert.ok(longPadded.body.startsWith("Hi word word"));
assert.ok(longPadded.body.endsWith("…"));
assert.ok(longPadded.body.length <= 141);

// Named + numeric entities decode; already-decoded < > text is not a tag.
const quotes = composePushAlert({
	subject: "s",
	snippet: "Don&rsquo;t miss it &#8217; &#x2019; &ldquo;today&rdquo; &mdash; &lt;b&gt;bold&lt;/b&gt; &amp; more",
});
assert.equal(quotes.body, "Don’t miss it ’ ’ “today” — <b>bold</b> & more");

// A snippet that is only padding falls back to the subject.
const onlyPadding = composePushAlert({ subject: "Promo", snippet: "&shy; &zwnj;&#847;​ " });
assert.equal(onlyPadding.subtitle, undefined);
assert.equal(onlyPadding.body, "Promo");

// ZWJ inside an emoji sequence survives; stray ZWJ padding does not.
const emoji = composePushAlert({ subject: "s", snippet: "Family 👨‍👩‍👧 ‍‍ hi" });
assert.equal(emoji.body, "Family 👨‍👩‍👧 hi");

console.log("push-payload.test.mjs: ok");
