/**
 * Spam explainability (AVE-94): every inbound email stores a reason code and
 * an auth tier; clients turn the code into one line in Spam / Screened out
 * and show "Unverified sender" for `unverified` mail, allowed senders included.
 * Runs migration 37 on node:sqlite to check the new columns.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/classification-reason.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { classifyInboundEmail, overrideAiSpamForVouchedSender } from "../lib/classify-email.ts";
import {
	inboundClassificationReason,
	storedAuthTier,
} from "../lib/classification-reason.ts";
import { parseAuthSignals } from "../lib/email-auth.ts";
import {
	isVouchedSender,
	resolveInboundFolder,
} from "../lib/sender-triage.ts";
import {
	ClassificationReasons,
	showsUnverifiedBanner,
	spamReasonLine,
	unverifiedSenderDetail,
} from "../../shared/spam-reason.ts";

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

const sendgridAuth = parseAuthSignals({
	envelopeHeaders: headers([
		"Authentication-Results",
		"mx.cloudflare.net; dkim=pass header.d=sendgrid.net header.s=s1; spf=pass smtp.mailfrom=bounces+123@em1234.sendgrid.net; dmarc=none header.from=smallbiz.example",
	]),
	headerFrom: "Ada <ada@smallbiz.example>",
	envelopeFrom: "bounces+123@em1234.sendgrid.net",
});
const verifiedAuth = parseAuthSignals({
	envelopeHeaders: headers([
		"Authentication-Results",
		"mx.cloudflare.net; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=joe@example.com; dmarc=pass header.from=example.com policy.dmarc=reject",
	]),
	headerFrom: "joe@example.com",
	envelopeFrom: "joe@example.com",
});
const failedAuth = parseAuthSignals({
	envelopeHeaders: headers([
		"Authentication-Results",
		"mx.cloudflare.net; dkim=pass header.d=evil.example; spf=softfail smtp.mailfrom=x@evil.example; dmarc=fail header.from=paypal.com policy.dmarc=reject",
	]),
	headerFrom: "service@paypal.com",
	envelopeFrom: "x@evil.example",
});

const allowed = (sender) => ({
	sender,
	status: "allowed",
	destination_folder_id: null,
	decided_at: "t",
	updated_at: "t",
});
const rejected = (sender) => ({ ...allowed(sender), status: "rejected" });

const spamAi = { run: async () => ({ response: "SPAM" }) };
const hamAi = { run: async () => ({ response: "HAM" }) };

/** Mirrors receiveEmail: classify → vouch override → route → stored fields. */
async function inbound({ auth, triage = null, ai = hamAi, screenerEnabled = true, mailHeaders = [] }) {
	let classification = await classifyInboundEmail(
		{ headers: mailHeaders, subject: "Hi", sender: auth.headerFrom, bodyText: "hello", auth },
		ai,
	);
	classification = overrideAiSpamForVouchedSender(classification, {
		vouched: isVouchedSender(triage, null),
		auth,
	});
	const decision = resolveInboundFolder({
		classification,
		triage,
		filterHit: null,
		screenerEnabled,
		preferenceFolderId: null,
	});
	return {
		folderId: decision.folderId,
		classification_reason: inboundClassificationReason(classification, decision),
		auth_tier: storedAuthTier(auth),
	};
}

// ── Stored tier ───────────────────────────────────────────────────

assert.equal(storedAuthTier(sendgridAuth), "unverified");
assert.equal(storedAuthTier(verifiedAuth), "verified");
assert.equal(storedAuthTier(failedAuth), "failed");
assert.equal(storedAuthTier(null), null, "outbound mail has no tier");
// Pre-tier snapshots fall back to `spoofed` / `aligned`.
assert.equal(storedAuthTier({ headerFrom: "a@b.c", envelopeFrom: "", aligned: true, spoofed: false }), "verified");
assert.equal(storedAuthTier({ headerFrom: "a@b.c", envelopeFrom: "", aligned: false, spoofed: true }), "failed");

// ── Reason per routing outcome ────────────────────────────────────

{
	const r = await inbound({ auth: failedAuth, triage: allowed("service@paypal.com") });
	assert.equal(r.folderId, "spam");
	assert.equal(r.classification_reason, "auth-failed");
	assert.equal(r.auth_tier, "failed");
	assert.equal(spamReasonLine(r.classification_reason, r.folderId), "Failed sender authentication");
}

{
	const r = await inbound({
		auth: verifiedAuth,
		triage: allowed("joe@example.com"),
		mailHeaders: headers(["X-Spam-Flag", "YES"]),
	});
	assert.equal(r.folderId, "spam");
	assert.equal(r.classification_reason, "spam-headers");
	assert.equal(spamReasonLine(r.classification_reason, r.folderId), "Flagged by spam filter");
}

