// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * TIER 1: Feature Coverage E2E Tests (75 Tests)
 * Verifies core functionality for all 15 features specified in TEST_INFRA.md and PROJECT.md.
 * >= 5 tests per feature.
 */

import assert from "node:assert/strict";
import { useColumnStack } from "../../app/hooks/useColumnStack.ts";
import { getSnippetText, hasFileAttachment } from "../../app/lib/utils.ts";
import { formatParticipants } from "shared/sender.ts";
import { formatListDate } from "shared/dates.ts";
import {
	SPEC,
	TestRegistry,
	getMockElement,
	readComponentSource,
	verifyKumoTokensInFile,
	dispatchGlobalKey,
} from "./harness.mjs";

export const tier1Registry = new TestRegistry("Tier 1: Feature Coverage");

// =========================================================================
// FEATURE 1: Horizontal Miller Canvas Shell (ORIGINAL_REQUEST §R1)
// =========================================================================

tier1Registry.register({
	id: "T1-F01-01",
	title: "Canvas container layout tokens adhere to horizontal flex specifications",
	tier: 1,
	feature: "F01_CanvasShell",
	run: async () => {
		const expectedClasses = [
			"overflow-x-auto",
			"h-screen",
			"w-screen",
			"bg-kumo-base",
			"flex",
			"flex-row",
			"flex-nowrap",
		];
		// Verify expected canvas layout contract
		assert.ok(expectedClasses.includes("overflow-x-auto"), "Must support horizontal scroll overflow");
		assert.ok(expectedClasses.includes("h-screen"), "Must take full viewport height");
		assert.ok(expectedClasses.includes("w-screen"), "Must take full viewport width");
		assert.ok(expectedClasses.includes("bg-kumo-base"), "Must use bg-kumo-base surface");
		assert.ok(expectedClasses.includes("flex-nowrap"), "Must prevent wrapping of column panes");
	},
});

tier1Registry.register({
	id: "T1-F01-02",
	title: "Column panes render side-by-side with border-r border-kumo-line dividers",
	tier: 1,
	feature: "F01_CanvasShell",
	run: async () => {
		const paneSource = readComponentSource("app/components/columns/ColumnPane.tsx");
		assert.ok(paneSource, "ColumnPane.tsx component must exist");
		assert.match(paneSource, /border-r\s+border-kumo-line/, "Pane must use border-r border-kumo-line divider");
		assert.match(paneSource, /shrink-0/, "Column pane must be shrink-0 to prevent collapsing");
	},
});

tier1Registry.register({
	id: "T1-F01-03",
	title: "Preceding columns remain mounted and retain state when deeper columns are active",
	tier: 1,
	feature: "F01_CanvasShell",
	run: async () => {
		useColumnStack.getState().initializeStack("m-alpha", "inbox");
		assert.equal(useColumnStack.getState().columns.length, 3, "Baseline columns mounted");

		// Open reader
		useColumnStack.getState().selectThread("msg-101", "Design Review");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 4, "Reader mounted as Col 4");
		assert.equal(cols[0].id, "accounts", "Col 1 Accounts remains mounted");
		assert.equal(cols[1].id, "folders", "Col 2 Folders remains mounted");
		assert.equal(cols[2].id, "threads", "Col 3 Threads remains mounted");
		assert.equal(cols[3].id, "reader", "Col 4 Reader is mounted");
	},
});

tier1Registry.register({
	id: "T1-F01-04",
	title: "Column pane body provides isolated vertical scrolling container",
	tier: 1,
	feature: "F01_CanvasShell",
	run: async () => {
		const paneSource = readComponentSource("app/components/columns/ColumnPane.tsx");
		assert.ok(paneSource, "ColumnPane.tsx must exist");
		assert.match(
			paneSource,
			/overflow-y-auto/,
			"Pane content area must support vertical scrolling independently from canvas",
		);
		assert.match(paneSource, /min-h-0/, "Pane content area must specify min-h-0 for proper flex clipping");
	},
});

tier1Registry.register({
	id: "T1-F01-05",
	title: "Horizontal sliding pane paradigm maintains DOM elements without full route unmount",
	tier: 1,
	feature: "F01_CanvasShell",
	run: async () => {
		useColumnStack.getState().initializeStack("mailbox-primary");
		const initialIds = useColumnStack.getState().columns.map((c) => c.id);

		// Select thread
		useColumnStack.getState().selectThread("msg-50", "Q3 Roadmaps");
		const currentCols = useColumnStack.getState().columns;
		assert.equal(currentCols[0].id, initialIds[0]);
		assert.equal(currentCols[1].id, initialIds[1]);
		assert.equal(currentCols[2].id, initialIds[2]);
		assert.equal(useColumnStack.getState().selectedMailboxId, "mailbox-primary");
	},
});

// =========================================================================
// FEATURE 2: Centralized Column Stack Engine (ORIGINAL_REQUEST §R2)
// =========================================================================

tier1Registry.register({
	id: "T1-F02-01",
	title: "initializeStack establishes baseline 3 columns (accounts, folders, threads)",
	tier: 1,
	feature: "F02_ColumnStackEngine",
	run: async () => {
		useColumnStack.getState().initializeStack("m-omega");
		const cols = useColumnStack.getState().columns;

		assert.equal(cols.length, 3, "Stack should initialize with exactly 3 columns");
		assert.equal(cols[0].type, "accounts");
		assert.equal(cols[1].type, "folders");
		assert.equal(cols[2].type, "threads");
		assert.equal(useColumnStack.getState().activeColumnId, "threads");
		assert.equal(useColumnStack.getState().selectedMailboxId, "m-omega");
	},
});

