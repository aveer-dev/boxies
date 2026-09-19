/**
 * Mailbox purge R2 cleanup (mirrors MailboxDO.purgeMailbox inventory delete).
 * Run: node --experimental-strip-types workers/test/mailbox-purge.test.mjs
 */

import assert from "node:assert/strict";
import {
	attachmentKey,
	collectMailboxPurgeR2Keys,
	deleteR2Keys,
} from "../lib/attachments.ts";
import {
	deleteEmailContent,
	emailBodyKey,
	emailContentKeys,
	emailRawKey,
	storeEmailContent,
} from "../lib/email-content.ts";

function createMockBucket() {
	/** @type {Map<string, string | Uint8Array>} */
	const store = new Map();
	return {
		store,
		async put(key, value) {
			if (typeof value === "string") {
				store.set(key, value);
			} else if (value instanceof ArrayBuffer) {
				store.set(key, new Uint8Array(value));
			} else if (ArrayBuffer.isView(value)) {
				store.set(key, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
			} else {
				store.set(key, String(value));
			}
			return null;
		},
		async get(key) {
			if (!store.has(key)) return null;
			const value = store.get(key);
			return {
				async text() {
					if (typeof value === "string") return value;
					return new TextDecoder().decode(value);
				},
			};
		},
		async delete(keys) {
			const list = Array.isArray(keys) ? keys : [keys];
			for (const key of list) store.delete(key);
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
	};
}

const bucket = createMockBucket();
const emailA = "purge-mail-a";
const emailB = "purge-mail-b";
const metaKey = "mailboxes/hello@inboxies.email.json";

await storeEmailContent(bucket, emailA, {
	htmlOrText: "<p>A</p>",
	rawMime: "From: a@b.c\r\n\r\nA",
});
await storeEmailContent(bucket, emailB, {
	htmlOrText: "<p>B</p>",
	rawMime: "From: a@b.c\r\n\r\nB",
});
const attA = attachmentKey(emailA, "att-1", "invoice.pdf");
const attB = attachmentKey(emailB, "att-2", "photo.jpg");
await bucket.put(attA, "pdf-bytes");
await bucket.put(attB, "jpg-bytes");
await bucket.put(metaKey, JSON.stringify({ fromName: "Hello" }));

assert.ok(bucket.store.has(emailBodyKey(emailA)));
assert.ok(bucket.store.has(emailRawKey(emailB)));
assert.ok(bucket.store.has(attA));
assert.ok(bucket.store.has(metaKey));

// Simulate purgeMailbox inventory delete (metadata kept until after purge).
const keys = collectMailboxPurgeR2Keys(
	[emailA, emailB],
	[
		{ email_id: emailA, id: "att-1", filename: "invoice.pdf" },
		{ email_id: emailB, id: "att-2", filename: "photo.jpg" },
	],
	emailContentKeys,
);
await deleteR2Keys(bucket, keys);

assert.equal(bucket.store.has(emailBodyKey(emailA)), false);
assert.equal(bucket.store.has(emailRawKey(emailA)), false);
assert.equal(bucket.store.has(emailBodyKey(emailB)), false);
assert.equal(bucket.store.has(emailRawKey(emailB)), false);
assert.equal(bucket.store.has(attA), false);
assert.equal(bucket.store.has(attB), false);
// Metadata survives until the HTTP handler deletes it last.
assert.equal(bucket.store.has(metaKey), true);

await bucket.delete(metaKey);
assert.equal(bucket.store.has(metaKey), false);

// deleteEmail-style path: body + attachments for one message
const single = "single-del";
await storeEmailContent(bucket, single, { htmlOrText: "<p>x</p>", rawMime: "x" });
const singleAtt = attachmentKey(single, "a9", "note.txt");
await bucket.put(singleAtt, "note");
await deleteEmailContent(bucket, single);
await deleteR2Keys(bucket, [singleAtt]);
assert.equal(bucket.store.has(emailBodyKey(single)), false);
assert.equal(bucket.store.has(singleAtt), false);

console.log("mailbox-purge tests passed");
