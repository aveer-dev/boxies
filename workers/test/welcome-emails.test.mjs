// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import {
	generateWelcomeEmails,
	seedWelcomeEmailsInDO,
	seedWelcomeEmailsForMailbox,
	WELCOME_FLAG_KEY,
} from "../lib/welcome-emails.ts";
import { Folders } from "../../shared/folders.ts";

console.log("Starting Welcome & Onboarding Emails test suite...");

// ── 1. Unit Tests: generateWelcomeEmails ───────────────────────────
{
	const baseDate = new Date("2026-10-04T12:00:00.000Z");
	const emails = generateWelcomeEmails({
		recipientEmail: "sarah@acme.corp",
		recipientName: "Sarah Connor",
		domain: "acme.corp",
		baseDate,
	});

	assert.equal(emails.length, 3, "Generates exactly 3 onboarding emails");

	const [e1, e2, e3] = emails;

	// Check email 1 (Getting Started)
	assert.ok(e1.subject.includes("Getting Started"), "Email 1 subject includes Getting Started");
	assert.equal(e1.sender, "welcome@acme.corp");
	assert.equal(e1.sender_name, "Inboxies Team");
	assert.equal(e1.recipient, "sarah@acme.corp");
	assert.equal(e1.read, false, "Email 1 is unread");
	assert.equal(e1.starred, false);
	assert.equal(e1.thread_id, e1.id, "Email 1 has thread_id equal to id");
	assert.ok(e1.message_id.includes(e1.id));
	assert.equal(e1.auth.spf, "pass");
	assert.equal(e1.auth.dkim, "pass");
	assert.equal(e1.auth.dmarc, "pass");
	assert.equal(e1.auth.aligned, true);
	assert.equal(e1.auth.spoofed, false);

	// Check body contents of Email 1
	assert.ok(e1.body.includes("Sarah Connor"), "Personalized with recipient display name");
	assert.ok(e1.body.includes("sarah@acme.corp"), "Mentions recipient email");
	assert.ok(e1.body.includes("Quick Start Checklist"), "Includes checklist");
	assert.ok(e1.body.includes("Personalize Your Profile & Signature"), "Step 1 instructions");
	assert.ok(e1.body.includes("Connect Native Mobile Apps"), "Step 2 mobile instructions");
	assert.ok(e1.body.includes("Link another device"), "Explains 15-minute pairing PIN code");
	assert.ok(e1.body.includes("Essential Keyboard Shortcuts"), "Includes shortcuts table");
	assert.ok(e1.body.includes("Reply Later"), "Includes Reply Later shortcut");
	assert.ok(e1.snippet.length > 20, "Has detailed snippet");
	assert.ok(e1.search_text.includes("checklist"), "FTS search text contains checklist");

	// Check email 2 (AI Assistant)
	assert.ok(e2.subject.includes("AI Agent") || e2.subject.includes("Copilot"), "Email 2 subject mentions AI");
	assert.equal(e2.sender, "agent@acme.corp");
	assert.equal(e2.sender_name, "Inboxies AI");
	assert.equal(e2.recipient, "sarah@acme.corp");
	assert.equal(e2.read, false, "Email 2 is unread");
	assert.equal(e2.thread_id, e2.id);
	assert.ok(e2.body.includes("Auto-Drafting on Incoming Mail"), "Explains auto-drafting");
	assert.ok(e2.body.includes("Safety Guarantee"), "Explains human-in-the-loop guarantee");
	assert.ok(e2.body.includes("Side Panel Copilot"), "Explains copilot drawer");
	assert.ok(e2.body.includes("search_emails"), "Lists search_emails tool");
	assert.ok(e2.body.includes("get_thread"), "Lists get_thread tool");
	assert.ok(e2.body.includes("Agent Prompt"), "Mentions custom agent prompt settings");
	assert.ok(e2.body.includes("/mcp"), "Mentions Model Context Protocol endpoint");

	// Check email 3 (Advanced Guide & Security)
	assert.ok(e3.subject.includes("Advanced Guide") || e3.subject.includes("Security"), "Email 3 subject mentions Advanced / Security");
	assert.equal(e3.sender, "security@acme.corp");
	assert.equal(e3.sender_name, "Inboxies Platform");
	assert.equal(e3.recipient, "sarah@acme.corp");
	assert.equal(e3.read, false, "Email 3 is unread");
	assert.equal(e3.thread_id, e3.id);
	assert.ok(e3.body.includes("The Screener &amp; Sender Triage") || e3.body.includes("The Screener & Sender Triage"), "Explains Screener");
	assert.ok(e3.body.includes("The Reply Later Focus Queue"), "Explains Reply Later");
	assert.ok(e3.body.includes("MX Records"), "Explains MX routing");
	assert.ok(e3.body.includes("SPF &amp; DKIM") || e3.body.includes("SPF & DKIM"), "Explains SPF/DKIM");
	assert.ok(e3.body.includes("Granular Mailbox Sharing"), "Explains ACL sharing");
	assert.ok(e3.body.includes("MBOX Export"), "Explains RFC 4155 MBOX export");

	// Verify reverse-chronological timestamps:
	// Email 1 is newest (e.g. 12:00:00), Email 2 is 11:59:00, Email 3 is 11:58:00
	const t1 = new Date(e1.date).getTime();
	const t2 = new Date(e2.date).getTime();
	const t3 = new Date(e3.date).getTime();
	assert.ok(t1 > t2, "Email 1 is newer than Email 2");
	assert.ok(t2 > t3, "Email 2 is newer than Email 3");
	assert.equal(t1 - t2, 60000, "1 minute interval between 1 and 2");
	assert.equal(t2 - t3, 60000, "1 minute interval between 2 and 3");

	console.log("✔ generateWelcomeEmails unit tests passed");
}

