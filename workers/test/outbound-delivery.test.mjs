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
import { mapEmailSendingEvent } from "../lib/email-sending-events.ts";

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
});
