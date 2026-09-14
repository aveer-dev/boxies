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

console.log("push-payload.test.mjs: ok");
