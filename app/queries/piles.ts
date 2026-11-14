// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

/**
 * Custom piles (AVE-194): create, rename and delete the piles people make
 * next to Reply Later and Set Aside. The list itself is `useWorkflowPiles`.
 */

function invalidatePiles(qc: QueryClient, mailboxId: string) {
	qc.invalidateQueries({ queryKey: queryKeys.workflowPiles.list(mailboxId) });
	qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
}

export function useCreatePile() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, name }: { mailboxId: string; name: string }) => api.createPile(mailboxId, name),
		onSuccess: (_pile, { mailboxId }) => invalidatePiles(qc, mailboxId),
	});
}

export function useRenamePile() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, pileId, name }: { mailboxId: string; pileId: string; name: string }) =>
			api.renamePile(mailboxId, pileId, name),
		onSuccess: (_pile, { mailboxId }) => invalidatePiles(qc, mailboxId),
	});
}

export function useDeletePile() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, pileId }: { mailboxId: string; pileId: string }) => api.deletePile(mailboxId, pileId),
		onSuccess: (_void, { mailboxId }) => invalidatePiles(qc, mailboxId),
	});
}
