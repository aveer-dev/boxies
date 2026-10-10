// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Mailbox } from "~/types";

/** Display name: settings.fromName → name (when not just the address) → local part. */
export function mailboxDisplayName(
	mailbox: Pick<Mailbox, "email" | "name" | "settings"> | undefined,
	fallbackId = "",
): string {
	if (!mailbox) return fallbackId.split("@")[0] || "Mailbox";
	if (mailbox.settings?.fromName) return mailbox.settings.fromName;
	if (mailbox.name && mailbox.name !== mailbox.email) return mailbox.name;
	return mailbox.email.split("@")[0] || mailbox.name;
}
