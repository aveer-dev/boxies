/**
 * Enter in To/Cc/Bcc commits the recipient and never sends the message (AVE-122).
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import {
	commitRecipientToken,
	currentToken,
	recipientKeyAction,
} from "../../app/lib/recipient-input.ts";

const enter = (extra = {}) => recipientKeyAction({ key: "Enter", listOpen: false, hasHighlight: false, ...extra });

// Plain Enter with no suggestions shown (the repro) commits, never sends.
assert.equal(enter(), "commit");
assert.equal(enter({ shiftKey: true }), "commit");
assert.equal(enter({ altKey: true }), "commit");
// List open but nothing to pick: still commit.
assert.equal(enter({ listOpen: true, hasHighlight: false }), "commit");
// Highlighted suggestion: pick it.
assert.equal(enter({ listOpen: true, hasHighlight: true }), "select");
// Cmd/Ctrl+Enter sends, even with the list open.
assert.equal(enter({ metaKey: true }), "send");
assert.equal(enter({ ctrlKey: true }), "send");
assert.equal(enter({ metaKey: true, listOpen: true, hasHighlight: true }), "send");
// IME composition Enter is left to the browser.
assert.equal(enter({ isComposing: true }), "none");

// Other keys only act while the list is open.
const key = (k, listOpen, hasHighlight = true) => recipientKeyAction({ key: k, listOpen, hasHighlight });
assert.equal(key("ArrowDown", true), "next");
assert.equal(key("ArrowUp", true), "prev");
assert.equal(key("Tab", true), "select");
assert.equal(key("Tab", true, false), "none");
assert.equal(key("Escape", true), "close");
for (const k of ["ArrowDown", "ArrowUp", "Tab", "Escape", "a"]) {
	assert.equal(key(k, false), "none");
}

// Committing the typed token appends a separator once.
assert.equal(commitRecipientToken("ada@example.com"), "ada@example.com, ");
assert.equal(commitRecipientToken("ada@example.com  "), "ada@example.com, ");
assert.equal(commitRecipientToken("a@x.com, b@y.com"), "a@x.com, b@y.com, ");
assert.equal(commitRecipientToken("a@x.com, "), "a@x.com, ");
assert.equal(commitRecipientToken("a@x.com,"), "a@x.com,");
assert.equal(commitRecipientToken(""), "");
assert.equal(commitRecipientToken("   "), "   ");

assert.deepEqual(currentToken("a@x.com, bo"), { prefix: "a@x.com,", token: "bo" });
assert.deepEqual(currentToken("bo"), { prefix: "", token: "bo" });

console.log("recipient-enter: ok");
