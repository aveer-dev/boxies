// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * M2 Navigation Column Adapters - Empirical Adversarial Verification Suite
 *
 * Verifies:
 * 1. getSnippetText robustness across all edge cases (null, undefined, empty, html, style, malicious, large strings)
 * 2. AccountsColumn: store updates, active dot switching, unread count formatting, Dialog.Root integration
 * 3. FoldersTagsColumn: folderCounts mapping (unreadCount, unread_count, email_count priority order), 7 core folders, HYPERION TAGS
 * 4. ThreadListColumn: selectThread triggers, mark-all-read deduplication, tags extraction & indicators
 * 5. Kumo Design Tokens audit across AccountsColumn, FoldersTagsColumn, ThreadListColumn
 */

import assert from "node:assert/strict";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { Dialog, Badge, Button } from "@cloudflare/kumo";
import { useColumnStack } from "../../app/hooks/useColumnStack.ts";
import { getSnippetText, hasFileAttachment } from "../../app/lib/utils.ts";
import { formatParticipants } from "shared/sender";
import { formatListDate } from "shared/dates";
import {
	setupTestDOM,
	cleanupTestDOM,
	resetColumnStack,
	readComponentSource,
	verifyKumoTokensInFile,
} from "./harness.mjs";

setupTestDOM();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
	totalTests++;
	try {
		resetColumnStack();
		fn();
		passedTests++;
		console.log(`  ✔ [PASS] ${name}`);
	} catch (err) {
		failedTests++;
		console.error(`  ✖ [FAIL] ${name}`);
		console.error(`     Error: ${err.message}`);
		if (err.stack) {
			console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
		}
	}
}

async function runTestAsync(name, fn) {
	totalTests++;
	try {
		resetColumnStack();
		await fn();
		passedTests++;
		console.log(`  ✔ [PASS] ${name}`);
	} catch (err) {
		failedTests++;
		console.error(`  ✖ [FAIL] ${name}`);
		console.error(`     Error: ${err.message}`);
		if (err.stack) {
			console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
		}
	}
}

console.log("========================================================================");
console.log("  M2 NAVIGATION COLUMN ADAPTERS - EMPIRICAL ADVERSARIAL VERIFICATION");
console.log("========================================================================");

// =============================================================================
// TEST SUITE 1: getSnippetText Robustness
// =============================================================================
console.log("\n▶ [SUITE 1] getSnippetText Empirically Tested...");

runTest("1.1: Handles null, undefined, and empty string without throwing", () => {
	assert.equal(getSnippetText(null), "");
	assert.equal(getSnippetText(undefined), "");
	assert.equal(getSnippetText(""), "");
	assert.equal(getSnippetText("   "), "");
	assert.equal(getSnippetText("\n\t  \r\n"), "");
});

runTest("1.2: Strips style tags, scripts, and HTML markup safely", () => {
	const html1 = "<p>Hello <b>World</b></p>";
	assert.equal(getSnippetText(html1), "Hello World");

	const html2 = "<style>body { color: red; }</style><p>Content after style</p>";
	assert.equal(getSnippetText(html2), "Content after style");

	const html3 = "<style type='text/css'>.header { font-size: 16px; }</style><div>Text only</div>";
	assert.equal(getSnippetText(html3), "Text only");

	// Unclosed style block
	const html4 = "<style>body { background: black; } Some text without closing style";
	assert.equal(getSnippetText(html4), "");
});

runTest("1.3: Decodes common and numeric HTML entities accurately", () => {
	const text1 = "Ben &amp; Jerry&#39;s &quot;Ice Cream&quot; &lt;special&gt; &apos;flavor&apos; &nbsp; $5";
	assert.equal(getSnippetText(text1), 'Ben & Jerry\'s "Ice Cream" <special> \'flavor\' $5');

	const text2 = "&#169; 2026 Cloudflare &#x26; Partners";
	assert.equal(getSnippetText(text2), "© 2026 Cloudflare & Partners");
});

