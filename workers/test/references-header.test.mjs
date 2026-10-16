/**
 * Outbound References header stays bounded on long threads (AVE-51).
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	MAX_RECENT_REFERENCES,
	buildReferencesChain,
	buildThreadingHeaders,
	trimReferences,
} from "../lib/email-helpers.ts";

const id = (n) => `msg-${n}@example.com`;

// Short chains are untouched.
assert.deepEqual(trimReferences([]), []);
assert.deepEqual(trimReferences([id(0)]), [id(0)]);
assert.deepEqual(trimReferences([id(0), id(1), id(2)]), [id(0), id(1), id(2)]);
const exact = Array.from({ length: MAX_RECENT_REFERENCES + 1 }, (_, i) => id(i));
assert.deepEqual(trimReferences(exact), exact);

// Empties and duplicates are dropped; root and latest position win.
assert.deepEqual(trimReferences([id(0), "", id(1), id(0), id(2), id(1)]), [id(0), id(2), id(1)]);

// A 100-message thread: replying to message 99 whose stored refs are 0..98.
const original = {
	id: "local-99",
	message_id: id(99),
	folder_id: "inbox",
	thread_id: "thread-1",
	email_references: JSON.stringify(Array.from({ length: 99 }, (_, i) => id(i))),
};
const { originalMsgId, references, threadId } = buildReferencesChain(original);
assert.equal(originalMsgId, id(99));
assert.equal(threadId, "thread-1");
assert.equal(references.length, MAX_RECENT_REFERENCES + 1);
assert.equal(references[0], id(0), "root kept");
assert.equal(references.at(-1), id(99), "direct parent kept");
assert.deepEqual(
	references.slice(1),
	Array.from({ length: MAX_RECENT_REFERENCES }, (_, i) => id(100 - MAX_RECENT_REFERENCES + i)),
	"most recent ids kept in order",
);

const headers = buildThreadingHeaders(originalMsgId, references);
assert.equal(headers["In-Reply-To"], `<${id(99)}>`);
const wire = headers.References.split(" ");
assert.equal(wire.length, MAX_RECENT_REFERENCES + 1);
assert.equal(wire[0], `<${id(0)}>`);
assert.equal(wire.at(-1), `<${id(99)}>`);

// Client-supplied (draft send) chains are trimmed at the header layer too.
const untrimmed = Array.from({ length: 100 }, (_, i) => id(i));
const draftWire = buildThreadingHeaders(id(99), untrimmed).References.split(" ");
assert.equal(draftWire.length, MAX_RECENT_REFERENCES + 1);
assert.equal(draftWire[0], `<${id(0)}>`);
assert.equal(draftWire.at(-1), `<${id(99)}>`);

// No references -> no References header.
assert.deepEqual(buildThreadingHeaders(id(1), []), { "In-Reply-To": `<${id(1)}>` });

// Malformed stored refs fall back to just the parent.
assert.deepEqual(
	buildReferencesChain({ ...original, email_references: "{not json" }).references,
	[id(99)],
);
assert.deepEqual(
	buildReferencesChain({ ...original, email_references: '{"a":1}' }).references,
	[id(99)],
);

console.log("references-header tests passed");
