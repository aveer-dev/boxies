/**
 * Web client bounce-suppression helpers (AVE-83): reading the server's 409
 * `recipient_suppressed` body, the inline reason text, and which notices stay
 * once the user edits the recipients.
 * Run: pnpm test:unit web-suppression
 */

import assert from "node:assert/strict";
import {
	RECIPIENT_SUPPRESSED_CODE,
	bareAddress,
	formatSuppressionDate,
	suppressedRecipientsFromError,
	suppressionAddressPath,
	suppressionReasonLabel,
	suppressionReasonText,
	suppressionsStillAddressed,
} from "../../app/lib/suppression.ts";
import {
	RECIPIENT_SUPPRESSED_CODE as SERVER_CODE,
	suppressedRecipientsError,
} from "../lib/email-suppression.ts";

assert.equal(RECIPIENT_SUPPRESSED_CODE, SERVER_CODE);

const row = (recipient, reason, sourceMailboxId = "bob@acme.test") => ({
	domain: "acme.test",
	recipient,
	reason,
	source: "email_sending_event",
	sourceEventId: null,
	sourceMailboxId,
	sourceMessageId: null,
	detail: reason === "hard_bounce" ? "550 5.1.1 User unknown" : null,
	createdAt: new Date("2026-10-01T12:00:00Z"),
	updatedAt: new Date("2026-10-01T12:00:00Z"),
});

// The server's real 409 body round-trips through the parser.
{
	const body = suppressedRecipientsError(
		[row("gone@example.net", "hard_bounce"), row("spam@example.net", "complaint", "carol@acme.test")],
		"bob@acme.test",
		false,
	);
	const err = Object.assign(new Error(body.error), { status: 409, body });
	const parsed = suppressedRecipientsFromError(err);
	assert.deepEqual(parsed, [
		{
			address: "gone@example.net",
			domain: "acme.test",
			reason: "hard_bounce",
			source: "email_sending_event",
			detail: "550 5.1.1 User unknown",
			suppressedAt: "2026-10-01T12:00:00.000Z",
			canUnsuppress: true,
		},
		{
			address: "spam@example.net",
			domain: "acme.test",
			reason: "complaint",
			source: "email_sending_event",
			detail: null,
			suppressedAt: "2026-10-01T12:00:00.000Z",
			canUnsuppress: false,
		},
	]);
}

// Anything else is not a suppression error.
{
	assert.equal(suppressedRecipientsFromError(null), null);
	assert.equal(suppressedRecipientsFromError(new Error("boom")), null);
	assert.equal(suppressedRecipientsFromError({ status: 409, body: { error: "Conflict" } }), null);
	assert.equal(
		suppressedRecipientsFromError({ status: 400, body: { code: SERVER_CODE, suppressed: [{ address: "a@b.c" }] } }),
		null,
	);
	assert.equal(
		suppressedRecipientsFromError({ status: 409, body: { code: SERVER_CODE, suppressed: [] } }),
		null,
	);
	assert.equal(
		suppressedRecipientsFromError({ status: 409, body: { code: SERVER_CODE, suppressed: [{ nope: 1 }] } }),
		null,
	);
	// Missing fields default safely: no Un-suppress unless the server says so.
	assert.deepEqual(
		suppressedRecipientsFromError({ status: 409, body: { code: SERVER_CODE, suppressed: [{ address: "A@B.c" }] } }),
		[{ address: "a@b.c", domain: "", reason: "hard_bounce", source: "", detail: null, suppressedAt: "", canUnsuppress: false }],
	);
}

// Reason text.
{
	assert.equal(formatSuppressionDate("2026-10-01T12:00:00Z", "en-US"), "Oct 1, 2026");
	assert.equal(formatSuppressionDate("not a date", "en-US"), "not a date");
	assert.equal(
		suppressionReasonText({ reason: "hard_bounce", suppressedAt: "2026-10-01T12:00:00Z" }, "en-US"),
		"This address bounced on Oct 1, 2026",
	);
	assert.equal(
		suppressionReasonText({ reason: "complaint", suppressedAt: "2026-10-01T12:00:00Z" }, "en-US"),
		"This address marked earlier mail as spam on Oct 1, 2026",
	);
	assert.equal(suppressionReasonText({ reason: "hard_bounce", suppressedAt: "" }), "This address bounced");
	assert.equal(suppressionReasonLabel("hard_bounce"), "Bounced");
	assert.equal(suppressionReasonLabel("complaint"), "Marked as spam");
}

// Notices follow the recipient fields.
{
	assert.equal(bareAddress("Pat <Pat@Example.net>"), "pat@example.net");
	assert.equal(bareAddress(" gone@example.net "), "gone@example.net");
	assert.equal(bareAddress("not-an-address"), null);
	const list = [
		{ address: "gone@example.net", reason: "hard_bounce", canUnsuppress: true },
		{ address: "spam@example.net", reason: "complaint", canUnsuppress: true },
	];
	assert.deepEqual(
		suppressionsStillAddressed(list, ["ok@example.net", "Gone <GONE@example.net>", "spam@example.net"]).map((s) => s.address),
		["gone@example.net", "spam@example.net"],
	);
	assert.deepEqual(
		suppressionsStillAddressed(list, ["ok@example.net", "spam@example.net"]).map((s) => s.address),
		["spam@example.net"],
	);
	assert.deepEqual(suppressionsStillAddressed(list, []), []);
}

// Path segment the DELETE route decodes.
assert.equal(suppressionAddressPath(" Gone+tag@Example.net "), "gone%2Btag%40example.net");

console.log("web-suppression: ok");
