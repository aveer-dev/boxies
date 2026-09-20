// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Web re-exports for Inbox New/Seen helpers (typed against app Email).
 */
export {
	applyReadToEmails,
	buildInboxListItems,
	patchEmailListCache,
	type EmailListCacheLike as EmailListCache,
	type InboxListItem,
} from "../../shared/list-sections";
