/**
 * AVE-195: tracking pixels are stripped from bodies the mailbox serves, in
 * every folder; other images stay. The reader note's strings are shared with
 * iOS and Android through shared/tracker-note.fixtures.json.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/tracking-pixels.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	blockTrackingPixels,
	shouldBlockTrackingPixels,
	trackerNote,
	trackingPixel,
} from "../../shared/tracking-pixels.ts";

const pixel = (tag) => trackingPixel(tag);

// ── Invisible remote images go ────────────────────────────────────
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" width="1" height="1">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" width="1px" height="1px" alt="">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" width="0" height="0">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" height="0">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" style="width:1px;height:1px">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" style="display: none !important">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" style="visibility:hidden">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" style="opacity:0">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" style="max-height:0;overflow:hidden">`), { service: null });
assert.deepEqual(pixel(`<img src="https://news.example.com/o/abc" hidden>`), { service: null });
assert.deepEqual(pixel(`<img src="//news.example.com/o/abc" width=1 height=1 />`), { service: null });
assert.deepEqual(pixel(`<IMG SRC='http://news.example.com/o/abc' WIDTH='1' HEIGHT='1'>`), { service: null });

// Invisible on a known host: named.
assert.deepEqual(
	pixel(`<img src="https://trk.klaviyo.com/open?x=1" width="1" height="1">`),
	{ service: "Klaviyo" },
);
assert.deepEqual(
	pixel(`<img src="https://t.hubspotemail.net/e2t/to/abc" style="display:none">`),
	{ service: "HubSpot" },
);

// Known open-pixel endpoints go whatever size they claim.
assert.deepEqual(
	pixel(`<img src="https://example.us1.list-manage.com/track/open.php?u=1&amp;id=2" width="600">`),
	{ service: "Mailchimp" },
);
assert.deepEqual(pixel(`<img src="https://u123.ct.sendgrid.net/wf/open?upn=abc">`), { service: "SendGrid" });
assert.deepEqual(pixel(`<img src="https://abc.r.us-east-1.awstrack.me/I0/0100/abc">`), { service: "Amazon SES" });
assert.deepEqual(pixel(`<img src="https://mailtrack.io/trace/mail/abc.png">`), { service: "Mailtrack" });
assert.deepEqual(pixel(`<img src="https://mandrillapp.com/track/open.php?u=1">`), { service: "Mailchimp" });

// ── Ordinary images stay ──────────────────────────────────────────
assert.equal(pixel(`<img src="https://cdn.example.com/hero.jpg" width="600" height="300">`), undefined);
assert.equal(pixel(`<img src="https://cdn.example.com/hero.jpg">`), undefined);
assert.equal(pixel(`<img src="https://cdn.example.com/logo.png" width="120">`), undefined);
// Known ESP host serving a real (visible) image: not touched.
assert.equal(pixel(`<img src="https://mcusercontent.com/abc/images/hero.png" width="600">`), undefined);
assert.equal(pixel(`<img src="https://gallery.mailchimp.com/abc/images/hero.png" width="600" height="200">`), undefined);
assert.equal(pixel(`<img src="https://example.us1.list-manage.com/images/logo.png" width="200">`), undefined);
// Thin divider: 1px tall but wide.
assert.equal(pixel(`<img src="https://cdn.example.com/line.png" width="600" height="1">`), undefined);
// CSS width wins over the attribute.
assert.equal(pixel(`<img src="https://cdn.example.com/line.png" width="1" height="1" style="width:100%;height:auto">`), undefined);
// Hidden but sized: a mobile/desktop image swap, not a pixel.
assert.equal(pixel(`<img src="https://cdn.example.com/mobile.png" width="320" style="display:none">`), undefined);
// Layout spacers on unknown hosts.
assert.equal(pixel(`<img src="https://cdn.example.com/img/spacer.gif" width="1" height="1">`), undefined);
assert.equal(pixel(`<img src="https://cdn.example.com/blank.gif" width="1" height="1">`), undefined);
// Inline and data images are never remote.
assert.equal(pixel(`<img src="cid:image001@example.com" width="1" height="1">`), undefined);
assert.equal(pixel(`<img src="data:image/gif;base64,R0lGOD" width="1" height="1">`), undefined);
assert.equal(pixel(`<img width="1" height="1">`), undefined);
// `max-width:600px` isn't a width.
assert.equal(pixel(`<img src="https://cdn.example.com/a.png" style="max-width:600px;height:1px">`), undefined);

// ── Whole bodies ──────────────────────────────────────────────────
const body = [
	`<p>Hello</p>`,
	`<img src="https://cdn.example.com/hero.jpg" width="600" alt="Hero">`,
	`<img src="https://example.us1.list-manage.com/track/open.php?u=1&amp;id=2" height="1" width="1" border="0" style="height:1px!important;width:1px!important">`,
	`<img alt="" src="https://news.example.com/o/abc>def" width="1" height="1">`,
	`<img src="https://u1.ct.sendgrid.net/wf/open?upn=x">`,
	`<img src="https://u1.ct.sendgrid.net/wf/open?upn=y">`,
].join("\n");
const result = blockTrackingPixels(body);
assert.equal(result.blocked?.count, 4);
assert.deepEqual(result.blocked?.services, ["Mailchimp", "SendGrid"]);
assert.match(result.html, /hero\.jpg/);
assert.doesNotMatch(result.html, /list-manage|sendgrid|news\.example/);
assert.match(result.html, /<p>Hello<\/p>/);

// Nothing to remove: same string back, no note.
const plain = `<p>Hi</p><img src="https://cdn.example.com/a.png">`;
assert.deepEqual(blockTrackingPixels(plain), { html: plain, blocked: null });
assert.deepEqual(blockTrackingPixels("Just text"), { html: "Just text", blocked: null });
assert.deepEqual(blockTrackingPixels(""), { html: "", blocked: null });

// Every folder but Drafts (the user's own body).
for (const folder of ["inbox", "promotions", "updates", "spam", "archive", "sent", "trash", "screener", null, undefined]) {
	assert.equal(shouldBlockTrackingPixels(folder), true, `${folder} blocks trackers`);
}
assert.equal(shouldBlockTrackingPixels("draft"), false);

// ── Reader note (shared with iOS and Android) ─────────────────────
const fixtures = JSON.parse(
	readFileSync(new URL("../../shared/tracker-note.fixtures.json", import.meta.url), "utf8"),
);
assert.ok(fixtures.length >= 8);
for (const fixture of fixtures) {
	assert.equal(trackerNote(fixture.blocked), fixture.note, fixture.name);
}

console.log("tracking-pixels: ok");
