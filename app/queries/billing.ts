// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { DomainService } from "~/types";
import { queryKeys } from "./keys";

/** A paid domain's service state; pass undefined to skip (e.g. platform domains). */
export function useDomainService(domain: string | undefined) {
	return useQuery<DomainService>({
		queryKey: domain ? queryKeys.domainService(domain) : ["domain-service", "_disabled"],
		queryFn: () => api.getDomainService(domain!),
		enabled: !!domain,
		staleTime: 60_000,
	});
}

/**
 * Renew (or keep) a domain's subscription. A new subscription goes through
 * Stripe Checkout, so the browser leaves; otherwise the state refreshes.
 */
export function useRenewDomain() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (domain: string) => api.renewDomain(domain),
		onSuccess: (res, domain) => {
			if (res.checkoutUrl) {
				window.location.href = res.checkoutUrl;
				return;
			}
			qc.invalidateQueries({ queryKey: queryKeys.domainService(domain) });
			qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
		},
	});
}
