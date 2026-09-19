/**
 * Android outbound compose limits must match the shared 5 MiB JPEG policy.
 * Run: node android/test/outbound-limits.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/util/OutboundAttachments.kt"),
	"utf8",
);

assert.match(source, /MAX_MESSAGE_BYTES = 5 \* 1024 \* 1024/);
assert.match(source, /Message exceeds the 5 MiB outbound limit/);
assert.match(source, /MAX_IMAGE_EDGE = 1600/);
assert.match(source, /0\.72f, 0\.55f, 0\.4f/);
assert.match(source, /Videos aren't supported \(5 MiB send limit\)/);
assert.match(source, /byteLength <= 256 \* 1024/);
assert.match(source, /fun remainingBudget/);
assert.match(source, /fun estimateMessageBytes/);

console.log("android outbound-limits tests passed");
