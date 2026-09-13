/**
 * Forwarding / auto-reply loop guards.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	appendXLoop,
	autoReplySubject,
	automationSettingsError,
	buildAutoReplyHeaders,
	headerMapFromSource,
	headersForEmailSend,
	isNoreplyAddress,
	mergeMailboxSettingsBlob,
	normalizeEmailAddress,
	parseAutomationSettings,
	shouldAutoReply,
	shouldForward,
	xLoopContains,
} from "../lib/mail-automations.ts";

const ham = { class: "ham", folderId: "inbox", reason: "personal-ham" };
const bulk = { class: "bulk", folderId: "promotions", reason: "bulk-list-headers" };
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };
const mailbox = "hello@inboxies.email";

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

assert.equal(normalizeEmailAddress("Alice <Hello+Tag@Inboxies.Email>"), "hello+tag@inboxies.email");
assert.equal(normalizeEmailAddress("not-an-email"), null);
assert.equal(isNoreplyAddress("noreply@store.example"), true);
assert.equal(isNoreplyAddress("no-reply@store.example"), true);
assert.equal(isNoreplyAddress("mailer-daemon@store.example"), true);
assert.equal(isNoreplyAddress("alice@example.com"), false);
assert.equal(isNoreplyAddress(""), true);

{
	const parsed = parseAutomationSettings({
		fromName: "Ada",
		forwarding: { enabled: true, email: " ada@example.com " },
		autoReply: { enabled: 1, subject: "Out", message: "Gone" },
	});
	assert.deepEqual(parsed.forwarding, { enabled: true, email: "ada@example.com" });
	assert.equal(parsed.autoReply.enabled, false);
	assert.equal(parsed.autoReply.message, "Gone");
}

assert.equal(
	automationSettingsError(
		{ forwarding: { enabled: true, email: "hello@inboxies.email" } },
		mailbox,
	),
	"Forwarding address cannot be this mailbox",
);
assert.equal(
	automationSettingsError({ autoReply: { enabled: true, message: "" } }, mailbox),
	"Enter an auto-reply message",
);
assert.equal(
	automationSettingsError(
		{ forwarding: { enabled: true, email: "ada@example.com" } },
		mailbox,
	),
	null,
);

{
	const map = headerMapFromSource(
		headers(["X-Loop", "hello@inboxies.email, other@example.com"]),
	);
	assert.equal(xLoopContains(map, "Hello+Tag@Inboxies.Email"), true);
	assert.equal(xLoopContains(map, "ada@example.com"), false);
}

assert.equal(
	appendXLoop("other@example.com", mailbox),
	"other@example.com, hello@inboxies.email",
);
assert.equal(appendXLoop(mailbox, mailbox), mailbox);

assert.deepEqual(
	shouldForward({
		enabled: true,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
	}),
	{ ok: true, dest: "ada@example.com" },
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: bulk,
	}).ok,
	true,
	"newsletters still forward",
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: spam,
	}).reason,
	"spam",
);

assert.equal(
	shouldForward({
		enabled: false,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
	}).reason,
	"disabled",
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: mailbox,
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
	}).reason,
	"self-dest",
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: "bob@example.com",
		mailboxId: mailbox,
		sender: "Bob <bob@example.com>",
		classification: ham,
	}).reason,
	"dest-is-sender",
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
		canBeForwarded: false,
	}).reason,
	"cannot-forward",
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
		headers: headers(["X-Loop", mailbox]),
	}).reason,
	"x-loop",
);

assert.equal(
	shouldForward({
		enabled: true,
		dest: "ada@example.com",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
		headers: headers(["X-Loop", "ada@example.com"]),
	}).reason,
	"x-loop",
	"A→B→A: dest already in X-Loop",
);

assert.deepEqual(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
	}),
	{ ok: true },
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: bulk,
	}).reason,
	"not-ham",
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: "noreply@store.example",
		classification: ham,
	}).reason,
	"noreply",
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: mailbox,
		classification: ham,
	}).reason,
	"self",
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
		headers: headers(["X-Loop", "Hello@Inboxies.Email"]),
	}).reason,
	"x-loop",
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
	}).reason,
	"empty-message",
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
		headers: headers(["Auto-Submitted", "auto-replied"]),
	}).reason,
	"auto-submitted",
	"other vacation systems must not get a reply even if classified ham",
);

assert.equal(
	shouldAutoReply({
		enabled: true,
		message: "I am away.",
		mailboxId: mailbox,
		sender: "bob@example.com",
		classification: ham,
		headers: headers(["Auto-Submitted", "no"]),
	}).ok,
	true,
	"Auto-Submitted: no is a normal message",
);

assert.equal(autoReplySubject("", "Hello"), "Re: Hello");
assert.equal(autoReplySubject("Out of office", "Hello"), "Out of office");
assert.equal(autoReplySubject("", "Re: Hello"), "Re: Hello");

{
	const built = buildAutoReplyHeaders({
		mailboxId: mailbox,
		originalMessageId: "<abc@example.com>",
	});
	assert.equal(built["Auto-Submitted"], "auto-replied");
	assert.equal(built.Precedence, "bulk");
	assert.equal(built["X-Auto-Response-Suppress"], "All");
	assert.equal(built["X-Loop"], mailbox);
	assert.equal(built["In-Reply-To"], "<abc@example.com>");
	assert.equal(built.References, "<abc@example.com>");
	const sendHeaders = headersForEmailSend({ ...built, "In-Reply-To": "" });
	assert.equal(sendHeaders["Auto-Submitted"], "auto-replied");
	assert.equal(sendHeaders.Precedence, "bulk");
	assert.equal("In-Reply-To" in sendHeaders, false);
}

{
	const merged = mergeMailboxSettingsBlob(
		{
			fromName: "Ada",
			agentSystemPrompt: "Be brief.",
			forwarding: { enabled: false, email: "" },
			autoReply: { enabled: true, subject: "Out", message: "Gone" },
			signature: { enabled: true, text: "-- Ada" },
		},
		{
			fromName: "Ada",
			forwarding: { enabled: true, email: "ada@example.com" },
		},
	);
	assert.deepEqual(merged.autoReply, {
		enabled: true,
		subject: "Out",
		message: "Gone",
	});
	assert.deepEqual(merged.signature, { enabled: true, text: "-- Ada" });
	assert.deepEqual(merged.forwarding, {
		enabled: true,
		email: "ada@example.com",
	});
	assert.equal(merged.agentSystemPrompt, undefined);
}

{
	const keptPrompt = mergeMailboxSettingsBlob(
		{ agentSystemPrompt: "Be brief.", fromName: "Ada" },
		{ fromName: "Ada", agentSystemPrompt: "Be brief." },
	);
	assert.equal(keptPrompt.agentSystemPrompt, "Be brief.");
}

console.log("mail-automations tests passed");
