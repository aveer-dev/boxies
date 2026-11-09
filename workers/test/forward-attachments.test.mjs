/**
 * Which of an original's files a forward carries (AVE-181): real attachments
 * only, never the inline `cid:` images that are part of the body. iOS and
 * Android check the same fixtures.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	forwardableAttachments,
	includeAttachmentsLabel,
	isInlineBodyPart,
} from "../../shared/forward-attachments.ts";

const fixtures = JSON.parse(
	readFileSync(new URL("../../shared/forward-attachments.fixtures.json", import.meta.url), "utf8"),
);
assert.ok(fixtures.length >= 10);

for (const fixture of fixtures) {
	const picked = forwardableAttachments(fixture.attachments, fixture.body).map((a) => a.id);
	assert.deepEqual(picked, fixture.forwardable, fixture.name);
}

assert.deepEqual(forwardableAttachments(undefined, "<p>x</p>"), []);
assert.deepEqual(forwardableAttachments(null, null), []);
assert.equal(isInlineBodyPart({ id: "x", disposition: " Inline " }, ""), true);
assert.equal(isInlineBodyPart({ id: "x", mimetype: "image/png", content_id: "a@b" }, null), false);

assert.equal(includeAttachmentsLabel(1), "Include 1 attachment");
assert.equal(includeAttachmentsLabel(3), "Include 3 attachments");

console.log("forward-attachments tests passed");
