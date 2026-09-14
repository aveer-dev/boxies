/**
 * End-to-end coverage for R2 body/MIME offload helpers + hydrate/delete flow.
 * Mirrors MailboxDO create/read/delete behavior with an in-memory R2 mock.
 * Run: node --experimental-strip-types workers/test/email-content-e2e.test.mjs
 */

import assert from "node:assert/strict";
import {
	buildSimpleMime,
	computeSnippet,
	deleteEmailContent,
	emailBodyKey,
	emailContentKeys,
	emailRawKey,
	loadEmailBody,
	storeEmailContent,
} from "../lib/email-content.ts";

/** Minimal R2Bucket stand-in used by the offload helpers. */
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
				async arrayBuffer() {
					if (typeof value === "string") {
						return new TextEncoder().encode(value).buffer;
					}
					return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
				},
			};
		},
		async delete(keys) {
			const list = Array.isArray(keys) ? keys : [keys];
			for (const key of list) store.delete(key);
		},
	};
}

/** Same resolve order as MailboxDO.#hydrateBody (R2 first, then legacy SQLite body). */
async function hydrateBody(bucket, emailId, legacyBody, snippet) {
	const fromR2 = await loadEmailBody(bucket, emailId);
	if (fromR2 != null) return fromR2;
	if (legacyBody == null || legacyBody === "") return legacyBody ?? null;
	await storeEmailContent(bucket, emailId, { htmlOrText: legacyBody });
	return legacyBody;
}

const bucket = createMockBucket();
const emailId = "e2e-msg-1";

// --- Inbound path: Worker stores HTML + original MIME; DO row keeps snippet only ---
const html = "<p>Hello from the wire — longer than a tweet but under the row cap.</p>";
const rawBytes = new TextEncoder().encode(
	`From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Hi\r\n\r\n${html}`,
);
await storeEmailContent(bucket, emailId, {
	htmlOrText: html,
	rawMime: rawBytes,
});
const snippet = computeSnippet(html);
assert.equal(snippet, html.slice(0, 300));
assert.ok(bucket.store.has(emailBodyKey(emailId)));
assert.ok(bucket.store.has(emailRawKey(emailId)));

// DO createEmail omits body when Worker already wrote R2 — hydrate must still work.
const hydrated = await hydrateBody(bucket, emailId, null, snippet);
assert.equal(hydrated, html);

const rawObj = await bucket.get(emailRawKey(emailId));
assert.ok(rawObj);
const rawBack = new Uint8Array(await rawObj.arrayBuffer());
assert.deepEqual(rawBack, rawBytes);

// --- Outbound/draft path: DO safety net writes HTML + simple MIME ---
const sentId = "e2e-sent-1";
const sentBody = "<p>Thanks for the update.</p>";
const simple = buildSimpleMime(
	{
		from: "bob@example.com",
		to: "alice@example.com",
		subject: "Re: Hi",
		messageId: "sent-1@example.com",
		inReplyTo: "orig@example.com",
	},
	sentBody,
);
await storeEmailContent(bucket, sentId, {
	htmlOrText: sentBody,
	rawMime: simple,
});
assert.equal(await loadEmailBody(bucket, sentId), sentBody);
assert.match(simple, /Content-Type: text\/html/);
assert.equal(
	typeof bucket.store.get(emailRawKey(sentId)),
	"string",
);

// --- Empty-body overwrite must clear previous HTML (draft clear) ---
await storeEmailContent(bucket, sentId, { htmlOrText: "" });
assert.equal(await loadEmailBody(bucket, sentId), "");

// --- Legacy hydrate: SQLite still has body, R2 missing ---
const legacyId = "e2e-legacy-1";
const legacyHtml = "<div>old sqlite body</div>";
assert.equal(await loadEmailBody(bucket, legacyId), null);
const migrated = await hydrateBody(bucket, legacyId, legacyHtml, null);
assert.equal(migrated, legacyHtml);
assert.equal(await loadEmailBody(bucket, legacyId), legacyHtml);

// --- Delete removes both keys (matches MailboxDO.deleteEmail cleanup) ---
await deleteEmailContent(bucket, emailId);
assert.equal(bucket.store.has(emailBodyKey(emailId)), false);
assert.equal(bucket.store.has(emailRawKey(emailId)), false);
assert.deepEqual(emailContentKeys(emailId), [
	emailBodyKey(emailId),
	emailRawKey(emailId),
]);

// --- Inbound empty body still stores .eml; hydrate returns empty html ---
const emptyId = "e2e-empty-1";
await storeEmailContent(bucket, emptyId, {
	htmlOrText: "",
	rawMime: "From: a@b.c\r\n\r\n",
});
assert.equal(await loadEmailBody(bucket, emptyId), "");
assert.ok(bucket.store.has(emailRawKey(emptyId)));

console.log("email-content e2e tests passed");
