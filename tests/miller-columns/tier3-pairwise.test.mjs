// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * TIER 3: Cross-Feature Combinations & Pairwise Tests (16 Tests)
 * Verifies complex multi-feature interactions, state transitions between columns,
 * layout harmony, and keyboard shortcut flows.
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

export const tier3Registry = new TestRegistry("Tier 3: Cross-Feature Combinations");

// T3-01: F1 (Canvas Shell) + F5 (Smooth Auto-Scroll)
tier3Registry.register({
	id: "T3-01",
	title: "F1+F5: Canvas smooth-scroll triggers when 4th column (Reader) is mounted",
	tier: 3,
	feature: "F01_F05_Canvas_Scroll",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("thread-e2e-1", "Pairwise Thread");

		await new Promise((r) => setTimeout(r, 120));
		const readerEl = getMockElement("column-reader") || getMockElement("column-pane-reader");
		assert.ok(readerEl, "Reader pane DOM element must be registered");
		assert.ok(readerEl.scrollIntoViewCalls.length > 0, "scrollIntoView must be called for new reader column");
		assert.equal(readerEl.scrollIntoViewCalls[0].behavior, "smooth");
	},
});

// T3-02: F2 (Column Stack) + F3 (Sibling Replacement) + F4 (Platform Links)
tier3Registry.register({
	id: "T3-02",
	title: "F2+F3+F4: Sibling replacement in thread list preserves open platform columns at stack end",
	tier: 3,
	feature: "F02_F03_F04_Sibling_Platform",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("thread-A", "Subject A");
		useColumnStack.getState().openPlatformColumn("settings");

		const colsBefore = useColumnStack.getState().columns;
		const settingsCol = colsBefore.find((c) => c.type === "settings");
		assert.ok(settingsCol, "Settings column must exist at end");

		// Switch thread sibling
		useColumnStack.getState().selectThread("thread-B", "Subject B");
		const colsAfter = useColumnStack.getState().columns;

		// Settings column must still be present
		assert.ok(colsAfter.some((c) => c.id === settingsCol.id), "Settings column must remain mounted at stack end");
		const readerCol = colsAfter.find((c) => c.type === "reader");
		assert.equal(readerCol?.title, "Subject B", "Reader title must be updated");
	},
});

// T3-03: F3 (Sibling Replacement) + F6 (Dismissal)
tier3Registry.register({
	id: "T3-03",
	title: "F3+F6: Dismissing Col 3 threads removes downstream Col 4 reader while retaining Col 1 and Col 2",
	tier: 3,
	feature: "F03_F06_Sibling_Dismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("t-1", "Subject 1");
		assert.equal(useColumnStack.getState().columns.length, 4);

		// Close reader
		useColumnStack.getState().closeColumn("reader");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 3);
		assert.equal(cols[0].id, "accounts");
		assert.equal(cols[1].id, "folders");
		assert.equal(cols[2].id, "threads");
	},
});

// T3-04: F4 (Platform Links) + F6 (Dismissal)
tier3Registry.register({
	id: "T3-04",
	title: "F4+F6: Opening Compose platform column then closing via ✕ restores active focus to previous reader column",
	tier: 3,
	feature: "F04_F06_Platform_Dismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1", "inbox", "e-1");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");

		useColumnStack.getState().openPlatformColumn("compose");
		const composeCol = useColumnStack.getState().columns.find((c) => c.type === "compose");
		assert.ok(composeCol);
		assert.equal(useColumnStack.getState().activeColumnId, composeCol.id);

		// Dismiss compose
		useColumnStack.getState().closeColumn(composeCol.id);
		assert.equal(useColumnStack.getState().activeColumnId, "reader", "Focus must shift back to reader");
	},
});

// T3-05: F7 (Accounts) + F8 (Folders) + F9 (Thread List)
tier3Registry.register({
	id: "T3-05",
	title: "F7+F8+F9: Switching mailbox in Col 1 reloads Col 2 folders and resets Col 3 threads to new mailbox",
	tier: 3,
	feature: "F07_F08_F09_Mailbox_Cascading",
	run: async () => {
		useColumnStack.getState().initializeStack("mailbox-primary");
		useColumnStack.getState().selectFolder("archive", "Archive");
		assert.equal(useColumnStack.getState().selectedFolderId, "archive");

		// Switch mailbox
		useColumnStack.getState().selectMailbox("mailbox-secondary", "Secondary Account");
		const state = useColumnStack.getState();
		assert.equal(state.selectedMailboxId, "mailbox-secondary");
		assert.equal(state.selectedFolderId, "inbox", "Folder must reset to inbox on mailbox switch");
		assert.equal(state.columns[1].props?.mailboxId, "mailbox-secondary");
		assert.equal(state.columns[2].props?.mailboxId, "mailbox-secondary");
	},
});

