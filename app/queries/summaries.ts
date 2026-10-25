// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { AiSummaryResponse } from "~/types";
import { queryKeys } from "./keys";

/**
 * Thread summary for the reader (AVE-20). The server returns the stored one,
 * or generates it on first open / when the thread has a newer message.
 */
export function useThreadSummary(
	mailboxId: string | undefined,
	threadId: string | undefined,
	enabled: boolean,
) {
	return useQuery<AiSummaryResponse>({
		queryKey: mailboxId && threadId
			? queryKeys.summaries.thread(mailboxId, threadId)
			: ["summaries", "_disabled_thread"],
		queryFn: ({ signal }) => api.getThreadSummary(mailboxId!, threadId!, { signal }),
		enabled: enabled && Boolean(mailboxId && threadId),
		staleTime: 5 * 60_000,
		// A model failure (502) is worth one quiet retry, nothing more.
		retry: 1,
	});
}

export function useRegenerateThreadSummary() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, threadId }: { mailboxId: string; threadId: string }) =>
			api.regenerateThreadSummary(mailboxId, threadId),
		onSuccess: (data, { mailboxId, threadId }) => {
			qc.setQueryData(queryKeys.summaries.thread(mailboxId, threadId), data);
		},
	});
}

/**
 * Quick summary of one message in a thread. Only runs once the user asks
 * (`requested`); the server returns a stored one without calling the model.
 */
export function useEmailQuickSummary(
	mailboxId: string | undefined,
	emailId: string,
	requested: boolean,
) {
	return useQuery<AiSummaryResponse>({
		queryKey: mailboxId
			? queryKeys.summaries.email(mailboxId, emailId)
			: ["summaries", "_disabled_email"],
		queryFn: ({ signal }) => api.generateEmailSummary(mailboxId!, emailId, { signal }),
		enabled: requested && Boolean(mailboxId),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

export function useRegenerateEmailSummary() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, emailId }: { mailboxId: string; emailId: string }) =>
			api.generateEmailSummary(mailboxId, emailId, { regenerate: true }),
		onSuccess: (data, { mailboxId, emailId }) => {
			qc.setQueryData(queryKeys.summaries.email(mailboxId, emailId), data);
		},
	});
}
