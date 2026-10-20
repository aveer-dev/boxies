// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound send queue: producer staging + enqueue, consumer claim / send /
 * retry / record, and the dead-letter consumer.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/outbound-send-queue.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	enqueueOutboundSend,
	isRetryableSendError,
	OUTBOUND_SEND_CLAIM_LEASE_MS,
	OUTBOUND_SEND_FAILED_ERROR,
	OUTBOUND_SEND_MAX_RETRIES,
	outboundPayloadKey,
	parseOutboundSendMessage,
	processOutboundSend,
	processOutboundSendDeadLetter,
	retryDelaySeconds,
	runOutboundBatch,
} from "../lib/outbound-send-queue.ts";
import { decideOutboundSendClaim } from "../lib/outbound-send-claim.ts";
import { OUTBOUND_SIZE_ERROR } from "../lib/outbound-limits.ts";

const MAILBOX = "ada@inboxies.email";
const EMAIL_ID = "email-1";
const PARAMS = {
	to: "pat@example.com",
	from: { email: MAILBOX, name: "Ada" },
	subject: "Hello",
	text: "Hi Pat",
};

function fakeBucket(initial = {}) {
	const objects = new Map(Object.entries(initial));
	const calls = [];
	return {
		objects,
		calls,
		async get(key) {
			calls.push(["get", key]);
			if (!objects.has(key)) return null;
			const value = objects.get(key);
			return { text: async () => value };
		},
		async put(key, value) {
			calls.push(["put", key]);
			objects.set(key, value);
		},
		async delete(key) {
			calls.push(["delete", key]);
			objects.delete(key);
		},
	};
}

/** In-memory mailbox DO: delivery status per row plus send claims. */
function fakeMailbox(rows = { [EMAIL_ID]: "queued" }, { now = () => 1_000 } = {}) {
	const status = new Map(Object.entries(rows));
	const claims = new Map();
	const states = [];
	const calls = [];
	let failSetDeliveryState = 0;
	return {
		status,
		claims,
		states,
		calls,
		failNextSetDeliveryState(times = 1) {
			failSetDeliveryState = times;
		},
		stub: {
			async claimOutboundSend(id, leaseMs) {
				calls.push("claim");
				const claim = decideOutboundSendClaim(
					status.has(id) ? status.get(id) : undefined,
					claims.get(id),
					now(),
				);
				if (claim === "claimed") claims.set(id, now() + leaseMs);
				return claim;
			},
			async releaseOutboundSendClaim(id) {
				calls.push("release");
				claims.delete(id);
			},
			async setDeliveryState(id, state) {
				calls.push(`set:${state.status}`);
				if (failSetDeliveryState > 0) {
					failSetDeliveryState--;
					throw new Error("DO unavailable");
				}
				states.push({ id, ...state });
				status.set(id, state.status);
				if (state.status !== "queued") claims.delete(id);
			},
		},
	};
}

function fakeEmail(results) {
	const sent = [];
	const queue = [...results];
	return {
		sent,
		async send(message) {
			sent.push(message);
			const next = queue.length ? queue.shift() : { messageId: `prov-${sent.length}` };
			if (next instanceof Error) throw next;
			return next;
		},
	};
}

function codedError(code, message = code) {
	return Object.assign(new Error(message), { code });
}

function stagedBucket(extra = {}) {
	return fakeBucket({
		[outboundPayloadKey(EMAIL_ID)]: JSON.stringify({ v: 1, params: PARAMS, ...extra }),
	});
}

const MESSAGE = { v: 1, mailboxId: MAILBOX, emailId: EMAIL_ID };

