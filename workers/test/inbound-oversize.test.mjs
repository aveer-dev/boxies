// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// AVE-47: inbound mail over 25 MB is rejected with a clean SMTP 552 via
// setReject, instead of throwing (which the email handler rethrows, so
// Cloudflare retries and sends a generic bounce).

import assert from "node:assert/strict";
import { test } from "node:test";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;
const REASON = "552 5.3.4 Message size exceeds fixed limit";
const mailboxId = "alex@example.com";

function createBucket() {
	const store = new Map();
	return {
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { json: async () => JSON.parse(text), text: async () => text };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
	};
}

async function createEnv() {
	const bucket = createBucket();
	await bucket.put(mailboxMetadataKey(mailboxId), "{}");
	const stubCalls = [];
	return {
		stubCalls,
		env: {
			BUCKET: bucket,
			MAILBOX: {
				idFromName: () => ({}),
				get: () =>
					new Proxy(
						{},
						{
							get: (_t, prop) => async () => {
								stubCalls.push(prop);
							},
						},
					),
			},
		},
	};
}

function message({ rawSize, raw, rejections }) {
	return {
		to: mailboxId,
		from: "sender@vendor.com",
		headers: new Headers(),
		raw,
		rawSize,
		setReject: (reason) => rejections.push(reason),
	};
}

test("oversize rawSize is rejected up front with 552, without reading the stream or throwing", async () => {
	const { receiveEmail } = await import("../index.ts");
	const { env, stubCalls } = await createEnv();
	const rejections = [];
	const raw = new ReadableStream();

	await assert.doesNotReject(
		receiveEmail(message({ rawSize: MAX_EMAIL_SIZE + 1, raw, rejections }), env, { waitUntil() {} }),
	);
	assert.deepEqual(rejections, [REASON]);
	assert.equal(raw.locked, false, "stream should not be read");
	assert.deepEqual(stubCalls, []);
});

test("stream larger than the limit despite an under-reported rawSize is rejected, not thrown", async () => {
	const { receiveEmail } = await import("../index.ts");
	const { env, stubCalls } = await createEnv();
	const rejections = [];
	const raw = new ReadableStream({
		start(c) {
			c.enqueue(new Uint8Array(1024));
			c.enqueue(new Uint8Array(MAX_EMAIL_SIZE));
			c.close();
		},
	});

	await assert.doesNotReject(receiveEmail(message({ rawSize: 2048, raw, rejections }), env, { waitUntil() {} }));
	assert.deepEqual(rejections, [REASON]);
	assert.deepEqual(stubCalls, []);
});

test("a message exactly at the limit is not rejected for size", async () => {
	const { receiveEmail } = await import("../index.ts");
	const { env } = await createEnv();
	const rejections = [];
	// Stream ends short of rawSize; parsing whatever arrived is fine here, we only
	// assert the size gate lets it through.
	const raw = new ReadableStream({ start: (c) => c.close() });
	try {
		await receiveEmail(message({ rawSize: MAX_EMAIL_SIZE, raw, rejections }), env, { waitUntil() {} });
	} catch {
		// Downstream processing against the minimal stub may fail; irrelevant here.
	}
	assert.deepEqual(rejections, []);
});

test("non-size stream errors still throw so delivery is retried", async () => {
	const { receiveEmail } = await import("../index.ts");
	const { env } = await createEnv();
	const rejections = [];
	const raw = new ReadableStream({
		start(c) {
			c.enqueue(new Uint8Array(4096));
			c.close();
		},
	});

	await assert.rejects(
		receiveEmail(message({ rawSize: 1024, raw, rejections }), env, { waitUntil() {} }),
		/Stream exceeds declared size/,
	);
	assert.deepEqual(rejections, []);
});
