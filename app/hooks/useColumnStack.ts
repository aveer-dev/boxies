// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";
import { FOLDER_DISPLAY_NAMES, Folders } from "shared/folders";

export type ColumnType =
	| "accounts"
	| "folders"
	| "threads"
	| "reader"
	| "settings"
	| "compose"
	| "search"
	| "agent";

export interface ColumnItem {
	id: string;
	type: ColumnType;
	title: string;
	subtitle?: string;
	width?: number | string; // e.g. 300, 400, 'min-w-[848px] flex-1'
	closable: boolean;
	props?: Record<string, any>;
	parentId?: string;
}

export interface ColumnStackState {
	// State variables
	columns: ColumnItem[];
	activeColumnId: string | null;
	selectedMailboxId: string | null;
	selectedFolderId: string | null;
	selectedEmailId: string | null;

	// Stack initialization
	initializeStack: (mailboxId: string, folderId?: string, emailId?: string) => void;

	// Miller Hierarchy / Parallel Link Actions
	selectMailbox: (mailboxId: string, mailboxName?: string) => void;
	selectFolder: (folderId: string, folderName?: string) => void;
	selectThread: (emailId: string, emailSubject?: string) => void;

	// Generic & Platform Column Operations
	openAdjacentColumn: (
		type: ColumnType,
		props?: Record<string, any>,
		sourceColumnId?: string,
	) => void;
	appendColumn: (
		type: ColumnType,
		props?: Record<string, any>,
	) => void;
	openPlatformColumn: (
		type: "settings" | "compose" | "search" | "agent",
		props?: Record<string, any>,
		placeAtEnd?: boolean,
	) => void;

	// Dismissal & Active Focus
	closeColumn: (columnId: string) => void;
	dismissColumn: (columnId: string) => void; // Alias for closeColumn
	setActiveColumn: (columnId: string) => void;
	scrollToColumn: (columnId: string) => void;

	// Selectors
	getColumn: (columnId: string) => ColumnItem | undefined;
	getColumnIndex: (columnId: string) => number;
}

export const DEFAULT_TITLES: Record<ColumnType, string> = {
	accounts: "Inboxies",
	folders: "Folders & Tags",
	threads: "Inbox",
	reader: "Message",
	settings: "Settings",
	compose: "New Message",
	search: "Search",
	agent: "Agent Assistant",
};

export const DEFAULT_WIDTHS: Record<ColumnType, number | string> = {
	accounts: 300,
	folders: 300,
	threads: 400,
	reader: "min-w-[848px] flex-1",
	settings: 540,
	compose: 560,
	search: 460,
	agent: 380,
};

export function triggerScrollToColumn(columnId: string) {
	if (typeof window === "undefined") return;
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			setTimeout(() => {
				const el =
					document.getElementById(`column-${columnId}`) ||
					document.getElementById(`column-pane-${columnId}`);
				if (el) {
					el.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
				}
			}, 50);
		});
	});
}

