// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

export function useSenderPreferences(
	mailboxId: string | undefined,
	params?: { q?: string; folder?: string },
) {
	return useQuery({
		queryKey: ["sender-preferences", mailboxId, params?.q ?? "", params?.folder ?? ""],
		queryFn: ({ signal }) =>
			api.listSenderPreferences(
				mailboxId!,
				{ q: params?.q, folder: params?.folder, limit: 200 },
				{ signal },
			),
		enabled: Boolean(mailboxId),
		select: (data) => data.preferences,
	});
}

export function useUpsertSenderPreference() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			address,
			folderId,
			displayName,
			refile,
		}: {
			mailboxId: string;
			address: string;
			folderId: string;
			displayName?: string | null;
			refile?: boolean;
		}) =>
			api.upsertSenderPreference(mailboxId, address, {
				folderId,
				displayName,
				refile,
			}),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["sender-preferences", mailboxId] });
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		},
	});
}

export function useDeleteSenderPreference() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			address,
		}: {
			mailboxId: string;
			address: string;
		}) => api.deleteSenderPreference(mailboxId, address),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["sender-preferences", mailboxId] });
		},
	});
}
