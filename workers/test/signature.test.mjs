/**
 * Mailbox signature sanitising and plain-text form (AVE-204).
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	normalizeSignatureSetting,
	sanitizeSignatureHtml,
	signatureContentHtml,
	signatureHtmlToText,
	withStoredSignature,
} from "../../shared/signature.ts";
import { composeBodyHasUserContent } from "../../shared/compose-body.ts";
import { sanitizeQuotedHtml } from "../../shared/quoted-html.ts";

// Allowlist: basic formatting and http(s)/mailto links only.
assert.equal(
	sanitizeSignatureHtml('<p style="color:red"><strong>Ada</strong> <em>Lovelace</em></p>'),
	"<p><strong>Ada</strong> <em>Lovelace</em></p>",
);
assert.equal(sanitizeSignatureHtml("<p>Hi<script>alert(1)</script><style>p{}</style></p>"), "<p>Hi</p>");
assert.equal(sanitizeSignatureHtml('<img src="https://t.example/x.gif">Ada'), "Ada");
assert.equal(sanitizeSignatureHtml('<a href="javascript:alert(1)">x</a>'), "x");
assert.equal(sanitizeSignatureHtml('<a href="data:text/html,hi">x</a>'), "x");
assert.equal(
	sanitizeSignatureHtml('<a href="mailto:ada@example.com" onclick="x()">Mail</a>'),
	'<a href="mailto:ada@example.com" target="_blank" rel="noopener noreferrer">Mail</a>',
);
assert.equal(sanitizeSignatureHtml("<table><tr><td>Ada</td></tr></table>"), "Ada");
assert.equal(sanitizeSignatureHtml("<p><b>open"), "<p><b>open</b></p>");

// Plain text keeps lines and link targets.
assert.equal(
	signatureHtmlToText('<p><b>Ada</b></p><p>CEO, <a href="https://ada.example">Ada &amp; Co</a></p>'),
	"Ada\nCEO, Ada & Co (https://ada.example)",
);
assert.equal(signatureHtmlToText('<p><a href="https://ada.example">https://ada.example</a></p>'), "https://ada.example");
assert.equal(signatureHtmlToText('<a href="mailto:ada@example.com">ada@example.com</a>'), "ada@example.com");
assert.equal(signatureHtmlToText("<p>Ada<br>Line two</p><ul><li>One</li><li>Two</li></ul>"), "Ada\nLine two\n• One\n• Two");

// Rendering for compose.
assert.equal(signatureContentHtml({ enabled: false, text: "Ada" }), "");
assert.equal(signatureContentHtml({ enabled: true, text: "" }), "");
assert.equal(signatureContentHtml({ enabled: true, text: "Ada <ceo>\nAda & Co" }), "Ada &lt;ceo&gt;<br>Ada &amp; Co");
assert.equal(
	signatureContentHtml({ enabled: true, text: "fallback", html: '<p>Ada<img src="x" onerror="alert(1)"></p>' }),
	"<p>Ada</p>",
);
assert.equal(signatureContentHtml({ enabled: true, text: "Ada", html: "<p><br></p>" }), "Ada");

// What the Worker stores.
assert.deepEqual(normalizeSignatureSetting({ enabled: true, text: "  Ada\r\nCEO  " }), {
	ok: true,
	signature: { enabled: true, text: "Ada\nCEO" },
});
assert.deepEqual(normalizeSignatureSetting({ enabled: true, text: "stale", html: "<p><i>Ada</i></p>" }), {
	ok: true,
	signature: { enabled: true, text: "Ada", html: "<p><i>Ada</i></p>" },
});
assert.deepEqual(normalizeSignatureSetting({ enabled: "yes", text: "Ada", html: "<p></p>" }), {
	ok: true,
	signature: { enabled: false, text: "Ada" },
});
assert.deepEqual(normalizeSignatureSetting(null), { ok: true, signature: null });
assert.equal(normalizeSignatureSetting({ enabled: true, html: "x".repeat(10_001) }).ok, false);
assert.equal(normalizeSignatureSetting({ enabled: true, text: "x".repeat(2_001) }).ok, false);
assert.deepEqual(
	withStoredSignature({ fromName: "Ada", signature: { enabled: true, html: "<b>Ada</b><script>x</script>" } }),
	{ fromName: "Ada", signature: { enabled: true, text: "Ada", html: "<b>Ada</b>" } },
);
assert.deepEqual(withStoredSignature({ fromName: "Ada" }), { fromName: "Ada" });

// The quote sanitiser is unchanged by the shared allowlist core.
assert.equal(
	sanitizeQuotedHtml('<p style="color:red"><img src="https://x.example/a.png">hi</p>'),
	'<p style="color:red"><img src="https://x.example/a.png">hi</p>',
);

// A formatted signature alone is not draft content.
const block = `<p><br></p><p><br></p><div style="border-top: 1px solid #ccc;">${signatureContentHtml({
	enabled: true,
	text: "",
	html: '<p><b>Ada</b></p><p><a href="https://ada.example">Site</a></p>',
})}</div>`;
assert.equal(composeBodyHasUserContent(block, block), false);
assert.equal(composeBodyHasUserContent(`<p>Hello</p>${block}`, block), true);

console.log("signature tests passed");
