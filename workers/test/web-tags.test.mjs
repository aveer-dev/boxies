/**
 * Tags on web (AVE-241): the picker's options and the cache patches made
 * while a tag change is in flight.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/web-tags.test.mjs
 */

import assert from "node:assert/strict";
import {
	compareTagNames,
	patchThreadTag,
	tagPickerOptions,
	tagThreadKey,
	unionTags,
	withTag,
} from "../../app/lib/tags.ts";
import { shortcutFor } from "../../app/lib/shortcuts.ts";

const work = { id: "t-work", name: "Work" };
const acme = { id: "t-acme", name: "acme" };
const zed = { id: "t-zed", name: "Zed" };

// Sorted like the Worker (name_key, then id): case-insensitive.
assert.deepEqual([zed, work, acme].sort(compareTagNames), [acme, work, zed]);

// withTag adds once, removes, keeps name order, and never mutates its input.
const start = [work];
assert.deepEqual(withTag(start, acme, true), [acme, work]);
assert.deepEqual(withTag(start, work, true), [work], "adding twice is a no-op");
assert.deepEqual(withTag(start, work, false), []);
assert.deepEqual(withTag(undefined, zed, true), [zed]);
assert.deepEqual(start, [work]);

// A thread carries every tag of its messages, once each.
assert.deepEqual(unionTags([{ tags: [work] }, { tags: [acme, work] }, {}]), [acme, work]);
assert.deepEqual(unionTags([]), []);

assert.equal(tagThreadKey({ id: "e1", thread_id: "th" }), "th");
assert.equal(tagThreadKey({ id: "e1", thread_id: null }), "e1");
assert.equal(tagThreadKey({ id: "e1" }), "e1");

// Patching a thread touches its rows only, and returns the same array when
// none belong to it (so React Query keeps the cached object).
const rows = [
	{ id: "a", thread_id: "th1", tags: [work] },
	{ id: "b", thread_id: "th2", tags: [] },
	{ id: "c", tags: [] }, // stored without a thread: its own id is the key
];
const added = patchThreadTag(rows, "th1", acme, true);
assert.deepEqual(added[0].tags, [acme, work]);
assert.equal(added[1], rows[1]);
assert.deepEqual(patchThreadTag(rows, "c", zed, true)[2].tags, [zed]);
assert.deepEqual(patchThreadTag(rows, "th1", work, false)[0].tags, []);
assert.equal(patchThreadTag(rows, "nope", work, true), rows);

// Picker: empty query lists everything and offers nothing to create.
const all = [acme, work, zed];
assert.deepEqual(tagPickerOptions(all, ""), { matches: all, create: null });
assert.deepEqual(tagPickerOptions(all, "   "), { matches: all, create: null });
// Substring, case-insensitive; a new name is offered as typed (trimmed, spaces folded).
assert.deepEqual(tagPickerOptions(all, "W"), { matches: [work], create: "W" });
assert.deepEqual(tagPickerOptions(all, "  new   tag "), { matches: [], create: "new tag" });
// An existing name (any case) isn't offered again.
assert.deepEqual(tagPickerOptions(all, "WORK"), { matches: [work], create: null });
// Names the Worker would refuse aren't offered.
assert.equal(tagPickerOptions(all, "x".repeat(65)).create, null);
assert.equal(tagPickerOptions(all, "x".repeat(64)).create, "x".repeat(64));
assert.equal(tagPickerOptions(all, "bad\u0007name").create, null);

// ⇧L opens the tag picker; plain L is still Reply later.
const key = (k, shiftKey = false) => ({ key: k, shiftKey, metaKey: false, ctrlKey: false, altKey: false });
assert.equal(shortcutFor(key("L", true)), "tags");
assert.equal(shortcutFor(key("l")), "replyLater");

console.log("web-tags: ok");
