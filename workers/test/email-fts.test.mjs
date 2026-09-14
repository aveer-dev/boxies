/**
 * Unit tests for FTS helpers: search text extraction + MATCH sanitizer.
 * Run: node --experimental-strip-types workers/test/email-fts.test.mjs
 */

import assert from "node:assert/strict";
import {
	FTS_BODY_MAX_LENGTH,
	computeSearchText,
	formatFtsRecipients,
	sanitizeFtsQuery,
} from "../lib/email-fts.ts";

// --- computeSearchText ---
assert.equal(computeSearchText(""), "");
assert.equal(
	computeSearchText("<p>Hello <b>world</b></p>"),
	"Hello world",
);
assert.equal(
	computeSearchText("<p>ignored html</p>", { plainText: "prefer plain" }),
	"prefer plain",
);
assert.equal(
	computeSearchText("<style>.x{}</style><p>Keep me</p>"),
	"Keep me",
);

const longPlain = "word ".repeat(FTS_BODY_MAX_LENGTH);
const truncated = computeSearchText(longPlain);
assert.equal(truncated.length, FTS_BODY_MAX_LENGTH);
assert.ok(!truncated.includes("<"));

// --- formatFtsRecipients ---
assert.equal(formatFtsRecipients("a@x.com", "b@x.com", null), "a@x.com b@x.com");
assert.equal(formatFtsRecipients(null, null, "c@x.com"), "c@x.com");
assert.equal(formatFtsRecipients(null, null, null), "");

// --- sanitizeFtsQuery ---
assert.equal(sanitizeFtsQuery(""), null);
assert.equal(sanitizeFtsQuery("   "), null);
assert.equal(sanitizeFtsQuery("***"), null);
assert.equal(sanitizeFtsQuery("hello"), `"hello"*`);
assert.equal(sanitizeFtsQuery("hello world"), `"hello"* "world"*`);
assert.equal(sanitizeFtsQuery('say "hi"'), `"say"* "hi"*`);
assert.equal(sanitizeFtsQuery("from:alice"), `"fromalice"*`);
assert.equal(sanitizeFtsQuery("AND OR NOT"), null);
assert.equal(sanitizeFtsQuery("invoice AND receipt"), `"invoice"* "receipt"*`);

console.log("email-fts tests passed");
