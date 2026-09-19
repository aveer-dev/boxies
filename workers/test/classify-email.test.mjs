/**
 * Inbound classification: spam vs ham vs bulk, auto-draft gate.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	classifyFromHeaders,
	classifyInboundEmail,
	firstClassifierToken,
	shouldAutoDraft,
	shouldClassifyInbound,
	shouldFallbackToInbox,
	shouldSendPush,
} from "../lib/classify-email.ts";
import PostalMime from "postal-mime";

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

// ── Bulk: List-Unsubscribe / List-Id → Promotions ─────────────────

{
	const result = classifyFromHeaders({
		headers: headers(["List-Unsubscribe", "<mailto:unsub@news.example>"]),
		subject: "This week's deals",
		sender: "news@shop.example",
	});
	assert.deepEqual(result, {
		class: "bulk",
		folderId: Folders.PROMOTIONS,
		reason: "bulk-list-headers",
	});
	assert.equal(shouldAutoDraft(result), false);
	assert.equal(shouldSendPush(result), true);
}

{
	const result = classifyFromHeaders({
		headers: headers(["List-Id", "<weekly.newsletter.example.com>"]),
		subject: "Friday roundup",
		sender: "editor@newsletter.example",
	});
	assert.equal(result?.class, "bulk");
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

{
	const result = classifyFromHeaders({
		headers: headers(["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"]),
		subject: "You are subscribed",
		sender: "list@example.com",
	});
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

{
	const result = classifyFromHeaders({
		headers: headers(["Precedence", "bulk"]),
		subject: "Mailing list post",
		sender: "list@example.com",
	});
	assert.equal(result?.class, "bulk");
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

{
	const result = classifyFromHeaders({
		headers: headers(["Precedence", "list"]),
		subject: "List traffic",
		sender: "list@example.com",
	});
	assert.equal(result?.class, "bulk");
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

// ── Bulk + transactional → Updates ────────────────────────────────

{
	const result = classifyFromHeaders({
		headers: headers(["List-Unsubscribe", "<mailto:unsub@shop.example>"]),
		subject: "Your order has shipped",
		sender: "orders@shop.example",
	});
	assert.deepEqual(result, {
		class: "bulk",
		folderId: Folders.UPDATES,
		reason: "bulk-transactional",
	});
	assert.equal(shouldAutoDraft(result), false);
}

{
	const result = classifyFromHeaders({
		headers: headers(
			["List-Id", "<receipts.store.example>"],
			["Auto-Submitted", "auto-generated"],
		),
		subject: "Thanks for your purchase",
		sender: "noreply@store.example",
	});
	assert.equal(result?.folderId, Folders.UPDATES);
}

{
	const result = classifyFromHeaders({
		headers: headers(["List-Unsubscribe", "<https://example.com/unsub>"]),
		subject: "Your 2FA code is 123456",
		sender: "security@example.com",
	});
	assert.equal(result?.folderId, Folders.UPDATES);
}

{
	const result = classifyFromHeaders({
		headers: headers(["List-Id", "<mail.example.com>"]),
		subject: "Receipt for invoice #442",
		sender: "billing@example.com",
	});
	assert.equal(result?.folderId, Folders.UPDATES);
}

{
	const result = classifyFromHeaders({
		headers: headers(
			["List-Unsubscribe", "<mailto:unsub@news.example>"],
			["Auto-Submitted", "no"],
		),
		subject: "This week's deals",
		sender: "news@shop.example",
	});
	assert.equal(
		result?.folderId,
		Folders.PROMOTIONS,
		"Auto-Submitted: no is not transactional",
	);
}

{
	const result = classifyFromHeaders({
		headers: headers(["Auto-Submitted", "auto-replied"]),
		subject: "Re: Lunch tomorrow",
		sender: "bob@example.com",
	});
	assert.deepEqual(result, {
		class: "bulk",
		folderId: Folders.UPDATES,
		reason: "bulk-transactional",
	});
	assert.equal(shouldAutoDraft(result), false);
}

// ── Spam headers win over list headers ────────────────────────────

{
	const result = classifyFromHeaders({
		headers: headers(
			["X-Spam-Flag", "YES"],
			["List-Unsubscribe", "<mailto:unsub@spam.example>"],
		),
		subject: "You won a prize",
		sender: "win@spam.example",
	});
	assert.deepEqual(result, {
		class: "spam",
		folderId: Folders.SPAM,
		reason: "spam-headers",
	});
	assert.equal(shouldAutoDraft(result), false);
	assert.equal(shouldSendPush(result), false);
}

{
	const result = classifyFromHeaders({
		headers: headers(["X-Spam-Status", "Yes, score=12.0"]),
		subject: "Cheap meds",
		sender: "meds@spam.example",
	});
	assert.equal(result?.class, "spam");
	assert.equal(result?.folderId, Folders.SPAM);
}

{
	const result = classifyFromHeaders({
		headers: headers(["Precedence", "junk"]),
		subject: "Junk",
		sender: "x@y.example",
	});
	assert.equal(result?.class, "spam");
}

// ── No list/spam headers → ham (AI skipped) ───────────────────────

{
	const fromHeaders = classifyFromHeaders({
		headers: headers(["From", "Ada <ada@example.com>"]),
		subject: "Lunch tomorrow?",
		sender: "ada@example.com",
		bodyText: "Want to grab lunch?",
	});
	assert.equal(fromHeaders, null);

	const result = await classifyInboundEmail({
		headers: headers(["From", "Ada <ada@example.com>"]),
		subject: "Lunch tomorrow?",
		sender: "ada@example.com",
		bodyText: "Want to grab lunch?",
	});
	assert.deepEqual(result, {
		class: "ham",
		folderId: Folders.INBOX,
		reason: "personal-ham",
	});
	assert.equal(shouldAutoDraft(result), true);
	assert.equal(shouldSendPush(result), true);
}

// JSON raw_headers string (PostalMime storage shape)
{
	const result = classifyFromHeaders({
		headers: JSON.stringify([
			{ key: "List-Unsubscribe", value: "<mailto:unsub@example.com>" },
		]),
		subject: "Weekly promo",
		sender: "promo@example.com",
	});
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

{
	const result = classifyFromHeaders({
		headers: [{ name: "List-Id", value: "<weekly.example.com>" }],
		subject: "Roundup",
		sender: "editor@example.com",
	});
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

{
	const result = classifyFromHeaders({
		headers: headers(
			["X-Spam-Flag", "NO"],
			["List-Unsubscribe", "<mailto:unsub@news.example>"],
		),
		subject: "This week's deals",
		sender: "news@shop.example",
	});
	assert.equal(result?.class, "bulk");
	assert.equal(result?.folderId, Folders.PROMOTIONS);
}

// ── AI spam vs ham (stubbed) ──────────────────────────────────────

{
	const spamAi = {
		run: async () => ({ response: "SPAM" }),
	};
	const result = await classifyInboundEmail(
		{
			headers: headers(["From", "phish@evil.example"]),
			subject: "Verify your account now",
			sender: "phish@evil.example",
			bodyText: "Click this link immediately to keep your account.",
		},
		spamAi,
	);
	assert.equal(result.class, "spam");
	assert.equal(result.folderId, Folders.SPAM);
	assert.equal(result.reason, "ai-spam");
	assert.equal(shouldAutoDraft(result), false);
}

{
	const hamAi = {
		run: async () => ({ response: "HAM" }),
	};
	const result = await classifyInboundEmail(
		{
			subject: "Project update",
			sender: "tim@acme.com",
			bodyText: "Can we move the meeting?",
		},
		hamAi,
	);
	assert.equal(result.class, "ham");
	assert.equal(result.folderId, Folders.INBOX);
	assert.equal(shouldAutoDraft(result), true);
}

{
	const failAi = {
		run: async () => {
			throw new Error("model unavailable");
		},
	};
	const result = await classifyInboundEmail(
		{
			subject: "Hello",
			sender: "friend@example.com",
			bodyText: "Checking in",
		},
		failAi,
	);
	assert.equal(result.class, "ham");
	assert.equal(result.reason, "ai-fail-open");
	assert.equal(shouldAutoDraft(result), true);
}

// Header decision skips AI entirely
{
	let called = 0;
	const ai = {
		run: async () => {
			called += 1;
			return { response: "SPAM" };
		},
	};
	const result = await classifyInboundEmail(
		{
			headers: headers(["List-Id", "<news.example.com>"]),
			subject: "Newsletter",
			sender: "news@example.com",
		},
		ai,
	);
	assert.equal(called, 0);
	assert.equal(result.folderId, Folders.PROMOTIONS);
	assert.equal(shouldAutoDraft(result), false);
}

// ── Auto-draft only for ham ───────────────────────────────────────

assert.equal(
	shouldAutoDraft({ class: "ham", folderId: Folders.INBOX, reason: "personal-ham" }),
	true,
);
assert.equal(
	shouldAutoDraft({ class: "spam", folderId: Folders.SPAM, reason: "spam-headers" }),
	false,
);
assert.equal(
	shouldAutoDraft({
		class: "bulk",
		folderId: Folders.PROMOTIONS,
		reason: "bulk-list-headers",
	}),
	false,
);
assert.equal(
	shouldAutoDraft({
		class: "bulk",
		folderId: Folders.UPDATES,
		reason: "bulk-transactional",
	}),
	false,
);

// ── Rejected envelopes and duplicates never classify ──────────────

assert.equal(
	shouldClassifyInbound({ routeAction: "reject", isDuplicate: false }),
	false,
);
assert.equal(
	shouldClassifyInbound({ routeAction: "deliver", isDuplicate: true }),
	false,
);
assert.equal(
	shouldClassifyInbound({ routeAction: "reject", isDuplicate: true }),
	false,
);
assert.equal(
	shouldClassifyInbound({ routeAction: "deliver", isDuplicate: false }),
	true,
);

// ── Inbox fallback only for missing classified folders ────────────

assert.equal(
	shouldFallbackToInbox(
		Folders.PROMOTIONS,
		new Error(
			'createEmail: folder "promotions" not found. Ensure the folder exists before inserting an email.',
		),
	),
	true,
);
assert.equal(
	shouldFallbackToInbox(
		Folders.SPAM,
		new Error('createEmail: folder "spam" not found.'),
	),
	true,
);
assert.equal(
	shouldFallbackToInbox(
		Folders.INBOX,
		new Error('createEmail: folder "inbox" not found.'),
	),
	false,
	"Inbox itself missing must bounce, not retry Inbox",
);
assert.equal(
	shouldFallbackToInbox(
		Folders.PROMOTIONS,
		new Error("UNIQUE constraint failed: emails.id"),
	),
	false,
	"Duplicate or other write errors must not insert a second copy in Inbox",
);
assert.equal(
	shouldFallbackToInbox(Folders.UPDATES, new Error("SQLITE_BUSY")),
	false,
);

// ── AI token parse: first word only, fail open ────────────────────

assert.equal(firstClassifierToken("SPAM"), "SPAM");
assert.equal(firstClassifierToken("spam."), "SPAM");
assert.equal(firstClassifierToken("HAM"), "HAM");
assert.equal(firstClassifierToken("NOT SPAM"), "NOT");
assert.equal(firstClassifierToken("This is HAM"), "THIS");

{
	const verboseSpam = {
		run: async () => ({ response: "NOT SPAM. This is a real person." }),
	};
	const result = await classifyInboundEmail(
		{
			subject: "Lunch?",
			sender: "ada@example.com",
			bodyText: "Want to grab lunch?",
		},
		verboseSpam,
	);
	assert.equal(result.class, "ham", "verbose NOT SPAM must fail open to ham");
}

{
	const wrapped = {
		run: async () => ({ result: { response: "SPAM" } }),
	};
	const result = await classifyInboundEmail(
		{
			subject: "Cheap meds",
			sender: "phish@evil.example",
			bodyText: "Click now",
		},
		wrapped,
	);
	assert.equal(result.class, "spam");
	assert.equal(result.reason, "ai-spam");
}

// ── PostalMime round-trip (same header shape as receiveEmail) ─────

function rfc822({ from, to, subject, extraHeaders = [], body }) {
	return [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${subject}`,
		...extraHeaders,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
	].join("\r\n");
}

async function classifyMime(raw, ai) {
	const parsed = await PostalMime.parse(raw);
	return classifyInboundEmail(
		{
			headers: parsed.headers,
			subject: parsed.subject,
			sender: parsed.from?.address,
			bodyText: parsed.text,
			bodyHtml: parsed.html,
		},
		ai,
	);
}

{
	const result = await classifyMime(
		rfc822({
			from: "News <news@shop.example>",
			to: "you@inboxies.email",
			subject: "This week's deals",
			extraHeaders: [
				"List-Unsubscribe: <mailto:unsub@shop.example>",
				"List-Id: <weekly.shop.example>",
				"Message-ID: <news-1@shop.example>",
			],
			body: "Hello subscriber, 20% off everything.",
		}),
	);
	assert.equal(result.class, "bulk");
	assert.equal(result.folderId, Folders.PROMOTIONS);
	assert.equal(shouldAutoDraft(result), false);
	assert.equal(shouldSendPush(result), true);
}

{
	const result = await classifyMime(
		rfc822({
			from: "Shop <orders@shop.example>",
			to: "you@inboxies.email",
			subject: "Your order has shipped",
			extraHeaders: [
				"List-Unsubscribe: <https://shop.example/unsub>",
				"List-Unsubscribe-Post: List-Unsubscribe=One-Click",
				"Message-ID: <ship-9@shop.example>",
			],
			body: "Tracking 1Z999 is on the way.",
		}),
	);
	assert.equal(result.class, "bulk");
	assert.equal(result.folderId, Folders.UPDATES);
	assert.equal(shouldAutoDraft(result), false);
}

{
	const result = await classifyMime(
		rfc822({
			from: "Spammer <win@spam.example>",
			to: "you@inboxies.email",
			subject: "You won a prize",
			extraHeaders: [
				"X-Spam-Flag: YES",
				"List-Unsubscribe: <mailto:unsub@spam.example>",
				"Message-ID: <spam-1@spam.example>",
			],
			body: "Claim your prize now.",
		}),
	);
	assert.equal(result.class, "spam");
	assert.equal(result.folderId, Folders.SPAM);
	assert.equal(shouldAutoDraft(result), false);
	assert.equal(shouldSendPush(result), false);
}

{
	const result = await classifyMime(
		rfc822({
			from: "Ada Lovelace <ada@example.com>",
			to: "you@inboxies.email",
			subject: "Lunch tomorrow?",
			extraHeaders: ["Message-ID: <lunch@example.com>"],
			body: "Want to grab lunch?",
		}),
	);
	assert.equal(result.class, "ham");
	assert.equal(result.folderId, Folders.INBOX);
	assert.equal(result.reason, "personal-ham");
	assert.equal(shouldAutoDraft(result), true);
}

{
	const result = classifyFromHeaders({
		headers: headers(["From", "PayPal <ceo@paypal.com>"]),
		subject: "Urgent wire",
		sender: "ceo@paypal.com",
		auth: {
			spoofed: true,
			source: "authentication-results",
			aligned: false,
			headerFrom: "ceo@paypal.com",
			envelopeFrom: "bad@evil.example",
		},
	});
	assert.deepEqual(result, {
		class: "spam",
		folderId: Folders.SPAM,
		reason: "auth-spoofed",
	});
	assert.equal(shouldAutoDraft(result, { spoofed: true }), false);
}

console.log("classify-email tests passed");
