/**
 * End-to-end coverage for purpose-box sender preferences in the inbound
 * filing pipeline (mirrors receiveEmail after classification).
 * Run: node --experimental-strip-types workers/test/sender-preferences-e2e.test.mjs
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	applyInboxFilters,
	parseInboxFilters,
} from "../lib/inbox-filters.ts";
import { shouldAutoDraft } from "../lib/classify-email.ts";
import {
	resolveInboundFolder,
	senderPreferenceUpsertError,
} from "../lib/sender-preferences.ts";

const ham = { class: "ham", folderId: "inbox", reason: "personal-ham" };
const bulkPromo = {
	class: "bulk",
	folderId: "promotions",
	reason: "bulk-list-headers",
};
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };

/** Mirrors receiveEmail: spam → filter folder → preference → classify. */
function inboundPurposePipeline(options) {
	const {
		classification,
		rawSettings = {},
		sender,
		subject = "",
		messageHeaders = [],
		preferenceFolderId = null,
		auth = null,
	} = options;

	const filterHit = applyInboxFilters(parseInboxFilters(rawSettings), {
		sender,
		subject,
		headers: messageHeaders,
		auth,
	});

	const targetFolder = resolveInboundFolder({
		classificationFolderId: classification.folderId,
		filterFolderId: filterHit?.folderId,
		preferenceFolderId:
			classification.folderId === Folders.SPAM ? null : preferenceFolderId,
	});

	const autoDraft =
		shouldAutoDraft(classification, auth) && !filterHit?.skipAutoDraft;

	return { filterHit, targetFolder, autoDraft };
}

// Pref alone → destination
{
	const result = inboundPurposePipeline({
		classification: bulkPromo,
		sender: "news@acme.com",
		preferenceFolderId: Folders.INBOX,
	});
	assert.equal(result.targetFolder, Folders.INBOX);
	assert.equal(result.autoDraft, false, "bulk never auto-drafts");
}

// Filter folder beats preference
{
	const result = inboundPurposePipeline({
		classification: ham,
		sender: "boss@acme.com",
		preferenceFolderId: Folders.PROMOTIONS,
		rawSettings: {
			filters: [
				{
					id: "boss",
					enabled: true,
					from: "boss@acme.com",
					folderId: "archive",
				},
			],
		},
	});
	assert.equal(result.targetFolder, Folders.ARCHIVE);
}

// Filter without folder still allows preference
{
	const result = inboundPurposePipeline({
		classification: ham,
		sender: "friend@example.com",
		preferenceFolderId: Folders.UPDATES,
		rawSettings: {
			filters: [
				{
					id: "skip",
					enabled: true,
					from: "friend@example.com",
					skipAutoDraft: true,
				},
			],
		},
	});
	assert.equal(result.targetFolder, Folders.UPDATES);
	assert.equal(result.autoDraft, false);
}

// Spam always wins over preference + filter
{
	const result = inboundPurposePipeline({
		classification: spam,
		sender: "scam@evil.com",
		preferenceFolderId: Folders.INBOX,
		rawSettings: {
			filters: [
				{
					id: "rescue",
					enabled: true,
					from: "scam@evil.com",
					folderId: "inbox",
				},
			],
		},
	});
	assert.equal(result.targetFolder, Folders.SPAM);
	assert.equal(result.autoDraft, false);
}

// No pref / no filter → classify suggestion
{
	const result = inboundPurposePipeline({
		classification: bulkPromo,
		sender: "unknown@lists.example.com",
	});
	assert.equal(result.targetFolder, Folders.PROMOTIONS);
}

// Move+set preference: destination must be a purpose box
assert.equal(
	senderPreferenceUpsertError({
		address: "a@b.com",
		folderId: Folders.ARCHIVE,
	}),
	"Destination must be one of: inbox, promotions, updates",
);
assert.equal(
	senderPreferenceUpsertError({
		address: "a@b.com",
		folderId: Folders.INBOX,
	}),
	null,
);

// Refile scope helper: only purpose folders
{
	const PURPOSE = new Set(["inbox", "promotions", "updates"]);
	const rows = [
		{ id: "1", folder_id: "inbox" },
		{ id: "2", folder_id: "promotions" },
		{ id: "3", folder_id: "spam" },
		{ id: "4", folder_id: "archive" },
		{ id: "5", folder_id: "updates" },
	];
	const target = "inbox";
	const refiled = rows.filter(
		(r) => PURPOSE.has(r.folder_id) && r.folder_id !== target,
	);
	assert.deepEqual(
		refiled.map((r) => r.id),
		["2", "5"],
	);
}

console.log("sender-preferences-e2e: ok");
