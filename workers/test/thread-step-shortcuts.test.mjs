/**
 * J and K move through the mail list (AVE-202).
 * Run: pnpm test:unit thread-step
 */

import assert from "node:assert/strict";
import { SHORTCUTS, shortcutFor } from "../../app/lib/shortcuts.ts";
import { stepThread } from "../../app/lib/thread-step.ts";

const key = (k, mods = {}) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

// Plain j / k move; ⌘J stays the assistant and ⌘K stays search.
assert.equal(shortcutFor(key("j")), "nextThread");
assert.equal(shortcutFor(key("k")), "prevThread");
assert.equal(shortcutFor(key("J", { shiftKey: true })), null);
assert.equal(shortcutFor(key("j", { metaKey: true })), "assistant");
assert.equal(shortcutFor(key("j", { ctrlKey: true })), "assistant");
assert.equal(shortcutFor(key("k", { metaKey: true })), "search");
assert.equal(shortcutFor(key("j", { altKey: true })), null);
// Only ⌘K / ⌘J fire while typing; j and k never do.
assert.ok(!SHORTCUTS.nextThread.inFields);
assert.ok(!SHORTCUTS.prevThread.inFields);
// The ? sheet lists them.
assert.equal(SHORTCUTS.nextThread.keys, "J");
assert.equal(SHORTCUTS.prevThread.keys, "K");

const ids = ["a", "b", "c"];
// Nothing open: start at the first thread, either way.
assert.equal(stepThread(ids, null, 1), "a");
assert.equal(stepThread(ids, null, -1), "a");
// A thread no longer in the list (archived, other page): start over.
assert.equal(stepThread(ids, "gone", 1), "a");
// Next and previous.
assert.equal(stepThread(ids, "a", 1), "b");
assert.equal(stepThread(ids, "c", -1), "b");
// Stop at the ends; no wrapping.
assert.equal(stepThread(ids, "c", 1), null);
assert.equal(stepThread(ids, "a", -1), null);
// Empty list.
assert.equal(stepThread([], null, 1), null);

console.log("thread-step shortcuts ok");
