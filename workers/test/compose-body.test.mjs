/**
 * Signature-only compose bodies should not count as draft content.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { composeBodyHasUserContent } from "../../shared/compose-body.ts";

const spacer = "<p><br></p><p><br></p>";
const signature = `${spacer}<div style="border-top: 1px solid #ccc;">Sent with Inboxies Email</div>`;

assert.equal(composeBodyHasUserContent("", signature), false);
assert.equal(composeBodyHasUserContent(signature, signature), false);
assert.equal(composeBodyHasUserContent(`${spacer}${signature}`, signature), false);
assert.equal(
	composeBodyHasUserContent("<p></p><p>Sent with Inboxies Email</p>", signature),
	false,
);

assert.equal(composeBodyHasUserContent("<p>Hello</p>", signature), true);
assert.equal(composeBodyHasUserContent(`<p>Hello</p>${signature}`, signature), true);
assert.equal(composeBodyHasUserContent("<p>Hello</p>", ""), true);
assert.equal(composeBodyHasUserContent("<p><br></p>", ""), false);

console.log("compose-body tests passed");
