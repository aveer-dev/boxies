/**
 * Inbox filter match / apply / validate.
 * Run: node --experimental-strip-types workers/test/inbox-filters.test.mjs
 */

import assert from "node:assert/strict";
import {
	MAX_INBOX_FILTERS,
	applyInboxFilters,
	inboxFiltersError,
	matchFromCondition,
	matchListCondition,
	matchSubjectCondition,
	parseInboxFilters,
} from "../lib/inbox-filters.ts";
import { mergeMailboxSettingsBlob } from "../lib/mail-automations.ts";

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

assert.equal(matchFromCondition("alice@example.com", "Alice <alice@example.com>"), true);
assert.equal(matchFromCondition("alice@example.com", "bob@example.com"), false);
assert.equal(matchFromCondition("@example.com", "alice@example.com"), true);
assert.equal(matchFromCondition("*@example.com", "alice@example.com"), true);
assert.equal(matchFromCondition("@example.com", "alice@other.com"), false);
assert.equal(matchFromCondition("news", "newsletter@lists.example.com"), true);

assert.equal(
	matchListCondition("*", headers(["List-Id", "<updates.example.com>"])),
	true,
);
assert.equal(matchListCondition("*", headers(["Subject", "Hello"])), false);
assert.equal(
	matchListCondition(
		"updates.example.com",
		headers(["List-Id", "<updates.example.com>"]),
	),
	true,
);
assert.equal(
	matchListCondition("other", headers(["List-Id", "<updates.example.com>"])),
	false,
);

assert.equal(matchSubjectCondition("invoice", "Your Invoice #12"), true);
assert.equal(matchSubjectCondition("invoice", "Hello there"), false);

{
	const rules = parseInboxFilters({
		filters: [
			{
				id: "disabled",
				enabled: false,
				from: "spam@example.com",
				folderId: "trash",
			},
			{
				id: "first",
				enabled: true,
				from: "@acme.com",
				folderId: "archive",
				skipAutoDraft: true,
			},
			{
				id: "second",
				enabled: true,
				from: "@acme.com",
				folderId: "trash",
			},
		],
	});
	const hit = applyInboxFilters(rules, {
		sender: "boss@acme.com",
		subject: "Hello",
		headers: [],
	});
	assert.equal(hit?.ruleId, "first");
	assert.equal(hit?.folderId, "archive");
	assert.equal(hit?.skipAutoDraft, true);
}

{
	const rules = parseInboxFilters([
		{
			id: "and",
			from: "@acme.com",
			subject: "invoice",
			folderId: "updates",
		},
	]);
	assert.equal(
		applyInboxFilters(rules, {
			sender: "ap@acme.com",
			subject: "Hello",
			headers: [],
		}),
		null,
	);
	const hit = applyInboxFilters(rules, {
		sender: "ap@acme.com",
		subject: "January invoice",
		headers: [],
	});
	assert.equal(hit?.folderId, "updates");
}

{
	const rules = parseInboxFilters([
		{
			id: "fwd",
			list: "*",
			forwardTo: "backup@example.com",
		},
	]);
	const hit = applyInboxFilters(rules, {
		sender: "list@news.example",
		subject: "Weekly",
		headers: headers(["List-Unsubscribe", "<mailto:u@example.com>"]),
	});
	assert.equal(hit?.forwardTo, "backup@example.com");
	assert.equal(hit?.skipAutoDraft, false);
}

{
	const parsed = parseInboxFilters({
		filters: [{ id: "x", from: "a@b.com" }],
	});
	assert.equal(
		inboxFiltersError(parsed, "me@inbox.test"),
		"Each filter needs at least one action (folder, skip auto-draft, or forward)",
	);
}

{
	const parsed = parseInboxFilters([{ id: "x", folderId: "archive" }]);
	assert.equal(
		inboxFiltersError(parsed, "me@inbox.test"),
		"Each filter needs at least one condition (from, list, or subject)",
	);
}

{
	const parsed = parseInboxFilters([
		{
			id: "x",
			from: "a@b.com",
			forwardTo: "me@inbox.test",
		},
	]);
	assert.equal(
		inboxFiltersError(parsed, "me@inbox.test"),
		"Filter forward address cannot be this mailbox",
	);
}

{
	const many = Array.from({ length: MAX_INBOX_FILTERS + 1 }, (_, i) => ({
		id: `r${i}`,
		from: "a@b.com",
		folderId: "archive",
	}));
	assert.equal(
		inboxFiltersError(parseInboxFilters(many), "me@inbox.test"),
		`At most ${MAX_INBOX_FILTERS} filters allowed`,
	);
}

{
	const merged = mergeMailboxSettingsBlob(
		{
			fromName: "Ada",
			filters: [{ id: "keep", from: "@acme.com", folderId: "archive" }],
			forwarding: { enabled: false, email: "" },
		},
		{
			fromName: "Ada",
			forwarding: { enabled: true, email: "ada@example.com" },
		},
	);
	assert.deepEqual(merged.filters, [
		{ id: "keep", from: "@acme.com", folderId: "archive" },
	]);
	assert.deepEqual(merged.forwarding, {
		enabled: true,
		email: "ada@example.com",
	});
}

{
	const merged = mergeMailboxSettingsBlob(
		{ filters: [{ id: "old", from: "a@b.com", folderId: "trash" }] },
		{ filters: [{ id: "new", from: "c@d.com", skipAutoDraft: true }] },
	);
	assert.deepEqual(merged.filters, [
		{ id: "new", from: "c@d.com", skipAutoDraft: true },
	]);
}

console.log("inbox-filters tests passed");