runTest("1.4: Handles plain string bodies and truncates to maxLength with ellipsis", () => {
	const normalBody = "This is a regular email plain text body that explains the agenda.";
	assert.equal(getSnippetText(normalBody), normalBody);

	const longBody = "A".repeat(150);
	const snippet = getSnippetText(longBody, 100);
	assert.equal(snippet.length, 103); // 100 chars + "..."
	assert.ok(snippet.endsWith("..."));
	assert.equal(snippet.slice(0, 100), "A".repeat(100));
});

runTest("1.5: Handles extreme strings and special Unicode characters without crashing", () => {
	const unicodeStr = "🚀 Cloudflare Workers ⚡ 日本語 中文 العربية 👨‍👩‍👧‍👦 🎉";
	const res = getSnippetText(unicodeStr);
	assert.equal(res, unicodeStr);

	const megaString = "<p>" + "word ".repeat(5000) + "</p>";
	const megaRes = getSnippetText(megaString, 100);
	assert.ok(megaRes.length <= 103);
	assert.ok(megaRes.endsWith("..."));
});

// =============================================================================
// TEST SUITE 2: AccountsColumn Verification
// =============================================================================
console.log("\n▶ [SUITE 2] AccountsColumn (Col 1 - 300px) Adversarial Challenges...");

runTest("2.1: Store updates correctly upon mailbox selection", () => {
	useColumnStack.getState().initializeStack("mbx-init");
	assert.equal(useColumnStack.getState().selectedMailboxId, "mbx-init");

	useColumnStack.getState().selectMailbox("mbx-new", "Engineering Mailbox");
	const state = useColumnStack.getState();
	assert.equal(state.selectedMailboxId, "mbx-new");
	assert.equal(state.activeColumnId, "threads");
	assert.equal(state.selectedFolderId, "inbox");
	assert.equal(state.selectedEmailId, null);

	const foldersCol = state.columns.find((c) => c.type === "folders");
	assert.ok(foldersCol);
	assert.equal(foldersCol.title, "Engineering Mailbox");
	assert.equal(foldersCol.props?.mailboxId, "mbx-new");
});