{
	const r = await inbound({ auth: sendgridAuth, triage: null, ai: spamAi });
	assert.equal(r.folderId, "spam");
	assert.equal(r.classification_reason, "ai-spam");
	assert.equal(r.auth_tier, "unverified");
	assert.equal(spamReasonLine(r.classification_reason, r.folderId), "Marked as spam by AI check");
}

{
	// Vouched + verified overrides the AI guess; the stored reason says so.
	const r = await inbound({ auth: verifiedAuth, triage: allowed("joe@example.com"), ai: spamAi });
	assert.equal(r.folderId, "inbox");
	assert.equal(r.classification_reason, "ai-spam-overridden");
	assert.equal(spamReasonLine(r.classification_reason, r.folderId), null);
}

{
	// A rejected sender's ham lands in Screened out; the reason is the block,
	// not the classifier's "ai-ham".
	const r = await inbound({ auth: verifiedAuth, triage: rejected("joe@example.com") });
	assert.equal(r.folderId, "screened_out");
	assert.equal(r.classification_reason, "sender-rejected");
	assert.equal(spamReasonLine(r.classification_reason, r.folderId), "You blocked this sender");

	const off = await inbound({ auth: verifiedAuth, triage: rejected("joe@example.com"), screenerEnabled: false });
	assert.equal(off.folderId, "spam");
	assert.equal(off.classification_reason, "sender-rejected");
}

{
	// Spam verdicts beat the rejected-sender reason (spam comes first).
	const r = await inbound({ auth: failedAuth, triage: rejected("service@paypal.com") });
	assert.equal(r.folderId, "spam");
	assert.equal(r.classification_reason, "auth-failed");
}

{
	// Unknown sender → Screener keeps the classifier's code.
	const r = await inbound({ auth: verifiedAuth, triage: null });
	assert.equal(r.folderId, "screener");
	assert.equal(r.classification_reason, "ai-ham");
}

{
	// Done-when: the banner appears for an allowed `unverified` sender.
	const r = await inbound({ auth: sendgridAuth, triage: allowed("ada@smallbiz.example") });
	assert.equal(r.folderId, "inbox");
	assert.equal(r.auth_tier, "unverified");
	assert.equal(showsUnverifiedBanner(r.auth_tier), true);
	assert.equal(spamReasonLine(r.classification_reason, r.folderId), null, "no reason line outside Spam");
}

assert.equal(showsUnverifiedBanner("verified"), false);
assert.equal(showsUnverifiedBanner("failed"), false, "failed mail has the spoof banner instead");
assert.equal(showsUnverifiedBanner(null), false);

// ── Copy mapping ──────────────────────────────────────────────────

assert.equal(spamReasonLine("ai-spam", "inbox"), null, "only in Spam / Screened out");
assert.equal(spamReasonLine("ai-ham", "spam"), null, "hand-moved ham has no line");
assert.equal(spamReasonLine(null, "spam"), null, "pre-37 rows have no line");
assert.equal(spamReasonLine("something-new", "spam"), null, "unknown codes are silent");
assert.equal(inboundClassificationReason({ reason: "" }, { triageAction: "allowed" }), null);
assert.equal(ClassificationReasons.SENDER_REJECTED, "sender-rejected");
assert.match(unverifiedSenderDetail("ada@smallbiz.example"), /smallbiz\.example/);
assert.equal(unverifiedSenderDetail(""), "We couldn’t confirm who sent this message.");

// ── Migration 37 ──────────────────────────────────────────────────

{
	const db = new DatabaseSync(":memory:");
	const sql = {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings);
		},
	};
	applyMigrations(sql, mailboxMigrations);
	const columns = new Map(
		sql.exec(`PRAGMA table_info(emails)`).map((c) => [c.name, c]),
	);
	for (const name of ["classification_reason", "auth_tier", "matched_rule_id"]) {
		assert.ok(columns.has(name), `emails.${name} exists`);
		assert.equal(columns.get(name).notnull, 0, `emails.${name} is nullable`);
	}
	sql.exec(`INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES ('spam', 'spam', 0)`);
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, classification_reason, auth_tier)
		 VALUES ('e1', 'spam', 's', 'x@example.com', 'me@example.com', '2026-01-01', 'auth-failed', 'failed')`,
	);
	const row = sql.exec(`SELECT classification_reason, auth_tier, matched_rule_id FROM emails WHERE id = 'e1'`)[0];
	assert.deepEqual({ ...row }, {
		classification_reason: "auth-failed",
		auth_tier: "failed",
		matched_rule_id: null,
	});
}

console.log("classification-reason tests passed");