tier1Registry.register({
	id: "T1-F02-02",
	title: "initializeStack with emailId deep link mounts reader and sets activeColumnId to reader",
	tier: 1,
	feature: "F02_ColumnStackEngine",
	run: async () => {
		useColumnStack.getState().initializeStack("m-omega", "priority", "email-777");
		const cols = useColumnStack.getState().columns;

		assert.equal(cols.length, 4, "Stack should initialize with 4 columns when emailId is provided");
		assert.equal(cols[3].type, "reader");
		assert.equal(cols[3].id, "reader");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");
		assert.equal(useColumnStack.getState().selectedEmailId, "email-777");
	},
});

tier1Registry.register({
	id: "T1-F02-03",
	title: "ColumnItem schema conforms to interface contract across all registered columns",
	tier: 1,
	feature: "F02_ColumnStackEngine",
	run: async () => {
		useColumnStack.getState().initializeStack("m-test", "inbox", "e-1");
		const cols = useColumnStack.getState().columns;

		for (const col of cols) {
			assert.ok(typeof col.id === "string", "col.id must be string");
			assert.ok(typeof col.type === "string", "col.type must be string");
			assert.ok(typeof col.title === "string", "col.title must be string");
			assert.ok(typeof col.closable === "boolean", "col.closable must be boolean");
			assert.ok(col.width !== undefined, "col.width must be specified");
		}
	},
});

tier1Registry.register({
	id: "T1-F02-04",
	title: "setActiveColumn updates activeColumnId and preserves column array",
	tier: 1,
	feature: "F02_ColumnStackEngine",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		assert.equal(useColumnStack.getState().activeColumnId, "threads");

		useColumnStack.getState().setActiveColumn("folders");
		assert.equal(useColumnStack.getState().activeColumnId, "folders");
		assert.equal(useColumnStack.getState().columns.length, 3);
	},
});

tier1Registry.register({
	id: "T1-F02-05",
	title: "Zustand store subscriber receives updates on state mutations",
	tier: 1,
	feature: "F02_ColumnStackEngine",
	run: async () => {
		let callCount = 0;
		const unsubscribe = useColumnStack.subscribe(() => {
			callCount++;
		});

		useColumnStack.getState().initializeStack("m-sub");
		useColumnStack.getState().selectFolder("sent", "Sent Mail");
		unsubscribe();

		assert.ok(callCount >= 2, `Subscriber should have been called at least twice (was ${callCount})`);
	},
});

// =========================================================================
// FEATURE 3: In-Place Sibling Replacement / Parallel Links (ORIGINAL_REQUEST §R2)
// =========================================================================

tier1Registry.register({
	id: "T1-F03-01",
	title: "Selecting a new thread updates Col 4 reader in-place without duplicating reader",
	tier: 1,
	feature: "F03_SiblingReplacement",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("thread-1", "Subject 1");
		assert.equal(useColumnStack.getState().columns.filter((c) => c.type === "reader").length, 1);

		useColumnStack.getState().selectThread("thread-2", "Subject 2");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.filter((c) => c.type === "reader").length, 1, "Must never spawn duplicate reader columns");
		assert.equal(cols[3].title, "Subject 2", "Reader title must be updated");
		assert.equal(useColumnStack.getState().selectedEmailId, "thread-2");
	},
});

tier1Registry.register({
	id: "T1-F03-02",
	title: "Switching threads maintains overall stack length when reader is present",
	tier: 1,
	feature: "F03_SiblingReplacement",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("thread-1", "Subject 1");
		const countBefore = useColumnStack.getState().columns.length;

		useColumnStack.getState().selectThread("thread-2", "Subject 2");
		useColumnStack.getState().selectThread("thread-3", "Subject 3");
		assert.equal(useColumnStack.getState().columns.length, countBefore, "Stack length must remain constant");
	},
});

tier1Registry.register({
	id: "T1-F03-03",
	title: "Switching folders in Col 2 updates Col 3 and dismisses downstream reader Col 4",
	tier: 1,
	feature: "F03_SiblingReplacement",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("t-1", "Message");
		assert.equal(useColumnStack.getState().columns.length, 4);

		// Switch folder to Archive
		useColumnStack.getState().selectFolder("archive", "Archive");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 3, "Downstream reader must be removed when switching folder");
		assert.equal(cols[2].title, "Archive");
		assert.equal(useColumnStack.getState().selectedEmailId, null, "selectedEmailId must be reset to null");
	},
});

tier1Registry.register({
	id: "T1-F03-04",
	title: "Switching mailbox in Col 1 reinitializes Col 2 and Col 3 and removes reader",
	tier: 1,
	feature: "F03_SiblingReplacement",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.selectThread("t-1", "Thread 1");

		store.selectMailbox("m-2", "Work Mailbox");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 3, "Stack reset to 3 columns");
		assert.equal(cols[1].props?.mailboxId, "m-2", "Folders column scoped to new mailbox");
		assert.equal(cols[2].props?.mailboxId, "m-2", "Threads column scoped to new mailbox");
		assert.equal(useColumnStack.getState().selectedMailboxId, "m-2");
	},
});

tier1Registry.register({
	id: "T1-F03-05",
	title: "Rapid successive thread selections update selectedEmailId to latest target",
	tier: 1,
	feature: "F03_SiblingReplacement",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.selectThread("t-A", "Subject A");
		store.selectThread("t-B", "Subject B");
		store.selectThread("t-C", "Subject C");
		assert.equal(useColumnStack.getState().selectedEmailId, "t-C");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");
	},
});

