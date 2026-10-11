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
import {
	overrideAiSpamForVouchedSender,
	shouldAutoDraft,
	shouldSendPush,
} from "../lib/classify-email.ts";
import {
	isVouchedSender,
	normalizeTriageSender,
	parseScreenerEnabled,
	resolveInboundFolder,
} from "../lib/sender-triage.ts";

const ham = { class: "ham", folderId: "inbox", reason: "ai-ham" };
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };
const newsletter = { class: "bulk", folderId: "promotions", reason: "bulk-list-headers" };
const receipt = { class: "bulk", folderId: "updates", reason: "bulk-transactional" };

function inboundPipeline({
	classification: rawClassification,
	triage,
	rawSettings = {},
	sender,
	subject = "Hi",
	auth = null,
	preferenceFolderId = null,
}) {
	const filterHit = applyInboxFilters(parseInboxFilters(rawSettings), {
		sender,
		subject,
		headers: [],
		auth,
	});
	const classification = overrideAiSpamForVouchedSender(rawClassification, {
		vouched: isVouchedSender(triage, preferenceFolderId),
		auth,
	});
	const decision = resolveInboundFolder({
		classification,
		triage,
		filterHit,
		screenerEnabled: parseScreenerEnabled(rawSettings),
		preferenceFolderId,
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
	assert.equal(r.skipForward, false);
}

// Allowed after you emailed them (outbound allow stores no destination)
{
	const r = inboundPipeline({
		classification: ham,
		triage: {
			sender: "friend@example.com",
			status: "allowed",
			destination_folder_id: null,
			decided_at: "t",
			updated_at: "t",
		},
		sender: "friend@example.com",
	});
	assert.equal(r.folderId, "inbox");
	assert.equal(r.autoDraft, true);
	assert.equal(r.push, true);
}

// Auto-allowed list mail still sorts into Promotions / Updates
{
	const autoAllowed = (sender) => ({
		sender,
		status: "allowed",
		destination_folder_id: null,
		decided_at: "t",
		updated_at: "t",
	});
	const promo = inboundPipeline({
		classification: newsletter,
		triage: autoAllowed("deals@shop.example"),
		sender: "deals@shop.example",
	});
	assert.equal(promo.folderId, "promotions");
	assert.equal(promo.triageAction, "allowed");
	assert.equal(promo.push, true);
	assert.equal(promo.autoDraft, false);

	const updates = inboundPipeline({
		classification: receipt,
		triage: autoAllowed("orders@shop.example"),
		sender: "orders@shop.example",
	});
	assert.equal(updates.folderId, "updates");

	// Explicit sender preference (Settings → Senders) beats classify
	const pinnedByPref = inboundPipeline({
		classification: newsletter,
		triage: autoAllowed("digest@club.example"),
		sender: "digest@club.example",
		preferenceFolderId: "inbox",
	});
	assert.equal(pinnedByPref.folderId, "inbox");

	// Filter folder beats classify
	const filtered = inboundPipeline({
		classification: newsletter,
		triage: autoAllowed("deals@shop.example"),
		sender: "deals@shop.example",
		rawSettings: {
			filters: [
				{ id: "f", enabled: true, from: "deals@shop.example", folderId: "archive" },
			],
		},
	});
	assert.equal(filtered.folderId, "archive");
}

// Accepted with an explicit destination keeps it over classify
{
	const acceptedTo = (destination_folder_id) => ({
		sender: "letters@writer.example",
		status: "allowed",
		destination_folder_id,
		decided_at: "t",
		updated_at: "t",
	});
	const inbox = inboundPipeline({
		classification: newsletter,
		triage: acceptedTo("inbox"),
		sender: "letters@writer.example",
	});
	assert.equal(inbox.folderId, "inbox");

	const promotions = inboundPipeline({
		classification: ham,
		triage: acceptedTo("promotions"),
		sender: "letters@writer.example",
	});
	assert.equal(promotions.folderId, "promotions");
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

// AI spam guess on someone you emailed: still reaches the Inbox and notifies
// (osato@ → emmanuel@ landed in Spam on 2026-10-09 before this).
{
	const aiSpam = { class: "spam", folderId: "spam", reason: "ai-spam" };
	const authed = {
		spoofed: false,
		source: "authentication-results",
		aligned: true,
		headerFrom: "osato@inboxies.email",
		envelopeFrom: "bounces@cf-bounce.inboxies.email",
	};
	const emailedThem = {
		sender: "osato@inboxies.email",
		status: "allowed",
		destination_folder_id: null,
		decided_at: "t",
		updated_at: "t",
	};

	const r = inboundPipeline({
		classification: aiSpam,
		triage: emailedThem,
		sender: "osato@inboxies.email",
		auth: authed,
	});
	assert.equal(r.folderId, "inbox");
	assert.equal(r.triageAction, "allowed");
	assert.equal(r.push, true);
	assert.equal(r.autoDraft, true);

	// Purpose box still applies once the guess is overridden.
	const sorted = inboundPipeline({
		classification: aiSpam,
		triage: emailedThem,
		sender: "osato@inboxies.email",
		auth: authed,
		preferenceFolderId: "updates",
	});
	assert.equal(sorted.folderId, "updates");

	// Same guess, unknown sender → stays in Spam.
	const stranger = inboundPipeline({
		classification: aiSpam,
		triage: null,
		sender: "stranger@example.com",
		auth: { ...authed, headerFrom: "stranger@example.com" },
	});
	assert.equal(stranger.folderId, "spam");
	assert.equal(stranger.push, false);

	// Allowed address but mail doesn't authenticate as them → stays in Spam.
	const unproven = inboundPipeline({
		classification: aiSpam,
		triage: emailedThem,
		sender: "osato@inboxies.email",
		auth: null,
	});
	assert.equal(unproven.folderId, "spam");
	assert.equal(unproven.push, false);
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
