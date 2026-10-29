/**
 * Quoted original in replies/forwards (AVE-133): HTML → clean plain text,
 * shared by web, Worker, iOS and Android via shared/quoted-text.fixtures.json.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { htmlToQuotedText } from "../../shared/quoted-text.ts";
import { buildQuotedReplyBlock } from "../lib/email-helpers.ts";

const fixtures = JSON.parse(
	readFileSync(new URL("../../shared/quoted-text.fixtures.json", import.meta.url), "utf8"),
);
assert.ok(fixtures.length >= 5);
for (const { name, html, expected } of fixtures) {
	assert.equal(htmlToQuotedText(html), expected, name);
}

const newsletter = fixtures.find((f) => f.name.startsWith("marketing")).html;
const quoted = htmlToQuotedText(newsletter);
for (const junk of ["&shy;", "­", "͏", "‌", "spooky season", "body{", "mso", "nested hidden", "Uber</title>"]) {
	assert.ok(!quoted.includes(junk), `newsletter quote leaks ${JSON.stringify(junk)}`);
}
assert.ok(!/\n{3,}/.test(quoted), "no runs of blank lines");

// Source-code newlines/indentation inside HTML are not content.
assert.equal(htmlToQuotedText("<div>\n   Hello\n   world\n</div>"), "Hello world");
// Unbalanced hidden element only drops the opening tag, not the rest of the mail.
assert.equal(htmlToQuotedText('<div style="display: none">Keep me'), "Keep me");
assert.equal(htmlToQuotedText(""), "");
assert.equal(htmlToQuotedText(null), "");

// The Worker's agent/MCP quote is HTML now (see quoted-html.test.mjs); its
// text/plain part still comes from htmlToQuotedText. An empty original adds no quote.
const block = buildQuotedReplyBlock({
	date: "2026-10-27T17:46:00Z",
	sender: "uber@uber.com",
	sender_name: "Uber",
	body: newsletter,
});
assert.ok(block.includes("Uber &lt;uber@uber.com&gt; wrote:"));
assert.ok(!/<style|<script|<title/i.test(block));
assert.equal(buildQuotedReplyBlock({ sender: "a", body: "<p>&nbsp;</p>" }), "", "no empty quote block");

console.log("quoted-text: ok");
