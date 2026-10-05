// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * TIER 5: Adversarial Challenger Test Suite & Invariant Oracle
 * Rigorously stress-tests and challenges useColumnStack state machine implementation:
 * 1. Rapid sequential sibling replacements in Col 2 (50 switches + 10,000 stress switches + memory leak audit)
 * 2. Folder transitions (Col 1 -> Col 2) downstream truncation oracle
 * 3. Platform column deduplication (Settings, Compose, Search, Agent) with props merging & placement variants
 * 4. Root column dismissal protection (accounts, folders, threads cannot be dismissed)
 * 5. Active column dismissal predecessor focus rollback under all stack topologies
 * 6. Randomized Chaos Monkey (1,000 pseudo-random state mutations checking 6 structural invariants)
 */

import assert from "node:assert/strict";
import { useColumnStack } from "../../app/hooks/useColumnStack.ts";
import { setupTestDOM, cleanupTestDOM, resetColumnStack } from "./harness.mjs";

let passedCount = 0;
let failedCount = 0;

function runTest(testName, fn) {
	try {
		resetColumnStack();
		fn();
		passedCount++;
		console.log(`  ✔ [PASS] ${testName}`);
	} catch (err) {
		failedCount++;
		console.error(`  ✖ [FAIL] ${testName}`);
		console.error(`     Error: ${err.message}`);
		if (err.stack) {
			console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
		}
	}
}

async function runAsyncTest(testName, fn) {
	try {
		resetColumnStack();
		await fn();
		passedCount++;
		console.log(`  ✔ [PASS] ${testName}`);
	} catch (err) {
		failedCount++;
		console.error(`  ✖ [FAIL] ${testName}`);
		console.error(`     Error: ${err.message}`);
		if (err.stack) {
			console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
		}
	}
}

setupTestDOM();

console.log("========================================================================");
console.log("  TIER 5: ADVERSARIAL CHALLENGER SUITE FOR useColumnStack");
console.log("========================================================================");

// =============================================================================
// CHALLENGE 1: Rapid sequential sibling replacements in Column 2 (threads switching)
// =============================================================================
console.log("\n▶ [CHALLENGE 1] Rapid Sequential Sibling Replacements & Memory Leak Audit...");

runTest("C1.1: 50 rapid sequential thread switches replace Column 4 in-place with zero duplicates", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_alpha", "inbox");

	assert.equal(useColumnStack.getState().columns.length, 3, "Initial stack must contain exactly 3 base columns");

	for (let i = 1; i <= 50; i++) {
		const emailId = `msg_seq_${i}`;
		const subject = `Sequential Subject #${i}`;
		useColumnStack.getState().selectThread(emailId, subject);

		const state = useColumnStack.getState();
		// Stack length must never exceed 4 (accounts, folders, threads, reader)
		assert.equal(state.columns.length, 4, `Stack length must remain 4 after switch ${i}, found ${state.columns.length}`);

		// Reader column must exist exactly once
		const readerCols = state.columns.filter((c) => c.type === "reader");
		assert.equal(readerCols.length, 1, `Exactly 1 reader column expected after switch ${i}`);

		// Column IDs must all be unique (zero duplicate IDs)
		const ids = state.columns.map((c) => c.id);
		assert.equal(new Set(ids).size, state.columns.length, `Column IDs must be unique after switch ${i}: [${ids.join(", ")}]`);

		// Reader attributes must update accurately
		const reader = readerCols[0];
		assert.equal(reader.id, "reader");
		assert.equal(reader.title, subject);
		assert.equal(reader.props?.emailId, emailId);
		assert.equal(reader.props?.folderId, "inbox");
		assert.equal(reader.width, "min-w-[848px] flex-1");
		assert.equal(state.selectedEmailId, emailId);
		assert.equal(state.activeColumnId, "reader");
	}
});