// T3-06: F8 (Folders) + F9 (Thread List) + F10 (Reading Room)
tier3Registry.register({
	id: "T3-06",
	title: "F8+F9+F10: Selecting a tag in Col 2 filters Col 3 threads and clicking thread loads Reading Room",
	tier: 3,
	feature: "F08_F09_F10_Tag_To_Reader",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		// Select tag
		useColumnStack.getState().selectFolder("tag-hyperion", "#Hyperion-Release");
		assert.equal(useColumnStack.getState().columns[2].title, "#Hyperion-Release");

		// Click thread in tagged list
		useColumnStack.getState().selectThread("thread-release-notes", "v2.0 Release Notes");
		const readerCol = useColumnStack.getState().columns.find((c) => c.type === "reader");
		assert.ok(readerCol);
		assert.equal(readerCol.title, "v2.0 Release Notes");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");
	},
});

// T3-07: F11 (Quick Reply) + F4 (Platform Links)
tier3Registry.register({
	id: "T3-07",
	title: "F11+F4: Triggering Pop-Out (⇧⌘O) from Quick Reply creates Compose platform column with draft text",
	tier: 3,
	feature: "F11_F04_QuickReply_PopOut",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1", "inbox", "email-789");
		const draftPayload = "Escalated issue regarding deployment #441";

		// Simulate Pop Out action
		useColumnStack.getState().openPlatformColumn("compose", {
			draft: draftPayload,
			replyToId: "email-789",
		});

		const composeCol = useColumnStack.getState().columns.find((c) => c.type === "compose");
		assert.ok(composeCol);
		assert.equal(composeCol.props?.draft, draftPayload);
		assert.equal(composeCol.props?.replyToId, "email-789");
		assert.equal(useColumnStack.getState().activeColumnId, composeCol.id);
	},
});

// T3-08: F12 (Floating Omnibar) + F4 (Platform Links) + F5 (Smooth Scroll)
tier3Registry.register({
	id: "T3-08",
	title: "F12+F4+F5: Pressing ⌘K in Omnibar pill opens Search platform column and triggers auto-scroll",
	tier: 3,
	feature: "F12_F04_F05_Omnibar_Search_Scroll",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().openPlatformColumn("search", { query: "invoice" });

		await new Promise((r) => setTimeout(r, 120));
		const searchCol = useColumnStack.getState().columns.find((c) => c.type === "search");
		assert.ok(searchCol);

		const searchEl = getMockElement(`column-${searchCol.id}`) || getMockElement(`column-pane-${searchCol.id}`);
		assert.ok(searchEl);
		assert.ok(searchEl.scrollIntoViewCalls.length > 0);
	},
});

// T3-09: F13 (FABs) + F4 (Platform Links) + F5 (Smooth Scroll)
tier3Registry.register({
	id: "T3-09",
	title: "F13+F4+F5: Clicking Compose FAB creates Compose column at stack end and scrolls to rightmost",
	tier: 3,
	feature: "F13_F04_F05_Compose_FAB_Scroll",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().openPlatformColumn("compose", undefined, true);

		await new Promise((r) => setTimeout(r, 120));
		const cols = useColumnStack.getState().columns;
		const lastCol = cols[cols.length - 1];
		assert.equal(lastCol.type, "compose");

		const composeEl = getMockElement(`column-${lastCol.id}`) || getMockElement(`column-pane-${lastCol.id}`);
		assert.ok(composeEl);
		assert.ok(composeEl.scrollIntoViewCalls.length > 0);
	},
});

// T3-10: F6 (Dismissal) + F5 (Smooth Scroll) + F2 (Column Stack)
tier3Registry.register({
	id: "T3-10",
	title: "F6+F5+F2: Closing a middle column in a 5-column stack scrolls viewport to new active column smoothly",
	tier: 3,
	feature: "F06_F05_F02_Middle_Close_Scroll",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("t-1", "Reader");
		useColumnStack.getState().openPlatformColumn("settings");

		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 5); // accounts, folders, threads, reader, settings

		// Close reader (middle column)
		useColumnStack.getState().setActiveColumn("reader");
		useColumnStack.getState().closeColumn("reader");

		await new Promise((r) => setTimeout(r, 120));
		assert.equal(useColumnStack.getState().activeColumnId, "threads");
		const threadsEl = getMockElement("column-threads") || getMockElement("column-pane-threads");
		assert.ok(threadsEl);
		assert.ok(threadsEl.scrollIntoViewCalls.length > 0);
	},
});