// ── 2. Fallback handling for display name & domain ─────────────────
{
	const emails = generateWelcomeEmails({
		recipientEmail: "bob.jones@custom.org",
		recipientName: null,
	});

	assert.equal(emails[0].sender, "welcome@custom.org");
	assert.ok(emails[0].body.includes("Bob.jones"), "Local part capitalized when recipientName omitted");

	const fallbackEmails = generateWelcomeEmails({
		recipientEmail: "hello-world",
	});
	assert.equal(fallbackEmails[0].sender, "welcome@inboxies.email", "Falls back to inboxies.email");

	console.log("✔ Display name and domain fallback tests passed");
}

// ── 3. Mock DO Seeding & Idempotency ──────────────────────────────
{
	const storage = new Map();
	const createdEmails = [];
	const triagedSenders = [];

	const mockDO = {
		ctx: {
			storage: {
				get: async (k) => storage.get(k),
				put: async (k, v) => storage.set(k, v),
				delete: async (k) => storage.delete(k),
			},
		},
		createEmail: async (folder, email, attachments) => {
			createdEmails.push({ folder, email, attachments });
		},
		upsertSenderTriage: async (row) => {
			triagedSenders.push(row);
		},
	};

	// First run: should seed all 3 emails
	const res1 = await seedWelcomeEmailsInDO(mockDO, {
		recipientEmail: "alice@example.com",
		recipientName: "Alice",
	});

	assert.equal(res1.seeded, 3, "Seeded 3 emails");
	assert.equal(createdEmails.length, 3, "Created 3 emails");
	assert.equal(createdEmails[0].folder, Folders.INBOX, "Placed in inbox folder");
	assert.equal(storage.get(WELCOME_FLAG_KEY), "1", "Flag key set in storage");
	assert.equal(triagedSenders.length, 3, "Triaged 3 platform senders as allowed");
	assert.equal(triagedSenders[0].status, "allowed");
	assert.equal(
		triagedSenders[0].destination_folder_id,
		null,
		"Platform senders get no pinned destination (classify sorts them)",
	);

	// Second run without force: should be idempotent and return 0
	const res2 = await seedWelcomeEmailsInDO(mockDO, {
		recipientEmail: "alice@example.com",
		recipientName: "Alice",
	});

	assert.equal(res2.seeded, 0, "Idempotent: did not seed again");
	assert.equal(createdEmails.length, 3, "No additional emails created");

	// Third run with force: true
	const res3 = await seedWelcomeEmailsInDO(mockDO, {
		recipientEmail: "alice@example.com",
		recipientName: "Alice",
		force: true,
	});

	assert.equal(res3.seeded, 3, "Force re-seeds 3 emails");
	assert.equal(createdEmails.length, 6, "Total 6 emails after forced re-seed");

	console.log("✔ DO Seeding & Idempotency tests passed");
}

// ── 4. seedWelcomeEmailsForMailbox helper ───────────────────────────
{
	let calledStub = null;
	const mockEnv = {
		MAILBOX: {
			idFromName: (name) => name,
			get: (id) => ({
				id,
				seedWelcomeEmails: async (opts) => {
					calledStub = opts;
					return { seeded: 3 };
				},
			}),
		},
	};

	const res = await seedWelcomeEmailsForMailbox(mockEnv, "test@domain.com", "Tester");
	assert.equal(res.seeded, 3);
	assert.equal(calledStub.recipientEmail, "test@domain.com");
	assert.equal(calledStub.recipientName, "Tester");

	// Safe handling when stub does not implement seedWelcomeEmails
	const mockEnvWithoutMethod = {
		MAILBOX: {
			idFromName: (name) => name,
			get: (id) => ({ id }),
		},
	};
	const safeRes = await seedWelcomeEmailsForMailbox(mockEnvWithoutMethod, "test@domain.com");
	assert.equal(safeRes.seeded, 0, "Gracefully returns 0 when method is missing");

	console.log("✔ seedWelcomeEmailsForMailbox helper tests passed");
}

console.log("\n=========================================");
console.log("ALL WELCOME EMAILS TESTS PASSED!");
console.log("=========================================\n");
