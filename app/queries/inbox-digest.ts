// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { InboxDigest } from "~/types";
import { queryKeys } from "./keys";

export function useInboxDigest(mailboxId: string | undefined) {
	return useQuery<InboxDigest>({
		queryKey: mailboxId
			? queryKeys.inboxDigest.detail(mailboxId)
			: ["inbox-digest", "_disabled"],
		queryFn: ({ signal }) => api.getInboxDigest(mailboxId!, { signal }),
		enabled: !!mailboxId,
	});
}

export function useCompleteDigestTodo() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			todoId,
		}: { mailboxId: string; todoId: string }) =>
			api.completeDigestTodo(mailboxId, todoId),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({
				queryKey: queryKeys.inboxDigest.detail(mailboxId),
			});
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
		},
	});
}

export function useMarkDigestTopicRead() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			topicId,
			emailIds,
		}: { mailboxId: string; topicId: string; emailIds: string[] }) =>
			api.markDigestTopicRead(mailboxId, topicId, emailIds),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({
				queryKey: queryKeys.inboxDigest.detail(mailboxId),
			});
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
		},
	});
}