describe("outbound-send message + policy helpers", () => {
	it("parses only well-formed v1 messages", () => {
		assert.deepEqual(parseOutboundSendMessage(MESSAGE), MESSAGE);
		assert.equal(parseOutboundSendMessage(null), null);
		assert.equal(parseOutboundSendMessage("x"), null);
		assert.equal(parseOutboundSendMessage({ ...MESSAGE, v: 2 }), null);
		assert.equal(parseOutboundSendMessage({ ...MESSAGE, emailId: "" }), null);
		assert.equal(parseOutboundSendMessage({ v: 1, emailId: EMAIL_ID }), null);
	});

	it("retries only rate limits, service errors and uncoded failures", () => {
		assert.equal(isRetryableSendError(codedError("E_RATE_LIMIT_EXCEEDED")), true);
		assert.equal(isRetryableSendError(codedError("E_INTERNAL_SERVER_ERROR")), true);
		assert.equal(isRetryableSendError(new Error("network reset")), true);
		assert.equal(isRetryableSendError(codedError("E_SENDER_NOT_VERIFIED")), false);
		assert.equal(isRetryableSendError(codedError("E_CONTENT_TOO_LARGE")), false);
		assert.equal(isRetryableSendError(codedError("E_DAILY_LIMIT_EXCEEDED")), false);
	});

	it("backs off exponentially and caps the delay", () => {
		assert.deepEqual([1, 2, 3, 4, 5].map(retryDelaySeconds), [15, 30, 60, 120, 240]);
		assert.equal(retryDelaySeconds(9), 300);
		assert.equal(retryDelaySeconds(0), 15);
	});

	it("claims only queued rows without a live claim", () => {
		assert.equal(decideOutboundSendClaim(undefined, undefined, 0), "missing");
		assert.equal(decideOutboundSendClaim("accepted", undefined, 0), "not_queued");
		assert.equal(decideOutboundSendClaim(null, undefined, 0), "not_queued");
		assert.equal(decideOutboundSendClaim("queued", undefined, 0), "claimed");
		assert.equal(decideOutboundSendClaim("queued", 10, 5), "in_flight");
		assert.equal(decideOutboundSendClaim("queued", 10, 10), "claimed");
	});

	it("keeps max_retries in wrangler.jsonc in sync with the consumer", () => {
		const config = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
		const block = config.match(/"queue":\s*"outbound-send",\s*"max_batch_size"[\s\S]*?\}/)?.[0] ?? "";
		assert.match(block, new RegExp(`"max_retries":\\s*${OUTBOUND_SEND_MAX_RETRIES},`));
		assert.match(block, /"dead_letter_queue":\s*"outbound-send-dlq"/);
		assert.match(config, /"binding":\s*"OUTBOUND_SEND",\s*"queue":\s*"outbound-send"/);
	});
});

describe("enqueueOutboundSend (producer)", () => {
	it("stages the payload in R2 and enqueues ids only", async () => {
		const bucket = fakeBucket();
		const sentMessages = [];
		const mailbox = fakeMailbox();
		await enqueueOutboundSend(
			{
				bucket,
				queue: { send: async (body, options) => sentMessages.push({ body, options }) },
				stub: mailbox.stub,
			},
			MAILBOX,
			EMAIL_ID,
			PARAMS,
		);
		assert.deepEqual(JSON.parse(bucket.objects.get(outboundPayloadKey(EMAIL_ID))), {
			v: 1,
			params: PARAMS,
		});
		assert.deepEqual(sentMessages, [{ body: MESSAGE, options: { contentType: "json" } }]);
		assert.deepEqual(mailbox.states, []);
	});

	it("marks the row failed and cleans up when the queue rejects", async () => {
		const bucket = fakeBucket();
		const mailbox = fakeMailbox();
		await enqueueOutboundSend(
			{
				bucket,
				queue: { send: async () => { throw new Error("queue down"); } },
				stub: mailbox.stub,
			},
			MAILBOX,
			EMAIL_ID,
			PARAMS,
		);
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "failed", error: OUTBOUND_SEND_FAILED_ERROR },
		]);
		assert.equal(bucket.objects.has(outboundPayloadKey(EMAIL_ID)), false);
	});

	it("does not throw even when recording the failure fails", async () => {
		const bucket = fakeBucket();
		bucket.put = async () => { throw new Error("r2 down"); };
		const mailbox = fakeMailbox();
		mailbox.failNextSetDeliveryState();
		let enqueued = false;
		await enqueueOutboundSend(
			{ bucket, queue: { send: async () => (enqueued = true) }, stub: mailbox.stub },
			MAILBOX,
			EMAIL_ID,
			PARAMS,
		);
		assert.equal(enqueued, false);
	});
});