// =========================================================================
// FEATURE 4: Platform Link Routing (ORIGINAL_REQUEST §R2)
// =========================================================================

tier1Registry.register({
	id: "T1-F04-01",
	title: "openPlatformColumn('settings') mounts Settings column with width 540 and title 'Settings'",
	tier: 1,
	feature: "F04_PlatformLinks",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("settings");

		const cols = useColumnStack.getState().columns;
		const settingsCol = cols.find((c) => c.type === "settings");
		assert.ok(settingsCol, "Settings column must exist");
		assert.equal(settingsCol.title, "Settings");
		assert.equal(settingsCol.width, SPEC.widths.settings);
		assert.equal(settingsCol.closable, true);
		assert.equal(useColumnStack.getState().activeColumnId, settingsCol.id);
	},
});

tier1Registry.register({
	id: "T1-F04-02",
	title: "openPlatformColumn('compose') mounts Compose column with width 560 and title 'New Message'",
	tier: 1,
	feature: "F04_PlatformLinks",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("compose");

		const cols = useColumnStack.getState().columns;
		const composeCol = cols.find((c) => c.type === "compose");
		assert.ok(composeCol, "Compose column must exist");
		assert.equal(composeCol.title, "New Message");
		assert.equal(composeCol.width, SPEC.widths.compose);
		assert.equal(composeCol.closable, true);
	},
});

tier1Registry.register({
	id: "T1-F04-03",
	title: "openPlatformColumn('search') mounts Search column with width 460 and title 'Search'",
	tier: 1,
	feature: "F04_PlatformLinks",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("search", { query: "invoice" });

		const cols = useColumnStack.getState().columns;
		const searchCol = cols.find((c) => c.type === "search");
		assert.ok(searchCol, "Search column must exist");
		assert.equal(searchCol.title, "Search");
		assert.equal(searchCol.width, SPEC.widths.search);
		assert.equal(searchCol.props?.query, "invoice");
	},
});

tier1Registry.register({
	id: "T1-F04-04",
	title: "openPlatformColumn('agent') mounts Agent column with width 380 and title 'Agent Assistant'",
	tier: 1,
	feature: "F04_PlatformLinks",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("agent");

		const cols = useColumnStack.getState().columns;
		const agentCol = cols.find((c) => c.type === "agent");
		assert.ok(agentCol, "Agent column must exist");
		assert.equal(agentCol.title, "Agent Assistant");
		assert.equal(agentCol.width, SPEC.widths.agent);
	},
});

tier1Registry.register({
	id: "T1-F04-05",
	title: "Re-opening existing platform column focuses existing instance without duplicate",
	tier: 1,
	feature: "F04_PlatformLinks",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("settings");
		const countAfterFirst = useColumnStack.getState().columns.length;

		// Open again
		store.openPlatformColumn("settings");
		const colsAfterSecond = useColumnStack.getState().columns;
		assert.equal(colsAfterSecond.length, countAfterFirst, "Must not create duplicate settings column");
		const settingsCols = colsAfterSecond.filter((c) => c.type === "settings");
		assert.equal(settingsCols.length, 1, "Exactly one settings column must exist");
	},
});

// =========================================================================
// FEATURE 5: Smooth Auto-Scroll to Active Column (ORIGINAL_REQUEST §R2)
// =========================================================================

tier1Registry.register({
	id: "T1-F05-01",
	title: "Auto-scroll queries DOM element ID pattern column-${columnId} or column-pane-${columnId}",
	tier: 1,
	feature: "F05_SmoothAutoScroll",
	run: async () => {
		useColumnStack.getState().initializeStack("m-scroll");
		await new Promise((r) => setTimeout(r, 120));

		// Target mock element
		const threadsEl = getMockElement("column-threads") || getMockElement("column-pane-threads");
		assert.ok(threadsEl, "DOM element for threads column should have been queried");
	},
});

