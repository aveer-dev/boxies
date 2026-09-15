/**
 * Sent → “people I’ve emailed” aggregation for compose autocomplete.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { aggregateRecentRecipients } from "../../shared/recent-recipients.ts";

const rows = [
	{
		recipient: "alice@example.com, bob@example.com",
		cc: "carol@example.com",
		bcc: null,
		date: "2026-03-10T12:00:00.000Z",
	},
	{
		recipient: "Alice Example <alice@example.com>",
		cc: null,
		bcc: "dave@example.com",
		date: "2026-03-09T12:00:00.000Z",
	},
	{
		recipient: "eve@example.com",
		cc: null,
		bcc: null,
		date: "2026-03-08T12:00:00.000Z",
	},
];

const all = aggregateRecentRecipients(rows, { limit: 10 });
assert.deepEqual(
	all.map((r) => r.email),
	[
		"alice@example.com",
		"bob@example.com",
		"carol@example.com",
		"dave@example.com",
		"eve@example.com",
	],
);
assert.equal(all[0].name, "Alice Example");
assert.equal(all[0].lastEmailedAt, "2026-03-10T12:00:00.000Z");

const filtered = aggregateRecentRecipients(rows, { q: "bob" });
assert.deepEqual(
	filtered.map((r) => r.email),
	["bob@example.com"],
);

const byName = aggregateRecentRecipients(rows, { q: "alice" });
assert.equal(byName.length, 1);
assert.equal(byName[0].email, "alice@example.com");

const known = aggregateRecentRecipients(
	[{ recipient: "bob@example.com", date: "2026-03-10T00:00:00.000Z" }],
	{ knownNames: { "bob@example.com": "Bob Builder" } },
);
assert.equal(known[0].name, "Bob Builder");

const capped = aggregateRecentRecipients(rows, { limit: 2 });
assert.equal(capped.length, 2);

assert.deepEqual(
	aggregateRecentRecipients([], { q: "x" }),
	[],
);

console.log("recent-recipients helpers: ok");
