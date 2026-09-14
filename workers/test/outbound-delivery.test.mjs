// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertOutboundMessageSize,
	base64DecodedByteLength,
	estimateOutboundMessageBytes,
	mapSendFailureMessage,
	MAX_OUTBOUND_MESSAGE_BYTES,
	OutboundSizeError,
	OUTBOUND_SIZE_ERROR,
} from "../lib/outbound-limits.ts";
import {
	applyEmailSendingEvent,
	mapEmailSendingEvent,
	unwrapEmailSendingEvent,
} from "../lib/email-sending-events.ts";

describe("outbound message size", () => {
	it("estimates UTF-8 body bytes", () => {
		assert.equal(estimateOutboundMessageBytes({ text: "hello" }), 5);
		assert.equal(estimateOutboundMessageBytes({ html: "café" }), 5);
	});

	it("estimates base64 attachment bytes", () => {
		// "hello" -> aGVsbG8=
		assert.equal(base64DecodedByteLength("aGVsbG8="), 5);
		assert.equal(
			estimateOutboundMessageBytes({
				text: "hi",
				attachments: [{ content: "aGVsbG8=" }],
			}),
			7,
		);
	});

	it("rejects payloads over 5 MiB", () => {
		const huge = "A".repeat(MAX_OUTBOUND_MESSAGE_BYTES + 1);
		assert.throws(
			() => assertOutboundMessageSize({ text: huge }),
			(err) => err instanceof OutboundSizeError && err.message === OUTBOUND_SIZE_ERROR,
		);
	});

	it("allows payloads at or under 5 MiB", () => {
		assert.doesNotThrow(() =>
			assertOutboundMessageSize({ text: "A".repeat(1024) }),
		);
	});

	it("maps content-too-large binding errors to the size message", () => {
		assert.equal(
			mapSendFailureMessage({ code: "content_too_large", message: "too big" }),
			OUTBOUND_SIZE_ERROR,
		);
		assert.equal(
			mapSendFailureMessage(new Error("Message size exceeds 5 MiB")),
			OUTBOUND_SIZE_ERROR,
		);
	});
});

describe("email sending event mapping", () => {
	it("maps bounced events", () => {
		const mapped = mapEmailSendingEvent({
			type: "cf.email.sending.message.bounced",
			payload: {
				messageId: "prov-1",
				sender: "me@example.com",
				bounce: { reason: "550 user unknown" },
			},
		});
		assert.deepEqual(mapped, {
			status: "bounced",
			error: "550 user unknown",
			providerMessageId: "prov-1",
			sender: "me@example.com",
		});
	});

	it("maps complained events", () => {
		const mapped = mapEmailSendingEvent({
			type: "cf.email.sending.message.complained",
			payload: {
				messageId: "prov-2",
				sender: "Me@Example.com",
			},
		});
		assert.equal(mapped?.status, "complained");
		assert.equal(mapped?.providerMessageId, "prov-2");
		assert.equal(mapped?.sender, "me@example.com");
		assert.match(mapped?.error || "", /spam/i);
	});

	it("maps Cloudflare docs bounce/complaint payloads", () => {
		const bounced = mapEmailSendingEvent({
			type: "cf.email.sending.message.bounced",
			source: { type: "email.sending", domain: "send.example.com" },
			payload: {
				eventId: "0190d0c4-7ea1-7af2-8b88-c1d2e3f4a5b6",
				messageId: "0101018f7d0c4d9a-msg-bounced",
				sender: "receipts@send.example.com",
				recipient: "user@example.net",
				terminal: true,
				delivery: {
					status: "bounced",
					smtpStatusCode: "550",
					smtpResponse: "550 5.1.1 User unknown",
				},
				bounce: {
					type: "hard",
					classification: "permanent_failure",
					reason: "550 5.1.1 User unknown",
				},
			},
		});
		assert.equal(bounced?.status, "bounced");
		assert.equal(bounced?.error, "550 5.1.1 User unknown");
		assert.equal(bounced?.sender, "receipts@send.example.com");

		const complained = mapEmailSendingEvent({
			type: "cf.email.sending.message.complained",
			payload: {
				messageId: "0101018f7d0c4d9a-msg-complained",
				sender: "news@send.example.com",
				terminal: true,
				delivery: { status: "complained" },
				complaint: { type: "abuse" },
			},
		});
		assert.equal(complained?.status, "complained");
		assert.match(complained?.error || "", /spam/i);
		assert.notEqual(complained?.error, "complained");
	});

	it("maps failed/rejected events", () => {
		const failed = mapEmailSendingEvent({
			type: "cf.email.sending.message.failed",
			payload: {
				messageId: "prov-3",
				sender: "a@b.com",
				delivery: { smtpResponse: "internal error" },
			},
		});
		assert.equal(failed?.status, "failed");
		assert.equal(failed?.error, "internal error");
	});

	it("ignores delivered events and missing ids", () => {
		assert.equal(
			mapEmailSendingEvent({
				type: "cf.email.sending.message.delivered",
				payload: { messageId: "prov-4", sender: "a@b.com" },
			}),
			null,
		);
		assert.equal(
			mapEmailSendingEvent({
				type: "cf.email.sending.message.bounced",
				payload: { sender: "a@b.com" },
			}),
			null,
		);
	});

	it("unwraps nested data wrappers without losing typed events", () => {
		const nested = unwrapEmailSendingEvent({
			data: {
				type: "cf.email.sending.message.bounced",
				payload: { messageId: "prov-5", sender: "a@b.com" },
			},
		});
		assert.equal(nested.type, "cf.email.sending.message.bounced");
		assert.equal(nested.payload?.messageId, "prov-5");

		const typed = unwrapEmailSendingEvent({
			type: "cf.email.sending.message.bounced",
			payload: { messageId: "prov-6", sender: "a@b.com" },
			data: { ignored: true },
		});
		assert.equal(typed.type, "cf.email.sending.message.bounced");
		assert.equal(typed.payload?.messageId, "prov-6");

		const fromJson = unwrapEmailSendingEvent(
			JSON.stringify({
				type: "cf.email.sending.message.failed",
				payload: { messageId: "prov-7", sender: "a@b.com" },
			}),
		);
		assert.equal(fromJson.type, "cf.email.sending.message.failed");
		assert.equal(fromJson.payload?.messageId, "prov-7");
	});
});

