/**
 * Inbound mailbox engine: envelope routing, plus-addresses, fan-out, bounces.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	allowedMailboxSet,
	canonicalMailboxId,
	isDuplicateInbound,
	mailboxMetadataKey,
	resolveMailboxParam,
	routeInboundEnvelope,
	routeInboundEnvelopes,
} from "../lib/mailbox-routing.ts";

// ── Canonical IDs ─────────────────────────────────────────────────

assert.equal(
	canonicalMailboxId("Hello+Foo@Inboxies.Email"),
	"hello@inboxies.email",
);
assert.equal(
	canonicalMailboxId("hello@inboxies.email"),
	"hello@inboxies.email",
);
assert.equal(
	canonicalMailboxId("hello+invoices@inboxies.email"),
	"hello@inboxies.email",
);
assert.equal(
	canonicalMailboxId("hello+a+b@inboxies.email"),
	"hello@inboxies.email",
);
assert.equal(
	canonicalMailboxId("Alice Example <Alice+Receipts@Inboxies.Email>"),
	"alice@inboxies.email",
);
assert.equal(
	canonicalMailboxId("hello@inboxies.email."),
	"hello@inboxies.email",
);
assert.equal(canonicalMailboxId(""), null);
assert.equal(canonicalMailboxId("   "), null);
assert.equal(canonicalMailboxId("not-an-email"), null);
assert.equal(canonicalMailboxId("@inboxies.email"), null);
assert.equal(canonicalMailboxId("hello+tag@"), null);
assert.equal(canonicalMailboxId("+tag@inboxies.email"), null);
assert.equal(canonicalMailboxId("hello @inboxies.email"), null);

assert.equal(
	resolveMailboxParam("Hello%2BFoo%40Inboxies.Email"),
	"hello@inboxies.email",
);
assert.equal(resolveMailboxParam(""), null);
assert.equal(resolveMailboxParam(undefined), null);

assert.equal(mailboxMetadataKey("hello@inboxies.email"), "mailboxes/hello@inboxies.email.json");

assert.deepEqual(
	[...allowedMailboxSet(["Hello+Tag@Inboxies.Email", "bob@inboxies.email", ""])].sort(),
	["bob@inboxies.email", "hello@inboxies.email"],
);

// ── Single-envelope route (existence is keyed by canonical id) ────

const exists = (id) => id === "hello@inboxies.email" || id === "alice@inboxies.email";

assert.deepEqual(
	await routeInboundEnvelope("Hello+Foo@Inboxies.Email", exists),
	{ action: "deliver", mailboxId: "hello@inboxies.email" },
);
assert.deepEqual(
	await routeInboundEnvelope("hello+tag@inboxies.email", () => false),
	{ action: "reject", reason: "Mailbox does not exist" },
);
assert.deepEqual(
	await routeInboundEnvelope("not-an-email", () => true),
	{ action: "reject", reason: "Invalid recipient" },
);
assert.deepEqual(
	await routeInboundEnvelope("alice@inboxies.email", exists),
	{ action: "deliver", mailboxId: "alice@inboxies.email" },
);

// Invalid addresses must not call exists (would be a wasted R2 HEAD).
let existsCalls = 0;
await routeInboundEnvelope("not-an-email", () => {
	existsCalls += 1;
	return true;
});
assert.equal(existsCalls, 0);

// Plus-address existence check uses the stripped id, not the envelope.
const seen = [];
await routeInboundEnvelope("hello+invoices@inboxies.email", (id) => {
	seen.push(id);
	return true;
});
assert.deepEqual(seen, ["hello@inboxies.email"]);

// ── Fan-out: one envelope per Worker invocation ───────────────────

const fanout = await routeInboundEnvelopes(
	[
		"alice@inboxies.email",
		"bob@inboxies.email",
		"hello+receipts@inboxies.email",
		"nobody@inboxies.email",
		"not-valid",
	],
	exists,
);

assert.deepEqual(fanout, [
	{ action: "deliver", mailboxId: "alice@inboxies.email" },
	{ action: "reject", reason: "Mailbox does not exist" },
	{ action: "deliver", mailboxId: "hello@inboxies.email" },
	{ action: "reject", reason: "Mailbox does not exist" },
	{ action: "reject", reason: "Invalid recipient" },
]);

// BCC / header-To mismatch: routing ignores headers; only envelope matters.
assert.deepEqual(
	await routeInboundEnvelope("alice@inboxies.email", exists),
	{ action: "deliver", mailboxId: "alice@inboxies.email" },
);

// Same message to base + plus-address maps to one mailbox (DO serializes).
const sameMailbox = await routeInboundEnvelopes(
	["hello@inboxies.email", "hello+tag@inboxies.email"],
	exists,
);
assert.deepEqual(
	sameMailbox.map((r) => r.action === "deliver" && r.mailboxId),
	["hello@inboxies.email", "hello@inboxies.email"],
);
assert.equal(
	isDuplicateInbound("msg-1@example.com", true),
	true,
);
assert.equal(
	isDuplicateInbound("msg-1@example.com", false),
	false,
);
assert.equal(isDuplicateInbound(null, true), false);

// ── Scale: O(1) Set lookup, never list-scan ───────────────────────

const MAILBOX_COUNT = 10_000;
const mailboxes = new Set();
for (let i = 0; i < MAILBOX_COUNT; i++) {
	mailboxes.add(`user${i}@inboxies.email`);
}
const existsAtScale = (id) => mailboxes.has(id);

const scaleRecipients = [
	"user0@inboxies.email",
	"User42+Invoices@Inboxies.Email",
	"user9999@inboxies.email",
	"missing@inboxies.email",
	"bad",
];
for (let i = 100; i < 200; i++) {
	scaleRecipients.push(`user${i}+tag@inboxies.email`);
}

const scaleRoutes = await routeInboundEnvelopes(scaleRecipients, existsAtScale);
const delivered = scaleRoutes.filter((r) => r.action === "deliver");
const rejectedUnknown = scaleRoutes.filter(
	(r) => r.action === "reject" && r.reason === "Mailbox does not exist",
);
const rejectedInvalid = scaleRoutes.filter(
	(r) => r.action === "reject" && r.reason === "Invalid recipient",
);

assert.equal(delivered.length, 103); // user0, user42, user9999, user100-199
assert.equal(rejectedUnknown.length, 1);
assert.equal(rejectedInvalid.length, 1);
assert.equal(delivered[1].mailboxId, "user42@inboxies.email");
assert.equal(
	delivered.every((r) => mailboxes.has(r.mailboxId)),
	true,
);

console.log("mailbox-routing helpers: ok");
