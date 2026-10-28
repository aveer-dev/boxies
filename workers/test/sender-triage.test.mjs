/**
 * Screener-lite routing + bootstrap helpers.
 * Run: node --experimental-strip-types workers/test/sender-triage.test.mjs
 */

import assert from "node:assert/strict";
import {
	allowOutboundRecipients,
	buildBootstrapAllowSeeds,
	isScreenerDestination,
	isVouchedSender,
	parseScreenerEnabled,
	pinnedPreferenceFolderId,
	pinnedTriageDestination,
	screenerAcceptDestination,
	resolveInboundFolder,
	isSpamVerdictMove,
	senderLessonForMove,
	senderTrustOf,
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
	// Forwarding still applies to Screener mail (the forwarder drops spam/spoofs).
	assert.equal(result.skipForward, false);
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
	// AVE-139: an Inbox destination is what a plain Accept stored, not a pin.
	// The classifier still sorts the sender's newsletters into Promotions.
	const acceptedInbox = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "inbox"),
		filterHit: null,
	});
	assert.equal(acceptedInbox.folderId, "promotions");
	assert.equal(acceptedInbox.triageAction, "allowed");
	const acceptedInboxReceipt = resolveInboundFolder({
		classification: receipt,
		triage: allowed("shop@x.com", "inbox"),
		filterHit: null,
	});
	assert.equal(acceptedInboxReceipt.folderId, "updates");

	const pinnedPromotions = resolveInboundFolder({
		classification: ham,
		triage: allowed("news@x.com", "promotions"),
		filterHit: null,
	});
	assert.equal(pinnedPromotions.folderId, "promotions");

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

// ── Rejected senders stay out with Screener off (to Spam) ─────────
{
	const rejected = { sender: "spammer@x.com", status: "rejected", destination_folder_id: null, decided_at: "", updated_at: "" };
	const off = resolveInboundFolder({
		classification: ham,
		triage: rejected,
		filterHit: { ruleId: "a", folderId: "inbox", skipAutoDraft: false },
		screenerEnabled: false,
		preferenceFolderId: "inbox",
	});
	assert.equal(off.folderId, "spam", "a filter or preference can't pull a reported sender back in");
	assert.equal(off.triageAction, "rejected");
	assert.equal(off.skipPush, true);
	assert.equal(off.skipAutoReply, true);
	assert.equal(off.skipForward, true);
	const on = resolveInboundFolder({ classification: ham, triage: rejected, filterHit: null, screenerEnabled: true });
	assert.equal(on.folderId, "screened_out");
}

// ── What a move teaches about the sender ──────────────────────────
{
	const base = { mailboxId: "ada@inboxies.email" };
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "Spammer <SPAM@x.com>", fromFolderId: "inbox", toFolderId: "spam" }),
		{ kind: "reject", sender: "spam@x.com" },
		"Report spam rejects the sender",
	);
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "news@x.com", fromFolderId: "spam", toFolderId: "promotions" }),
		{ kind: "allow", sender: "news@x.com", destination: "promotions" },
		"Not spam to a purpose box allows and files there",
	);
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "news@x.com", fromFolderId: "spam", toFolderId: "archive" }),
		{ kind: "allow", sender: "news@x.com", destination: null },
		"Not spam elsewhere allows without a default box",
	);
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "news@x.com", fromFolderId: "inbox", toFolderId: "updates" }),
		{ kind: "preference", sender: "news@x.com", destination: "updates" },
	);
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "Ada+notes@Inboxies.Email", fromFolderId: "sent", toFolderId: "spam" }),
		{ kind: "none" },
		"your own address is never rejected",
	);
	assert.deepEqual(senderLessonForMove({ ...base, sender: null, fromFolderId: "inbox", toFolderId: "spam" }), { kind: "none" });

	// AVE-95: crossing Spam always teaches, "remember" or not (move menu, swipe, multi-select).
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "a@x.com", fromFolderId: "spam", toFolderId: "inbox", remember: false }),
		{ kind: "allow", sender: "a@x.com", destination: "inbox" },
	);
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "a@x.com", fromFolderId: "archive", toFolderId: "spam", remember: false }),
		{ kind: "reject", sender: "a@x.com" },
	);
	// Other moves only teach when the user said "remember".
	assert.deepEqual(
		senderLessonForMove({ ...base, sender: "a@x.com", fromFolderId: "inbox", toFolderId: "updates", remember: false }),
		{ kind: "none" },
	);
	// Deleting or screening out spam isn't a vote, even with "remember".
	for (const toFolderId of ["trash", "screened_out"]) {
		assert.deepEqual(
			senderLessonForMove({ ...base, sender: "a@x.com", fromFolderId: "spam", toFolderId, remember: true }),
			{ kind: "none" },
			`spam → ${toFolderId} teaches nothing`,
		);
	}
	assert.equal(isSpamVerdictMove("spam", "spam"), false);
	assert.equal(isSpamVerdictMove(null, "spam"), true);
	assert.equal(isSpamVerdictMove("spam", "archive"), true);
	assert.equal(isSpamVerdictMove("inbox", "archive"), false);
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

