/**
 * The quoted original as the real message (AVE-133 review round 1): the
 * Worker appends a sanitised HTML quote to replies and forwards, so the
 * original keeps its layout, links, images and emphasis.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	appendQuote,
	bodyHasInlineQuote,
	buildForwardQuote,
	buildReplyQuote,
	quotedBodyHtml,
	sanitizeQuotedHtml,
} from "../../shared/quoted-html.ts";
import { buildQuotedReplyBlock } from "../lib/email-helpers.ts";

const fixtures = JSON.parse(
	readFileSync(new URL("../../shared/quoted-text.fixtures.json", import.meta.url), "utf8"),
);
const newsletter = fixtures.find((f) => f.name.startsWith("marketing")).html;

/** No executable or form markup may survive, whatever the input. */
function assertInert(html, label) {
	assert.doesNotMatch(html, /<script|<style|<iframe|<object|<embed|<form|<input|<button|<svg|<meta|<link|<base/i, `${label}: dangerous tag`);
	assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${label}: event handler`);
	assert.doesNotMatch(html, /javascript:|vbscript:|expression\(/i, `${label}: script URL / CSS expression`);
}

// ── Sanitiser: formatting is kept ─────────────────────────────────

const rich = sanitizeQuotedHtml(
	`<table width="600" cellpadding="0" style="background:#f4f4f4"><tr><td align="center" bgcolor="#000000">` +
		`<h1 style="color:#ffffff;font-size:24px">Big <em>news</em></h1>` +
		`<p>Read the <a href="https://example.com/post?a=1&amp;b=2" title="Post">full post</a>, <strong>today</strong>.</p>` +
		`<img src="https://cdn.example.com/hero.png" alt="Hero" width="300">` +
		`<ul><li>One</li><li><u>Two</u></li></ul></td></tr></table>`,
);
for (const kept of [
	'<table width="600" cellpadding="0" style="background:#f4f4f4">',
	'<td align="center" bgcolor="#000000">',
	'<h1 style="color:#ffffff;font-size:24px">Big <em>news</em></h1>',
	'<a href="https://example.com/post?a=1&amp;b=2" title="Post" target="_blank" rel="noopener noreferrer">full post</a>',
	"<strong>today</strong>",
	'<img src="https://cdn.example.com/hero.png" alt="Hero" width="300">',
	"<ul><li>One</li><li><u>Two</u></li></ul>",
]) {
	assert.ok(rich.includes(kept), `keeps ${kept}\n${rich}`);
}

// Inline (cid) and embedded images survive; mailto/tel links too.
assert.equal(sanitizeQuotedHtml('<img src="cid:logo@x">'), '<img src="cid:logo@x">');
assert.equal(
	sanitizeQuotedHtml('<img src="data:image/png;base64,iVBORw0KGgo=">'),
	'<img src="data:image/png;base64,iVBORw0KGgo=">',
);
assert.match(sanitizeQuotedHtml('<a href="mailto:a@b.co">mail</a>'), /href="mailto:a@b.co"/);

// ── Sanitiser: scripts, handlers, forms and bad URLs go ───────────

const attacks = [
	'<script>alert(1)</script>ok',
	'<SCRIPT src="//evil"></SCRIPT>ok',
	'<img src="https://x/y.png" onerror="alert(1)">',
	'<a href="javascript:alert(1)">x</a>',
	'<a href="  JaVaScRiPt:alert(1)">x</a>',
	'<a href="jav&#x61;script:alert(1)">x</a>',
	'<a href="javascript&colon;alert(1)">x</a>',
	'<a href="java\tscript:alert(1)">x</a>',
	'<img src="data:text/html;base64,PHNjcmlwdD4=">',
	'<div style="background:url(javascript:alert(1))">x</div>',
	'<div style="width: expression(alert(1))">x</div>',
	'<div style="background:\\75rl(javascript:alert(1))">x</div>',
	'<form action="https://evil/login"><input name="pw"><button>Go</button></form>ok',
	'<iframe src="https://evil"></iframe>ok',
	'<svg><script>alert(1)</script><animate onbegin="alert(1)"/></svg>ok',
	'<object data="x"></object><embed src="x">ok',
	'<style>body{display:none}</style>ok',
	'<body onload="alert(1)">ok</body>',
	'<div onclick = alert(1) >x</div>',
	'<p title="a" onmouseover="alert(1)" x="<script>">x</p>',
	'<scr<script>ipt>alert(1)</script>',
	'<script>never closed',
	'<<script>script>alert(1)<</script>/script>',
	'<!--<script>alert(1)</script>-->ok',
	'<![CDATA[<script>alert(1)</script>]]>ok',
	'<meta http-equiv="refresh" content="0;url=https://evil">ok',
	'<base href="https://evil/">ok',
];
for (const attack of attacks) {
	assertInert(sanitizeQuotedHtml(attack), attack);
}
assert.equal(sanitizeQuotedHtml('<a href="javascript:alert(1)">x</a>'), "<a>x</a>");
assert.equal(sanitizeQuotedHtml('<img src="https://x/y.png" onerror="alert(1)">'), '<img src="https://x/y.png">');
assert.equal(sanitizeQuotedHtml("<script>never closed"), "");
assert.equal(sanitizeQuotedHtml('<form action="x"><input name="pw">Hi</form>'), "Hi");
// Attribute values can't break out of their quotes.
assert.equal(sanitizeQuotedHtml(`<p title='a"><script>'>x</p>`), '<p title="a&quot;&gt;&lt;script&gt;">x</p>');

// The real newsletter fixture: inert, still formatted, no CSS / preheader junk leaking as text.
const cleanNewsletter = sanitizeQuotedHtml(newsletter);
assertInert(cleanNewsletter, "newsletter");
assert.match(cleanNewsletter, /<table/);
assert.doesNotMatch(cleanNewsletter, /<title|<head/i);

// ── Sanitiser: the original can't escape the quote container ──────

assert.equal(sanitizeQuotedHtml("a</blockquote></div>b"), "ab");
assert.equal(sanitizeQuotedHtml("<div><b>x</div>y"), "<div><b>x</b></div>y");
assert.equal(sanitizeQuotedHtml("<table><tr><td>open"), "<table><tr><td>open</td></tr></table>");
assert.equal(sanitizeQuotedHtml("<blink>kept text</blink>"), "kept text");
assert.equal(sanitizeQuotedHtml("1 < 2 > 0"), "1 &lt; 2 &gt; 0");

// ── Reply quote ───────────────────────────────────────────────────

const original = {
	date: "2026-10-27T14:05:00.000Z",
	sender: "news@example.com",
	sender_name: "Example News",
	recipient: "me@inboxies.co",
	subject: "October update",
	body: '<p>Hello <b>there</b> <a href="https://example.com">site</a></p><script>alert(1)</script><img src=x onerror=alert(1)>',
};
const reply = buildReplyQuote(original, { timeZone: "America/New_York" });
assertInert(reply.html, "reply quote");
assert.ok(reply.html.startsWith('<br><div class="gmail_quote inboxies_quote">'));
assert.match(
	reply.html,
	/<div dir="ltr" class="gmail_attr">On Tue, Oct 27, 2026, 10:05 AM, Example News &lt;news@example.com&gt; wrote:<br><\/div>/,
);
assert.match(reply.html, /<blockquote class="gmail_quote" type="cite" style="[^"]+">/);
assert.ok(reply.html.includes('<p>Hello <b>there</b> <a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a></p>'));
assert.ok(reply.html.endsWith("</blockquote></div>"));
assert.equal(
	reply.text,
	"\n\nOn Tue, Oct 27, 2026, 10:05 AM, Example News <news@example.com> wrote:\n\n> Hello there site",
);
// Without a zone the date is UTC; a bogus zone falls back to UTC instead of throwing.
assert.match(buildReplyQuote(original).text, /2:05 PM/);
assert.match(buildReplyQuote(original, { timeZone: "Not/AZone" }).text, /2:05 PM/);

// Plain-text original → escaped HTML with line breaks, `> ` text lines.
const plain = buildReplyQuote({ ...original, sender_name: null, body: "Line <1>\nLine 2\n\nBye" });
assert.match(plain.html, /<div dir="auto">Line &lt;1&gt;<br>Line 2<br><br>Bye<\/div>/);
assert.match(plain.html, /news@example.com wrote:/);
assert.ok(plain.text.endsWith("> Line <1>\n> Line 2\n>\n> Bye"));
assert.equal(quotedBodyHtml(""), "");

// Sender names are escaped in the attribution.
assert.match(
	buildReplyQuote({ ...original, sender_name: '<img src=x onerror=alert(1)>"' }).html,
	/&lt;img src=x onerror=alert\(1\)&gt;&quot;/,
);

// ── Forward quote ─────────────────────────────────────────────────

const forward = buildForwardQuote({ ...original, cc: "team@example.com" }, { timeZone: "UTC" });
assertInert(forward.html, "forward quote");
assert.match(
	forward.html,
	/---------- Forwarded message ---------<br>From: Example News &lt;news@example.com&gt;<br>Date: Tue, Oct 27, 2026, 2:05 PM<br>Subject: October update<br>To: me@inboxies.co<br>Cc: team@example.com<br><\/div><br>/,
);
assert.ok(forward.html.includes("<p>Hello <b>there</b>"));
assert.doesNotMatch(forward.html, /<blockquote/);
assert.ok(forward.text.includes("---------- Forwarded message ---------\nFrom: Example News <news@example.com>"));
assert.ok(forward.text.endsWith("\n\nHello there site"));

// ── appendQuote ───────────────────────────────────────────────────

const appended = appendQuote({ html: "<p>Thanks!</p>", text: "Thanks!\n" }, reply);
assert.equal(appended.html, `<p>Thanks!</p>${reply.html}`);
assert.equal(appended.text, `Thanks!${reply.text}`);
// A text-only reply still gets a formatted HTML part.
const textOnly = appendQuote({ text: "Hi <you>\n\nBye" }, reply);
assert.ok(textOnly.html.startsWith("<p>Hi &lt;you&gt;</p><p>Bye</p><br><div class=\"gmail_quote"));

// ── Drafts that already carry a quote send as-is ──────────────────

assert.equal(bodyHasInlineQuote('<p>Hi</p><br><blockquote style="border-left: 2px solid #ccc">On x wrote:</blockquote>'), true);
assert.equal(bodyHasInlineQuote("<p>x</p><div><strong>Forwarded message:</strong><br>"), true);
assert.equal(bodyHasInlineQuote("Hi\n\n---------- Forwarded message ----------\nFrom: a"), true);
assert.equal(bodyHasInlineQuote("<p>Just a reply</p>"), false);
assert.equal(bodyHasInlineQuote(null), false);

// ── Agent / MCP replies use the same HTML quote ───────────────────

const agentQuote = buildQuotedReplyBlock({
	date: original.date,
	sender: original.sender,
	sender_name: original.sender_name,
	body: original.body,
});
assertInert(agentQuote, "agent quote");
assert.match(agentQuote, /class="gmail_quote inboxies_quote"/);
assert.match(agentQuote, /<b>there<\/b>/);
assert.equal(buildQuotedReplyBlock({ sender: "a@b.c" }), "");

console.log("quoted-html: ok");
