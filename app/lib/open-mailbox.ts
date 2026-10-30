// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { QueryClient } from "@tanstack/react-query";
import type { NavigateOptions } from "react-router";
import { mailboxHref } from "shared/mailbox-url";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { Mailbox } from "~/types";

/**
 * Open a mailbox the user just gained (invite accepted, mailbox created): its
 * URL is its index in the fresh mailbox list, never its address (AVE-126).
 * Falls back to `/` when the list doesn't have it yet.
 */
export async function openMailbox(
	queryClient: QueryClient,
	navigate: (to: string, options?: NavigateOptions) => unknown,
	mailboxId: string,
	options?: NavigateOptions,
): Promise<void> {
	let ids: string[] = [];
	try {
		await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		const mailboxes = await queryClient.fetchQuery<Mailbox[]>({
			queryKey: queryKeys.mailboxes.all,
			queryFn: () => api.listMailboxes() as Promise<Mailbox[]>,
		});
		ids = mailboxes.map((m) => m.id);
	} catch {
		// The list page at `/` will load it again.
	}
	navigate(mailboxHref(mailboxId, ids) ?? "/", options);
}