// ── Vouched senders (may override an AI spam guess) ───────────────

assert.equal(isVouchedSender(allowed("friend@example.com")), true);
assert.equal(isVouchedSender(allowed("friend@example.com", "promotions")), true);
assert.equal(isVouchedSender(null, "updates"), true);
assert.equal(isVouchedSender(null, "  "), false);
assert.equal(isVouchedSender(null, null), false);
assert.equal(
	isVouchedSender(
		{ ...allowed("nope@example.com"), status: "rejected" },
		"inbox",
	),
	false,
);

// Sender trust (spam-management-plan §5): explicit allow = allowed + a
// user-picked box; emailed / Screener-accepted / sorted = implicit.
const userPref = (folderId) => ({ folderId, source: "user" });
assert.equal(senderTrustOf(allowed("ada@example.com"), userPref("inbox")), "allowed");
assert.equal(senderTrustOf(allowed("ada@example.com")), "implicit");
assert.equal(
	senderTrustOf(allowed("ada@example.com"), { folderId: "inbox", source: "screener" }),
	"implicit",
);
assert.equal(senderTrustOf(null, userPref("updates")), "implicit");
assert.equal(senderTrustOf(null, null), "none");
assert.equal(
	senderTrustOf({ ...allowed("nope@example.com"), status: "rejected" }, userPref("inbox")),
	"none",
);

console.log("sender-triage.test.mjs: ok");

// ── AVE-139: plain Accept doesn't pin; deliberate picks do ────────
{
	// Accept (Inbox) stores no destination; Promotions / Updates stick.
	assert.equal(screenerAcceptDestination("inbox"), null);
	assert.equal(screenerAcceptDestination("promotions"), "promotions");
	assert.equal(screenerAcceptDestination("updates"), "updates");

	assert.equal(pinnedTriageDestination("inbox"), null);
	assert.equal(pinnedTriageDestination("updates"), "updates");
	assert.equal(pinnedTriageDestination("archive"), null);
	assert.equal(pinnedTriageDestination(null), null);

	// A Screener-sourced Inbox preference is a legacy plain Accept.
	assert.equal(pinnedPreferenceFolderId("inbox", "screener"), null);
	assert.equal(pinnedPreferenceFolderId("promotions", "screener"), "promotions");
	assert.equal(pinnedPreferenceFolderId("inbox", "user"), "inbox");
	assert.equal(pinnedPreferenceFolderId("inbox"), "inbox");
	assert.equal(pinnedPreferenceFolderId("  ", "user"), null);

	// Legacy accepted-to-Inbox row: triage destination + screener preference.
	const legacy = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "inbox"),
		filterHit: null,
		preferenceFolderId: "inbox",
		preferenceSource: "screener",
	});
	assert.equal(legacy.folderId, "promotions");

	// Personal mail from them still lands in Inbox.
	const personal = resolveInboundFolder({
		classification: ham,
		triage: allowed("friend@x.com", null),
		filterHit: null,
	});
	assert.equal(personal.folderId, "inbox");

	// Inbox chosen in Settings / "Put future mail here" (user source) pins.
	const userInbox = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "inbox"),
		filterHit: null,
		preferenceFolderId: "inbox",
		preferenceSource: "user",
	});
	assert.equal(userInbox.folderId, "inbox");

	// Accepted into Promotions (screener source) sticks over a ham guess.
	const acceptedPromo = resolveInboundFolder({
		classification: ham,
		triage: allowed("news@x.com", "promotions"),
		filterHit: null,
		preferenceFolderId: "promotions",
		preferenceSource: "screener",
	});
	assert.equal(acceptedPromo.folderId, "promotions");

	// A filter still wins over everything for an allowed sender.
	const filtered = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "promotions"),
		filterHit: { ruleId: "f", folderId: "archive", skipAutoDraft: false },
		preferenceFolderId: "promotions",
		preferenceSource: "screener",
	});
	assert.equal(filtered.folderId, "archive");

	// Spam is unchanged: an accepted sender's spam still goes to Spam.
	const spammy = resolveInboundFolder({
		classification: spam,
		triage: allowed("news@x.com", "inbox"),
		filterHit: null,
		preferenceFolderId: "inbox",
		preferenceSource: "screener",
	});
	assert.equal(spammy.folderId, "spam");
	assert.equal(spammy.triageAction, "spam");

	// Screener off: a legacy screener-Inbox preference doesn't pin either.
	const off = resolveInboundFolder({
		classification: bulk,
		triage: allowed("news@x.com", "inbox"),
		filterHit: null,
		screenerEnabled: false,
		preferenceFolderId: "inbox",
		preferenceSource: "screener",
	});
	assert.equal(off.folderId, "promotions");
}
