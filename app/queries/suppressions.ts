// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

/** Suppressions this mailbox may see: its own, or the whole domain's for an admin. */
export function useSuppressions(mailboxId: string | undefined) {
	return useQuery({
		queryKey: queryKeys.suppressions.list(mailboxId ?? ""),
		queryFn: ({ signal }) => api.listSuppressions(mailboxId!, { signal }),
		enabled: Boolean(mailboxId),
	});
}

export function useUnsuppress() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, address }: { mailboxId: string; address: string }) =>
			api.unsuppress(mailboxId, address),
		onSettled: (_data, _error, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: queryKeys.suppressions.list(mailboxId) });
		},
	});
}
