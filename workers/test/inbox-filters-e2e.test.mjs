/**
 * End-to-end coverage for inbound filter decisions used by receiveEmail:
 * folder override, skip auto-draft, forward override, settings merge/PUT validation.
 * Run: node --experimental-strip-types workers/test/inbox-filters-e2e.test.mjs
 */

import assert from "node:assert/strict";
import {
	applyInboxFilters,
	inboxFiltersError,
	parseInboxFilters,
} from "../lib/inbox-filters.ts";
import {
	mergeMailboxSettingsBlob,
	shouldForward,
} from "../lib/mail-automations.ts";
import { shouldAutoDraft } from "../lib/classify-email.ts";
import { resolveInboundFolder } from "../lib/sender-preferences.ts";

const mailbox = "hello@inboxies.email";
const ham = { class: "ham", folderId: "inbox", reason: "personal-ham" };
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

/** Mirrors receiveEmail decision order after classification. */
function inboundFilterPipeline(options) {
	const {
		classification,
		rawSettings,
		sender,
		subject,
		messageHeaders,
		canBeForwarded = true,
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
		preferenceFolderId: null,
	});
	const autoDraft =
		shouldAutoDraft(classification, auth) && !filterHit?.skipAutoDraft;

	const override = filterHit?.forwardTo?.trim() || "";
	const useOverride = Boolean(override);
	const forward = shouldForward({
		enabled: useOverride
			? true
			: Boolean(rawSettings.forwarding?.enabled),
		dest: useOverride ? override : rawSettings.forwarding?.email,
		mailboxId: mailbox,
		sender,
		classification,
		headers: messageHeaders,
		canBeForwarded,
	});

	return {
		filterHit,
		targetFolder,
		autoDraft,
		forwardDest: forward.ok ? forward.dest : null,
		forwardSkip: forward.ok ? null : forward.reason,
	};
}

// ── From → archive + skip auto-draft ──────────────────────────────
{
	const result = inboundFilterPipeline({
		classification: ham,
		rawSettings: {
			filters: [
				{
					id: "boss",
					enabled: true,
					from: "@acme.com",
					folderId: "archive",
					skipAutoDraft: true,
				},
			],
		},
		sender: "ceo@acme.com",
		subject: "Quarterly plan",
		messageHeaders: [],
	});
	assert.equal(result.targetFolder, "archive");
	assert.equal(result.autoDraft, false);
	assert.equal(result.forwardDest, null);
}

// ── List mail → promotions + filter forward overrides global ─────
{
	const result = inboundFilterPipeline({
		classification: {
			class: "bulk",
			folderId: "promotions",
			reason: "bulk-list-headers",
		},
		rawSettings: {
			forwarding: { enabled: true, email: "global@example.com" },
			filters: [
				{
					id: "lists",
					enabled: true,
					list: "*",
					folderId: "updates",
					forwardTo: "backup@example.com",
				},
			],
		},
		sender: "newsletter@store.example",
		subject: "Weekly deals",
		messageHeaders: headers(["List-Id", "<deals.store.example>"]),
	});
	assert.equal(result.targetFolder, "updates");
	assert.equal(result.autoDraft, false); // bulk is never auto-drafted
	assert.equal(result.forwardDest, "backup@example.com");
}

// ── No match keeps classifier folder + global forward + ham draft ─
{
	const result = inboundFilterPipeline({
		classification: ham,
		rawSettings: {
			forwarding: { enabled: true, email: "global@example.com" },
			filters: [
				{
					id: "boss",
					enabled: true,
					from: "@acme.com",
					folderId: "archive",
					skipAutoDraft: true,
				},
			],
		},
		sender: "friend@personal.example",
		subject: "Dinner?",
		messageHeaders: [],
	});
	assert.equal(result.targetFolder, "inbox");
	assert.equal(result.autoDraft, true);
	assert.equal(result.forwardDest, "global@example.com");
}

// ── Spam folder wins over filter folder; forward still skipped ────
{
	const result = inboundFilterPipeline({
		classification: spam,
		rawSettings: {
			filters: [
				{
					id: "any",
					enabled: true,
					from: "phish@bad.example",
					folderId: "trash",
					forwardTo: "backup@example.com",
				},
			],
		},
		sender: "phish@bad.example",
		subject: "Urgent",
		messageHeaders: [],
	});
	assert.equal(result.targetFolder, "spam");
	assert.equal(result.autoDraft, false);
	assert.equal(result.forwardSkip, "spam");
}

