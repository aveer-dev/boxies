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
	applySenderTrust,
	classifyFromHeaders,
	shouldAutoDraft,
	shouldSendPush,
} from "../lib/classify-email.ts";
import {
	normalizeTriageSender,
	parseScreenerEnabled,
	resolveInboundFolder,
	senderTrustOf,
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
	headers = [],
	preferenceFolderId = null,
	preferenceSource = "user",
}) {
	const filterHit = applyInboxFilters(parseInboxFilters(rawSettings), {
		sender,
		subject,
		headers: [],
		auth,
	});
	const preference = preferenceFolderId
		? { folderId: preferenceFolderId, source: preferenceSource }
		: null;
	const classification = applySenderTrust(
		rawClassification,
		{ headers, subject, sender, auth },
		senderTrustOf(triage, preference),
	);
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

	// No trusted auth verdict counts as unverified: implicit trust still
	// beats the AI guess alone.
	const unproven = inboundPipeline({
		classification: aiSpam,
		triage: emailedThem,
		sender: "osato@inboxies.email",
		auth: null,
	});
	assert.equal(unproven.folderId, "inbox");

	// Forged From (auth failed) stays in Spam even for someone you emailed.
	const forged = inboundPipeline({
		classification: { class: "spam", folderId: "spam", reason: "auth-failed" },
		triage: emailedThem,
		sender: "osato@inboxies.email",
		auth: { ...authed, aligned: false, authTier: "failed", spoofed: true },
	});
	assert.equal(forged.folderId, "spam");
	assert.equal(forged.push, false);
}

// AVE-93: after Not spam, an unverified ESP sender's next AI-spam message
// lands in Inbox; a failed message from the same address still lands in Spam.
{
	const sender = "ada@smallbiz.example";
	// Not spam → Inbox writes an allowed triage row plus a user purpose box.
	const notSpammed = {
		sender,
		status: "allowed",
		destination_folder_id: "inbox",
		decided_at: "t",
		updated_at: "t",
	};
	const viaEsp = {
		authTier: "unverified",
		spoofed: false,
		source: "authentication-results",
		aligned: false,
		dkim: "pass",
		dkimDomain: "sendgrid.net",
		headerFrom: sender,
		envelopeFrom: "bounces@sendgrid.net",
	};
	const next = inboundPipeline({
		classification: { class: "spam", folderId: "spam", reason: "ai-spam" },
		triage: notSpammed,
		sender,
		auth: viaEsp,
		preferenceFolderId: "inbox",
	});
	assert.equal(next.folderId, "inbox");
	assert.equal(next.push, true);
	// Unaligned From: never auto-drafted.
	assert.equal(next.autoDraft, false);

	const failedAuth = { ...viaEsp, authTier: "failed", spoofed: true, dmarc: "fail", dmarcPolicy: "reject" };
	// Even list mail with failed auth is spam before it can be sorted as bulk.
	const failedHeaders = [{ key: "List-Unsubscribe", value: "<mailto:u@smallbiz.example>" }];
	const failedClass = classifyFromHeaders({ headers: failedHeaders, sender, auth: failedAuth });
	assert.equal(failedClass.reason, "auth-failed");
	const failed = inboundPipeline({
		classification: failedClass,
		triage: notSpammed,
		sender,
		auth: failedAuth,
		headers: failedHeaders,
		preferenceFolderId: "inbox",
	});
	assert.equal(failed.folderId, "spam");
	assert.equal(failed.push, false);
}

// Spam headers: only an explicit allow on verified mail skips them.
{
	const sender = "news@club.example";
	const verified = {
		authTier: "verified",
		spoofed: false,
		source: "authentication-results",
		aligned: true,
		headerFrom: sender,
		envelopeFrom: "bounces@club.example",
	};
	const allowedRow = {
		sender,
		status: "allowed",
		destination_folder_id: null,
		decided_at: "t",
		updated_at: "t",
	};
	const flaggedList = [
		{ key: "X-Spam-Flag", value: "YES" },
		{ key: "List-Id", value: "<news.club.example>" },
	];
	const flagged = { class: "spam", folderId: "spam", reason: "spam-headers" };

	// Explicit allow + verified: re-sorted as bulk, not Spam.
	const allowed = inboundPipeline({
		classification: flagged,
		triage: allowedRow,
		sender,
		subject: "This week at the club",
		auth: verified,
		headers: flaggedList,
		preferenceFolderId: "promotions",
	});
	assert.equal(allowed.folderId, "promotions");
	assert.equal(allowed.triageAction, "allowed");

	// Explicit allow + unverified: spam headers stand.
	const unverified = inboundPipeline({
		classification: flagged,
		triage: allowedRow,
		sender,
		auth: { ...verified, aligned: null, source: "none", authTier: "unverified" },
		headers: flaggedList,
		preferenceFolderId: "promotions",
	});
	assert.equal(unverified.folderId, "spam");

	// Implicit trust only (emailed them, no user-picked box): spam headers stand.
	const implicit = inboundPipeline({
		classification: flagged,
		triage: allowedRow,
		sender,
		auth: verified,
		headers: flaggedList,
	});
	assert.equal(implicit.folderId, "spam");

	// Blocked sender: no override, never Inbox.
	const blocked = inboundPipeline({
		classification: { class: "spam", folderId: "spam", reason: "ai-spam" },
		triage: { ...allowedRow, status: "rejected" },
		sender,
		auth: verified,
	});
	assert.equal(blocked.folderId, "spam");
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
