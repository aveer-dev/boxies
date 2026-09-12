/**
 * Canonical mailbox IDs: lowercase, plus-tag strip, angle-bracket extract.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	canonicalMailboxId,
	routeInboundEnvelope,
} from "../lib/mailbox-routing.ts";

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
	canonicalMailboxId("Alice Example <Alice+Receipts@Inboxies.Email>"),
	"alice@inboxies.email",
);
assert.equal(canonicalMailboxId(""), null);
assert.equal(canonicalMailboxId("   "), null);
assert.equal(canonicalMailboxId("not-an-email"), null);
assert.equal(canonicalMailboxId("@inboxies.email"), null);
assert.equal(canonicalMailboxId("hello+tag@"), null);
assert.equal(canonicalMailboxId("+tag@inboxies.email"), null);

assert.deepEqual(
	routeInboundEnvelope("Hello+Foo@Inboxies.Email", true),
	{ action: "deliver", mailboxId: "hello@inboxies.email" },
);
assert.deepEqual(
	routeInboundEnvelope("hello+tag@inboxies.email", false),
	{ action: "reject", reason: "Mailbox does not exist" },
);
assert.deepEqual(
	routeInboundEnvelope("not-an-email", false),
	{ action: "reject", reason: "Invalid recipient" },
);
assert.deepEqual(
	routeInboundEnvelope("alice@inboxies.email", true),
	{ action: "deliver", mailboxId: "alice@inboxies.email" },
);

console.log("mailbox-routing helpers: ok");