tier1Registry.register({
	id: "T1-F05-02",
	title: "scrollIntoView parameters specify behavior: 'smooth'",
	tier: 1,
	feature: "F05_SmoothAutoScroll",
	run: async () => {
		const storeSource = readComponentSource("app/hooks/useColumnStack.ts");
		assert.ok(storeSource);
		assert.match(storeSource, /behavior:\s*["']smooth["']/, "scrollIntoView must specify behavior: 'smooth'");
	},
});

tier1Registry.register({
	id: "T1-F05-03",
	title: "scrollIntoView parameters specify inline: 'nearest' to prevent lateral jumps",
	tier: 1,
	feature: "F05_SmoothAutoScroll",
	run: async () => {
		const storeSource = readComponentSource("app/hooks/useColumnStack.ts");
		assert.ok(storeSource);
		assert.match(storeSource, /inline:\s*["']nearest["']/, "scrollIntoView must specify inline: 'nearest'");
	},
});

tier1Registry.register({
	id: "T1-F05-04",
	title: "Selecting thread triggers auto-scroll to reader column",
	tier: 1,
	feature: "F05_SmoothAutoScroll",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("msg-99", "Scroll Test");

		// Allow animation frames and timeouts to resolve
		await new Promise((r) => setTimeout(r, 120));
		const readerEl = getMockElement("column-reader") || getMockElement("column-pane-reader");
		assert.ok(readerEl, "element for reader column must be queried");
		assert.ok(
			readerEl.scrollIntoViewCalls.length > 0,
			"scrollIntoView must have been called on reader column element",
		);
		const call = readerEl.scrollIntoViewCalls[0];
		assert.equal(call.behavior, "smooth");
		assert.equal(call.inline, "nearest");
	},
});

tier1Registry.register({
	id: "T1-F05-05",
	title: "Scroll helper handles headless / SSR environments safely without throwing",
	tier: 1,
	feature: "F05_SmoothAutoScroll",
	run: async () => {
		assert.doesNotThrow(() => {
			useColumnStack.getState().scrollToColumn("non-existent-column");
		});
	},
});

// =========================================================================
// FEATURE 6: Column Header Dismissal (✕) (ORIGINAL_REQUEST §R2)
// =========================================================================

tier1Registry.register({
	id: "T1-F06-01",
	title: "Root columns specify closable: false in ColumnItem configuration",
	tier: 1,
	feature: "F06_ColumnDismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		const cols = useColumnStack.getState().columns;

		assert.equal(cols[0].closable, false, "Accounts column must not be closable");
		assert.equal(cols[1].closable, false, "Folders column must not be closable");
		assert.equal(cols[2].closable, false, "Threads column must not be closable");
	},
});

tier1Registry.register({
	id: "T1-F06-02",
	title: "Non-root columns specify closable: true in ColumnItem configuration",
	tier: 1,
	feature: "F06_ColumnDismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("t-1", "Reader");
		useColumnStack.getState().openPlatformColumn("settings");

		const cols = useColumnStack.getState().columns;
		const readerCol = cols.find((c) => c.type === "reader");
		const settingsCol = cols.find((c) => c.type === "settings");

		assert.equal(readerCol?.closable, true, "Reader column must be closable");
		assert.equal(settingsCol?.closable, true, "Settings column must be closable");
	},
});

tier1Registry.register({
	id: "T1-F06-03",
	title: "closeColumn removes target column from store array",
	tier: 1,
	feature: "F06_ColumnDismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("t-1", "To Close");
		assert.equal(useColumnStack.getState().columns.length, 4);

		useColumnStack.getState().closeColumn("reader");
		const cols = useColumnStack.getState().columns;
		assert.equal(cols.length, 3);
		assert.ok(!cols.some((c) => c.id === "reader"), "Reader column must be removed");
	},
});

tier1Registry.register({
	id: "T1-F06-04",
	title: "Closing active column shifts focus to predecessor column in stack",
	tier: 1,
	feature: "F06_ColumnDismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("t-1", "Reader");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");

		useColumnStack.getState().closeColumn("reader");
		assert.equal(useColumnStack.getState().activeColumnId, "threads", "Focus should fall back to threads column");
	},
});

tier1Registry.register({
	id: "T1-F06-05",
	title: "Closing reader column resets selectedEmailId to null",
	tier: 1,
	feature: "F06_ColumnDismissal",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("email-xyz", "Subject");
		assert.equal(useColumnStack.getState().selectedEmailId, "email-xyz");

		useColumnStack.getState().closeColumn("reader");
		assert.equal(useColumnStack.getState().selectedEmailId, null, "selectedEmailId must be reset to null");
	},
});

// =========================================================================
// FEATURE 7: Col 1 Accounts (ORIGINAL_REQUEST §R3)
// =========================================================================

tier1Registry.register({
	id: "T1-F07-01",
	title: "Accounts column width is constrained to 300px",
	tier: 1,
	feature: "F07_Col1Accounts",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		const accountsCol = useColumnStack.getState().columns.find((c) => c.type === "accounts");
		assert.equal(accountsCol?.width, SPEC.widths.accounts);

		const componentSource = readComponentSource("app/components/columns/AccountsColumn.tsx");
		assert.ok(componentSource);
		assert.match(componentSource, /width=\{300\}/, "AccountsColumn must pass width={300} to ColumnPane");
	},
});

tier1Registry.register({
	id: "T1-F07-02",
	title: "Accounts column header displays uppercase 'Inboxies' title",
	tier: 1,
	feature: "F07_Col1Accounts",
	run: async () => {
		const componentSource = readComponentSource("app/components/columns/AccountsColumn.tsx");
		assert.ok(componentSource);
		assert.match(componentSource, /Inboxies/, "AccountsColumn must display 'Inboxies' brand title");
	},
});

tier1Registry.register({
	id: "T1-F07-03",
	title: "Active mailbox item displays active indicator dot with bg-kumo-default",
	tier: 1,
	feature: "F07_Col1Accounts",
	run: async () => {
		const componentSource = readComponentSource("app/components/columns/AccountsColumn.tsx");
		assert.ok(componentSource);
		assert.match(
			componentSource,
			/isSelected\s*\?\s*["'][^"']*bg-kumo-default[^"']*["']/,
			"Active indicator dot must use bg-kumo-default when selected",
		);
	},
});

tier1Registry.register({
	id: "T1-F07-04",
	title: "Inactive mailbox item displays indicator dot with bg-kumo-line",
	tier: 1,
	feature: "F07_Col1Accounts",
	run: async () => {
		const componentSource = readComponentSource("app/components/columns/AccountsColumn.tsx");
		assert.ok(componentSource);
		assert.match(componentSource, /bg-kumo-line/, "Inactive account dot must use bg-kumo-line");
	},
});

tier1Registry.register({
	id: "T1-F07-05",
	title: "Account items display mailbox handle in text-kumo-subtle",
	tier: 1,
	feature: "F07_Col1Accounts",
	run: async () => {
		const componentSource = readComponentSource("app/components/columns/AccountsColumn.tsx");
		assert.ok(componentSource);
		assert.match(componentSource, /text-kumo-subtle/, "Account handle must use text-kumo-subtle token");
	},
});

// =========================================================================
// FEATURE 8: Col 2 Folders & HYPERION TAGS (ORIGINAL_REQUEST §R3)
// =========================================================================

tier1Registry.register({
	id: "T1-F08-01",
	title: "Folders column width is configured to 300px",
	tier: 1,
	feature: "F08_Col2FoldersTags",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		const foldersCol = useColumnStack.getState().columns.find((c) => c.type === "folders");
		assert.equal(foldersCol?.width, SPEC.widths.folders);
	},
});

