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


// One-time code leads the body (AVE-175).
const withCode = composePushAlert({
	subject: "Your verification code",
	snippet: "Use 482913 to sign in.",
	oneTimeCode: "482913",
});
assert.equal(withCode.subtitle, "Your verification code");
assert.equal(withCode.body, "Code 482913 · Use 482913 to sign in.");
assert.equal(withCode.fcmBody, "Code 482913 · Your verification code\nUse 482913 to sign in.");

const codeNoPreview = composePushAlert({ subject: "Sign-in code", snippet: "", oneTimeCode: "K7Q2XP" });
assert.equal(codeNoPreview.body, "Code K7Q2XP · Sign-in code");
assert.equal(codeNoPreview.fcmBody, "Code K7Q2XP · Sign-in code");

const nullCode = composePushAlert({ subject: "Hello", snippet: "Hi", oneTimeCode: null });
assert.equal(nullCode.body, "Hi");

console.log("push-payload.test.mjs: ok");
