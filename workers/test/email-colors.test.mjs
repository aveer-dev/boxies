/**
 * Dark mode: which emails keep their own colours (light paper card) and which
 * take the app theme. iOS and Android run the same fixtures in their unit tests.
 * Run: pnpm test:unit email-colors
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailHasOwnColors } from "../../shared/email-colors.ts";

const fixtures = JSON.parse(
	readFileSync(new URL("../../shared/email-colors.fixtures.json", import.meta.url), "utf8"),
);

assert.ok(fixtures.length > 10, "fixtures load");
for (const { name, html, ownColors } of fixtures) {
	assert.equal(emailHasOwnColors(html), ownColors, name);
}

console.log("email-colors tests passed");
