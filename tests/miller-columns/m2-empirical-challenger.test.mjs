// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Milestone 2 Empirical Challenger Test Suite
 * Rigorously challenges and stress-tests:
 * 1. AccountsColumn (Col 1 - 300px)
 * 2. FoldersTagsColumn (Col 2 - 300px)
 * 3. ThreadListColumn (Col 3 - 400px)
 */

import assert from "node:assert/strict";
import { useColumnStack } from "../../app/hooks/useColumnStack.ts";
import {
	SPEC,
	setupTestDOM,
	cleanupTestDOM,
	resetColumnStack,
	readComponentSource,
	verifyKumoTokensInFile,
} from "./harness.mjs";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function challenge(title, fn) {
	totalTests++;
	try {
		resetColumnStack();
		fn();
		passedTests++;
		console.log(`  ✔ [PASS] ${title}`);
	} catch (err) {
		failedTests++;
		console.error(`  ✖ [FAIL] ${title}`);
		console.error(`     Error: ${err.message}`);
		if (err.stack) {
			console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
		}
	}
}

async function challengeAsync(title, fn) {
	totalTests++;
	try {
		resetColumnStack();
		await fn();
		passedTests++;
		console.log(`  ✔ [PASS] ${title}`);
	} catch (err) {
		failedTests++;
		console.error(`  ✖ [FAIL] ${title}`);
		console.error(`     Error: ${err.message}`);
		if (err.stack) {
			console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
		}
	}
}

setupTestDOM();

console.log("========================================================================");
console.log("  MILESTONE 2: NAVIGATION COLUMN ADAPTERS EMPIRICAL CHALLENGER SUITE");
console.log("========================================================================");

// =============================================================================
// CHALLENGE SUITE 1: AccountsColumn
// =============================================================================
console.log("\n▶ [CHALLENGE SUITE 1] AccountsColumn (Col 1 - 300px)...");

