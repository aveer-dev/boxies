/**
 * Screener-lite routing + bootstrap helpers.
 * Run: node --experimental-strip-types workers/test/sender-triage.test.mjs
 */

import assert from "node:assert/strict";
import {
	allowOutboundRecipients,
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
const receipt = { class: "bulk", folderId: "updates", reason: "bulk-transactional" };

const allowed = (sender, destination_folder_id = null) => ({
	sender,
	status: "allowed",
	destination_folder_id,
	decided_at: "t",
	updated_at: "t",
});

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

// ── Allowed without explicit destination → classifier folder ─────
{
	const promo = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com"),
		filterHit: null,
	});
	assert.equal(promo.folderId, "promotions");
	assert.equal(promo.triageAction, "allowed");
	assert.equal(promo.skipPush, false);

	const updates = resolveInboundFolder({
		classification: receipt,
		triage: allowed("receipts@shop.com"),
		filterHit: null,
	});
	assert.equal(updates.folderId, "updates");

	const personal = resolveInboundFolder({
		classification: ham,
		triage: allowed("friend@x.com"),
		filterHit: null,
	});
	assert.equal(personal.folderId, "inbox");

	// Non-destination junk in the column is ignored, not trusted.
	const junk = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "archive"),
		filterHit: null,
	});
	assert.equal(junk.folderId, "promotions");
}

// ── Allowed with explicit destination beats classify ──────────────
{
	const pinnedInbox = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "inbox"),
		filterHit: null,
	});
	assert.equal(pinnedInbox.folderId, "inbox");

	const pinnedUpdates = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "updates"),
		filterHit: null,
	});
	assert.equal(pinnedUpdates.folderId, "updates");
	assert.equal(pinnedUpdates.triageAction, "allowed");
}

// ── Allowed: filter folder overrides destination and classify ─────
{
	const withFilter = resolveInboundFolder({
		classification: ham,
		triage: allowed("boss@acme.com", "inbox"),
		filterHit: {
			ruleId: "boss",
			folderId: "archive",
			skipAutoDraft: true,
		},
	});
	assert.equal(withFilter.folderId, "archive");
	assert.equal(withFilter.skipAutoDraft, true);

	const filterOverClassify = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com"),
		filterHit: { ruleId: "keep", folderId: "inbox", skipAutoDraft: false },
	});
	assert.equal(filterOverClassify.folderId, "inbox");
}

// ── Allowed: purpose preference beats triage dest; filter still wins ─
{
	const withPref = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "updates"),
		filterHit: null,
		preferenceFolderId: "promotions",
	});
	assert.equal(withPref.folderId, "promotions");

	const prefOverClassify = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com"),
		filterHit: null,
		preferenceFolderId: "inbox",
	});
	assert.equal(prefOverClassify.folderId, "inbox");

	const filterWins = resolveInboundFolder({
		classification: ham,
		triage: allowed("boss@acme.com", "inbox"),
		filterHit: {
			ruleId: "boss",
			folderId: "archive",
			skipAutoDraft: true,
		},
		preferenceFolderId: "promotions",
	});
	assert.equal(filterWins.folderId, "archive");
}

// ── Screener disabled: preference between filter and classify ─────
{
	const withPref = resolveInboundFolder({
		classification: bulk,
		triage: null,
		filterHit: null,
		screenerEnabled: false,
		preferenceFolderId: "updates",
	});
	assert.equal(withPref.folderId, "updates");
	assert.equal(withPref.triageAction, "disabled");
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

// ── Bootstrap seeds: deduped, no destination (classify keeps sorting) ─
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
	assert.equal(seeds.length, 4);
	const byEmail = Object.fromEntries(seeds.map((s) => [s.sender, s]));
	assert.equal(byEmail["a@x.com"].display_name, "A");
	assert.ok(byEmail["promo@x.com"]);
	assert.ok(byEmail["receipt@x.com"]);
	for (const seed of seeds) {
		assert.equal("destination_folder_id" in seed, false);
	}
}

// ── Outbound allow: no explicit destination, never overrides ──────
{
	const rows = new Map([
		["blocked@x.com", allowed("blocked@x.com")],
		["pinned@x.com", allowed("pinned@x.com", "updates")],
	]);
	rows.get("blocked@x.com").status = "rejected";
	const upserts = [];
	const stub = {
		getSenderTriage: async (sender) => rows.get(sender) ?? null,
		upsertSenderTriage: async (row) => {
			upserts.push(row);
		},
	};
	const count = await allowOutboundRecipients(
		stub,
		"New <new@x.com>",
		["blocked@x.com"],
		[{ email: "pinned@x.com" }],
	);
	assert.equal(count, 1);
	assert.deepEqual(upserts, [
		{ sender: "new@x.com", status: "allowed", destination_folder_id: null },
	]);
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
