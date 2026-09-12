/**
 * Reply recipient selection: Reply to your own Sent mail must go to
 * the original recipient, not back to you.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	replyToAddresses,
	replyAllAddresses,
	rewriteSelfReplyTo,
} from "../../shared/reply-recipients.ts";

const me = "me@boxies.test";
const alice = "alice@example.com";
const bob = "bob@example.com";

const sentToAlice = { sender: me, recipient: alice, cc: null };
const receivedFromAlice = { sender: alice, recipient: me, cc: null };
const sentToAliceCcBob = { sender: me, recipient: alice, cc: bob };

assert.deepEqual(replyToAddresses(sentToAlice, me), [alice]);
assert.deepEqual(replyToAddresses(receivedFromAlice, me), [alice]);
assert.deepEqual(replyToAddresses(sentToAliceCcBob, me), [alice]);

assert.deepEqual(replyAllAddresses(sentToAlice, me), { to: [alice], cc: [] });
assert.deepEqual(replyAllAddresses(receivedFromAlice, me), { to: [alice], cc: [] });
assert.deepEqual(replyAllAddresses(sentToAliceCcBob, me), {
	to: [alice],
	cc: [bob],
});

assert.equal(rewriteSelfReplyTo(me, sentToAlice, me), alice);
assert.equal(rewriteSelfReplyTo(alice, sentToAlice, me), alice);
assert.equal(rewriteSelfReplyTo(me, receivedFromAlice, me), me);
assert.equal(rewriteSelfReplyTo(me, { sender: me, recipient: me }, me), me);

console.log("reply-recipients helpers: ok");
