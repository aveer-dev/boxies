/**
 * Email content R2 helpers: keys, snippets, simple MIME, delete key list.
 * Run: node --experimental-strip-types workers/test/email-content.test.mjs
 */

import assert from "node:assert/strict";
import {
	SNIPPET_MAX_LENGTH,
	buildSimpleMime,
	computeSnippet,
	emailBodyKey,
	emailContentKeys,
	emailRawKey,
} from "../lib/email-content.ts";

assert.equal(emailBodyKey("abc"), "emails/abc/body.html");
assert.equal(emailRawKey("abc"), "emails/abc/raw.eml");
assert.deepEqual(emailContentKeys("abc"), [
	"emails/abc/body.html",
	"emails/abc/raw.eml",
]);

assert.equal(computeSnippet(""), "");
assert.equal(computeSnippet("short"), "short");
const long = "x".repeat(SNIPPET_MAX_LENGTH + 50);
assert.equal(computeSnippet(long).length, SNIPPET_MAX_LENGTH);
assert.equal(computeSnippet(long), long.slice(0, SNIPPET_MAX_LENGTH));

const mime = buildSimpleMime(
	{
		from: "Ada <ada@example.com>",
		to: "bob@example.com",
		subject: "Hello",
		date: "Mon, 13 Sep 2026 12:00:00 +0000",
		messageId: "mid@example.com",
		inReplyTo: "<prev@example.com>",
	},
	"<p>Hi</p>",
);
assert.match(mime, /^From: Ada <ada@example.com>\r\n/);
assert.match(mime, /To: bob@example.com\r\n/);
assert.match(mime, /Subject: Hello\r\n/);
assert.match(mime, /Message-ID: <mid@example.com>\r\n/);
assert.match(mime, /In-Reply-To: <prev@example.com>\r\n/);
assert.match(mime, /Content-Type: text\/html; charset=utf-8\r\n/);
assert.match(mime, /\r\n\r\n<p>Hi<\/p>$/);

const plain = buildSimpleMime({ from: "a@b.c", to: "d@e.f" }, "just text");
assert.match(plain, /Content-Type: text\/plain; charset=utf-8\r\n/);
assert.match(plain, /\r\n\r\njust text$/);

console.log("email-content tests passed");