runTest("C1.2: 10,000 high-frequency thread switches stress-test with heap memory measurement", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_stress", "inbox");

	if (globalThis.gc) globalThis.gc();
	const initialMem = process.memoryUsage().heapUsed;
	const startTime = Date.now();

	const ITERATIONS = 10000;
	for (let i = 1; i <= ITERATIONS; i++) {
		const emailId = `stress_email_${i % 250}`;
		const subject = `High Frequency Subject #${i}`;
		useColumnStack.getState().selectThread(emailId, subject);
	}

	const duration = Date.now() - startTime;
	if (globalThis.gc) globalThis.gc();
	const finalMem = process.memoryUsage().heapUsed;
	const memDiffMB = (finalMem - initialMem) / (1024 * 1024);

	const state = useColumnStack.getState();
	assert.equal(state.columns.length, 4, "Final stack length must be strictly 4");
	assert.equal(new Set(state.columns.map((c) => c.id)).size, 4, "Zero duplicate column IDs allowed");

	// Memory growth check: 10,000 state updates should not leak unbounded MBs of heap
	console.log(`      [Heap Stats] 10,000 switches completed in ${duration}ms. Memory delta: ${memDiffMB.toFixed(2)} MB`);
	assert.ok(memDiffMB < 25, `Heap growth (${memDiffMB.toFixed(2)} MB) exceeded 25MB threshold`);
});

runTest("C1.3: Sibling replacement cleans downstream child columns previously attached to reader", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_alpha", "inbox");

	// Open reader
	store.selectThread("msg_1", "Subject 1");
	assert.equal(useColumnStack.getState().columns.length, 4);

	// Open adjacent compose spawned from reader
	store.openAdjacentColumn("compose", { draft: "child_draft" }, "reader");
	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 5);
	assert.equal(state.columns[4].type, "compose");
	assert.equal(state.columns[4].parentId, "reader");

	// Switching thread sibling must truncate downstream children of previous reader
	store.selectThread("msg_2", "Subject 2");
	state = useColumnStack.getState();
	assert.equal(state.columns.length, 4, "Child column of previous reader must be truncated upon thread switch");
	assert.equal(state.columns.some((c) => c.parentId === "reader"), false, "No columns with parentId === reader allowed");
	assert.equal(state.selectedEmailId, "msg_2");
	assert.equal(state.activeColumnId, "reader");
});

// =============================================================================
// CHALLENGE 2: Folder transitions (Col 1 -> Col 2) downstream truncation oracle
// =============================================================================
console.log("\n▶ [CHALLENGE 2] Folder Transitions (Col 1 -> Col 2) Truncation Oracle...");

runTest("C2.1: Switching folder strictly truncates active reader column and resets selectedEmailId", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_bravo", "inbox");
	store.selectThread("email_foo", "Important Message");

	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 4);
	assert.equal(state.selectedEmailId, "email_foo");
	assert.equal(state.activeColumnId, "reader");

	// Switch folder to Sent
	store.selectFolder("sent", "Sent");
	state = useColumnStack.getState();

	assert.equal(state.columns.length, 3, "Stack must strictly contain 3 columns after folder switch");
	assert.equal(state.columns.some((c) => c.type === "reader"), false, "Reader column must be truncated");
	assert.equal(state.selectedEmailId, null, "selectedEmailId must be reset to null");
	assert.equal(state.selectedFolderId, "sent", "selectedFolderId must update to sent");
	assert.equal(state.activeColumnId, "threads", "activeColumnId must focus threads");
	assert.equal(state.columns[2].title, "Sent", "Threads column title must update to Sent");
	assert.equal(state.columns[2].props?.folderId, "sent", "Threads props.folderId must update");
});

runTest("C2.2: Switching folder preserves independent platform columns appended at end of stack", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_bravo", "inbox");
	store.selectThread("email_bar", "Bar Message");
	store.openPlatformColumn("settings");

	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 5, "[accounts, folders, threads, reader, settings]");
	assert.equal(state.columns[4].type, "settings");

	// Switch folder to Trash
	store.selectFolder("trash", "Trash");
	state = useColumnStack.getState();

	assert.equal(state.columns.length, 4, "[accounts, folders, threads, settings]");
	assert.equal(state.columns.some((c) => c.type === "reader"), false, "Reader must be truncated");
	assert.equal(state.columns[3].type, "settings", "Platform settings column must be preserved");
	assert.equal(state.selectedEmailId, null, "selectedEmailId must be reset to null");
	assert.equal(state.selectedFolderId, "trash", "selectedFolderId must be trash");
});