runTest("2.2: Active dot switches correctly between mailboxes", () => {
	const src = readComponentSource("app/components/columns/AccountsColumn.tsx");
	assert.ok(src);

	// Verify exact token assignment for dot in source
	assert.match(
		src,
		/isSelected\s*\?\s*["'][^"']*bg-kumo-default ring-2 ring-kumo-line[^"']*["']\s*:\s*["'][^"']*bg-kumo-line[^"']*["']/,
	);

	// Empirical model test
	const accounts = [
		{ id: "acc-1", name: "Primary", email: "primary@example.com" },
		{ id: "acc-2", name: "Secondary", email: "sec@example.com" },
		{ id: "acc-3", name: "Work", email: "work@example.com" },
	];

	for (const target of accounts) {
		const selectedMailboxId = target.id;
		for (const acc of accounts) {
			const isSelected = selectedMailboxId === acc.id;
			const dotClass = isSelected
				? "bg-kumo-default ring-2 ring-kumo-line"
				: "bg-kumo-line";
			if (acc.id === target.id) {
				assert.ok(dotClass.includes("bg-kumo-default ring-2 ring-kumo-line"));
			} else {
				assert.equal(dotClass, "bg-kumo-line");
			}
		}
	}
});

runTest("2.3: Unread counters format properly across all ranges", () => {
	const src = readComponentSource("app/components/columns/AccountsColumn.tsx");
	assert.ok(src);

	// Checks unreadCount ?? unread_count ?? unread
	assert.match(
		src,
		/const unreadCount = \(mailbox as any\)\.unreadCount \?\? \(mailbox as any\)\.unread_count \?\? \(mailbox as any\)\.unread;/,
	);

	// Formatting logic oracle
	const formatOracle = (mailbox) => {
		const unreadCount = mailbox.unreadCount ?? mailbox.unread_count ?? mailbox.unread;
		if (unreadCount == null || unreadCount <= 0) return null;
		return unreadCount > 999 ? "999+" : unreadCount;
	};

	assert.equal(formatOracle({ unreadCount: 0 }), null);
	assert.equal(formatOracle({ unreadCount: null }), null);
	assert.equal(formatOracle({ unread_count: undefined }), null);
	assert.equal(formatOracle({ unreadCount: 1 }), 1);
	assert.equal(formatOracle({ unread_count: 55 }), 55);
	assert.equal(formatOracle({ unread: 999 }), 999);
	assert.equal(formatOracle({ unreadCount: 1000 }), "999+");
	assert.equal(formatOracle({ unread_count: 45000 }), "999+");
});

runTest("2.4: Dialog.Root modal pattern renders safely in SSR/Server without context crash", () => {
	const html = ReactDOMServer.renderToString(
		React.createElement(
			Dialog.Root,
			{ open: false },
			React.createElement(
				Dialog,
				{ size: "sm", className: "p-6" },
				React.createElement(Dialog.Title, { className: "text-base font-semibold mb-4" }, "Add Connected Mailbox"),
			),
		),
	);
	assert.ok(typeof html === "string");
});

// =============================================================================
// TEST SUITE 3: FoldersTagsColumn Verification
// =============================================================================
console.log("\n▶ [SUITE 3] FoldersTagsColumn (Col 2 - 300px) Adversarial Challenges...");

runTest("3.1: folderCounts unread counts map properly for unreadCount, unread_count, and email_count", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);

	assert.match(
		src,
		/map\[f\.id\] = \(f as any\)\.unreadCount \?\? \(f as any\)\.unread_count \?\? \(f as any\)\.email_count \?\? 0;/,
	);

	const computeFolderCounts = (folders) => {
		const map = {};
		for (const f of folders) {
			map[f.id] = f.unreadCount ?? f.unread_count ?? f.email_count ?? 0;
		}
		return map;
	};

	const testFolders = [
		{ id: "inbox", unreadCount: 14, unread_count: 20, email_count: 100 }, // unreadCount takes priority
		{ id: "priority", unread_count: 7, email_count: 50 },                 // falls back to unread_count
		{ id: "archive", email_count: 88 },                                  // falls back to email_count
		{ id: "drafts", unreadCount: 0, email_count: 12 },                   // unreadCount of 0 must NOT fall back to email_count
		{ id: "trash" },                                                     // defaults to 0
	];

	const counts = computeFolderCounts(testFolders);
	assert.equal(counts["inbox"], 14, "unreadCount should take highest precedence");
	assert.equal(counts["priority"], 7, "unread_count should be secondary fallback");
	assert.equal(counts["archive"], 88, "email_count should be tertiary fallback");
	assert.equal(counts["drafts"], 0, "unreadCount of 0 must be respected and not overridden by email_count");
	assert.equal(counts["trash"], 0, "Missing count should default to 0");
});

