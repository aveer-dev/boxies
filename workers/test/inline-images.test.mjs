/**
 * AVE-110: inline cid: images in the web reader. The sandboxed reader iframe
 * can't load attachment URLs (opaque origin, no session cookie), so the app
 * fetches referenced inline images and swaps cid: for data: URLs.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/inline-images.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	MAX_INLINE_IMAGE_BYTES,
	MAX_INLINE_IMAGES_TOTAL_BYTES,
	inlineImageMimeType,
	normalizeContentId,
	referencesContentId,
	replaceContentIds,
	selectInlineImages,
} from "../../shared/inline-images.ts";

// Content ids
assert.equal(normalizeContentId("<img1@hc>"), "img1@hc");
assert.equal(normalizeContentId(" img1@hc "), "img1@hc");
assert.equal(normalizeContentId("<>"), null);
assert.equal(normalizeContentId(null), null);

// Only plain image types
assert.equal(inlineImageMimeType("image/png"), "image/png");
assert.equal(inlineImageMimeType("Image/JPEG; name=a.jpg"), "image/jpeg");
assert.equal(inlineImageMimeType("image/svg+xml"), "image/svg+xml");
assert.equal(inlineImageMimeType("text/html"), null);
assert.equal(inlineImageMimeType("application/octet-stream"), null);
assert.equal(inlineImageMimeType("image/png\"><script>"), null);
assert.equal(inlineImageMimeType(undefined), null);

// References: whole ids only, either form, case-insensitive scheme and id
const body = '<p>Hi</p><img src="cid:img1@hc"><img src=\'CID:<Logo@HC>\'><div style="background:url(cid:bg@hc)"></div>';
assert.equal(referencesContentId(body, "<img1@hc>"), true);
assert.equal(referencesContentId(body, "logo@hc"), true);
assert.equal(referencesContentId(body, "bg@hc"), true);
assert.equal(referencesContentId(body, "img1"), false, "a prefix of an id is not a reference");
assert.equal(referencesContentId('<img src="cid:img10@hc">', "img1@hc"), false);
assert.equal(referencesContentId("", "img1@hc"), false);
assert.equal(referencesContentId('<img src="cid:a%20b@hc">', "a b@hc"), true, "percent-encoded ids match");

// Selection
const att = (id, cid, mimetype = "image/png", size = 1000) => ({ id, content_id: cid, mimetype, size });
const attachments = [
	att("a1", "<img1@hc>"),
	att("a2", "logo@hc", "image/gif"),
	att("a3", "unused@hc"), // not referenced
	att("a4", "bg@hc", "text/html"), // not an image
	att("a5", null), // no content id
	att("a6", "<img1@hc>"), // duplicate content id
];
assert.deepEqual(selectInlineImages(body, attachments).map((a) => a.id), ["a1", "a2"]);
assert.deepEqual(selectInlineImages("<p>no images</p>", attachments), []);
assert.deepEqual(selectInlineImages(body, undefined), []);
assert.deepEqual(selectInlineImages(body, []), []);

// Size caps: per image and in total
assert.equal(MAX_INLINE_IMAGE_BYTES, 5 * 1024 * 1024);
assert.equal(MAX_INLINE_IMAGES_TOTAL_BYTES, 20 * 1024 * 1024);
assert.deepEqual(
	selectInlineImages(body, [att("big", "img1@hc", "image/png", MAX_INLINE_IMAGE_BYTES + 1), att("ok", "logo@hc")]).map((a) => a.id),
	["ok"],
);
const many = Array.from({ length: 6 }, (_, i) => `<img src="cid:p${i}@hc">`).join("");
assert.deepEqual(
	selectInlineImages(many, Array.from({ length: 6 }, (_, i) => att(`p${i}`, `p${i}@hc`, "image/png", 4 * 1024 * 1024))).map((a) => a.id),
	["p0", "p1", "p2", "p3", "p4"],
	"total cap stops at 20 MB",
);
assert.deepEqual(
	selectInlineImages(body, [att("a1", "img1@hc")], { maxBytes: 10 }),
	[],
);

// Replacement
const png = "data:image/png;base64,iVBORw0KGgo=";
const gif = "data:image/gif;base64,R0lGODlh";
const out = replaceContentIds(body, new Map([["<img1@hc>", png], ["logo@hc", gif]]));
assert.ok(out.includes(`<img src="${png}">`));
assert.ok(out.includes(`<img src='${gif}'>`), "cid:<id> form is replaced whole");
assert.ok(out.includes("url(cid:bg@hc)"), "references with no image are left alone");
assert.equal(replaceContentIds('<img src="cid:img10@hc">', new Map([["img1@hc", png]])), '<img src="cid:img10@hc">');
assert.equal(replaceContentIds(body, new Map()), body);
// `$` patterns in the replacement are literal
assert.equal(replaceContentIds('<img src="cid:x@hc">', new Map([["x@hc", "data:image/png;base64,$&$1"]])), '<img src="data:image/png;base64,$&$1">');
// Regex metacharacters in ids don't throw or over-match
assert.equal(replaceContentIds('<img src="cid:a.b+c@hc"><img src="cid:aXb+c@hc">', new Map([["a.b+c@hc", png]])), `<img src="${png}"><img src="cid:aXb+c@hc">`);

// The reader routes received bodies through the loader, and the sandbox stays opaque.
const iframe = readFileSync(new URL("../../app/components/EmailIframe.tsx", import.meta.url), "utf8");
assert.match(iframe, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
assert.doesNotMatch(iframe, /sandbox="[^"]*allow-same-origin/);
for (const file of ["SingleMessageView.tsx", "ThreadMessage.tsx"]) {
	const source = readFileSync(new URL(`../../app/components/email-panel/${file}`, import.meta.url), "utf8");
	assert.match(source, /<MessageBody /, `${file} renders bodies through MessageBody`);
	assert.doesNotMatch(source, /<EmailIframe/, `${file} doesn't bypass the inline-image loader`);
}

console.log("inline-images: ok");