describe("email sending event apply", () => {
	it("acks when event should be ignored", async () => {
		const ok = await applyEmailSendingEvent(
			{
				type: "cf.email.sending.message.delivered",
				payload: { messageId: "x", sender: "a@b.com" },
			},
			() => {
				throw new Error("should not resolve stub");
			},
		);
		assert.equal(ok, true);
	});

	it("acks when sender is missing", async () => {
		const ok = await applyEmailSendingEvent(
			{
				type: "cf.email.sending.message.bounced",
				payload: { messageId: "x", bounce: { reason: "nope" } },
			},
			() => {
				throw new Error("should not resolve stub");
			},
		);
		assert.equal(ok, true);
	});

	it("acks when stub resolution throws for invalid sender", async () => {
		const ok = await applyEmailSendingEvent(
			{
				type: "cf.email.sending.message.bounced",
				payload: {
					messageId: "x",
					sender: "not-an-email",
					bounce: { reason: "nope" },
				},
			},
			() => {
				throw new Error("Invalid mailbox email address");
			},
		);
		assert.equal(ok, true);
	});

	it("retries when email is not found yet", async () => {
		const ok = await applyEmailSendingEvent(
			{
				type: "cf.email.sending.message.bounced",
				payload: {
					messageId: "prov-missing",
					sender: "me@example.com",
					bounce: { reason: "550" },
				},
			},
			() => ({
				findEmailByProviderMessageId: async () => null,
				setDeliveryState: async () => {
					throw new Error("should not set");
				},
			}),
		);
		assert.equal(ok, false);
	});

	it("updates delivery state when email is found", async () => {
		const calls = [];
		const ok = await applyEmailSendingEvent(
			{
				data: {
					type: "cf.email.sending.message.complained",
					payload: {
						messageId: "prov-9",
						sender: "me@example.com",
					},
				},
			},
			() => ({
				findEmailByProviderMessageId: async (id) => ({
					id: "email-1",
					provider: id,
				}),
				setDeliveryState: async (id, state) => {
					calls.push({ id, state });
				},
			}),
		);
		assert.equal(ok, true);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].id, "email-1");
		assert.equal(calls[0].state.status, "complained");
		assert.equal(calls[0].state.providerMessageId, "prov-9");
	});
});