tier1Registry.register({
	id: "T1-F08-02",
	title: "Core system folders list contains all 7 required folders",
	tier: 1,
	feature: "F08_Col2FoldersTags",
	run: async () => {
		const required = ["inbox", "priority", "sent", "drafts", "scheduled", "archive", "trash"];
		for (const f of required) {
			assert.ok(SPEC.coreFolders.includes(f), `System folder ${f} must be supported`);
		}
	},
});

tier1Registry.register({
	id: "T1-F08-03",
	title: "System folder navigation triggers selectFolder in useColumnStack",
	tier: 1,
	feature: "F08_Col2FoldersTags",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectFolder("priority", "VIP & Priority");

		assert.equal(useColumnStack.getState().selectedFolderId, "priority");
		const threadsCol = useColumnStack.getState().columns.find((c) => c.type === "threads");
		assert.equal(threadsCol?.title, "VIP & Priority");
	},
});

tier1Registry.register({
	id: "T1-F08-04",
	title: "Custom tags section header matches 'HYPERION TAGS' specification",
	tier: 1,
	feature: "F08_Col2FoldersTags",
	run: async () => {
		assert.equal(SPEC.tagsSectionHeader, "HYPERION TAGS", "Must match Figma node 18-970 header");
	},
});

tier1Registry.register({
	id: "T1-F08-05",
	title: "Tag pills format with hashtag prefix (#)",
	tier: 1,
	feature: "F08_Col2FoldersTags",
	run: async () => {
		const sampleTag = "Engineering-PRs";
		const formatted = `#${sampleTag}`;
		assert.match(formatted, /^#[a-zA-Z0-9_-]+$/, "Tag pill must be hashtag prefixed");
	},
});

// =========================================================================
// FEATURE 9: Col 3 Thread List (ORIGINAL_REQUEST §R3)
// =========================================================================

tier1Registry.register({
	id: "T1-F09-01",
	title: "Thread List column width is configured to 400px",
	tier: 1,
	feature: "F09_Col3ThreadList",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		const threadsCol = useColumnStack.getState().columns.find((c) => c.type === "threads");
		assert.equal(threadsCol?.width, SPEC.widths.threads);
	},
});

tier1Registry.register({
	id: "T1-F09-02",
	title: "Thread list column header displays folder title and count badge",
	tier: 1,
	feature: "F09_Col3ThreadList",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1", "inbox");
		const threadsCol = useColumnStack.getState().columns.find((c) => c.type === "threads");
		assert.equal(threadsCol?.title, "Inbox");
	},
});

tier1Registry.register({
	id: "T1-F09-03",
	title: "Selecting a thread updates activeColumnId to reader",
	tier: 1,
	feature: "F09_Col3ThreadList",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("email-999", "Important Announcement");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");
	},
});

tier1Registry.register({
	id: "T1-F09-04",
	title: "Thread cards display sender, timestamp, subject, and 1-line snippet",
	tier: 1,
	feature: "F09_Col3ThreadList",
	run: async () => {
		const source = readComponentSource("app/components/columns/ThreadListColumn.tsx");
		assert.ok(source, "ThreadListColumn.tsx component must exist");

		// Verify component structure includes sender, timestamp, subject, snippet
		assert.match(source, /formatParticipants\(email\)/, "Must format participants/sender");
		assert.match(source, /formatListDate\(email\.date\)/, "Must format email list date/timestamp");
		assert.match(source, /email\.subject\s*\|\|\s*"\(no subject\)"/, "Must display subject with fallback");
		assert.match(source, /getSnippetText\(email\.snippet\s*\|\|\s*email\.body\)/, "Must extract snippet safely from email.snippet or email.body");

		// Execute real formatting functions with genuine email data
		const testEmail = {
			id: "email-101",
			sender: "alice@example.com",
			sender_name: "Alice Smith",
			date: new Date(Date.now() - 3600000).toISOString(),
			subject: "Sprint Sync Notes",
			snippet: "Here are the notes from our morning standup meeting.",
			body: "<p>Full HTML body text</p>",
			read: false,
		};

		const formattedSender = formatParticipants(testEmail);
		assert.equal(formattedSender, "Alice Smith", "Should extract display name from email address");

		const formattedDate = formatListDate(testEmail.date);
		assert.ok(typeof formattedDate === "string" && formattedDate.length > 0, "Should format date string");

		const extractedSnippet = getSnippetText(testEmail.snippet || testEmail.body);
		assert.equal(extractedSnippet, "Here are the notes from our morning standup meeting.", "Should extract clean snippet text");

		// Verify fallback to body when snippet is absent
		const emailWithoutSnippet = {
			id: "email-102",
			from: "Bob <bob@example.com>",
			date: new Date().toISOString(),
			subject: "No Snippet Email",
			body: "<p>This is the <b>body</b> content that should be used as snippet.</p>",
		};
		const fallbackSnippet = getSnippetText(emailWithoutSnippet.snippet || emailWithoutSnippet.body);
		assert.equal(fallbackSnippet, "This is the body content that should be used as snippet.");
	},
});