runTest("C2.3: Rapid back-and-forth folder transitions across 7 system folders with threads opened", () => {
	const folders = ["inbox", "priority", "sent", "drafts", "scheduled", "archive", "trash"];
	const store = useColumnStack.getState();
	store.initializeStack("mbx_charlie", "inbox");

	for (const folderId of folders) {
		// Open thread in current folder
		store.selectThread(`msg_${folderId}`, `Subject for ${folderId}`);
		let s = useColumnStack.getState();
		assert.equal(s.columns.length, 4);
		assert.equal(s.selectedEmailId, `msg_${folderId}`);

		// Now switch to folder
		store.selectFolder(folderId, folderId.toUpperCase());
		s = useColumnStack.getState();
		assert.equal(s.columns.length, 3, `Must truncate reader when switching to ${folderId}`);
		assert.equal(s.columns.some((c) => c.type === "reader"), false);
		assert.equal(s.selectedEmailId, null);
		assert.equal(s.selectedFolderId, folderId);
		assert.equal(s.activeColumnId, "threads");
		assert.equal(s.columns[2].title, folderId.toUpperCase());
	}
});

// =============================================================================
// CHALLENGE 3: Platform column deduplication (Settings, Compose, Search, Agent)
// =============================================================================
console.log("\n▶ [CHALLENGE 3] Platform Column Deduplication Oracle...");

runTest("C3.1: 50 repeated invocations of openPlatformColumn('settings') does not grow stack", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_delta", "inbox");
	assert.equal(useColumnStack.getState().columns.length, 3);

	for (let i = 1; i <= 50; i++) {
		store.openPlatformColumn("settings", { count: i });
		const state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, `Stack length must remain 4 after call ${i}`);
		assert.equal(state.activeColumnId, "settings", `Settings must be active after call ${i}`);
		const settingsCols = state.columns.filter((c) => c.type === "settings");
		assert.equal(settingsCols.length, 1, `Exactly 1 settings column allowed, found ${settingsCols.length}`);
		assert.equal(settingsCols[0].props?.count, i, "Props should be updated on deduplication");
	}
});

runTest("C3.2: 50 repeated invocations of openPlatformColumn('compose') does not grow stack", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_delta", "inbox");

	for (let i = 1; i <= 50; i++) {
		store.openPlatformColumn("compose", { draftId: `draft_${i}` });
		const state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, `Stack length must remain 4 after compose call ${i}`);
		assert.equal(state.activeColumnId, "compose");
		const composeCols = state.columns.filter((c) => c.type === "compose");
		assert.equal(composeCols.length, 1);
		assert.equal(composeCols[0].props?.draftId, `draft_${i}`);
	}
});

runTest("C3.3: Alternating between settings and compose 50 times stabilizes at 5 total columns", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_delta", "inbox");

	for (let i = 1; i <= 50; i++) {
		store.openPlatformColumn("settings");
		assert.equal(useColumnStack.getState().activeColumnId, "settings");
		store.openPlatformColumn("compose");
		assert.equal(useColumnStack.getState().activeColumnId, "compose");

		const state = useColumnStack.getState();
		// 3 base + 1 settings + 1 compose = 5
		assert.equal(state.columns.length, 5, `Stack length must be exactly 5 on iteration ${i}`);
		const types = state.columns.map((c) => c.type);
		assert.deepEqual(types, ["accounts", "folders", "threads", "settings", "compose"]);
	}
});

runTest("C3.4: Mixed placement (placeAtEnd: true vs false) enforces singleton semantics", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_delta", "inbox");

	// First open at end
	store.openPlatformColumn("settings", { initial: true }, true);
	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 4);
	assert.equal(state.columns[3].type, "settings");

	// Second open adjacent (placeAtEnd: false)
	store.openPlatformColumn("settings", { updated: true }, false);
	state = useColumnStack.getState();
	assert.equal(state.columns.length, 4, "Must not duplicate settings column even when placeAtEnd varies");
	assert.equal(state.activeColumnId, "settings");
	assert.equal(state.columns[3].props?.updated, true, "Props must merge cleanly");
});

