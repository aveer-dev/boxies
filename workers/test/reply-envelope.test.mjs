/**
 * Reply envelope shared by the composer and the reading-room quick reply.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	buildReplyEnvelope,
	isAliasReply,
	plainTextToHtml,
	prefixSubject,
	replyFrom,
} from "../../shared/reply-envelope.ts";

const me = "me@boxies.test";
const alice = "alice@example.com";
const bob = "bob@example.com";
const carol = "carol@example.com";
const mailbox = { email: me, name: "Me", fromName: "Emmanuel" };

// Subject prefixing is idempotent.
assert.equal(prefixSubject("Hello", "Re"), "Re: Hello");
assert.equal(prefixSubject("Re: Hello", "Re"), "Re: Hello");
assert.equal(prefixSubject("Hello", "Fwd"), "Fwd: Hello");

// Plain reply goes back to the sender, from the mailbox with its display name.
const received = { sender: alice, recipient: `${me}, ${bob}`, cc: carol, subject: "Plan" };
assert.deepEqual(buildReplyEnvelope(received, mailbox, "reply"), {
	to: alice,
	cc: undefined,
	from: { email: me, name: "Emmanuel" },
	subject: "Re: Plan",
});

// Reply-all keeps everyone except me; Cc stays Cc.
assert.deepEqual(buildReplyEnvelope(received, mailbox, "reply-all"), {
	to: [alice, bob],
	cc: carol,
	from: { email: me, name: "Emmanuel" },
	subject: "Re: Plan",
});

// Replying to my own Sent copy targets the original recipient.
const sent = { sender: me, recipient: alice, cc: null, subject: "Re: Plan" };
assert.equal(buildReplyEnvelope(sent, mailbox, "reply").to, alice);
assert.equal(buildReplyEnvelope(sent, mailbox, "reply").subject, "Re: Plan");

// Private-email aliases answer from the alias address.
const viaAlias = { sender: alice, recipient: "shop.x1@private.boxies.test", cc: null, subject: "Order", alias_id: "a1" };
assert.equal(isAliasReply("reply", viaAlias), true);
assert.equal(isAliasReply("forward", viaAlias), false);
assert.deepEqual(buildReplyEnvelope(viaAlias, mailbox, "reply").from, {
	email: "shop.x1@private.boxies.test",
	name: "Emmanuel",
});
assert.equal(
	isAliasReply("reply", { recipient: "x@private.boxies.test", alias_id: null }),
	true,
);

// Without a display name (or when it equals the address) from is a bare address.
assert.equal(replyFrom("reply", null, { email: me }), me);
assert.equal(replyFrom("reply", null, { email: me, name: me }), me);
assert.deepEqual(replyFrom("reply", null, { email: me, name: "Me" }), { email: me, name: "Me" });

// Textarea text becomes escaped paragraphs.
assert.equal(plainTextToHtml("  "), "");
assert.equal(plainTextToHtml("Hi <b>Al</b>\nthanks"), "<p>Hi &lt;b&gt;Al&lt;/b&gt;<br>thanks</p>");
assert.equal(plainTextToHtml("One\n\nTwo"), "<p>One</p><p>Two</p>");

console.log("reply-envelope tests passed");