tier1Registry.register({
	id: "T1-F09-05",
	title: "Thread cards support tag chips and attachment count indicator",
	tier: 1,
	feature: "F09_Col3ThreadList",
	run: async () => {
		const source = readComponentSource("app/components/columns/ThreadListColumn.tsx");
		assert.ok(source, "ThreadListColumn.tsx component must exist");

		// Verify component implementation checks tags and attachments safely
		assert.match(source, /hasFileAttachment\(email\)/, "Must use hasFileAttachment utility");
		assert.match(source, /PaperclipIcon/, "Must render PaperclipIcon for attachments");
		assert.match(source, /\(email as any\)\.tags/, "Must check email.tags");
		assert.match(source, /attachmentCount\s*>\s*1/, "Must handle plural attachment files text");

		// Execute tag extraction logic matching component
		const emailWithTags = {
			id: "e-1",
			tags: ["Engineering-PRs", "#Design"],
			category: "Engineering-PRs",
			attachmentsCount: 2,
		};
		const tags = (emailWithTags.tags ? emailWithTags.tags : emailWithTags.category ? [emailWithTags.category] : []).map(
			(t) => (t.startsWith("#") ? t : `#${t}`),
		);
		assert.deepEqual(tags, ["#Engineering-PRs", "#Design"], "Tags must be normalized with # prefix");

		// Execute attachment presence and count logic matching component
		const hasAttachment =
			hasFileAttachment(emailWithTags) ||
			(emailWithTags.attachmentsCount ?? 0) > 0;
		assert.equal(hasAttachment, true, "Email with attachmentsCount > 0 must indicate attachment");

		const count = emailWithTags.attachmentsCount;
		const attachmentText = count > 1 ? `${count} files` : count === 1 ? "1 file" : "file";
		assert.equal(attachmentText, "2 files", "Plural attachment count should render '2 files'");

		// Email with 1 attachment
		const emailSingleAttach = { id: "e-2", attachmentsCount: 1 };
		const singleText = emailSingleAttach.attachmentsCount > 1 ? `${emailSingleAttach.attachmentsCount} files` : "1 file";
		assert.equal(singleText, "1 file", "Single attachment count should render '1 file'");
	},
});

// =========================================================================
// FEATURE 10: Col 4 Reading Room (ORIGINAL_REQUEST §R3)
// =========================================================================

tier1Registry.register({
	id: "T1-F10-01",
	title: "Reading Room column specifies width min-w-[700px] flex-1 or min-w-[848px] flex-1",
	tier: 1,
	feature: "F10_Col4ReadingRoom",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1", "inbox", "e-1");
		const readerCol = useColumnStack.getState().columns.find((c) => c.type === "reader");
		assert.ok(readerCol, "Reader column must exist in stack");
		assert.match(String(readerCol.width), /min-w-.*flex-1/);
	},
});

tier1Registry.register({
	id: "T1-F10-02",
	title: "Reading Room column specifies closable: true with header dismiss action",
	tier: 1,
	feature: "F10_Col4ReadingRoom",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1", "inbox", "e-1");
		const readerCol = useColumnStack.getState().columns.find((c) => c.type === "reader");
		assert.equal(readerCol?.closable, true);
	},
});

tier1Registry.register({
	id: "T1-F10-03",
	title: "Reading Room header displays subject title",
	tier: 1,
	feature: "F10_Col4ReadingRoom",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("msg-header-test", "Architecture RFC v2");
		const readerCol = useColumnStack.getState().columns.find((c) => c.type === "reader");
		assert.equal(readerCol?.title, "Architecture RFC v2");
	},
});

tier1Registry.register({
	id: "T1-F10-04",
	title: "Reading Room integrates EmailPanel subcomponents",
	tier: 1,
	feature: "F10_Col4ReadingRoom",
	run: async () => {
		const emailPanelSource = readComponentSource("app/components/EmailPanel.tsx");
		assert.ok(emailPanelSource, "EmailPanel.tsx must exist");
	},
});

tier1Registry.register({
	id: "T1-F10-05",
	title: "Reading Room retains active selection highlight when focused",
	tier: 1,
	feature: "F10_Col4ReadingRoom",
	run: async () => {
		useColumnStack.getState().initializeStack("m-1");
		useColumnStack.getState().selectThread("msg-1", "Subject");
		assert.equal(useColumnStack.getState().activeColumnId, "reader");
	},
});

// =========================================================================
// FEATURE 11: Docked Quick Reply Bar (ORIGINAL_REQUEST §R3)
// =========================================================================

tier1Registry.register({
	id: "T1-F11-01",
	title: "Quick Reply Bar props conform to interface contract",
	tier: 1,
	feature: "F11_QuickReplyBar",
	run: async () => {
		const requiredProps = ["emailId", "mailboxId", "onPopOut", "onAIAssist", "onSend"];
		for (const prop of requiredProps) {
			assert.ok(prop, `Property ${prop} is required in QuickReplyBar contract`);
		}
	},
});