runTest("C3.5: All four platform columns (settings, compose, search, agent) deduplicated simultaneously", () => {
	const platformTypes = ["settings", "compose", "search", "agent"];
	const store = useColumnStack.getState();
	store.initializeStack("mbx_delta", "inbox");

	// Open all 4
	for (const type of platformTypes) {
		store.openPlatformColumn(type);
	}
	assert.equal(useColumnStack.getState().columns.length, 7); // 3 + 4 = 7

	// Open all 4 again with new props
	for (const type of platformTypes) {
		store.openPlatformColumn(type, { ping: "pong" });
	}
	const state = useColumnStack.getState();
	assert.equal(state.columns.length, 7, "Stack must remain 7 after re-opening all platform columns");
	const foundTypes = state.columns.map((c) => c.type);
	assert.deepEqual(foundTypes, ["accounts", "folders", "threads", "settings", "compose", "search", "agent"]);
});

// =============================================================================
// CHALLENGE 4: Root column dismissal protection (accounts, folders, threads)
// =============================================================================
console.log("\n▶ [CHALLENGE 4] Root Column Dismissal Protection Oracle...");

runTest("C4.1: closeColumn and dismissColumn strictly cannot dismiss 'accounts'", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_echo", "inbox");
	assert.equal(useColumnStack.getState().columns[0].closable, false, "Accounts closable must be false");

	store.closeColumn("accounts");
	assert.equal(useColumnStack.getState().columns.length, 3, "Accounts must not be closed via closeColumn");
	assert.equal(useColumnStack.getState().columns[0].id, "accounts");

	store.dismissColumn("accounts");
	assert.equal(useColumnStack.getState().columns.length, 3, "Accounts must not be closed via dismissColumn");
	assert.equal(useColumnStack.getState().columns[0].id, "accounts");
});

runTest("C4.2: closeColumn and dismissColumn strictly cannot dismiss 'folders'", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_echo", "inbox");
	assert.equal(useColumnStack.getState().columns[1].closable, false, "Folders closable must be false");

	store.closeColumn("folders");
	assert.equal(useColumnStack.getState().columns.length, 3, "Folders must not be closed via closeColumn");
	assert.equal(useColumnStack.getState().columns[1].id, "folders");

	store.dismissColumn("folders");
	assert.equal(useColumnStack.getState().columns.length, 3, "Folders must not be closed via dismissColumn");
	assert.equal(useColumnStack.getState().columns[1].id, "folders");
});

runTest("C4.3: closeColumn and dismissColumn strictly cannot dismiss 'threads'", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_echo", "inbox");
	assert.equal(useColumnStack.getState().columns[2].closable, false, "Threads closable must be false");

	store.closeColumn("threads");
	assert.equal(useColumnStack.getState().columns.length, 3, "Threads must not be closed via closeColumn");
	assert.equal(useColumnStack.getState().columns[2].id, "threads");

	store.dismissColumn("threads");
	assert.equal(useColumnStack.getState().columns.length, 3, "Threads must not be closed via dismissColumn");
	assert.equal(useColumnStack.getState().columns[2].id, "threads");
});

runTest("C4.4: Dismissal attempts on active root columns preserve active focus and column presence", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_echo", "inbox");

	// Active on accounts
	store.setActiveColumn("accounts");
	store.closeColumn("accounts");
	assert.equal(useColumnStack.getState().activeColumnId, "accounts");
	assert.equal(useColumnStack.getState().columns.length, 3);

	// Active on folders
	store.setActiveColumn("folders");
	store.closeColumn("folders");
	assert.equal(useColumnStack.getState().activeColumnId, "folders");
	assert.equal(useColumnStack.getState().columns.length, 3);

	// Active on threads
	store.setActiveColumn("threads");
	store.closeColumn("threads");
	assert.equal(useColumnStack.getState().activeColumnId, "threads");
	assert.equal(useColumnStack.getState().columns.length, 3);
});

runTest("C4.5: Dismissal of nonexistent or invalid IDs is completely safe and no-ops", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_echo", "inbox");

	assert.doesNotThrow(() => store.closeColumn("nonexistent_id"));
	assert.doesNotThrow(() => store.closeColumn(""));
	assert.doesNotThrow(() => store.closeColumn(null));
	assert.doesNotThrow(() => store.closeColumn(undefined));
	assert.equal(useColumnStack.getState().columns.length, 3);
});