// ── Disabled rules are skipped; first enabled match wins ──────────
{
	const result = inboundFilterPipeline({
		classification: ham,
		rawSettings: {
			filters: [
				{
					id: "off",
					enabled: false,
					from: "a@example.com",
					folderId: "trash",
				},
				{
					id: "on",
					enabled: true,
					from: "a@example.com",
					folderId: "archive",
				},
			],
		},
		sender: "a@example.com",
		subject: "Hi",
		messageHeaders: [],
	});
	assert.equal(result.filterHit?.ruleId, "on");
	assert.equal(result.targetFolder, "archive");
}

// ── AND conditions (from + subject) ───────────────────────────────
{
	const miss = inboundFilterPipeline({
		classification: ham,
		rawSettings: {
			filters: [
				{
					id: "invoice",
					from: "@vendor.com",
					subject: "invoice",
					folderId: "updates",
					skipAutoDraft: true,
				},
			],
		},
		sender: "billing@vendor.com",
		subject: "Hello",
		messageHeaders: [],
	});
	assert.equal(miss.targetFolder, "inbox");
	assert.equal(miss.autoDraft, true);

	const hit = inboundFilterPipeline({
		classification: ham,
		rawSettings: {
			filters: [
				{
					id: "invoice",
					from: "@vendor.com",
					subject: "invoice",
					folderId: "updates",
					skipAutoDraft: true,
				},
			],
		},
		sender: "billing@vendor.com",
		subject: "Your invoice is ready",
		messageHeaders: [],
	});
	assert.equal(hit.targetFolder, "updates");
	assert.equal(hit.autoDraft, false);
}

// ── Settings merge: forwarding save preserves filters ─────────────
{
	const merged = mergeMailboxSettingsBlob(
		{
			fromName: "Ada",
			filters: [
				{
					id: "keep",
					from: "@acme.com",
					folderId: "archive",
					skipAutoDraft: true,
				},
			],
			forwarding: { enabled: false, email: "" },
			autoReply: { enabled: true, subject: "Out", message: "Gone" },
		},
		{
			fromName: "Ada",
			forwarding: { enabled: true, email: "ada@example.com" },
		},
	);
	assert.deepEqual(merged.filters, [
		{
			id: "keep",
			from: "@acme.com",
			folderId: "archive",
			skipAutoDraft: true,
		},
	]);
	assert.deepEqual(merged.autoReply, {
		enabled: true,
		subject: "Out",
		message: "Gone",
	});
	assert.equal(
		inboxFiltersError(parseInboxFilters(merged), mailbox),
		null,
	);
}

// ── PUT validation rejects bad filter forward dest ────────────────
{
	const err = inboxFiltersError(
		parseInboxFilters([
			{
				id: "bad",
				from: "a@b.com",
				forwardTo: mailbox,
			},
		]),
		mailbox,
	);
	assert.equal(err, "Filter forward address cannot be this mailbox");
}

// Spoofed From does not match from-filters (no archive / forward)
{
	const spoofed = {
		spoofed: true,
		source: "authentication-results",
		aligned: false,
		headerFrom: "boss@acme.com",
		envelopeFrom: "bad@evil.example",
	};
	const result = inboundFilterPipeline({
		classification: ham,
		rawSettings: {
			filters: [
				{
					id: "boss",
					enabled: true,
					from: "@acme.com",
					folderId: "archive",
					forwardTo: "backup@example.com",
				},
			],
		},
		sender: "boss@acme.com",
		subject: "Hello",
		messageHeaders: headers(["From", "Boss <boss@acme.com>"]),
		auth: spoofed,
	});
	assert.equal(result.filterHit, null);
	assert.equal(result.targetFolder, "inbox");
	assert.equal(result.autoDraft, false);
	assert.equal(result.forwardDest, null);
}

// shouldAutoDraft export from classify is what receiveEmail uses
assert.equal(shouldAutoDraft(ham), true);
assert.equal(shouldAutoDraft(spam), false);

console.log("inbox-filters-e2e tests passed");
