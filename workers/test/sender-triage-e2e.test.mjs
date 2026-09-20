/**
 * End-to-end-shaped coverage for Screener inbound + outbound allow decisions.
 * Mirrors receiveEmail triage order and outbound allow-list skips for rejects.
 * Run: node --experimental-strip-types workers/test/sender-triage-e2e.test.mjs
 */

import assert from "node:assert/strict";
import {
	applyInboxFilters,
	parseInboxFilters,
} from "../lib/inbox-filters.ts";
import { shouldAutoDraft, shouldSendPush } from "../lib/classify-email.ts";
import {
	normalizeTriageSender,
	parseScreenerEnabled,
	resolveInboundFolder,
} from "../lib/sender-triage.ts";

const ham = { class: "ham", folderId: "inbox", reason: "ai-ham" };
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };

function inboundPipeline({
	classification,
	triage,
	rawSettings = {},
	sender,
	subject = "Hi",
	auth = null,
}) {
	const filterHit = applyInboxFilters(parseInboxFilters(rawSettings), {
		sender,
		subject,
		headers: [],
		auth,
	});
	const decision = resolveInboundFolder({
		classification,
		triage,
		filterHit,
		screenerEnabled: parseScreenerEnabled(rawSettings),
	});
	const autoDraft =
		!decision.skipAutoDraft &&
		shouldAutoDraft(classification, auth) &&
		!filterHit?.skipAutoDraft;
	const push = !decision.skipPush && shouldSendPush(classification);
	return { ...decision, autoDraft, push, filterHit };
}

// Unknown stranger → Screener, quiet
{
	const r = inboundPipeline({
		classification: ham,
		triage: null,
		sender: "stranger@example.com",
		rawSettings: {
			filters: [{ id: "x", enabled: true, from: "stranger@example.com", folderId: "inbox" }],
		},
	});
	assert.equal(r.folderId, "screener");
	assert.equal(r.autoDraft, false);
	assert.equal(r.push, false);
	assert.equal(r.skipForward, true);
}

// Allowed after you emailed them
{
	const r = inboundPipeline({
		classification: ham,
		triage: {
			sender: "friend@example.com",
			status: "allowed",
			destination_folder_id: "inbox",
			decided_at: "t",
			updated_at: "t",
		},
		sender: "friend@example.com",
	});
	assert.equal(r.folderId, "inbox");
	assert.equal(r.autoDraft, true);
	assert.equal(r.push, true);
}

// Rejected stays quiet in screened_out
{
	const r = inboundPipeline({
		classification: ham,
		triage: {
			sender: "spammy@example.com",
			status: "rejected",
			destination_folder_id: null,
			decided_at: "t",
			updated_at: "t",
		},
		sender: "spammy@example.com",
	});
	assert.equal(r.folderId, "screened_out");
	assert.equal(r.push, false);
	assert.equal(r.autoDraft, false);
}

// Spam still wins over triage allow
{
	const r = inboundPipeline({
		classification: spam,
		triage: {
			sender: "spoof@example.com",
			status: "allowed",
			destination_folder_id: "inbox",
			decided_at: "t",
			updated_at: "t",
		},
		sender: "spoof@example.com",
	});
	assert.equal(r.folderId, "spam");
}

// Angle-bracket From normalizes for triage PK
assert.equal(
	normalizeTriageSender("Alice <alice@example.com>"),
	"alice@example.com",
);
assert.equal(normalizeTriageSender("alice@example.com"), "alice@example.com");

// Outbound allow policy: skip if already rejected
function shouldUpsertOutboundAllow(existing) {
	if (existing?.status === "rejected") return false;
	if (existing?.status === "allowed") return false;
	return true;
}
assert.equal(shouldUpsertOutboundAllow(null), true);
assert.equal(shouldUpsertOutboundAllow({ status: "allowed" }), false);
assert.equal(shouldUpsertOutboundAllow({ status: "rejected" }), false);

console.log("sender-triage-e2e.test.mjs: ok");
