/**
 * The in-page pill sits inside the email field: flush with its inner right edge, never past it,
 * in every state. Covers the layout math in content.js (pillLayout).
 * Run: node extension/test/pill-layout.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooks = {};
// A framed window makes the content script stop right after defining its pure helpers.
const window = { top: {} };
vm.runInContext(readFileSync(join(root, "content.js"), "utf8"), vm.createContext({ __inboxiesTest: hooks, window }));
const { pillLayout } = hooks;
assert.equal(typeof pillLayout, "function");

// About the widths Chromium draws the pill at with each label (Inter 12px; ▾ is the menu chevron).
const LABELS = {
	"Private email": 113,
	"Private email ▾": 127,
	"Creating…": 97,
	Filled: 76,
	"Couldn't create one": 151,
	"Connect the extension first": 194,
};

const field = (width, height, border = 1) => ({
	width,
	height,
	borderTop: border,
	borderRight: border,
	borderBottom: border,
	borderLeft: border,
});

/** The pill's box (left, top, right, bottom) for a label width, as content.js draws it. */
function pillBox(f, labelWidth, restWidth = LABELS["Private email"]) {
	const layout = pillLayout(f, restWidth, labelWidth);
	if (!layout) return null;
	const width = layout.compact ? layout.height : labelWidth;
	return { ...layout, left: layout.right - width, bottom: layout.top + layout.height };
}

function assertInside(f, box, message) {
	assert.ok(box.left >= f.borderLeft + 3, `${message}: left ${box.left}`);
	assert.ok(box.right <= f.width - f.borderRight - 3, `${message}: right ${box.right}`);
	assert.ok(box.top >= f.borderTop + 3, `${message}: top ${box.top}`);
	assert.ok(box.bottom <= f.height - f.borderBottom - 3, `${message}: bottom ${box.bottom}`);
}


for (const [width, height] of [
	[340, 48],
	[340, 40],
	[340, 32],
	[180, 48],
	[180, 32],
	[120, 32],
	[60, 30],
	[600, 56],
]) {
	const f = field(width, height);
	for (const [text, labelWidth] of Object.entries(LABELS)) {
		const box = pillBox(f, labelWidth);
		assert.ok(box, `${width}×${height} shows the pill`);
		assertInside(f, box, `${width}×${height} "${text}"`);
	}
}

// Normal field: the pill is 24px tall, 8px from the inner right edge, vertically centred.
{
	const layout = pillLayout(field(340, 48), 116);
	assert.deepEqual({ ...layout }, { top: 12, right: 331, height: 24, compact: false });
}

// Short field: still 24px, 3px from the border.
{
	const layout = pillLayout(field(340, 32), 116);
	assert.equal(layout.height, 24);
	assert.equal(layout.top, 4);
	assert.equal(layout.right, 340 - 1 - 3);
}

// Shorter still: the pill shrinks to fit, then stops showing.
assert.equal(pillLayout(field(340, 28), 116).height, 20);
assert.equal(pillLayout(field(340, 22), 116), null);

// Narrow field: the label collapses to the icon rather than crowding (or leaving) the field,
// and stays collapsed through the shorter Creating… and Filled.
const rest = LABELS["Private email"];
assert.equal(pillLayout(field(180, 48), rest).compact, true);
assert.equal(pillLayout(field(180, 48), rest, LABELS.Filled).compact, true);
assert.equal(pillLayout(field(340, 48), rest).compact, false);
// A long status shows while it fits inside the field, and collapses where it wouldn't.
assert.equal(pillLayout(field(340, 48), rest, LABELS["Connect the extension first"]).compact, false);
assert.equal(pillLayout(field(208, 48), rest).compact, false);
assert.equal(pillLayout(field(208, 48), rest, LABELS["Connect the extension first"]).compact, true);

// Too small for even the icon: hidden.
assert.equal(pillLayout(field(28, 32), 116), null);

// Thick borders are respected.
{
	const f = field(300, 48, 3);
	assertInside(f, pillBox(f, 116), "thick border");
}

console.log("pill layout: ok");
