// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Folders } from "../../shared/folders";

const FOLDER_NAMES: Record<string, string> = {
	[Folders.INBOX]: "Inbox",
	[Folders.PROMOTIONS]: "Promotions",
	[Folders.UPDATES]: "Updates",
	[Folders.ARCHIVE]: "Archive",
};

/** The move response fields a Spam verdict toast reads (AVE-95, AVE-98, AVE-99). */
export interface SpamVerdictResult {
	senderStatus?: "allowed" | "rejected";
	unsubscribe?: "sent" | "failed";
	rescuedCount?: number;
	undoToken?: string | null;
}

/**
 * Toast copy for a move that crossed Spam (docs/spam-management-plan.md §6):
 * "Moved to Inbox · future mail from ada@x will skip Spam · 3 more moved",
 * "Reported as spam · 3 more moved". Null when the move taught nothing.
 */
export function spamVerdictToastTitle(
	result: SpamVerdictResult | undefined,
	context: { folderId: string; sender?: string | null },
): string | null {
	if (!result?.senderStatus) return null;
	const more = result.rescuedCount && result.rescuedCount > 0 ? ` · ${result.rescuedCount} more moved` : "";
	if (result.senderStatus === "rejected") {
		const base =
			result.unsubscribe === "sent"
				? "Reported as spam and unsubscribed"
				: result.unsubscribe === "failed"
					? "Reported as spam · couldn't unsubscribe"
					: "Reported as spam";
		return base + more;
	}
	const folder = FOLDER_NAMES[context.folderId];
	const moved = folder ? `Moved to ${folder}` : "Moved out of Spam";
	const sender = context.sender?.trim();
	return `${moved}${sender ? ` · future mail from ${sender} will skip Spam` : ""}${more}`;
}

