/**
 * Inbound classification: spam vs ham vs bulk, auto-draft gate.
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	classifyFromHeaders,
	classifyInboundEmail,
	shouldAutoDraft,
	shouldClassifyInbound,
	shouldSendPush,
} from "../lib/classify-email.ts";

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

console.log("classify-email tests passed");