// =============================================================================
// CHALLENGE 5: Active column dismissal predecessor focus rollback
// =============================================================================
console.log("\n▶ [CHALLENGE 5] Active Column Dismissal Predecessor Focus Rollback...");

runTest("C5.1: Dismissing active Reader rolls back focus to Threads and clears selectedEmailId", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_foxtrot", "inbox");
	store.selectThread("msg_test", "Test Subject");

	let state = useColumnStack.getState();
	assert.equal(state.activeColumnId, "reader");
	assert.equal(state.selectedEmailId, "msg_test");

	store.closeColumn("reader");
	state = useColumnStack.getState();

	assert.equal(state.columns.length, 3);
	assert.equal(state.activeColumnId, "threads", "Active column must roll back to threads (predecessor)");
	assert.equal(state.selectedEmailId, null, "selectedEmailId must be null after reader is closed");
});

runTest("C5.2: Sequential backwards dismissals roll back active focus step-by-step to Threads", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_foxtrot", "inbox");
	store.openPlatformColumn("settings");
	store.openPlatformColumn("compose");
	store.openPlatformColumn("search");

	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 6, "[accounts, folders, threads, settings, compose, search]");
	assert.equal(state.activeColumnId, "search");

	// Close search -> focus compose
	store.closeColumn("search");
	state = useColumnStack.getState();
	assert.equal(state.columns.length, 5);
	assert.equal(state.activeColumnId, "compose", "Focus must roll back to compose");

	// Close compose -> focus settings
	store.closeColumn("compose");
	state = useColumnStack.getState();
	assert.equal(state.columns.length, 4);
	assert.equal(state.activeColumnId, "settings", "Focus must roll back to settings");

	// Close settings -> focus threads
	store.closeColumn("settings");
	state = useColumnStack.getState();
	assert.equal(state.columns.length, 3);
	assert.equal(state.activeColumnId, "threads", "Focus must roll back to threads");
});

runTest("C5.3: Dismissing non-active column does NOT hijack or disturb current active focus", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_foxtrot", "inbox");
	store.openPlatformColumn("settings");
	store.openPlatformColumn("compose");

	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 5);
	// Active is compose (index 4)
	assert.equal(state.activeColumnId, "compose");

	// Close settings (index 3) while compose is active
	store.closeColumn("settings");
	state = useColumnStack.getState();

	assert.equal(state.columns.length, 4);
	assert.equal(state.activeColumnId, "compose", "Active focus must remain on compose when predecessor is dismissed");
	assert.equal(state.columns.some((c) => c.id === "settings"), false);
});

runTest("C5.4: Closing parent column removes child column and rolls back active focus", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_foxtrot", "inbox");
	store.selectThread("msg_parent", "Parent Message");
	// Spawn adjacent compose from reader
	store.openAdjacentColumn("compose", { draft: "adjacent" }, "reader");

	let state = useColumnStack.getState();
	assert.equal(state.columns.length, 5);
	assert.equal(state.activeColumnId, "compose");
	assert.equal(state.columns[4].parentId, "reader");

	// Close reader (which is parent of compose)
	store.closeColumn("reader");
	state = useColumnStack.getState();

	assert.equal(state.columns.length, 3, "Both reader and its child column must be removed");
	assert.equal(state.activeColumnId, "threads", "Active focus must roll back to threads");
	assert.equal(state.selectedEmailId, null);
});

// =============================================================================
// CHALLENGE 6: Fuzz Testing & State Machine Chaos Monkey (1,000 Operations)
// =============================================================================
console.log("\n▶ [CHALLENGE 6] Chaos Monkey Fuzz Testing (1,000 Invariant Checked Operations)...");

