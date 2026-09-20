// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Canonical folder ID constants.
 *
 * Every part of the stack — API routes, Durable Object, MCP, agent,
 * frontend sidebar — references folder IDs. This module is the single
 * source of truth so we don't scatter magic strings everywhere.
 */

export const Folders = {
	INBOX: "inbox",
	SCREENER: "screener",
	PROMOTIONS: "promotions",
	UPDATES: "updates",
	SENT: "sent",
	DRAFT: "draft",
	ARCHIVE: "archive",
	SPAM: "spam",
	SCREENED_OUT: "screened_out",
	TRASH: "trash",
} as const;

export type FolderId = (typeof Folders)[keyof typeof Folders];

/** Approve destinations for Screener-lite v1 (purpose boxes). */
export const SCREENER_DESTINATION_IDS = [
	Folders.INBOX,
	Folders.PROMOTIONS,
	Folders.UPDATES,
] as const;

export type ScreenerDestinationId = (typeof SCREENER_DESTINATION_IDS)[number];

/**
 * System folder IDs that appear in the sidebar.
 * Order here matches the sidebar display order.
 * `screened_out` is secondary history — clients may hide it from swipe tabs.
 */
export const SYSTEM_FOLDER_IDS: readonly FolderId[] = [
	Folders.INBOX,
	Folders.SCREENER,
	Folders.PROMOTIONS,
	Folders.UPDATES,
	Folders.SENT,
	Folders.DRAFT,
	Folders.ARCHIVE,
	Folders.SPAM,
	Folders.SCREENED_OUT,
	Folders.TRASH,
];

/**
 * Primary swipe / home-chrome folders (excludes screened_out history).
 */
export const PRIMARY_FOLDER_IDS: readonly FolderId[] = SYSTEM_FOLDER_IDS.filter(
	(id) => id !== Folders.SCREENED_OUT,
);

/**
 * Purpose boxes — sender defaults may only target these.
 * Inbox / Promotions / Updates (Hey-shaped Imbox / Feed / Paper Trail).
 */
export const PURPOSE_FOLDER_IDS = [
	Folders.INBOX,
	Folders.PROMOTIONS,
	Folders.UPDATES,
] as const;

export type PurposeFolderId = (typeof PURPOSE_FOLDER_IDS)[number];

export function isPurposeFolderId(folderId: string): folderId is PurposeFolderId {
	return (PURPOSE_FOLDER_IDS as readonly string[]).includes(folderId);
}

/**
 * Human-readable display names for folder IDs.
 * Used in the sidebar, search result badges, and tool descriptions.
 */
export const FOLDER_DISPLAY_NAMES: Record<string, string> = {
	[Folders.INBOX]: "Inbox",
	[Folders.SCREENER]: "Screener",
	[Folders.PROMOTIONS]: "Promotions",
	[Folders.UPDATES]: "Updates",
	[Folders.SENT]: "Sent",
	[Folders.DRAFT]: "Drafts",
	[Folders.ARCHIVE]: "Archive",
	[Folders.TRASH]: "Trash",
	[Folders.SPAM]: "Spam",
	[Folders.SCREENED_OUT]: "Screened out",
};

/** Formatted string for tool parameter descriptions (agent + MCP). */
export const FOLDER_TOOL_DESCRIPTION =
	"Folder to list: inbox, screener, promotions, updates, sent, draft, archive, spam, screened_out, trash";

/** Formatted string for move-email tool descriptions. */
export const MOVE_FOLDER_TOOL_DESCRIPTION =
	"Target folder: inbox, screener, promotions, updates, sent, draft, archive, spam, screened_out, trash";

/**
 * Look up a display name for a folder ID, falling back to the raw ID
 * with a capitalised first letter.
 */
export function getFolderDisplayName(folderId: string): string {
	return FOLDER_DISPLAY_NAMES[folderId.toLowerCase()] || folderId.charAt(0).toUpperCase() + folderId.slice(1);
}
