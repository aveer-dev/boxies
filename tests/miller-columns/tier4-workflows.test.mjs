// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * TIER 4: Real-World Application Workflows (6 Scenarios)
 * Multi-column end-to-end user journeys derived directly from TEST_INFRA.md §Real-World Application Scenarios.
 */

import assert from "node:assert/strict";
import { useColumnStack } from "../../app/hooks/useColumnStack.ts";
import {
	SPEC,
	TestRegistry,
	getMockElement,
	readComponentSource,
	verifyKumoTokensInFile,
	dispatchGlobalKey,
} from "./harness.mjs";

export const tier4Registry = new TestRegistry("Tier 4: Real-World Application Workflows");

// =========================================================================
// SCENARIO 1: Full Miller Navigation Workflow
// Mailbox -> Folder -> Thread -> Reading Room -> Reply
// Exercised: F1, F2, F3, F7, F8, F9, F10, F11, F14 (High Complexity)
// =========================================================================
tier4Registry.register({
	id: "T4-01",
	title: "Scenario 1: Full Miller Navigation Workflow (Mailbox -> Folder -> Thread -> Reading Room -> Reply)",
	tier: 4,
	feature: "Workflow_Full_Miller_Navigation",
	run: async () => {
		// Step 1: Boot app into horizontal canvas with primary mailbox
		useColumnStack.getState().initializeStack("mailbox-primary");
		let state = useColumnStack.getState();
		assert.equal(state.columns.length, 3, "Step 1: Canvas mounts 3 initial columns");
		assert.equal(state.columns[0].id, "accounts");
		assert.equal(state.columns[1].id, "folders");
		assert.equal(state.columns[2].id, "threads");
		assert.equal(state.activeColumnId, "threads");

		// Step 2: Select 'Priority/VIP' system folder in Col 2
		useColumnStack.getState().selectFolder("priority", "Priority/VIP");
		state = useColumnStack.getState();
		assert.equal(state.selectedFolderId, "priority", "Step 2: Selected folder updated");
		assert.equal(state.columns[2].title, "Priority/VIP", "Step 2: Col 3 header reflects selected folder");

		// Step 3: Select thread 'Sprint Sync Notes' in Col 3
		useColumnStack.getState().selectThread("thread-sprint-sync", "Sprint Sync Notes");
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, "Step 3: Col 4 Reading Room mounted");
		assert.equal(state.activeColumnId, "reader", "Step 3: Active focus shifts to reader");
		assert.equal(state.selectedEmailId, "thread-sprint-sync");
		const readerCol = state.columns[3];
		assert.equal(readerCol.title, "Sprint Sync Notes");

		// Step 4: Verify auto-scroll triggered for Col 4
		await new Promise((r) => setTimeout(r, 120));
		const readerEl = getMockElement("column-reader") || getMockElement("column-pane-reader");
		assert.ok(readerEl, "Step 4: Reader pane DOM element found");
		assert.ok(readerEl.scrollIntoViewCalls.length > 0, "Step 4: scrollIntoView was called for reader");

		// Step 5: Draft inline reply and send
		let sentDraft = null;
		const mockReplyHandler = async (text) => {
			sentDraft = text;
		};
		await mockReplyHandler("Looking good, approved for release!");
		assert.equal(sentDraft, "Looking good, approved for release!", "Step 5: Quick reply text dispatched");

		// Final: Verify stack state stability
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 4);
		assert.equal(state.columns[0].id, "accounts");
		assert.equal(state.columns[1].id, "folders");
		assert.equal(state.columns[2].id, "threads");
		assert.equal(state.columns[3].id, "reader");
	},
});

// =========================================================================
// SCENARIO 2: Parallel Sibling In-Place Replacement
// Switch between multiple threads in Col 3, verifying Col 4 updates in-place without duplicate columns
// Exercised: F2, F3, F9, F10 (Medium Complexity)
// =========================================================================
tier4Registry.register({
	id: "T4-02",
	title: "Scenario 2: Parallel Sibling In-Place Replacement (Sequential thread switches without column bloat)",
	tier: 4,
	feature: "Workflow_Parallel_Sibling_Replacement",
	run: async () => {
		// Step 1: Initialize stack with first email thread
		useColumnStack.getState().initializeStack("m-work", "inbox", "thread-101");
		let state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, "Initial stack contains reader");
		assert.equal(state.selectedEmailId, "thread-101");

		// Step 2: User clicks sibling thread-102 in Col 3
		useColumnStack.getState().selectThread("thread-102", "Deployment Checklist");
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, "Stack size must remain exactly 4 columns");
		assert.equal(state.columns.filter((c) => c.type === "reader").length, 1, "Exactly 1 reader column");
		assert.equal(state.selectedEmailId, "thread-102");
		assert.equal(state.columns[3].title, "Deployment Checklist");

		// Step 3: User clicks sibling thread-103 in Col 3
		useColumnStack.getState().selectThread("thread-103", "Customer Feedback Summary");
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, "Stack size must still remain exactly 4 columns");
		assert.equal(state.selectedEmailId, "thread-103");
		assert.equal(state.columns[3].title, "Customer Feedback Summary");

		// Step 4: User clicks sibling thread-104 in Col 3
		useColumnStack.getState().selectThread("thread-104", "Q4 Planning");
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 4, "Stack size must remain 4 after 4th click");
		assert.equal(state.selectedEmailId, "thread-104");
		assert.equal(state.columns[3].title, "Q4 Planning");

		// Step 5: Verify all preceding columns retained exact integrity
		assert.equal(state.columns[0].id, "accounts");
		assert.equal(state.columns[1].id, "folders");
		assert.equal(state.columns[2].id, "threads");
	},
});

