// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Web reader helpers for notes to self (AVE-60): sticky placement and
// clamping, grouping, list preview text and the editor's markdown buttons.
import assert from "node:assert/strict";
import {
	STICKY_CASCADE,
	STICKY_EDGE,
	applyNoteFormat,
	clampNotePosition,
	groupThreadNotes,
	keyboardNudge,
	notePreviewText,
	passedDragThreshold,
	stickyNotePosition,
	threadKeyFor,
} from "../../app/lib/thread-notes.ts";

const note = { width: 240, height: 120 };
const view = { width: 800, height: 600 };

// ── threadKeyFor ──
assert.equal(threadKeyFor({ id: "e1", thread_id: "t1" }), "t1");
assert.equal(threadKeyFor({ id: "e1", thread_id: null }), "e1");
assert.equal(threadKeyFor({ id: "e1" }), "e1");

// ── clampNotePosition ──
// Inside: unchanged (rounded).
assert.deepEqual(clampNotePosition({ x: 100.4, y: 50.6 }, note, view), { x: 100, y: 51 });
// Past the top-left: held at the edge gap.
assert.deepEqual(clampNotePosition({ x: -50, y: -10 }, note, view), { x: STICKY_EDGE, y: STICKY_EDGE });
// Past the bottom-right: the whole note stays inside.
assert.deepEqual(clampNotePosition({ x: 5000, y: 5000 }, note, view), {
	x: view.width - note.width - STICKY_EDGE,
	y: view.height - note.height - STICKY_EDGE,
});
// A view narrower / shorter than the note pins it to the start edge.
assert.deepEqual(clampNotePosition({ x: 90, y: 90 }, note, { width: 200, height: 100 }), {
	x: STICKY_EDGE,
	y: STICKY_EDGE,
});
// Junk input falls back to the start edge.
assert.deepEqual(clampNotePosition({ x: Number.NaN, y: Infinity }, note, view), {
	x: STICKY_EDGE,
	y: STICKY_EDGE,
});
// Custom edge.
assert.deepEqual(clampNotePosition({ x: 0, y: 0 }, note, view, 0), { x: 0, y: 0 });

// ── stickyNotePosition ──
// Never dragged: top-right corner.
assert.deepEqual(stickyNotePosition({ posX: null, posY: null }, 0, note, view), {
	x: view.width - note.width - STICKY_EDGE,
	y: STICKY_EDGE,
});
// Later unsaved notes cascade down-left.
assert.deepEqual(stickyNotePosition({ posX: null, posY: null }, 2, note, view), {
	x: view.width - note.width - STICKY_EDGE - 2 * STICKY_CASCADE,
	y: STICKY_EDGE + 2 * STICKY_CASCADE,
});
// Saved spot wins, and is clamped to a smaller view.
assert.deepEqual(stickyNotePosition({ posX: 300, posY: 200 }, 0, note, view), { x: 300, y: 200 });
assert.deepEqual(
	stickyNotePosition({ posX: 700, posY: 500 }, 0, note, { width: 400, height: 300 }),
	{ x: 400 - note.width - STICKY_EDGE, y: 300 - note.height - STICKY_EDGE },
);
// Only one axis saved: treated as never dragged.
assert.deepEqual(stickyNotePosition({ posX: 10, posY: null }, 0, note, view), {
	x: view.width - note.width - STICKY_EDGE,
	y: STICKY_EDGE,
});

// ── drag threshold & keyboard ──
assert.equal(passedDragThreshold({ x: 0, y: 0 }, { x: 1, y: 2 }), false);
assert.equal(passedDragThreshold({ x: 0, y: 0 }, { x: 3, y: 0 }), true);
assert.deepEqual(keyboardNudge("ArrowLeft", false), { x: -8, y: 0 });
assert.deepEqual(keyboardNudge("ArrowDown", true), { x: 0, y: 32 });
assert.equal(keyboardNudge("Enter", false), null);

