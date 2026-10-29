/**
 * Assistant markdown images render as links, never as a loading <img> (AVE-108).
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import { markdownImageLabel, markdownImageLinkHref } from "../../app/lib/markdown-image.ts";

// http(s) URLs become a link target (normalized).
assert.equal(markdownImageLinkHref("https://evil.test/c?d=secret"), "https://evil.test/c?d=secret");
assert.equal(markdownImageLinkHref("  http://example.com/a.png "), "http://example.com/a.png");
assert.equal(markdownImageLinkHref("HTTPS://Example.com"), "https://example.com/");

// Everything else gets no link.
for (const src of [
	"javascript:alert(1)",
	" JavaScript:alert(1)",
	"data:image/png;base64,AAAA",
	"vbscript:x",
	"file:///etc/passwd",
	"/relative.png",
	"//evil.test/x.png",
	"relative.png",
	"",
	"   ",
	undefined,
	null,
	42,
]) {
	assert.equal(markdownImageLinkHref(src), null, `expected no link for ${String(src)}`);
}

assert.equal(markdownImageLabel("Chart"), "Chart");
assert.equal(markdownImageLabel("  "), "image");
assert.equal(markdownImageLabel(undefined), "image");

console.log("markdown-image: ok");
