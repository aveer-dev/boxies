/**
 * Inbound classification: spam vs ham vs bulk, auto-draft gate.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	applySenderTrust,
	classifyFromHeaders,
	classifyInboundEmail,
	firstClassifierToken,
	isAiSpam,
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
			authTier: "failed",
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
		reason: "auth-failed",
	});
	assert.equal(shouldAutoDraft(result, { authTier: "failed", spoofed: true }), false);
}

// ── Auth tiers: only `failed` is spam on auth alone ───────────────

{
	const base = {
		source: "authentication-results",
		headerFrom: "ada@smallbiz.example",
		envelopeFrom: "bounces@sendgrid.net",
	};
	const input = (auth) => ({
		headers: headers(["From", "Ada <ada@smallbiz.example>"]),
		subject: "Your quote",
		sender: "ada@smallbiz.example",
		auth,
	});

	const verified = { ...base, aligned: true, authTier: "verified", spoofed: false };
	assert.equal(classifyFromHeaders(input(verified)), null);
	assert.equal(
		shouldAutoDraft({ class: "ham", folderId: Folders.INBOX, reason: "ai-ham" }, verified),
		true,
	);

	// Passes only for the ESP, no enforcing DMARC: falls through to AI.
	const unverified = { ...base, aligned: false, authTier: "unverified", spoofed: false };
	assert.equal(classifyFromHeaders(input(unverified)), null);
	const viaAi = await classifyInboundEmail(input(unverified), {
		run: async () => ({ response: "HAM" }),
	});
	assert.equal(viaAi.class, "ham");
	assert.equal(viaAi.reason, "ai-ham");
	// Unaligned From still never auto-drafts.
	assert.equal(shouldAutoDraft(viaAi, unverified), false);
	// No trusted verdict at all: unverified, auto-draft allowed as before.
	const noVerdict = { ...base, source: "none", aligned: null, authTier: "unverified", spoofed: false };
	assert.equal(classifyFromHeaders(input(noVerdict)), null);
	assert.equal(shouldAutoDraft(viaAi, noVerdict), true);

	const failed = { ...base, aligned: false, authTier: "failed", spoofed: true, dmarc: "fail", dmarcPolicy: "reject" };
	assert.deepEqual(classifyFromHeaders(input(failed)), {
		class: "spam",
		folderId: Folders.SPAM,
		reason: "auth-failed",
	});
	// The AI is never consulted for failed mail.
	const noAi = await classifyInboundEmail(input(failed), {
		run: async () => {
			throw new Error("AI must not run for auth-failed mail");
		},
	});
	assert.equal(noAi.reason, "auth-failed");

	// Failed auth decides before spam headers and bulk (§5 step 1), so list
	// mail with a forged From can't be sorted into Promotions.
	assert.equal(
		classifyFromHeaders({ ...input(failed), headers: headers(["X-Spam-Flag", "YES"]) })?.reason,
		"auth-failed",
	);
	assert.equal(
		classifyFromHeaders({
			...input(failed),
			headers: headers(["List-Unsubscribe", "<mailto:u@smallbiz.example>"]),
		})?.reason,
		"auth-failed",
	);
	// Unverified list mail still sorts as bulk.
	assert.equal(
		classifyFromHeaders({
			...input(unverified),
			headers: headers(["List-Unsubscribe", "<mailto:u@smallbiz.example>"]),
		})?.class,
		"bulk",
	);
}

// ── Sender trust: §5 precedence for allowed and vouched senders ──

{
	const aiSpam = { class: "spam", folderId: Folders.SPAM, reason: "ai-spam" };
	const headerSpam = { class: "spam", folderId: Folders.SPAM, reason: "spam-headers" };
	const authed = {
		authTier: "verified",
		spoofed: false,
		source: "authentication-results",
		aligned: true,
		headerFrom: "osato@inboxies.email",
		envelopeFrom: "bounces@cf-bounce.inboxies.email",
	};
	// Passes only for the ESP's domain, no enforcing DMARC.
	const viaEsp = { ...authed, aligned: false, authTier: "unverified" };
	// No trusted verdict: `aligned === null` is unverified, not "no override".
	const noVerdict = { ...authed, aligned: null, source: "none", authTier: "unverified" };
	const forged = { ...authed, aligned: false, authTier: "failed", spoofed: true };
	const mail = (auth, extraHeaders = []) => ({
		headers: headers(["X-Spam-Flag", "YES"], ...extraHeaders),
		subject: "Lunch?",
		sender: "osato@inboxies.email",
		auth,
	});

	assert.equal(isAiSpam(aiSpam), true);
	assert.equal(isAiSpam(headerSpam), false);

	// Step 1: auth failed stays Spam, whatever the trust.
	const failedSpam = { class: "spam", folderId: Folders.SPAM, reason: "auth-failed" };
	for (const trust of ["allowed", "implicit"]) {
		assert.equal(applySenderTrust(failedSpam, mail(forged), trust), failedSpam);
		// A forged From can't ride an allow past an AI or header verdict either.
		assert.equal(applySenderTrust(aiSpam, mail(forged), trust), aiSpam);
		assert.equal(applySenderTrust(headerSpam, mail(forged), trust), headerSpam);
	}

	// Strangers and blocked senders (trust none): every verdict stands.
	for (const verdict of [aiSpam, headerSpam]) {
		assert.equal(applySenderTrust(verdict, mail(authed), "none"), verdict);
	}

	// Step 3: explicit allow + verified skips spam headers, then files
	// normally: ham with no list headers, bulk with them.
	assert.deepEqual(applySenderTrust(headerSpam, mail(authed), "allowed"), {
		class: "ham",
		folderId: Folders.INBOX,
		reason: "allowed-sender",
	});
	assert.deepEqual(
		applySenderTrust(
			headerSpam,
			mail(authed, [["List-Unsubscribe", "<mailto:u@inboxies.email>"]]),
			"allowed",
		),
		{ class: "bulk", folderId: Folders.PROMOTIONS, reason: "bulk-list-headers" },
	);
	// Explicit allow + verified skips the AI verdict.
	const allowedHam = applySenderTrust(aiSpam, mail(authed), "allowed");
	assert.deepEqual(allowedHam, {
		class: "ham",
		folderId: Folders.INBOX,
		reason: "allowed-sender",
	});
	assert.equal(shouldSendPush(allowedHam), true);
	assert.equal(shouldAutoDraft(allowedHam, authed), true);

	// Step 3: explicit allow + unverified skips the AI verdict only.
	for (const auth of [viaEsp, noVerdict, null]) {
		assert.equal(applySenderTrust(aiSpam, mail(auth), "allowed").folderId, Folders.INBOX);
		assert.equal(applySenderTrust(headerSpam, mail(auth), "allowed"), headerSpam);
	}
	// Unaligned From still never auto-drafts.
	assert.equal(shouldAutoDraft(applySenderTrust(aiSpam, mail(viaEsp), "allowed"), viaEsp), false);

	// Step 4: implicit trust overrides an AI-only verdict, verified or not.
	for (const auth of [authed, viaEsp, noVerdict, null]) {
		assert.deepEqual(applySenderTrust(aiSpam, mail(auth), "implicit"), {
			class: "ham",
			folderId: Folders.INBOX,
			reason: "ai-spam-overridden",
		});
	}
	// Step 5: upstream spam headers beat implicit trust, even when verified.
	assert.equal(applySenderTrust(headerSpam, mail(authed), "implicit"), headerSpam);

	// Non-spam passes through untouched.
	const ham = { class: "ham", folderId: Folders.INBOX, reason: "ai-ham" };
	assert.equal(applySenderTrust(ham, mail(authed), "allowed"), ham);
}

console.log("classify-email tests passed");
