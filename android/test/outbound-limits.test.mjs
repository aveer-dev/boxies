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
// Videos attach when they fit (AVE-183): no blanket rejection, and an
// oversized file is named by size against the shared 5 MB label.
assert.doesNotMatch(source, /Videos aren't supported/);
assert.match(source, /LIMIT_LABEL = "5 MB"/);
assert.match(source, /Messages can be up to \$LIMIT_LABEL, attachments included\./);
assert.match(source, /byteLength <= 256 \* 1024/);
assert.match(source, /fun remainingBudget/);
assert.match(source, /fun estimateMessageBytes/);
assert.match(source, /flattenOntoWhite/);
assert.match(source, /Color\.WHITE/);
assert.match(source, /hasAlpha\(\)/);

console.log("android outbound-limits tests passed");