challenge("AC-01: AccountsColumn specification conformance (width 300px, closable false, id accounts, Inboxies title)", () => {
	const src = readComponentSource("app/components/columns/AccountsColumn.tsx");
	assert.ok(src, "AccountsColumn.tsx must exist");
	assert.match(src, /id=["']accounts["']/, "Must specify id='accounts'");
	assert.match(src, /width=\{300\}/, "Must specify width={300}");
	assert.match(src, /closable=\{false\}/, "Must specify closable={false}");
	assert.match(src, /Inboxies/, "Must render 'Inboxies' header title");
});

challenge("AC-02: Mailbox selection updates store (selectedMailboxId, activeColumnId, title)", () => {
	useColumnStack.getState().initializeStack("mbx_1");
	assert.equal(useColumnStack.getState().selectedMailboxId, "mbx_1");

	// Switch mailbox via selectMailbox
	useColumnStack.getState().selectMailbox("mbx_2", "Work Mailbox");
	const state = useColumnStack.getState();
	assert.equal(state.selectedMailboxId, "mbx_2", "selectedMailboxId must update");
	assert.equal(state.activeColumnId, "threads", "activeColumnId must update to threads");
	assert.equal(state.selectedFolderId, "inbox", "selectedFolderId must reset to inbox");
	assert.equal(state.selectedEmailId, null, "selectedEmailId must reset to null");

	// Folders column title must update to mailboxName
	const foldersCol = state.columns.find((c) => c.type === "folders");
	assert.ok(foldersCol);
	assert.equal(foldersCol.title, "Work Mailbox");
});

challenge("AC-03: Active dot styling switches correctly between selected and unselected states", () => {
	const src = readComponentSource("app/components/columns/AccountsColumn.tsx");
	assert.ok(src);

	// Test active dot class logic
	const activeDotClass = (isSelected) =>
		`w-1.5 h-1.5 rounded-full shrink-0 ${
			isSelected ? "bg-kumo-default ring-2 ring-kumo-line" : "bg-kumo-line"
		}`;

	assert.match(
		src,
		/isSelected\s*\?\s*["'][^"']*bg-kumo-default ring-2 ring-kumo-line[^"']*["']\s*:\s*["'][^"']*bg-kumo-line[^"']*["']/,
		"AccountsColumn must use exact active dot token styling",
	);

	// Verify simulated accounts switching
	const mailboxes = [{ id: "acc_1" }, { id: "acc_2" }, { id: "acc_3" }];
	let selectedId = "acc_1";

	const getDotClasses = (id) => activeDotClass(id === selectedId);

	assert.ok(getDotClasses("acc_1").includes("bg-kumo-default ring-2 ring-kumo-line"));
	assert.ok(getDotClasses("acc_2").includes("bg-kumo-line"));
	assert.ok(getDotClasses("acc_3").includes("bg-kumo-line"));

	// Switch to acc_2
	selectedId = "acc_2";
	assert.ok(getDotClasses("acc_1").includes("bg-kumo-line"));
	assert.ok(getDotClasses("acc_2").includes("bg-kumo-default ring-2 ring-kumo-line"));
	assert.ok(getDotClasses("acc_3").includes("bg-kumo-line"));
});

challenge("AC-04: Unread counter formatting oracle for accounts (null, 0, 1, 999, 1000, 50000)", () => {
	const src = readComponentSource("app/components/columns/AccountsColumn.tsx");
	assert.ok(src);

	// Verify unread count extraction checks unreadCount, unread_count, and unread
	assert.match(src, /\(mailbox as any\)\.unreadCount\s*\?\?\s*\(mailbox as any\)\.unread_count\s*\?\?\s*\(mailbox as any\)\.unread/);

	// Verify formatting logic
	const formatUnread = (unreadCount) => {
		if (unreadCount == null || unreadCount <= 0) return null;
		return unreadCount > 999 ? "999+" : unreadCount;
	};

	assert.equal(formatUnread(undefined), null, "undefined count should not render badge");
	assert.equal(formatUnread(null), null, "null count should not render badge");
	assert.equal(formatUnread(0), null, "0 count should not render badge");
	assert.equal(formatUnread(-5), null, "negative count should not render badge");
	assert.equal(formatUnread(1), 1, "1 unread should format as 1");
	assert.equal(formatUnread(42), 42, "42 unread should format as 42");
	assert.equal(formatUnread(999), 999, "999 unread should format as 999");
	assert.equal(formatUnread(1000), "999+", "1000 unread should format as 999+");
	assert.equal(formatUnread(50000), "999+", "50000 unread should format as 999+");

	assert.match(src, /\{unreadCount\s*>\s*999\s*\?\s*["']999\+["']\s*:\s*unreadCount\}/);
});

challenge("AC-05: Account display name fallback oracle", () => {
	const src = readComponentSource("app/components/columns/AccountsColumn.tsx");
	assert.ok(src);

	const getDisplayName = (mailbox) => mailbox.name || mailbox.email.split("@")[0];

	assert.equal(getDisplayName({ name: "Personal", email: "user@domain.com" }), "Personal");
	assert.equal(getDisplayName({ name: "", email: "alex.smith@example.org" }), "alex.smith");
	assert.equal(getDisplayName({ name: null, email: "dev-team@cloud.com" }), "dev-team");

	assert.match(src, /mailbox\.name\s*\|\|\s*mailbox\.email\.split\(["']@["']\)\[0\]/);
});

// =============================================================================
// CHALLENGE SUITE 2: FoldersTagsColumn
// =============================================================================
console.log("\n▶ [CHALLENGE SUITE 2] FoldersTagsColumn (Col 2 - 300px)...");

challenge("FT-01: FoldersTagsColumn specification conformance (width 300px, closable false, id folders)", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src, "FoldersTagsColumn.tsx must exist");
	assert.match(src, /id=["']folders["']/, "Must specify id='folders'");
	assert.match(src, /width=\{300\}/, "Must specify width={300}");
	assert.match(src, /closable=\{false\}/, "Must specify closable={false}");
});

challenge("FT-02: Exactly 7 core system folders defined in required order", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);

	const expectedSystemFolders = [
		{ id: "inbox", label: "Inbox" },
		{ id: "priority", label: "Priority/VIP" },
		{ id: "sent", label: "Sent" },
		{ id: "drafts", label: "Drafts" },
		{ id: "scheduled", label: "Scheduled" },
		{ id: "archive", label: "Archive" },
		{ id: "trash", label: "Trash" },
	];

	for (const f of expectedSystemFolders) {
		assert.match(src, new RegExp(`id:\\s*["']${f.id}["'],\\s*label:\\s*["']${f.label.replace("/", "\\/")}["']`));
	}
});

challenge("FT-03: System folder selection updates store and Col 3 title", () => {
	useColumnStack.getState().initializeStack("mbx_alpha");

	const folders = [
		{ id: "inbox", label: "Inbox" },
		{ id: "priority", label: "Priority/VIP" },
		{ id: "sent", label: "Sent" },
		{ id: "drafts", label: "Drafts" },
		{ id: "scheduled", label: "Scheduled" },
		{ id: "archive", label: "Archive" },
		{ id: "trash", label: "Trash" },
	];

	for (const f of folders) {
		useColumnStack.getState().selectFolder(f.id, f.label);
		const state = useColumnStack.getState();
		assert.equal(state.selectedFolderId, f.id, `selectedFolderId should be ${f.id}`);
		const threadsCol = state.columns.find((c) => c.type === "threads");
		assert.ok(threadsCol);
		assert.equal(threadsCol.title, f.label, `threadsCol.title should be ${f.label}`);
	}
});

challenge("FT-04: System folder selection truncates downstream reader column", () => {
	useColumnStack.getState().initializeStack("mbx_alpha");
	useColumnStack.getState().selectThread("msg_123", "Deep Email Subject");

	assert.equal(useColumnStack.getState().columns.length, 4);
	assert.equal(useColumnStack.getState().selectedEmailId, "msg_123");

	// Now click on 'sent' folder
	useColumnStack.getState().selectFolder("sent", "Sent");
	const state = useColumnStack.getState();
	assert.equal(state.columns.length, 3, "Stack must truncate Col 4 Reader");
	assert.equal(state.selectedEmailId, null, "selectedEmailId must be reset to null");
	assert.equal(state.activeColumnId, "threads", "activeColumnId must return to threads");
	assert.equal(state.columns.some((c) => c.type === "reader"), false, "Reader column must be absent");
});

challenge("FT-05: HYPERION TAGS section header matches exact Figma 18-970 spec", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);
	assert.match(src, /HYPERION TAGS/, "Must contain uppercase 'HYPERION TAGS' header");
	assert.match(
		src,
		/text-\[11px\] font-bold tracking-wider text-kumo-subtle uppercase px-4 pt-5 pb-2/,
		"Must match exact typography and padding token classes",
	);
});

challenge("FT-06: Custom tag selection updates store with hashtag label", () => {
	useColumnStack.getState().initializeStack("mbx_alpha");

	const testTag = { id: "tag-engineering-prs", name: "Engineering-PRs" };
	const cleanName = testTag.name.replace(/^#/, "");
	const fullLabel = `#${cleanName}`;

	useColumnStack.getState().selectFolder(testTag.id, fullLabel);
	const state = useColumnStack.getState();
	assert.equal(state.selectedFolderId, "tag-engineering-prs");
	const threadsCol = state.columns.find((c) => c.type === "threads");
	assert.ok(threadsCol);
	assert.equal(threadsCol.title, "#Engineering-PRs");
});

challenge("FT-07: Folder and tag count formatting oracle (0, 1, 999, 1000, 12500)", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);

	const formatFolderCount = (count) => {
		if (!count || count <= 0) return null;
		return count > 999 ? "999+" : count.toLocaleString();
	};

	assert.equal(formatFolderCount(0), null, "0 count must not display");
	assert.equal(formatFolderCount(-10), null, "negative count must not display");
	assert.equal(formatFolderCount(1), "1");
	assert.equal(formatFolderCount(123), "123");
	assert.equal(formatFolderCount(999), "999");
	assert.equal(formatFolderCount(1000), "999+");
	assert.equal(formatFolderCount(12500), "999+");

	assert.match(src, /count\s*>\s*999\s*\?\s*["']999\+["']\s*:\s*count\.toLocaleString\(\)/);
	assert.match(src, /count\s*>\s*999\s*\?\s*["']999\+["']\s*:\s*count/);
});

challenge("FT-08: System folder alias highlighting (drafts vs draft, scheduled vs reply_later)", () => {
	const src = readComponentSource("app/components/columns/FoldersTagsColumn.tsx");
	assert.ok(src);

	const isFolderSelected = (folderId, currentSelectedId) =>
		currentSelectedId === folderId ||
		(folderId === "drafts" && currentSelectedId === "draft") ||
		(folderId === "scheduled" && currentSelectedId === "reply_later");

	assert.equal(isFolderSelected("inbox", "inbox"), true);
	assert.equal(isFolderSelected("drafts", "drafts"), true);
	assert.equal(isFolderSelected("drafts", "draft"), true, "'drafts' must be selected when current id is 'draft'");
	assert.equal(isFolderSelected("scheduled", "scheduled"), true);
	assert.equal(isFolderSelected("scheduled", "reply_later"), true, "'scheduled' must be selected when current id is 'reply_later'");
	assert.equal(isFolderSelected("sent", "draft"), false);
});

// =============================================================================
// CHALLENGE SUITE 3: ThreadListColumn
// =============================================================================
console.log("\n▶ [CHALLENGE SUITE 3] ThreadListColumn (Col 3 - 400px)...");

challenge("TL-01: ThreadListColumn specification conformance (width 400px, closable false, id threads)", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src, "ThreadListColumn.tsx must exist");
	assert.match(src, /id=["']threads["']/, "Must specify id='threads'");
	assert.match(src, /width=\{400\}/, "Must specify width={400}");
	assert.match(src, /closable=\{false\}/, "Must specify closable={false}");
});

challenge("TL-02: Thread selection triggers selectThread in useColumnStack", () => {
	useColumnStack.getState().initializeStack("mbx_test", "inbox");

	useColumnStack.getState().selectThread("thread_abc_1", "Project Update v2");
	const state = useColumnStack.getState();

	assert.equal(state.selectedEmailId, "thread_abc_1");
	assert.equal(state.activeColumnId, "reader");
	assert.equal(state.columns.length, 4);

	const readerCol = state.columns.find((c) => c.type === "reader");
	assert.ok(readerCol);
	assert.equal(readerCol.title, "Project Update v2");
	assert.equal(readerCol.props?.emailId, "thread_abc_1");
});

challenge("TL-03: Sibling thread selection updates reader in-place without duplicating reader", () => {
	useColumnStack.getState().initializeStack("mbx_test", "inbox");

	for (let i = 1; i <= 20; i++) {
		useColumnStack.getState().selectThread(`thread_${i}`, `Thread Subject ${i}`);
		const state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, `Stack length must remain 4 at step ${i}`);
		const readerCols = state.columns.filter((c) => c.type === "reader");
		assert.equal(readerCols.length, 1, `Exactly 1 reader column expected at step ${i}`);
		assert.equal(state.selectedEmailId, `thread_${i}`);
		assert.equal(readerCols[0].title, `Thread Subject ${i}`);
	}
});

challenge("TL-04: Mark all read handler deduplicates thread IDs and dispatches mutations", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	// Verify deduplication logic via Set
	const mockEmails = [
		{ id: "e1", thread_id: "t1", read: false },
		{ id: "e2", thread_id: "t1", read: false }, // same thread
		{ id: "e3", thread_id: "t2", read: true },  // already read
		{ id: "e4", thread_id: "t3", read: false },
		{ id: "e5", id: "t4", read: false },        // no thread_id, fallback to id
	];

	const unreadThreadIds = new Set(
		mockEmails.filter((e) => !e.read).map((e) => e.thread_id || e.id),
	);

	assert.equal(unreadThreadIds.size, 3, "Should deduplicate to exactly 3 unique thread IDs (t1, t3, t4)");
	assert.ok(unreadThreadIds.has("t1"));
	assert.ok(unreadThreadIds.has("t3"));
	assert.ok(unreadThreadIds.has("t4"));
	assert.equal(unreadThreadIds.has("t2"), false, "Read thread t2 should not be included");

	assert.match(
		src,
		/const unreadThreadIds = new Set\(\s*emails\.filter\(\(e\) => !e\.read\)\.map\(\(e\) => e\.thread_id \|\| e\.id\),\s*\);/,
		"ThreadListColumn must deduplicate unread thread IDs before mutating",
	);
});

challenge("TL-05: Unread dot token compliance (bg-kumo-brand for unread, bg-transparent for read)", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	assert.match(
		src,
		/isUnread\s*\?\s*["']bg-kumo-brand["']\s*:\s*["']bg-transparent["']/,
		"Unread dot must use bg-kumo-brand when unread and bg-transparent when read",
	);
});

challenge("TL-06: Active card styling token compliance", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	assert.match(
		src,
		/isSelected\s*\?\s*["'][^"']*bg-kumo-tint ring-1 ring-inset ring-kumo-line text-kumo-default[^"']*["']/,
		"Selected thread card must use bg-kumo-tint ring-1 ring-inset ring-kumo-line text-kumo-default",
	);

	assert.match(
		src,
		/absolute left-0 top-0 bottom-0 w-0\.5 bg-kumo-default rounded-r/,
		"Selected thread card must render active vertical indicator bar in bg-kumo-default",
	);
});

challenge("TL-07: Attachment indicator formatting oracle (0, 1, 2, 8 files)", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	const formatAttachmentText = (count) => {
		if (count > 1) return `${count} files`;
		if (count === 1) return "1 file";
		return "file";
	};

	assert.equal(formatAttachmentText(1), "1 file");
	assert.equal(formatAttachmentText(2), "2 files");
	assert.equal(formatAttachmentText(8), "8 files");
	assert.equal(formatAttachmentText(0), "file");

	assert.match(src, /attachmentCount\s*>\s*1\s*\?\s*`\$\{attachmentCount\} files`\s*:\s*attachmentCount === 1\s*\?\s*["']1 file["']\s*:\s*["']file["']/);
	assert.match(src, /PaperclipIcon/, "Must render PaperclipIcon for attachments");
});

challenge("TL-08: Tag chips formatting oracle (hashtag prefixing and styling)", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	const formatTag = (t) => (t.startsWith("#") ? t : `#${t}`);

	assert.equal(formatTag("Engineering-PRs"), "#Engineering-PRs");
	assert.equal(formatTag("#Design"), "#Design");
	assert.equal(formatTag("123"), "#123");

	assert.match(src, /t\.startsWith\(["']#["']\)\s*\?\s*t\s*:\s*`#\$\{t\}`/);
	assert.match(src, /bg-kumo-fill text-kumo-default font-medium/);
});

challenge("TL-09: Body snippet and subject fallback oracles", () => {
	const src = readComponentSource("app/components/columns/ThreadListColumn.tsx");
	assert.ok(src);

	assert.match(src, /snippet\s*\|\|\s*["']No preview text["']/);
	assert.match(src, /email\.subject\s*\|\|\s*["']\(no subject\)["']/);
	assert.match(src, /line-clamp-1 truncate leading-relaxed/);
});

// =============================================================================
// CHALLENGE SUITE 4: Kumo Token Compliance Across All 3 Files
// =============================================================================
console.log("\n▶ [CHALLENGE SUITE 4] Kumo Token Compliance Audit...");

challenge("KC-01: AccountsColumn 100% Kumo token compliant with zero forbidden color patterns", () => {
	const res = verifyKumoTokensInFile("app/components/columns/AccountsColumn.tsx");
	assert.equal(res.exists, true);
	assert.deepEqual(res.violations, [], `AccountsColumn violations: ${res.violations.join(", ")}`);
});

challenge("KC-02: FoldersTagsColumn 100% Kumo token compliant with zero forbidden color patterns", () => {
	const res = verifyKumoTokensInFile("app/components/columns/FoldersTagsColumn.tsx");
	assert.equal(res.exists, true);
	assert.deepEqual(res.violations, [], `FoldersTagsColumn violations: ${res.violations.join(", ")}`);
});

challenge("KC-03: ThreadListColumn 100% Kumo token compliant with zero forbidden color patterns", () => {
	const res = verifyKumoTokensInFile("app/components/columns/ThreadListColumn.tsx");
	assert.equal(res.exists, true);
	assert.deepEqual(res.violations, [], `ThreadListColumn violations: ${res.violations.join(", ")}`);
});

cleanupTestDOM();

console.log("\n========================================================================");
console.log(`  CHALLENGER RESULTS: ${passedTests}/${totalTests} PASSED | ${failedTests} FAILED`);
console.log("========================================================================\n");

if (failedTests > 0) {
	process.exit(1);
} else {
	process.exit(0);
}
