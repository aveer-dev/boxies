// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { queryKeys } from "./keys";

/** The signed-in user (401 when signed out; not retried). */
export function useMe(options?: { enabled?: boolean }) {
	return useQuery({
		queryKey: queryKeys.account.me,
		queryFn: () => api.getMe(),
		staleTime: 60_000,
		enabled: options?.enabled ?? true,
	});
}

export function useIdentities() {
	return useQuery({
		queryKey: queryKeys.account.identities,
		queryFn: () => api.listIdentities(),
		staleTime: 30_000,
	});
}

export function useSessions() {
	return useQuery({
		queryKey: queryKeys.account.sessions,
		queryFn: () => api.listSessions(),
		staleTime: 15_000,
	});
}

export function useMcpGrants() {
	return useQuery({
		queryKey: queryKeys.account.mcpGrants,
		queryFn: () => api.listMcpGrants(),
		staleTime: 15_000,
	});
}

export function useRecoveryEmail() {
	return useQuery({
		queryKey: queryKeys.account.recoveryEmail,
		queryFn: () => api.getRecoveryEmail(),
		staleTime: 60_000,
	});
}
