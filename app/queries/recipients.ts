// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import type { RecentRecipient } from "~/types";
import { queryKeys } from "./keys";

export function useRecentRecipients(
	mailboxId: string | undefined,
	q: string,
	options?: { enabled?: boolean; limit?: number },
) {
	const trimmed = q.trim();
	return useQuery<RecentRecipient[]>({
		queryKey: mailboxId
			? queryKeys.recipients.list(mailboxId, trimmed)
			: ["recipients", "_disabled"],
		queryFn: async ({ signal }) => {
			const data = await api.listRecentRecipients(
				mailboxId!,
				{ q: trimmed, limit: options?.limit ?? 20 },
				{ signal },
			);
			return data.recipients ?? [];
		},
		enabled: !!mailboxId && (options?.enabled ?? true),
		staleTime: 60_000,
	});
}
