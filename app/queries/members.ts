// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

export function useMailboxMembers(mailboxId: string | undefined) {
	return useQuery({
		queryKey: queryKeys.members.list(mailboxId ?? ""),
		queryFn: () => api.listMailboxMembers(mailboxId!),
		enabled: Boolean(mailboxId),
	});
}

/** Pending invites only; owners and the domain's admins can list them. */
export function usePendingInvites(mailboxId: string | undefined, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.members.invites(mailboxId ?? ""),
		queryFn: async () =>
			(await api.listMailboxInvites(mailboxId!)).filter((i) => i.status === "pending"),
		enabled: Boolean(mailboxId) && enabled,
	});
}