describe("processOutboundSend (consumer)", () => {
	it("sends, records accepted, and deletes the payload", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([{ messageId: "prov-9" }]);
		const outcome = await processOutboundSend(
			{ bucket, email, stubFor: () => mailbox.stub },
			MESSAGE,
			1,
		);
		assert.deepEqual(outcome, { action: "ack" });
		assert.equal(email.sent.length, 1);
		assert.equal(email.sent[0].subject, "Hello");
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "accepted", providerMessageId: "prov-9", error: null },
		]);
		assert.equal(bucket.objects.size, 0);
		assert.equal(mailbox.claims.size, 0);
	});

	it("is idempotent: a duplicate delivery after success does not resend", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([]);
		const deps = { bucket, email, stubFor: () => mailbox.stub };
		await processOutboundSend(deps, MESSAGE, 1);
		const again = await processOutboundSend(deps, MESSAGE, 1);
		assert.deepEqual(again, { action: "ack" });
		assert.equal(email.sent.length, 1);
	});

	it("skips rows that are gone or already settled", async () => {
		for (const rows of [{}, { [EMAIL_ID]: "failed" }]) {
			const bucket = stagedBucket();
			const mailbox = fakeMailbox(rows);
			const email = fakeEmail([]);
			const outcome = await processOutboundSend(
				{ bucket, email, stubFor: () => mailbox.stub },
				MESSAGE,
				1,
			);
			assert.deepEqual(outcome, { action: "ack" });
			assert.equal(email.sent.length, 0);
			assert.deepEqual(mailbox.states, []);
			assert.equal(bucket.objects.size, 0, "orphaned payload is cleaned up");
		}
	});

	it("retries without sending while another consumer holds the claim", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		mailbox.claims.set(EMAIL_ID, 1_000 + OUTBOUND_SEND_CLAIM_LEASE_MS);
		const email = fakeEmail([]);
		const outcome = await processOutboundSend(
			{ bucket, email, stubFor: () => mailbox.stub },
			MESSAGE,
			2,
		);
		assert.deepEqual(outcome, { action: "retry", delaySeconds: 30 });
		assert.equal(email.sent.length, 0);
	});

	it("retries transient binding errors with backoff and releases the claim", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([codedError("E_RATE_LIMIT_EXCEEDED", "rate limit")]);
		const outcome = await processOutboundSend(
			{ bucket, email, stubFor: () => mailbox.stub },
			MESSAGE,
			3,
		);
		assert.deepEqual(outcome, { action: "retry", delaySeconds: 60 });
		assert.deepEqual(mailbox.states, [], "row stays queued");
		assert.equal(mailbox.claims.size, 0);
		assert.equal(bucket.objects.size, 1, "payload kept for the retry");
	});

	it("marks failed on a permanent binding error without retrying", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([codedError("E_CONTENT_TOO_LARGE", "too large")]);
		const outcome = await processOutboundSend(
			{ bucket, email, stubFor: () => mailbox.stub },
			MESSAGE,
			1,
		);
		assert.deepEqual(outcome, { action: "ack" });
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "failed", error: OUTBOUND_SIZE_ERROR },
		]);
		assert.equal(bucket.objects.size, 0);
	});

	it("marks failed with the real error on the final attempt", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([codedError("E_INTERNAL_SERVER_ERROR", "Service unavailable")]);
		const outcome = await processOutboundSend(
			{ bucket, email, stubFor: () => mailbox.stub },
			MESSAGE,
			OUTBOUND_SEND_MAX_RETRIES + 1,
		);
		assert.deepEqual(outcome, { action: "ack" });
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "failed", error: "Service unavailable" },
		]);
	});

	it("records an accepted send on retry instead of sending twice", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([{ messageId: "prov-1" }]);
		const deps = { bucket, email, stubFor: () => mailbox.stub };
		mailbox.failNextSetDeliveryState();
		const first = await processOutboundSend(deps, MESSAGE, 1);
		assert.deepEqual(first, { action: "retry", delaySeconds: 15 });
		assert.equal(
			JSON.parse(bucket.objects.get(outboundPayloadKey(EMAIL_ID))).acceptedProviderMessageId,
			"prov-1",
		);
		const second = await processOutboundSend(deps, MESSAGE, 2);
		assert.deepEqual(second, { action: "ack" });
		assert.equal(email.sent.length, 1, "binding called once");
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "accepted", providerMessageId: "prov-1", error: null },
		]);
		assert.equal(bucket.objects.size, 0);
	});

	it("marks failed when the staged payload is missing", async () => {
		const bucket = fakeBucket();
		const mailbox = fakeMailbox();
		const email = fakeEmail([]);
		const outcome = await processOutboundSend(
			{ bucket, email, stubFor: () => mailbox.stub },
			MESSAGE,
			1,
		);
		assert.deepEqual(outcome, { action: "ack" });
		assert.equal(email.sent.length, 0);
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "failed", error: OUTBOUND_SEND_FAILED_ERROR },
		]);
	});

	it("drops malformed messages and invalid mailboxes", async () => {
		const bucket = stagedBucket();
		const email = fakeEmail([]);
		const deps = {
			bucket,
			email,
			stubFor: () => { throw new Error("Invalid mailbox email address"); },
		};
		assert.deepEqual(await processOutboundSend(deps, { nope: true }, 1), { action: "ack" });
		assert.deepEqual(await processOutboundSend(deps, MESSAGE, 1), { action: "ack" });
		assert.equal(email.sent.length, 0);
	});
});