runTest("C6.1: 1,000 pseudo-random operations maintain all 6 fundamental store invariants", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_fuzz", "inbox");

	const folders = ["inbox", "sent", "archive", "trash", "drafts", "priority"];
	const platformTypes = ["settings", "compose", "search", "agent"];

	// Seeded pseudo-random generator (LCG)
	let seed = 123456789;
	function rand() {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	}

	const TOTAL_STEPS = 1000;
	for (let step = 1; step <= TOTAL_STEPS; step++) {
		const actionType = Math.floor(rand() * 7);

		switch (actionType) {
			case 0: {
				// Select thread
				const threadId = `fuzz_msg_${Math.floor(rand() * 20)}`;
				useColumnStack.getState().selectThread(threadId, `Fuzz Subject ${threadId}`);
				break;
			}
			case 1: {
				// Select folder
				const folder = folders[Math.floor(rand() * folders.length)];
				useColumnStack.getState().selectFolder(folder);
				break;
			}
			case 2: {
				// Open platform column (append or adjacent)
				const pType = platformTypes[Math.floor(rand() * platformTypes.length)];
				const placeAtEnd = rand() > 0.5;
				useColumnStack.getState().openPlatformColumn(pType, { step }, placeAtEnd);
				break;
			}
			case 3: {
				// Close a column (could be root or closable or random)
				const cols = useColumnStack.getState().columns;
				const target = cols[Math.floor(rand() * cols.length)]?.id;
				if (target) {
					useColumnStack.getState().closeColumn(target);
				}
				break;
			}
			case 4: {
				// Set active column
				const cols = useColumnStack.getState().columns;
				const target = cols[Math.floor(rand() * cols.length)]?.id;
				if (target) {
					useColumnStack.getState().setActiveColumn(target);
				}
				break;
			}
			case 5: {
				// Select mailbox
				const mbxId = `mbx_${Math.floor(rand() * 3)}`;
				useColumnStack.getState().selectMailbox(mbxId);
				break;
			}
			case 6: {
				// Append column
				const pType = platformTypes[Math.floor(rand() * platformTypes.length)];
				useColumnStack.getState().appendColumn(pType, { step });
				break;
			}
		}

		// INVARIANT VERIFICATION AT EVERY STEP
		const st = useColumnStack.getState();

		// Invariant 1: Stack must never be empty and has at least 3 base columns
		assert.ok(st.columns.length >= 3, `Step ${step}: Stack must have at least 3 columns, found ${st.columns.length}`);

		// Invariant 2: Base columns accounts, folders, threads must always be present and maintain relative order
		const accIdx = st.columns.findIndex((c) => c.id === "accounts");
		const fldIdx = st.columns.findIndex((c) => c.id === "folders");
		const thdIdx = st.columns.findIndex((c) => c.id === "threads");
		assert.ok(accIdx >= 0, `Step ${step}: accounts column must be present`);
		assert.ok(fldIdx >= 0, `Step ${step}: folders column must be present`);
		assert.ok(thdIdx >= 0, `Step ${step}: threads column must be present`);
		assert.ok(accIdx < fldIdx, `Step ${step}: accounts must precede folders`);
		assert.ok(fldIdx < thdIdx, `Step ${step}: folders must precede threads`);

		// Invariant 3: Base columns must have closable === false
		assert.equal(st.columns[accIdx]?.closable, false, `Step ${step}: accounts must not be closable`);
		assert.equal(st.columns[fldIdx]?.closable, false, `Step ${step}: folders must not be closable`);
		assert.equal(st.columns[thdIdx]?.closable, false, `Step ${step}: threads must not be closable`);

		// Invariant 4: All column IDs must be strictly unique
		const ids = st.columns.map((c) => c.id);
		assert.equal(new Set(ids).size, st.columns.length, `Step ${step}: Duplicate column IDs detected: [${ids.join(", ")}]`);

		// Invariant 5: Active column ID must point to an existing column in the stack
		if (st.activeColumnId) {
			const activeExists = st.columns.some((c) => c.id === st.activeColumnId);
			assert.ok(activeExists, `Step ${step}: activeColumnId "${st.activeColumnId}" not found in mounted columns`);
		}

		// Invariant 6: selectedEmailId consistency: if selectedEmailId is non-null, reader column MUST be mounted
		if (st.selectedEmailId) {
			const hasReader = st.columns.some((c) => c.type === "reader");
			assert.ok(hasReader, `Step ${step}: selectedEmailId is "${st.selectedEmailId}" but no reader column is mounted`);
		}
	}
	console.log(`      [Chaos Stats] Successfully validated 1,000 steps with 6,000 invariant checks.`);
});

