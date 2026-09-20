/**
 * Screener-lite routing + bootstrap helpers.
 * Run: node --experimental-strip-types workers/test/sender-triage.test.mjs
 */

import assert from "node:assert/strict";
import {
	buildBootstrapAllowSeeds,
	isScreenerDestination,
	parseScreenerEnabled,
	resolveInboundFolder,
	screenerSettingsError,
} from "../lib/sender-triage.ts";
import { shouldFallbackToInbox } from "../lib/classify-email.ts";
import { aggregateRecentRecipients } from "../../shared/recent-recipients.ts";

const ham = { class: "ham", folderId: "inbox", reason: "personal-ham" };
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };
const bulk = { class: "bulk", folderId: "promotions", reason: "bulk-list-headers" };

// ── Spam always wins ──────────────────────────────────────────────
{
	const result = resolveInboundFolder({
		classification: spam,
		triage: null,
		filterHit: { ruleId: "x", folderId: "inbox", skipAutoDraft: false },
	});
	assert.equal(result.folderId, "spam");
	assert.equal(result.triageAction, "spam");
	assert.equal(result.skipPush, true);
	assert.equal(result.skipAutoDraft, true);
}

// ── Unknown → screener; filters cannot bypass ─────────────────────
{
	const result = resolveInboundFolder({
		classification: ham,
		triage: null,
		filterHit: {
			ruleId: "smuggle",
			folderId: "inbox",
			skipAutoDraft: false,
		},
	});
	assert.equal(result.folderId, "screener");
	assert.equal(result.triageAction, "unknown");
	assert.equal(result.skipPush, true);
	assert.equal(result.skipAutoDraft, true);
	assert.equal(result.skipForward, true);
	assert.equal(result.skipAutoReply, true);
}

// ── Rejected → screened_out ───────────────────────────────────────
{
	const result = resolveInboundFolder({
		classification: ham,
		triage: {
			sender: "bad@x.com",
			status: "rejected",
			destination_folder_id: null,
			decided_at: "t",
			updated_at: "t",
		},
		filterHit: null,
	});
	assert.equal(result.folderId, "screened_out");
	assert.equal(result.triageAction, "rejected");
	assert.equal(result.skipPush, true);
}

// ── Allowed uses destination; filter can override ─────────────────
{
	const base = resolveInboundFolder({
		classification: bulk,
		triage: {
			sender: "news@x.com",
			status: "allowed",
			destination_folder_id: "updates",
			decided_at: "t",
			updated_at: "t",
		},
		filterHit: null,
	});
	assert.equal(base.folderId, "updates");
	assert.equal(base.triageAction, "allowed");
	assert.equal(base.skipPush, false);

	const withFilter = resolveInboundFolder({
		classification: ham,
		triage: {
			sender: "boss@acme.com",
			status: "allowed",
			destination_folder_id: "inbox",
			decided_at: "t",
			updated_at: "t",
		},
		filterHit: {
			ruleId: "boss",
			folderId: "archive",
			skipAutoDraft: true,
		},
	});
	assert.equal(withFilter.folderId, "archive");
	assert.equal(withFilter.skipAutoDraft, true);
}

// ── Screener disabled → legacy classify+filter ────────────────────
{
	const result = resolveInboundFolder({
		classification: ham,
		triage: null,
		filterHit: { ruleId: "a", folderId: "trash", skipAutoDraft: false },
		screenerEnabled: false,
	});
	assert.equal(result.folderId, "trash");
	assert.equal(result.triageAction, "disabled");
}

// ── Destination helper ────────────────────────────────────────────
assert.equal(isScreenerDestination("inbox"), true);
assert.equal(isScreenerDestination("archive"), false);

// ── Settings parse ────────────────────────────────────────────────
assert.equal(parseScreenerEnabled({}), true);
assert.equal(parseScreenerEnabled({ screener: { enabled: false } }), false);
assert.equal(parseScreenerEnabled({ screener: { enabled: true } }), true);
assert.equal(screenerSettingsError({ screener: { enabled: "yes" } }), "screener.enabled must be a boolean");
assert.equal(screenerSettingsError({ screener: { enabled: true } }), null);

// ── Bootstrap seeds: Sent wins, then inbox, then promo/updates ────
{
	const seeds = buildBootstrapAllowSeeds({
		sentAddresses: [{ email: "a@x.com", name: "A" }],
		inboxSenders: [
			{ email: "a@x.com", name: "A-inbox" },
			{ email: "b@x.com" },
		],
		promotionsSenders: [{ email: "promo@x.com" }, { email: "b@x.com" }],
		updatesSenders: [{ email: "receipt@x.com" }],
	});
	const byEmail = Object.fromEntries(seeds.map((s) => [s.sender, s]));
	assert.equal(byEmail["a@x.com"].destination_folder_id, "inbox");
	assert.equal(byEmail["b@x.com"].destination_folder_id, "inbox");
	assert.equal(byEmail["promo@x.com"].destination_folder_id, "promotions");
	assert.equal(byEmail["receipt@x.com"].destination_folder_id, "updates");
}

// ── Fallback must not dump screener into inbox ────────────────────
assert.equal(
	shouldFallbackToInbox("screener", new Error('createEmail: folder "screener" not found')),
	false,
);
assert.equal(
	shouldFallbackToInbox("screened_out", new Error('createEmail: folder "screened_out" not found')),
	false,
);
assert.equal(
	shouldFallbackToInbox("promotions", new Error('createEmail: folder "promotions" not found')),
	true,
);

// ── Bootstrap hardCap can exceed autocomplete 50 ──────────────────
{
	const rows = Array.from({ length: 80 }, (_, i) => ({
		recipient: `user${i}@x.com`,
		date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
	}));
	const capped = aggregateRecentRecipients(rows, { limit: 500 });
	assert.equal(capped.length, 50);
	const wide = aggregateRecentRecipients(rows, { limit: 500, hardCap: 500 });
	assert.equal(wide.length, 80);
}

console.log("sender-triage.test.mjs: ok");
