// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";

export function useAliases(mailboxId: string | undefined) {
	return useQuery({
		queryKey: ["aliases", mailboxId],
		queryFn: ({ signal }) => api.listAliases(mailboxId!, { signal }),
		enabled: Boolean(mailboxId),
		select: (data) => data.aliases,
	});
}

export function useCreateAlias() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			label,
			expiresAt,
			pausedAction,
		}: {
			mailboxId: string;
			label?: string | null;
			expiresAt?: string | null;
			pausedAction?: "drop" | "reject";
		}) =>
			api.createAlias(mailboxId, { label, expiresAt, pausedAction }),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["aliases", mailboxId] });
		},
	});
}

export function useUpdateAlias() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			aliasId,
			label,
			isActive,
			pausedAction,
			expiresAt,
		}: {
			mailboxId: string;
			aliasId: string;
			label?: string | null;
			isActive?: boolean;
			pausedAction?: "drop" | "reject";
			expiresAt?: string | null;
		}) =>
			api.updateAlias(mailboxId, aliasId, {
				label,
				isActive,
				pausedAction,
				expiresAt,
			}),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["aliases", mailboxId] });
		},
	});
}

export function useDeleteAlias() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			aliasId,
		}: {
			mailboxId: string;
			aliasId: string;
		}) => api.deleteAlias(mailboxId, aliasId),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["aliases", mailboxId] });
		},
	});
}