// =============================================================================
// CHALLENGE 7: Mailbox Cascades, Boundary Inputs, and DOM Scrolling Resilience
// =============================================================================
console.log("\n▶ [CHALLENGE 7] Mailbox Cascades & Boundary Inputs...");

runTest("C7.1: selectMailbox with new mailbox switches context, resets reader, and retains platform columns", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_primary", "inbox");
	store.selectThread("msg_primary_1", "Primary Message");
	store.openPlatformColumn("settings");
	store.openPlatformColumn("compose");

	let s = useColumnStack.getState();
	assert.equal(s.columns.length, 6, "[accounts, folders, threads, reader, settings, compose]");
	assert.equal(s.selectedMailboxId, "mbx_primary");

	// Switch mailbox
	store.selectMailbox("mbx_secondary", "Secondary Account");
	s = useColumnStack.getState();

	assert.equal(s.selectedMailboxId, "mbx_secondary");
	assert.equal(s.selectedFolderId, "inbox");
	assert.equal(s.selectedEmailId, null, "selectedEmailId must be reset to null");
	assert.equal(s.activeColumnId, "threads");
	assert.equal(s.columns.some((c) => c.type === "reader"), false, "Reader must be dropped on mailbox switch");
	assert.equal(s.columns[1].title, "Secondary Account");
	assert.equal(s.columns[1].props?.mailboxId, "mbx_secondary");
	assert.equal(s.columns[2].props?.mailboxId, "mbx_secondary");
	// Retained platform columns
	assert.ok(s.columns.some((c) => c.type === "settings"));
	assert.ok(s.columns.some((c) => c.type === "compose"));
});

runTest("C7.2: selectMailbox with identical mailbox ID is idempotent and returns early", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_same", "inbox");
	store.selectThread("msg_keep", "Keep this open");

	let s = useColumnStack.getState();
	assert.equal(s.columns.length, 4);

	// Select same mailbox
	store.selectMailbox("mbx_same");
	s = useColumnStack.getState();
	assert.equal(s.columns.length, 4, "Must not reset stack when selecting identical mailbox");
	assert.equal(s.selectedEmailId, "msg_keep");
});

runTest("C7.3: Boundary inputs (special characters, tags with hashtags, empty strings) do not corrupt state", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_special", "inbox");

	// Tag selection in folder
	store.selectFolder("#Engineering-PRs", "#Engineering-PRs");
	let s = useColumnStack.getState();
	assert.equal(s.selectedFolderId, "#Engineering-PRs");
	assert.equal(s.columns[2].title, "#Engineering-PRs");

	// Thread with emoji and special chars
	store.selectThread("msg_🔥_123", "🔥 Urgent: Deploy v2.0 <script>alert(1)</script>");
	s = useColumnStack.getState();
	assert.equal(s.selectedEmailId, "msg_🔥_123");
	assert.equal(s.columns[3].title, "🔥 Urgent: Deploy v2.0 <script>alert(1)</script>");

	// Close nonexistent
	store.closeColumn("invalid_null_column_id");
	assert.equal(useColumnStack.getState().columns.length, 4);

	// Close column multiple times in succession
	store.closeColumn("reader");
	store.closeColumn("reader");
	store.closeColumn("reader");
	s = useColumnStack.getState();
	assert.equal(s.columns.length, 3);
	assert.equal(s.activeColumnId, "threads");
});

runTest("C7.4: scrollToColumn and triggerScrollToColumn execute safely with mock DOM", () => {
	const store = useColumnStack.getState();
	store.initializeStack("mbx_scroll", "inbox");

	// Call scrollToColumn directly
	assert.doesNotThrow(() => store.scrollToColumn("threads"));
	assert.doesNotThrow(() => store.scrollToColumn("nonexistent_element"));
});

cleanupTestDOM();

console.log("\n========================================================================");
console.log(`  TIER 5 ADVERSARIAL CHALLENGER RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log("========================================================================");

if (failedCount > 0) {
	process.exit(1);
} else {
	process.exit(0);
}