// ── groupThreadNotes ──
const mk = (id, noteType, emailId) => ({
	id,
	threadId: "t1",
	emailId,
	noteType,
	body: id,
	posX: null,
	posY: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
});
{
	const { sticky, inlineByEmail } = groupThreadNotes([
		mk("s1", "sticky", null),
		mk("i1", "inline", "e1"),
		mk("i2", "inline", "e2"),
		mk("i3", "inline", "e1"),
		mk("s2", "sticky", "e2"),
		mk("orphan", "inline", null),
	]);
	assert.deepEqual(sticky.map((n) => n.id), ["s1", "s2"]);
	assert.deepEqual(inlineByEmail.get("e1").map((n) => n.id), ["i1", "i3"]);
	assert.deepEqual(inlineByEmail.get("e2").map((n) => n.id), ["i2"]);
	assert.equal(inlineByEmail.size, 2);
}
assert.deepEqual(groupThreadNotes(undefined).sticky, []);

// ── notePreviewText ──
assert.equal(notePreviewText(null), "");
assert.equal(notePreviewText("Call **Alice** at 2pm"), "Call Alice at 2pm");
assert.equal(notePreviewText("# Pricing\n- keep _under_ $15k\n- [ ] send `SLA`"), "Pricing keep under $15k send SLA");
assert.equal(notePreviewText("See [the doc](https://x.test/a) > ok"), "See the doc > ok");
assert.equal(notePreviewText("> quoted\n1. first\n2) second"), "quoted first second");
assert.equal(notePreviewText("snake_case_name stays"), "snake_case_name stays");
assert.equal(notePreviewText("~~old~~ new"), "old new");

// ── applyNoteFormat ──
// Wrap a selection in bold, then unwrap it again.
{
	const bold = applyNoteFormat("call alice", 5, 10, "bold");
	assert.deepEqual(bold, { text: "call **alice**", selectionStart: 7, selectionEnd: 12 });
	assert.deepEqual(applyNoteFormat(bold.text, bold.selectionStart, bold.selectionEnd, "bold"), {
		text: "call alice",
		selectionStart: 5,
		selectionEnd: 10,
	});
}
// Empty selection: caret lands between the markers.
assert.deepEqual(applyNoteFormat("ab", 1, 1, "italic"), { text: "a__b", selectionStart: 2, selectionEnd: 2 });
assert.deepEqual(applyNoteFormat("x", 1, 1, "code"), { text: "x``", selectionStart: 2, selectionEnd: 2 });
// Link: url placeholder selected.
{
	const link = applyNoteFormat("see docs", 4, 8, "link");
	assert.equal(link.text, "see [docs](https://)");
	assert.equal(link.text.slice(link.selectionStart, link.selectionEnd), "https://");
	const bare = applyNoteFormat("", 0, 0, "link");
	assert.equal(bare.text, "[link](https://)");
	assert.equal(bare.text.slice(bare.selectionStart, bare.selectionEnd), "https://");
}
// Bullets prefix every touched line, and toggle off when all have it.
{
	const text = "one\ntwo\nthree";
	const on = applyNoteFormat(text, 1, 6, "bullet");
	assert.equal(on.text, "- one\n- two\nthree");
	assert.equal(on.selectionStart, 3);
	const off = applyNoteFormat(on.text, 0, 11, "bullet");
	assert.equal(off.text, "one\ntwo\nthree");
	// Caret on an empty line.
	assert.deepEqual(applyNoteFormat("", 0, 0, "checklist"), { text: "- [ ] ", selectionStart: 6, selectionEnd: 6 });
	// Only the caret's line changes.
	assert.equal(applyNoteFormat("a\nb\nc", 2, 2, "bullet").text, "a\n- b\nc");
	// Mixed lines: the unprefixed ones gain it, none lose it.
	assert.equal(applyNoteFormat("- a\nb", 0, 5, "bullet").text, "- a\n- b");
}
// Selection given backwards still works.
assert.equal(applyNoteFormat("hello", 5, 0, "bold").text, "**hello**");

console.log("thread-notes-web ok");