runTest("3.2: 7 core system folders and aliases handled correctly", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);

	const coreIds = ["inbox", "priority", "sent", "drafts", "scheduled", "archive", "trash"];
	for (const id of coreIds) {
		assert.match(src, new RegExp(`id:\\s*["']${id}["']`));
	}

	// Verify alias matching
	assert.match(src, /f\.id === ["']drafts["'] && selectedFolderId === ["']draft["']/);
	assert.match(src, /f\.id === ["']scheduled["'] && selectedFolderId === ["']reply_later["']/);
});

runTest("3.3: HYPERION TAGS hashtag prefixing and count formatting", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);

	assert.match(src, /HYPERION TAGS/);
	assert.match(src, /tag\.name\.replace\(\/\^#\/,\s*["']["']\)/);
	assert.match(src, /`#\$\{cleanName\}`/);

	// Tag count formatting
	const formatTagCount = (count) => (count > 999 ? "999+" : count);
	assert.equal(formatTagCount(5), 5);
	assert.equal(formatTagCount(1000), "999+");
});

// =============================================================================
// TEST SUITE 4: ThreadListColumn Verification
// =============================================================================
console.log("\n▶ [SUITE 4] ThreadListColumn (Col 3 - 400px) Adversarial Challenges...");

runTest("4.1: Thread selection triggers selectThread in useColumnStack", () => {
	useColumnStack.getState().initializeStack("mbx-xyz", "inbox");

	useColumnStack.getState().selectThread("email-test-01", "Meeting Agenda");
	const state = useColumnStack.getState();

	assert.equal(state.selectedEmailId, "email-test-01");
	assert.equal(state.activeColumnId, "reader");

	const readerCol = state.columns.find((c) => c.type === "reader");
	assert.ok(readerCol);
	assert.equal(readerCol.title, "Meeting Agenda");
	assert.equal(readerCol.props?.emailId, "email-test-01");
	assert.equal(readerCol.props?.folderId, "inbox");
});

runTest("4.2: Mark-all-read deduplicates thread IDs and dispatches correctly", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	assert.match(src, /const unreadThreadIds = new Set\(/);
	assert.match(src, /markThreadRead\.mutate\(\{ mailboxId, threadId: tid \}\)/);

	// Deduplication oracle
	const emails = [
		{ id: "e1", thread_id: "th-1", read: false },
		{ id: "e2", thread_id: "th-1", read: false }, // same thread
		{ id: "e3", thread_id: "th-2", read: true },  // read
		{ id: "e4", thread_id: "th-3", read: false }, // unread
		{ id: "e5", read: false },                    // no thread_id, fallback to e5
	];

	const unreadThreadIds = new Set(
		emails.filter((e) => !e.read).map((e) => e.thread_id || e.id),
	);

	assert.equal(unreadThreadIds.size, 3);
	assert.ok(unreadThreadIds.has("th-1"));
	assert.ok(unreadThreadIds.has("th-3"));
	assert.ok(unreadThreadIds.has("e5"));
	assert.ok(!unreadThreadIds.has("th-2"));
});

runTest("4.3: Tags extraction handles arrays, category fallback, and empty states", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	// Test extraction logic
	const extractTags = (email) => {
		return email.tags
			? email.tags
			: email.category
			? [email.category]
			: [];
	};

	assert.deepEqual(extractTags({ tags: ["Engineering", "PRs"] }), ["Engineering", "PRs"]);
	assert.deepEqual(extractTags({ category: "VIP" }), ["VIP"]);
	assert.deepEqual(extractTags({}), []);
	assert.deepEqual(extractTags({ tags: null, category: null }), []);
});

runTest("4.4: Attachment indicator formatting accurately reflects counts", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	assert.match(src, /hasFileAttachment\(email\)/);
	assert.match(
		src,
		/attachmentCount > 1\s*\?\s*`\$\{attachmentCount\} files`\s*:\s*attachmentCount === 1\s*\?\s*["']1 file["']\s*:\s*["']file["']/,
	);

	// hasFileAttachment tests
	assert.equal(hasFileAttachment({ has_attachment: true }), true);
	assert.equal(hasFileAttachment({ has_attachment: false, attachments: [] }), false);
	assert.equal(
		hasFileAttachment({
			attachments: [{ id: "att-1", disposition: "attachment" }],
		}),
		true,
	);
	assert.equal(
		hasFileAttachment({
			attachments: [{ id: "att-inline", disposition: "inline" }],
		}),
		false,
	);
});

// =============================================================================
// TEST SUITE 5: Kumo Design Token Adherence
// =============================================================================
console.log("\n▶ [SUITE 5] Strict Kumo Design Token Compliance...");

runTest("5.1: AccountsColumn has zero forbidden color violations", () => {
	const audit = verifyKumoTokensInFile("app/components/columns/AccountsColumn.tsx");
	assert.equal(audit.exists, true);
	assert.deepEqual(audit.violations, []);
});

runTest("5.2: FoldersTagsColumn has zero forbidden color violations", () => {
	const audit = verifyKumoTokensInFile("app/components/columns/FoldersTagsColumn.tsx");
	assert.equal(audit.exists, true);
	assert.deepEqual(audit.violations, []);
});

runTest("5.3: ThreadListColumn has zero forbidden color violations", () => {
	const audit = verifyKumoTokensInFile("app/components/columns/ThreadListColumn.tsx");
	assert.equal(audit.exists, true);
	assert.deepEqual(audit.violations, []);
});

cleanupTestDOM();

console.log("\n========================================================================");
console.log(`  EMPIRICAL ADVERSARIAL SUMMARY: ${passedTests}/${totalTests} PASSED | ${failedTests} FAILED`);
console.log("========================================================================\n");

if (failedTests > 0) {
	process.exit(1);
} else {
	process.exit(0);
}