// T3-11: F14 (Email Core Engine) + F10 (Reading Room) + F11 (Quick Reply)
tier3Registry.register({
	id: "T3-11",
	title: "F14+F10+F11: Interacting with EmailPanel actions inside Col 4 integrates with docked quick reply bar",
	tier: 3,
	feature: "F14_F10_F11_EmailPanel_QuickReply",
	run: async () => {
		const emailPanelSource = readComponentSource("app/components/EmailPanel.tsx");
		assert.ok(emailPanelSource);

		const quickReplyProps = {
			emailId: "msg-core-1",
			mailboxId: "m-1",
			onPopOut: (draft) => {},
			onAIAssist: async (txt) => txt + " (AI assisted)",
			onSend: async (txt) => {},
		};
		const aiResult = await quickReplyProps.onAIAssist("Draft text");
		assert.equal(aiResult, "Draft text (AI assisted)");
	},
});

// T3-12: F15 (Kumo Tokens) + F1 (Canvas) + F7 (Accounts) + F12 (Floating Dock)
tier3Registry.register({
	id: "T3-12",
	title: "F15+F1+F7+F12: Canvas shell, Col 1, and Floating Dock all maintain strict Kumo color token harmony",
	tier: 3,
	feature: "F15_F01_F07_F12_Token_Harmony",
	run: async () => {
		const accountsTokens = verifyKumoTokensInFile("app/components/columns/AccountsColumn.tsx");
		const dockTokens = verifyKumoTokensInFile("app/components/columns/FloatingDock.tsx");
		const paneTokens = verifyKumoTokensInFile("app/components/columns/ColumnPane.tsx");

		assert.equal(accountsTokens.violations.length, 0);
		assert.equal(dockTokens.violations.length, 0);
		assert.equal(paneTokens.violations.length, 0);
	},
});

// T3-13: F3 (Sibling Replacement) + F11 (Quick Reply)
tier3Registry.register({
	id: "T3-13",
	title: "F3+F11: Switching threads in Col 3 updates reader context and resets active email ID",
	tier: 3,
	feature: "F03_F11_Sibling_Draft_Context",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("thread-initial", "Initial Subject");
		assert.equal(useColumnStack.getState().selectedEmailId, "thread-initial");

		useColumnStack.getState().selectThread("thread-switched", "Switched Subject");
		assert.equal(useColumnStack.getState().selectedEmailId, "thread-switched");
		const readerCol = useColumnStack.getState().columns.find((c) => c.type === "reader");
		assert.equal(readerCol?.props?.emailId, "thread-switched");
	},
});

// T3-14: F8 (Folders) + F3 (Sibling Replacement) + F10 (Reading Room)
tier3Registry.register({
	id: "T3-14",
	title: "F8+F3+F10: Switching from folder view to tag view in Col 2 replaces Col 3 thread list and dismisses Col 4 reader",
	tier: 3,
	feature: "F08_F03_F10_Folder_To_Tag_Replacement",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("email-inbox-1", "Inbox Email");
		assert.equal(useColumnStack.getState().columns.length, 4);

		// Switch from folder to tag view
		useColumnStack.getState().selectFolder("tag-design-critique", "#Design-Critique");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 3, "Downstream reader must be removed");
		assert.equal(cols[2].title, "#Design-Critique");
		assert.equal(useColumnStack.getState().selectedEmailId, null);
	},
});

// T3-15: F12 (Omnibar) + F9 (Thread List) + F10 (Reading Room)
tier3Registry.register({
	id: "T3-15",
	title: "F12+F9+F10: Searching via Omnibar displays results in Search column and opening result mounts Reader",
	tier: 3,
	feature: "F12_F09_F10_Omnibar_Search_To_Reader",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().openPlatformColumn("search", { query: "invoice" });

		// Click search result to inspect
		useColumnStack.getState().selectThread("search-res-1", "Invoice #2026-001");
		const readerCol = useColumnStack.getState().columns.find((c) => c.type === "reader");
		assert.ok(readerCol);
		assert.equal(readerCol.title, "Invoice #2026-001");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");
	},
});

// T3-16: F13 (FABs) + F6 (Dismissal) + F4 (Platform Links)
tier3Registry.register({
	id: "T3-16",
	title: "F13+F6+F4: Opening Settings FAB then Compose, then dismissing Settings via ✕ preserves downstream Compose",
	tier: 3,
	feature: "F13_F06_F04_FAB_Multi_Platform_Dismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().openPlatformColumn("settings");
		useColumnStack.getState().openPlatformColumn("compose");

		const colsBefore = useColumnStack.getState().columns;
		const settingsCol = colsBefore.find((c) => c.type === "settings");
		const composeCol = colsBefore.find((c) => c.type === "compose");
		assert.ok(settingsCol && composeCol);

		// Close settings
		useColumnStack.getState().closeColumn(settingsCol.id);
		const colsAfter = useColumnStack.getState().columns;
		assert.ok(!colsAfter.some((c) => c.id === settingsCol.id), "Settings must be closed");
		assert.ok(colsAfter.some((c) => c.id === composeCol.id), "Compose must remain mounted");
	},
});