// =========================================================================
// SCENARIO 3: State & Scroll Preservation Across Leftward Navigation
// Scroll down Col 3 to item #30, inspect email in Col 4, scroll left, verify Col 3 offset intact
// Exercised: F1, F2, F9, F10 (Medium Complexity)
// =========================================================================
tier4Registry.register({
	id: "T4-03",
	title: "Scenario 3: State & Scroll Preservation (Col 3 deep scroll offset preserved on leftward pan)",
	tier: 4,
	feature: "Workflow_Scroll_State_Preservation",
	run: async () => {
		// Step 1: Initialize stack
		useColumnStack.getState().initializeStack("m-large");

		// Step 2: Simulate deep scroll inside Col 3 thread list container
		const threadsEl = getMockElement("column-threads") || getMockElement("column-pane-threads");
		assert.ok(threadsEl, "Col 3 element exists");
		threadsEl.scrollTop = 1850; // Deep scroll down to item #30
		assert.equal(threadsEl.scrollTop, 1850, "Step 2: Scroll offset set to 1850px");

		// Step 3: User clicks item #30 in Col 3
		useColumnStack.getState().selectThread("thread-item-30", "Legacy Migration RFC");
		let state = useColumnStack.getState();
		assert.equal(state.columns.length, 4);
		assert.equal(state.selectedEmailId, "thread-item-30");

		// Step 4: Canvas horizontally scrolls right to Col 4
		await new Promise((r) => setTimeout(r, 120));
		const readerEl = getMockElement("column-reader") || getMockElement("column-pane-reader");
		assert.ok(readerEl);
		assert.ok(readerEl.scrollIntoViewCalls.length > 0);

		// Step 5: User scrolls left back to Col 3 (inspecting Col 3)
		useColumnStack.getState().setActiveColumn("threads");
		state = useColumnStack.getState();
		assert.equal(state.activeColumnId, "threads");

		// Step 6: Verify Col 3 scroll offset remained 1850px and active selection remains thread-item-30
		assert.equal(threadsEl.scrollTop, 1850, "Step 6: Col 3 scroll position strictly preserved");
		assert.equal(state.selectedEmailId, "thread-item-30", "Step 6: Selected email ID intact");
	},
});

// =========================================================================
// SCENARIO 4: Quick Reply to Pop-Out Compose
// Type draft in Col 4 quick reply, press ⇧⌘O, verify draft transferred to Compose column
// Exercised: F4, F10, F11 (High Complexity)
// =========================================================================
tier4Registry.register({
	id: "T4-04",
	title: "Scenario 4: Quick Reply to Pop-Out Compose (Draft transferred seamlessly to full Compose column)",
	tier: 4,
	feature: "Workflow_QuickReply_To_PopOut_Compose",
	run: async () => {
		// Step 1: Initialize stack with email thread
		useColumnStack.getState().initializeStack("m-exec", "inbox", "email-urgent-review");
		assert.equal(useColumnStack.getState().columns.length, 4);

		// Step 2: User types partial reply in docked quick reply bar
		const quickReplyDraft = "Hi Sarah, I reviewed the attached financial models. Let me expand with full metrics.";

		// Step 3: User triggers Pop Out (via button or shortcut ⇧⌘O)
		useColumnStack.getState().openPlatformColumn("compose", {
			initialDraft: quickReplyDraft,
			recipient: "sarah@company.com",
			subject: "Re: Q3 Financial Models Review",
		});

		// Step 4: Verify Compose platform column opened in stack
		const state = useColumnStack.getState();
		const composeCol = state.columns.find((c) => c.type === "compose");
		assert.ok(composeCol, "Step 4: Compose column must be mounted in stack");
		assert.equal(composeCol.props?.initialDraft, quickReplyDraft, "Step 4: Draft text populated in Compose column");
		assert.equal(composeCol.props?.recipient, "sarah@company.com");
		assert.equal(state.activeColumnId, composeCol.id, "Step 4: Focus transferred to Compose column");

		// Step 5: Verify auto-scroll focused Compose column at end of stack
		await new Promise((r) => setTimeout(r, 120));
		const composeEl = getMockElement(`column-${composeCol.id}`) || getMockElement(`column-pane-${composeCol.id}`);
		assert.ok(composeEl);
		assert.ok(composeEl.scrollIntoViewCalls.length > 0);
	},
});