export const useColumnStack = create<ColumnStackState>((set, get) => ({
	columns: [],
	activeColumnId: null,
	selectedMailboxId: null,
	selectedFolderId: Folders.INBOX,
	selectedEmailId: null,

	initializeStack: (mailboxId: string, folderId = Folders.INBOX, emailId?: string) => {
		const folderDisplayName = FOLDER_DISPLAY_NAMES[folderId] ?? (folderId === "inbox" ? "Inbox" : folderId);

		const baseColumns: ColumnItem[] = [
			{
				id: "accounts",
				type: "accounts",
				title: DEFAULT_TITLES.accounts,
				width: DEFAULT_WIDTHS.accounts,
				closable: false,
			},
			{
				id: "folders",
				type: "folders",
				title: DEFAULT_TITLES.folders,
				width: DEFAULT_WIDTHS.folders,
				closable: false,
				props: { mailboxId },
				parentId: "accounts",
			},
			{
				id: "threads",
				type: "threads",
				title: folderDisplayName,
				width: DEFAULT_WIDTHS.threads,
				closable: false,
				props: { mailboxId, folderId },
				parentId: "folders",
			},
		];

		if (emailId) {
			baseColumns.push({
				id: "reader",
				type: "reader",
				title: DEFAULT_TITLES.reader,
				width: DEFAULT_WIDTHS.reader,
				closable: true,
				props: { mailboxId, emailId, folderId },
				parentId: "threads",
			});
		}

		const initialActive = emailId ? "reader" : "threads";

		set({
			columns: baseColumns,
			activeColumnId: initialActive,
			selectedMailboxId: mailboxId,
			selectedFolderId: folderId,
			selectedEmailId: emailId || null,
		});

		triggerScrollToColumn(initialActive);
	},

	selectMailbox: (mailboxId: string, mailboxName?: string) => {
		const state = get();
		if (state.selectedMailboxId === mailboxId && state.columns.length > 0) return;

		const currentCols = [...state.columns];
		const accountsCol = currentCols.find((c) => c.type === "accounts") || {
			id: "accounts",
			type: "accounts" as const,
			title: DEFAULT_TITLES.accounts,
			width: DEFAULT_WIDTHS.accounts,
			closable: false,
		};

		const foldersCol: ColumnItem = {
			id: "folders",
			type: "folders",
			title: mailboxName || DEFAULT_TITLES.folders,
			width: DEFAULT_WIDTHS.folders,
			closable: false,
			props: { mailboxId },
			parentId: "accounts",
		};

		const threadsCol: ColumnItem = {
			id: "threads",
			type: "threads",
			title: "Inbox",
			width: DEFAULT_WIDTHS.threads,
			closable: false,
			props: { mailboxId, folderId: Folders.INBOX },
			parentId: "folders",
		};

		// Retain independent platform columns placed at the end if desired
		const platformCols = currentCols.filter(
			(c) => c.type === "settings" || c.type === "compose" || c.type === "search" || c.type === "agent",
		);

		set({
			columns: [accountsCol, foldersCol, threadsCol, ...platformCols],
			selectedMailboxId: mailboxId,
			selectedFolderId: Folders.INBOX,
			selectedEmailId: null,
			activeColumnId: "threads",
		});

		triggerScrollToColumn("threads");
	},

	selectFolder: (folderId: string, folderName?: string) => {
		const state = get();
		const mailboxId = state.selectedMailboxId;
		if (!mailboxId) return;

		const displayName = folderName || FOLDER_DISPLAY_NAMES[folderId] || folderId;
		const currentCols = [...state.columns];
		const foldersIdx = currentCols.findIndex((c) => c.type === "folders");
		const threadsIdx = currentCols.findIndex((c) => c.type === "threads");

		const updatedThreadsCol: ColumnItem = {
			id: "threads",
			type: "threads",
			title: displayName,
			width: DEFAULT_WIDTHS.threads,
			closable: false,
			props: { mailboxId, folderId },
			parentId: "folders",
		};

		let newCols: ColumnItem[];
		if (threadsIdx >= 0) {
			// Sibling replacement at Column N+1 (threadsIdx)
			// Truncate downstream hierarchical columns at N+2+ (such as reader)
			const prefix = currentCols.slice(0, threadsIdx);
			const nonHierarchicalPlatformCols = currentCols
				.slice(threadsIdx + 1)
				.filter((c) => c.type !== "reader" && c.parentId !== "reader");

			newCols = [...prefix, updatedThreadsCol, ...nonHierarchicalPlatformCols];
		} else {
			const insertAt = foldersIdx >= 0 ? foldersIdx + 1 : currentCols.length;
			currentCols.splice(insertAt, 0, updatedThreadsCol);
			newCols = currentCols;
		}

		set({
			columns: newCols,
			selectedFolderId: folderId,
			selectedEmailId: null,
			activeColumnId: "threads",
		});

		triggerScrollToColumn("threads");
	},

	selectThread: (emailId: string, emailSubject?: string) => {
		const state = get();
		const mailboxId = state.selectedMailboxId;
		if (!mailboxId) return;

		const currentCols = [...state.columns];
		const readerIndex = currentCols.findIndex((c) => c.type === "reader");
		const threadsIndex = currentCols.findIndex((c) => c.type === "threads");

		const readerCol: ColumnItem = {
			id: "reader",
			type: "reader",
			title: emailSubject || DEFAULT_TITLES.reader,
			width: DEFAULT_WIDTHS.reader,
			closable: true,
			props: {
				mailboxId,
				emailId,
				folderId: state.selectedFolderId || Folders.INBOX,
			},
			parentId: "threads",
		};

		if (readerIndex >= 0) {
			// In-place replacement at Column N+1
			currentCols[readerIndex] = readerCol;
			// Cleanly slice any columns downstream that were children of the previous reader
			const filtered = currentCols.filter(
				(col, idx) => idx <= readerIndex || (col.type !== "reader" && col.parentId !== "reader"),
			);
			set({
				columns: filtered,
				selectedEmailId: emailId,
				activeColumnId: "reader",
			});
		} else {
			const insertAt = threadsIndex >= 0 ? threadsIndex + 1 : currentCols.length;
			currentCols.splice(insertAt, 0, readerCol);
			set({
				columns: currentCols,
				selectedEmailId: emailId,
				activeColumnId: "reader",
			});
		}

		triggerScrollToColumn("reader");
	},

	openAdjacentColumn: (
		type: ColumnType,
		props?: Record<string, any>,
		sourceColumnId?: string,
	) => {
		const state = get();
		const currentCols = [...state.columns];

		// Deduplication check: Focus existing column if already open
		const existingIndex = currentCols.findIndex((c) => c.type === type || c.id === type);
		if (existingIndex >= 0) {
			if (props) {
				currentCols[existingIndex] = {
					...currentCols[existingIndex],
					props: { ...currentCols[existingIndex].props, ...props },
				};
			}
			set({ columns: currentCols, activeColumnId: currentCols[existingIndex].id });
			triggerScrollToColumn(currentCols[existingIndex].id);
			return;
		}

		const sourceId = sourceColumnId || state.activeColumnId || "threads";
		const sourceIdx = currentCols.findIndex((c) => c.id === sourceId);
		const insertIdx = sourceIdx >= 0 ? sourceIdx + 1 : currentCols.length;

		const newCol: ColumnItem = {
			id: type,
			type,
			title: DEFAULT_TITLES[type] || type,
			width: DEFAULT_WIDTHS[type] || 500,
			closable: true,
			props: { mailboxId: state.selectedMailboxId, ...props },
			parentId: sourceId,
		};

		currentCols.splice(insertIdx, 0, newCol);

		set({
			columns: currentCols,
			activeColumnId: newCol.id,
		});

		triggerScrollToColumn(newCol.id);
	},

	appendColumn: (type: ColumnType, props?: Record<string, any>) => {
		const state = get();
		const currentCols = [...state.columns];

		// Deduplication check
		const existingIndex = currentCols.findIndex((c) => c.type === type || c.id === type);
		if (existingIndex >= 0) {
			if (props) {
				currentCols[existingIndex] = {
					...currentCols[existingIndex],
					props: { ...currentCols[existingIndex].props, ...props },
				};
			}
			set({ columns: currentCols, activeColumnId: currentCols[existingIndex].id });
			triggerScrollToColumn(currentCols[existingIndex].id);
			return;
		}

		const newCol: ColumnItem = {
			id: type,
			type,
			title: DEFAULT_TITLES[type] || type,
			width: DEFAULT_WIDTHS[type] || 500,
			closable: true,
			props: { mailboxId: state.selectedMailboxId, ...props },
		};

		currentCols.push(newCol);

		set({
			columns: currentCols,
			activeColumnId: newCol.id,
		});

		triggerScrollToColumn(newCol.id);
	},

	openPlatformColumn: (
		type: "settings" | "compose" | "search" | "agent",
		props?: Record<string, any>,
		placeAtEnd = true,
	) => {
		if (placeAtEnd) {
			get().appendColumn(type, props);
		} else {
			get().openAdjacentColumn(type, props);
		}
	},

	closeColumn: (columnId: string) => {
		const state = get();
		const targetIndex = state.columns.findIndex((c) => c.id === columnId);
		if (targetIndex === -1) return;

		const targetCol = state.columns[targetIndex];
		if (!targetCol.closable) return; // Prevent closing root non-closable columns

		// Clean up target column and any child columns registered with parentId === columnId
		const filtered = state.columns.filter(
			(c) => c.id !== columnId && c.parentId !== columnId,
		);

		let nextActive = state.activeColumnId;
		if (state.activeColumnId === columnId || !filtered.some((c) => c.id === state.activeColumnId)) {
			// Rollback focus to predecessor
			const fallbackIdx = Math.max(0, targetIndex - 1);
			nextActive = filtered[fallbackIdx]?.id || null;
		}

		set({
			columns: filtered,
			activeColumnId: nextActive,
			selectedEmailId: columnId === "reader" ? null : state.selectedEmailId,
		});

		if (nextActive) {
			triggerScrollToColumn(nextActive);
		}
	},

	dismissColumn: (columnId: string) => {
		get().closeColumn(columnId);
	},

	setActiveColumn: (columnId: string) => {
		set({ activeColumnId: columnId });
	},

	scrollToColumn: (columnId: string) => {
		triggerScrollToColumn(columnId);
	},

	getColumn: (columnId: string) => {
		return get().columns.find((c) => c.id === columnId);
	},

	getColumnIndex: (columnId: string) => {
		return get().columns.findIndex((c) => c.id === columnId);
	},
}));
