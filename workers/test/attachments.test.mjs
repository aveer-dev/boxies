/**
 * Attachment R2 key helpers + mailbox purge key collection.
 * Run: node --experimental-strip-types workers/test/attachments.test.mjs
 */

import assert from "node:assert/strict";
import {
	R2_DELETE_CHUNK_SIZE,
	attachmentKey,
	collectMailboxPurgeR2Keys,
	deleteEmailAttachments,
	deleteR2Keys,
	sanitizeAttachmentFilename,
} from "../lib/attachments.ts";
import { emailContentKeys } from "../lib/email-content.ts";

assert.equal(sanitizeAttachmentFilename("a/b\\c:d"), "a_b_c_d");
assert.equal(sanitizeAttachmentFilename(null), "untitled");
assert.equal(sanitizeAttachmentFilename(""), "untitled");

assert.equal(
	attachmentKey("email-1", "att-1", "report.pdf"),
	"attachments/email-1/att-1/report.pdf",
);
assert.equal(
	attachmentKey("email-1", "att-1", "evil/../x.pdf"),
	"attachments/email-1/att-1/evil_.._x.pdf",
);

const emailIds = ["e1", "e2"];
const attachments = [
	{ email_id: "e1", id: "a1", filename: "one.txt" },
	{ email_id: "e2", id: "a2", filename: "two.bin" },
];
const keys = collectMailboxPurgeR2Keys(emailIds, attachments, emailContentKeys);
assert.deepEqual(keys, [
	...emailContentKeys("e1"),
	...emailContentKeys("e2"),
	"attachments/e1/a1/one.txt",
	"attachments/e2/a2/two.bin",
]);

function createMockBucket() {
	/** @type {Map<string, string>} */
	const store = new Map();
	return {
		store,
		async put(key, value) {
			store.set(key, String(value));
			return null;
		},
		async delete(input) {
			const list = Array.isArray(input) ? input : [input];
			for (const key of list) store.delete(key);
		},
	};
}

const bucket = createMockBucket();
const emailId = "del-email-1";
const attKey = attachmentKey(emailId, "att-x", "file.png");
await bucket.put(attKey, "bytes");
await bucket.put(attachmentKey(emailId, "att-y", "other.pdf"), "bytes");
assert.equal(bucket.store.size, 2);

await deleteEmailAttachments(bucket, emailId, [
	{ id: "att-x", filename: "file.png" },
]);
assert.equal(bucket.store.has(attKey), false);
assert.equal(bucket.store.has(attachmentKey(emailId, "att-y", "other.pdf")), true);

// Chunked delete covers multi-key purge lists
const many = [];
for (let i = 0; i < R2_DELETE_CHUNK_SIZE + 5; i++) {
	const k = `purge-key-${i}`;
	many.push(k);
	await bucket.put(k, "x");
}
await deleteR2Keys(bucket, many);
for (const k of many) {
	assert.equal(bucket.store.has(k), false);
}

console.log("attachments tests passed");
