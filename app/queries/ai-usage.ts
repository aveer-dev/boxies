// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";

export const aiUsageQueryKey = (mailboxId: string | undefined) => ["ai-usage", mailboxId] as const;

/** Today's AI usage meters for a mailbox (AVE-45). Refetched after each chat turn. */
export function useAiUsage(mailboxId: string | undefined) {
	return useQuery({
		queryKey: aiUsageQueryKey(mailboxId),
		queryFn: ({ signal }) => api.getAiUsage(mailboxId!, { signal }),
		enabled: Boolean(mailboxId),
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	});
}