describe("processOutboundSendDeadLetter (DLQ consumer)", () => {
	it("marks a still-queued row failed and deletes the payload", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		const outcome = await processOutboundSendDeadLetter(
			{ bucket, stubFor: () => mailbox.stub },
			MESSAGE,
		);
		assert.deepEqual(outcome, { action: "ack" });
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "failed", error: OUTBOUND_SEND_FAILED_ERROR },
		]);
		assert.equal(bucket.objects.size, 0);
	});

	it("records accepted when the binding took the message", async () => {
		const bucket = stagedBucket({ acceptedProviderMessageId: "prov-7" });
		const mailbox = fakeMailbox();
		await processOutboundSendDeadLetter({ bucket, stubFor: () => mailbox.stub }, MESSAGE);
		assert.deepEqual(mailbox.states, [
			{ id: EMAIL_ID, status: "accepted", providerMessageId: "prov-7", error: null },
		]);
	});

	it("leaves settled rows alone", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox({ [EMAIL_ID]: "accepted" });
		const outcome = await processOutboundSendDeadLetter(
			{ bucket, stubFor: () => mailbox.stub },
			MESSAGE,
		);
		assert.deepEqual(outcome, { action: "ack" });
		assert.deepEqual(mailbox.states, []);
	});

	it("waits out a live claim", async () => {
		const bucket = stagedBucket();
		const mailbox = fakeMailbox();
		mailbox.claims.set(EMAIL_ID, 1_000 + OUTBOUND_SEND_CLAIM_LEASE_MS);
		const outcome = await processOutboundSendDeadLetter(
			{ bucket, stubFor: () => mailbox.stub },
			MESSAGE,
		);
		assert.deepEqual(outcome, {
			action: "retry",
			delaySeconds: OUTBOUND_SEND_CLAIM_LEASE_MS / 1000,
		});
	});
});

describe("runOutboundBatch", () => {
	it("acks and retries per message; a throw retries only that message", async () => {
		const log = [];
		const message = (body, attempts) => ({
			body,
			attempts,
			ack: () => log.push([body, "ack"]),
			retry: (options) => log.push([body, "retry", options]),
		});
		await runOutboundBatch(
			[message("a", 1), message("b", 2), message("c", 1)],
			async (body) => {
				if (body === "a") return { action: "ack" };
				if (body === "b") return { action: "retry", delaySeconds: 30 };
				throw new Error("boom");
			},
			"test",
		);
		assert.deepEqual(log.sort(), [
			["a", "ack"],
			["b", "retry", { delaySeconds: 30 }],
			["c", "retry", { delaySeconds: 15 }],
		]);
	});
});