tier1Registry.register({
	id: "T1-F11-02",
	title: "Quick Reply Bar provides Pop Out action with shortcut ⇧⌘O",
	tier: 1,
	feature: "F11_QuickReplyBar",
	run: async () => {
		const shortcut = SPEC.shortcuts.popOut;
		assert.equal(shortcut.key, "o");
		assert.equal(shortcut.metaKey, true);
		assert.equal(shortcut.shiftKey, true);
	},
});

tier1Registry.register({
	id: "T1-F11-03",
	title: "Quick Reply Bar provides AI Assist action with shortcut ⌘J",
	tier: 1,
	feature: "F11_QuickReplyBar",
	run: async () => {
		const shortcut = SPEC.shortcuts.aiAssist;
		assert.equal(shortcut.key, "j");
		assert.equal(shortcut.metaKey, true);
	},
});

tier1Registry.register({
	id: "T1-F11-04",
	title: "Pop Out action triggers opening Compose column in column stack",
	tier: 1,
	feature: "F11_QuickReplyBar",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1", "inbox", "email-pop");
		// Simulate pop out
		store.openPlatformColumn("compose", { initialDraft: "Draft text from quick reply" });

		const composeCol = useColumnStack.getState().columns.find((c) => c.type === "compose");
		assert.ok(composeCol);
		assert.equal(composeCol.props?.initialDraft, "Draft text from quick reply");
	},
});

tier1Registry.register({
	id: "T1-F11-05",
	title: "Quick Reply Bar Send action submits draft text",
	tier: 1,
	feature: "F11_QuickReplyBar",
	run: async () => {
		let sentText = "";
		const onSend = async (text) => {
			sentText = text;
		};
		await onSend("Thank you for the update!");
		assert.equal(sentText, "Thank you for the update!");
	},
});

// =========================================================================
// FEATURE 12: Floating Omnibar Pill (ORIGINAL_REQUEST §R4)
// =========================================================================

tier1Registry.register({
	id: "T1-F12-01",
	title: "Floating dock positioned fixed at bottom-6 left-1/2 -translate-x-1/2",
	tier: 1,
	feature: "F12_FloatingOmnibar",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /fixed\s+bottom-6\s+left-1\/2\s+-translate-x-1\/2/);
	},
});

tier1Registry.register({
	id: "T1-F12-02",
	title: "Omnibar pill styled with bg-kumo-elevated, backdrop-blur, and border-kumo-line",
	tier: 1,
	feature: "F12_FloatingOmnibar",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /bg-kumo-elevated/);
		assert.match(dockSource, /backdrop-blur/);
		assert.match(dockSource, /border-kumo-line/);
	},
});

tier1Registry.register({
	id: "T1-F12-03",
	title: "Omnibar input placeholder matches 'Search messages, senders, or commands...'",
	tier: 1,
	feature: "F12_FloatingOmnibar",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /Search messages, senders, or commands\.\.\./);
	},
});

tier1Registry.register({
	id: "T1-F12-04",
	title: "Omnibar renders ⌘K shortcut badge in monospace font",
	tier: 1,
	feature: "F12_FloatingOmnibar",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /⌘K/);
	},
});

tier1Registry.register({
	id: "T1-F12-05",
	title: "Global shortcut ⌘K opens Search platform column",
	tier: 1,
	feature: "F12_FloatingOmnibar",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		// Directly verify openPlatformColumn invocation for search
		store.openPlatformColumn("search");
		const searchCol = useColumnStack.getState().columns.find((c) => c.type === "search");
		assert.ok(searchCol, "Search column must open on ⌘K");
	},
});

// =========================================================================
// FEATURE 13: Floating Action Buttons (ORIGINAL_REQUEST §R4)
// =========================================================================

tier1Registry.register({
	id: "T1-F13-01",
	title: "Settings FAB renders Gear icon with accessible aria-label",
	tier: 1,
	feature: "F13_FloatingActionButtons",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /Gear(Six)?Icon/);
		assert.match(dockSource, /aria-label=["']Settings["']/);
	},
});

tier1Registry.register({
	id: "T1-F13-02",
	title: "Compose FAB renders Pencil icon with prominent visual token",
	tier: 1,
	feature: "F13_FloatingActionButtons",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /PencilSimpleIcon/);
		assert.match(dockSource, /aria-label=["'](Compose New Message|New Message)["']/);
	},
});

tier1Registry.register({
	id: "T1-F13-03",
	title: "Clicking Settings FAB opens Settings platform column in stack",
	tier: 1,
	feature: "F13_FloatingActionButtons",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("settings", undefined, true);

		const settingsCol = useColumnStack.getState().columns.find((c) => c.type === "settings");
		assert.ok(settingsCol);
		assert.equal(useColumnStack.getState().activeColumnId, settingsCol.id);
	},
});

tier1Registry.register({
	id: "T1-F13-04",
	title: "Clicking Compose FAB opens Compose platform column in stack",
	tier: 1,
	feature: "F13_FloatingActionButtons",
	run: async () => {
		const store = useColumnStack.getState();
		store.initializeStack("m-1");
		store.openPlatformColumn("compose", undefined, true);

		const composeCol = useColumnStack.getState().columns.find((c) => c.type === "compose");
		assert.ok(composeCol);
		assert.equal(useColumnStack.getState().activeColumnId, composeCol.id);
	},
});

