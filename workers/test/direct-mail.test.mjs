/**
 * AVE-172: only direct person-to-person mail gets the automatic AI draft.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import { classifyFromHeaders, shouldAutoDraft } from "../lib/classify-email.ts";
import {
	directMailSignals,
	isDirectMail,
	isNoReplyAddress,
} from "../lib/direct-mail.ts";

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

const ham = { class: "ham", folderId: Folders.INBOX, reason: "ai-ham" };
const verified = { authTier: "verified", aligned: true };
const me = ["me@example.com"];

function direct(overrides = {}) {
	return {
		headers: headers(["From", "Ada <ada@friend.org>"], ["Subject", "Lunch?"]),
		sender: "ada@friend.org",
		replyTo: [],
		recipients: ["me@example.com"],
		ownAddresses: me,
		folderId: Folders.INBOX,
		...overrides,
	};
}

// ── Direct personal mail → draft ──────────────────────────────────

assert.deepEqual(directMailSignals(direct()), []);
assert.equal(isDirectMail(direct()), true);
assert.equal(shouldAutoDraft(ham, verified, direct()), true);
// Cc'd and plus-addressed delivery still counts as addressed to me.
assert.equal(
	isDirectMail(direct({ recipients: ["bob@friend.org", "ME+work@Example.com"] })),
	true,
);
// Mail to a private alias matches the alias address.
assert.equal(
	isDirectMail(
		direct({
			recipients: ["x7k2@private.example.com"],
			ownAddresses: ["x7k2@private.example.com", "me@example.com"],
		}),
	),
	true,
);
// Auto-Submitted: no is an explicit "human sent this".
assert.equal(isDirectMail(direct({ headers: headers(["Auto-Submitted", "no"]) })), true);
// Unknown recipients or own addresses skip the To/Cc check rather than block.
assert.equal(isDirectMail(direct({ recipients: [] })), true);
assert.equal(isDirectMail(direct({ ownAddresses: [] })), true);
// Without `direct`, shouldAutoDraft keeps the old ham-only behaviour.
assert.equal(shouldAutoDraft(ham, verified), true);

// ── Newsletter with List-Unsubscribe → no draft ───────────────────

{
	const newsletter = direct({
		headers: headers(
			["List-Unsubscribe", "<https://news.example/unsub>"],
			["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
		),
		sender: "digest@news.example",
	});
	assert.deepEqual(directMailSignals(newsletter), ["list-headers"]);
	assert.equal(shouldAutoDraft(ham, verified, newsletter), false);
	// The classifier already files it as bulk, so it is skipped either way.
	const classified = classifyFromHeaders({ headers: newsletter.headers, subject: "Weekly digest" });
	assert.equal(classified.class, "bulk");
	assert.equal(shouldAutoDraft(classified, verified, { ...newsletter, folderId: classified.folderId }), false);
}
assert.equal(isDirectMail(direct({ headers: headers(["List-Id", "<team.lists.example>"]) })), false);
assert.equal(isDirectMail(direct({ headers: headers(["List-Post", "<mailto:team@lists.example>"]) })), false);
assert.equal(isDirectMail(direct({ headers: headers(["Precedence", "bulk"]) })), false);
assert.equal(isDirectMail(direct({ headers: headers(["Precedence", "list"]) })), false);
assert.equal(isDirectMail(direct({ headers: headers(["Precedence", "junk"]) })), false);

// ── GitHub-style notification from notifications@ → no draft ──────

{
	const github = direct({
		headers: headers(["X-GitHub-Reason", "mention"]),
		sender: "notifications@github.com",
		replyTo: ["reply+ABC123@reply.github.com"],
	});
	assert.deepEqual(directMailSignals(github), ["no-reply-sender"]);
	assert.equal(shouldAutoDraft(ham, verified, github), false);
}

// ── Receipt from no-reply → no draft ──────────────────────────────

{
	const receipt = direct({
		headers: headers(["Subject", "Your receipt"]),
		sender: "no-reply@payments.example",
	});
	assert.deepEqual(directMailSignals(receipt), ["no-reply-sender"]);
	assert.equal(shouldAutoDraft(ham, verified, receipt), false);
}
// A person's From with a no-reply Reply-To is still machine mail.
assert.deepEqual(directMailSignals(direct({ replyTo: ["donotreply@shop.example"] })), [
	"no-reply-reply-to",
]);

// ── Promotions / Updates / Screener filing → no draft ─────────────

for (const folderId of [Folders.PROMOTIONS, Folders.UPDATES, "screener", "custom-folder"]) {
	assert.deepEqual(directMailSignals(direct({ folderId })), ["not-inbox"]);
	assert.equal(shouldAutoDraft(ham, verified, direct({ folderId })), false);
}

// ── Automated and campaign headers → no draft ─────────────────────

assert.deepEqual(
	directMailSignals(direct({ headers: headers(["Auto-Submitted", "auto-generated"]) })),
	["automated-headers"],
);
assert.deepEqual(
	directMailSignals(direct({ headers: headers(["X-Auto-Response-Suppress", "All"]) })),
	["automated-headers"],
);
for (const name of ["Feedback-ID", "X-MC-User", "X-Mailchimp-Campaign", "X-CampaignID", "X-SG-EID", "X-Mailgun-Tag"]) {
	assert.deepEqual(directMailSignals(direct({ headers: headers([name, "x"]) })), ["campaign-headers"], name);
}
// Headers stored as a JSON string (as in D1/DO rows) parse the same way.
assert.equal(
	isDirectMail(direct({ headers: JSON.stringify(headers(["List-Id", "<x.example>"])) })),
	false,
);

// ── Bcc / list delivery → no draft ────────────────────────────────

{
	const bcc = direct({ recipients: ["team@friend.org"] });
	assert.deepEqual(directMailSignals(bcc), ["not-addressed"]);
	assert.equal(shouldAutoDraft(ham, verified, bcc), false);
}

// ── Existing gates still apply ────────────────────────────────────

assert.equal(shouldAutoDraft(ham, { authTier: "failed", spoofed: true }, direct()), false);
assert.equal(
	shouldAutoDraft({ class: "spam", folderId: Folders.SPAM, reason: "ai-spam" }, verified, direct()),
	false,
);

// ── No-reply address detection ────────────────────────────────────

for (const address of [
	"noreply@x.com",
	"no-reply@x.com",
	"no_reply@x.com",
	"github-noreply@x.com",
	"donotreply@x.com",
	"do-not-reply@x.com",
	"notifications@github.com",
	"notification@x.com",
	"notify@x.com",
	"alerts@x.com",
	"MAILER-DAEMON@x.com",
	"postmaster@x.com",
	"bounce@x.com",
	"bounces+123@x.com",
]) {
	assert.equal(isNoReplyAddress(address), true, address);
}
for (const address of ["ada@friend.org", "replyall@x.com", "notes@x.com", "support@x.com", "", null]) {
	assert.equal(isNoReplyAddress(address), false, String(address));
}

console.log("direct-mail tests passed");
