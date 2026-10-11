// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Folders } from "shared/folders";
import api from "~/services/api";
import type { Folder } from "~/types";
import { queryKeys } from "./keys";

export function useFolders(mailboxId: string | undefined) {
	return useQuery<Folder[]>({
		queryKey: mailboxId
			? queryKeys.folders.list(mailboxId)
			: ["folders", "_disabled"],
		queryFn: () => api.listFolders(mailboxId!) as Promise<Folder[]>,
		enabled: !!mailboxId,
	});
}

/** Inbox unread count per mailbox (shares the per-mailbox folders cache). */
export function useInboxUnreadCounts(mailboxIds: string[]) {
	const results = useQueries({
		queries: mailboxIds.map((mailboxId) => ({
			queryKey: queryKeys.folders.list(mailboxId),
			queryFn: () => api.listFolders(mailboxId) as Promise<Folder[]>,
		})),
	});
	const counts: Record<string, number> = {};
	mailboxIds.forEach((mailboxId, i) => {
		const inbox = results[i]?.data?.find((f) => f.id === Folders.INBOX);
		counts[mailboxId] = inbox?.unreadCount ?? 0;
	});
	return counts;
}

export function useWorkflowPiles(mailboxId: string | undefined) {
	return useQuery<{ id: string; count: number }[]>({
		queryKey: mailboxId
			? queryKeys.workflowPiles.list(mailboxId)
			: ["workflow-piles", "_disabled"],
		queryFn: async () => {
			const data = await api.listWorkflowPiles(mailboxId!);
			return data.piles ?? [];
		},
		enabled: !!mailboxId,
		refetchInterval: 30_000,
	});
}

export function useCreateFolder() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			name,
		}: { mailboxId: string; name: string }) =>
			api.createFolder(mailboxId, name),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}

export function useUpdateFolder() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			name,
		}: { mailboxId: string; id: string; name: string }) =>
			api.updateFolder(mailboxId, id, name),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}

export function useDeleteFolder() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
		}: { mailboxId: string; id: string }) =>
			api.deleteFolder(mailboxId, id),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}