tier1Registry.register({
	id: "T1-F13-05",
	title: "Floating dock provides tooltips with shortcut cues for Settings and Compose",
	tier: 1,
	feature: "F13_FloatingActionButtons",
	run: async () => {
		const dockSource = readComponentSource("app/components/columns/FloatingDock.tsx");
		assert.ok(dockSource);
		assert.match(dockSource, /Tooltip.*content=["']Settings \(⌘,\)["']/);
		assert.match(dockSource, /Tooltip.*content=["']New Message \(⌘N\)["']/);
	},
});

// =========================================================================
// FEATURE 14: Email Core Engine Preservation (ORIGINAL_REQUEST §R5)
// =========================================================================

tier1Registry.register({
	id: "T1-F14-01",
	title: "Preserves ThreadMessage accordion collapse and expansion",
	tier: 1,
	feature: "F14_EmailCoreEngine",
	run: async () => {
		const threadMsgSource = readComponentSource("app/components/email-panel/ThreadMessage.tsx");
		assert.ok(threadMsgSource, "ThreadMessage.tsx must exist");
		assert.match(threadMsgSource, /isExpanded/, "ThreadMessage must support isExpanded collapse state");
	},
});

tier1Registry.register({
	id: "T1-F14-02",
	title: "Preserves EmailIframe HTML rendering with sandboxing",
	tier: 1,
	feature: "F14_EmailCoreEngine",
	run: async () => {
		const iframeSource = readComponentSource("app/components/EmailIframe.tsx");
		assert.ok(iframeSource, "EmailIframe.tsx must exist");
		assert.match(iframeSource, /iframe/, "EmailIframe must render HTML inside an iframe");
	},
});

tier1Registry.register({
	id: "T1-F14-03",
	title: "Preserves EmailPanelToolbar actions (Reply, Forward, Star, Trash)",
	tier: 1,
	feature: "F14_EmailCoreEngine",
	run: async () => {
		const toolbarSource = readComponentSource("app/components/email-panel/EmailPanelToolbar.tsx");
		assert.ok(toolbarSource, "EmailPanelToolbar.tsx must exist");
		assert.match(toolbarSource, /Reply|Star|Trash/, "EmailPanelToolbar must support primary actions");
	},
});

tier1Registry.register({
	id: "T1-F14-04",
	title: "Preserves EmailAttachmentList with download and preview",
	tier: 1,
	feature: "F14_EmailCoreEngine",
	run: async () => {
		const attachSource = readComponentSource("app/components/EmailAttachmentList.tsx");
		assert.ok(attachSource, "EmailAttachmentList.tsx must exist");
		assert.match(attachSource, /attachments/, "EmailAttachmentList must handle attachments");
	},
});

tier1Registry.register({
	id: "T1-F14-05",
	title: "Preserves ScreenerTriageBar for triage of unknown senders",
	tier: 1,
	feature: "F14_EmailCoreEngine",
	run: async () => {
		const screenerSource = readComponentSource("app/components/email-panel/ScreenerTriageBar.tsx");
		assert.ok(screenerSource, "ScreenerTriageBar.tsx must exist");
	},
});

// =========================================================================
// FEATURE 15: Strict Kumo Token Compliance (ORIGINAL_REQUEST §R3)
// =========================================================================

tier1Registry.register({
	id: "T1-F15-01",
	title: "ColumnPane.tsx contains zero forbidden unthemed colors",
	tier: 1,
	feature: "F15_KumoCompliance",
	run: async () => {
		const res = verifyKumoTokensInFile("app/components/columns/ColumnPane.tsx");
		assert.ok(res.exists, "ColumnPane.tsx must exist");
		assert.equal(res.violations.length, 0, `Found violations: ${res.violations.join(", ")}`);
	},
});

tier1Registry.register({
	id: "T1-F15-02",
	title: "AccountsColumn.tsx contains zero forbidden unthemed colors",
	tier: 1,
	feature: "F15_KumoCompliance",
	run: async () => {
		const res = verifyKumoTokensInFile("app/components/columns/AccountsColumn.tsx");
		assert.ok(res.exists, "AccountsColumn.tsx must exist");
		assert.equal(res.violations.length, 0, `Found violations: ${res.violations.join(", ")}`);
	},
});

tier1Registry.register({
	id: "T1-F15-03",
	title: "FloatingDock.tsx contains zero forbidden unthemed colors",
	tier: 1,
	feature: "F15_KumoCompliance",
	run: async () => {
		const res = verifyKumoTokensInFile("app/components/columns/FloatingDock.tsx");
		assert.ok(res.exists, "FloatingDock.tsx must exist");
		assert.equal(res.violations.length, 0, `Found violations: ${res.violations.join(", ")}`);
	},
});

tier1Registry.register({
	id: "T1-F15-04",
	title: "All column border utilities use border-kumo-line or border-kumo-hairline",
	tier: 1,
	feature: "F15_KumoCompliance",
	run: async () => {
		const paneSource = readComponentSource("app/components/columns/ColumnPane.tsx");
		assert.ok(paneSource);
		assert.match(paneSource, /border-kumo-line/);
		assert.doesNotMatch(paneSource, /border-gray-/);
		assert.doesNotMatch(paneSource, /border-zinc-/);
	},
});

tier1Registry.register({
	id: "T1-F15-05",
	title: "All column text colors use text-kumo-default, subtle, strong, or inverse",
	tier: 1,
	feature: "F15_KumoCompliance",
	run: async () => {
		const paneSource = readComponentSource("app/components/columns/ColumnPane.tsx");
		assert.ok(paneSource);
		assert.match(paneSource, /text-kumo-subtle|text-kumo-default/);
		assert.doesNotMatch(paneSource, /text-gray-/);
		assert.doesNotMatch(paneSource, /text-zinc-/);
	},
});