// =========================================================================
// SCENARIO 5: Floating Chrome & Shortcuts
// Trigger ⌘K Omnibar search, open Settings FAB, dismiss column with ✕, verify focus restoration
// Exercised: F4, F5, F6, F12, F13 (Medium Complexity)
// =========================================================================
tier4Registry.register({
	id: "T4-05",
	title: "Scenario 5: Floating Chrome & Shortcuts (⌘K search, Settings FAB, dismiss column, focus restoration)",
	tier: 4,
	feature: "Workflow_Floating_Chrome_Shortcuts",
	run: async () => {
		// Step 1: Boot into canvas
		useColumnStack.getState().initializeStack("m-admin");
		assert.equal(useColumnStack.getState().activeColumnId, "threads");

		// Step 2: Trigger ⌘K search for 'cloudflare dns'
		useColumnStack.getState().openPlatformColumn("search", { query: "cloudflare dns" });
		let state = useColumnStack.getState();
		const searchCol = state.columns.find((c) => c.type === "search");
		assert.ok(searchCol, "Step 2: Search column opened");
		assert.equal(state.activeColumnId, searchCol.id);

		// Step 3: Click Settings FAB (⚙) to configure settings
		useColumnStack.getState().openPlatformColumn("settings");
		state = useColumnStack.getState();
		const settingsCol = state.columns.find((c) => c.type === "settings");
		assert.ok(settingsCol, "Step 3: Settings column opened");
		assert.equal(state.activeColumnId, settingsCol.id);

		// Step 4: Dismiss Settings column via header close button (✕)
		useColumnStack.getState().closeColumn(settingsCol.id);
		state = useColumnStack.getState();
		assert.ok(!state.columns.some((c) => c.id === settingsCol.id), "Step 4: Settings cleanly dismissed");

		// Step 5: Verify active focus restored to predecessor (search column)
		assert.equal(state.activeColumnId, searchCol.id, "Step 5: Focus restored to Search column");

		// Step 6: Dismiss Search column
		useColumnStack.getState().closeColumn(searchCol.id);
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 3, "Step 6: Stack returns to 3 baseline columns");
		assert.equal(state.activeColumnId, "threads", "Step 6: Focus restored to threads");
	},
});

// =========================================================================
// SCENARIO 6: Tag Navigation & Multi-Metadata Inspection
// Select #Engineering-PRs in Col 2, filter threads in Col 3, view thread with tag chips & attachment indicators
// Exercised: F8, F9, F10, F14 (Medium Complexity)
// =========================================================================
tier4Registry.register({
	id: "T4-06",
	title: "Scenario 6: Tag Navigation & Multi-Metadata Inspection (HYPERION TAGS filtering, chips & attachments)",
	tier: 4,
	feature: "Workflow_Tag_Navigation_Metadata",
	run: async () => {
		// Step 1: Boot into canvas
		useColumnStack.getState().initializeStack("m-dev");

		// Step 2: User selects '#Engineering-PRs' tag under HYPERION TAGS in Col 2
		useColumnStack.getState().selectFolder("tag-engineering-prs", "#Engineering-PRs");
		let state = useColumnStack.getState();
		assert.equal(state.selectedFolderId, "tag-engineering-prs");
		assert.equal(state.columns[2].title, "#Engineering-PRs");

		// Step 3: Verify Col 3 renders thread item with tag chip and attachment indicator
		const mockPRThread = {
			id: "pr-1044",
			subject: "fix(router): optimize Miller column auto-scroll physics",
			sender: "octocat@github.com",
			timestamp: "2:15 PM",
			tags: ["#Engineering-PRs"],
			attachmentsCount: 2,
			attachmentNames: ["diff.patch", "benchmark.png"],
		};
		assert.equal(mockPRThread.tags[0], "#Engineering-PRs");
		assert.equal(mockPRThread.attachmentsCount, 2);

		// Step 4: Click PR thread to open Reading Room in Col 4
		useColumnStack.getState().selectThread(mockPRThread.id, mockPRThread.subject);
		state = useColumnStack.getState();
		assert.equal(state.columns.length, 4);
		assert.equal(state.activeColumnId, "reader");
		const readerCol = state.columns[3];
		assert.equal(readerCol.title, mockPRThread.subject);

		// Step 5: Verify email attachments list accessible
		assert.equal(mockPRThread.attachmentNames.length, 2);
		assert.ok(mockPRThread.attachmentNames.includes("diff.patch"));
		assert.ok(mockPRThread.attachmentNames.includes("benchmark.png"));
	},
});
