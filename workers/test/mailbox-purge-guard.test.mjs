/**
 * Mailbox deleted-flag + purge key collection (write-lock semantics).
 * Run: node --experimental-strip-types workers/test/mailbox-purge-guard.test.mjs
 */

import assert from "node:assert/strict";
import {
	attachmentKey,
	collectMailboxPurgeR2Keys,
	deleteR2Keys,
} from "../lib/attachments.ts";
import {
	emailContentKeys,
	storeEmailContent,
	emailBodyKey,
} from "../lib/email-content.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";

function createMockBucket() {
	/** @type {Map<string, string>} */
	const store = new Map();
	return {
		store,
		async put(key, value) {
			store.set(key, String(value));
			return null;
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

/** Mirrors MailboxDO deleted-flag + metadata delete ordering after inventory wipe. */
async function simulatePurge(bucket, mailboxId, emailIds, attachments) {
	const keys = collectMailboxPurgeR2Keys(emailIds, attachments, emailContentKeys);
	await deleteR2Keys(bucket, keys);
	const deletedFlag = { value: "1" };
	await bucket.delete(mailboxMetadataKey(mailboxId));
	return deletedFlag;
}

const mailboxId = "purge-guard@inboxies.email";
const bucket = createMockBucket();
const emailId = "guard-mail-1";
const meta = mailboxMetadataKey(mailboxId);

await bucket.put(meta, "{}");
await storeEmailContent(bucket, emailId, { htmlOrText: "<p>x</p>", rawMime: "x" });
const att = attachmentKey(emailId, "a1", "f.txt");
await bucket.put(att, "bytes");

assert.ok(await bucket.head(meta));

const flag = await simulatePurge(
	bucket,
	mailboxId,
	[emailId],
	[{ email_id: emailId, id: "a1", filename: "f.txt" }],
);

assert.equal(flag.value, "1");
assert.equal(await bucket.head(meta), null);
assert.equal(bucket.store.has(emailBodyKey(emailId)), false);
assert.equal(bucket.store.has(att), false);

// Recreate path: metadata back + clear flag
await bucket.put(meta, "{}");
flag.value = null; // reviveMailbox
assert.ok(await bucket.head(meta));
assert.equal(flag.value, null);

console.log("mailbox-purge-guard tests passed");
