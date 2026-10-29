// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { SenderRuleKind, SenderRuleVerdict } from "~/types";

/** Allow / block rules for Settings → Senders (AVE-97). */
export function useSenderRules(
	mailboxId: string | undefined,
	params: { verdict: SenderRuleVerdict; q?: string },
) {
	return useQuery({
		queryKey: ["sender-rules", mailboxId, params.verdict, params.q ?? ""],
		queryFn: ({ signal }) =>
			api.listSenderRules(
				mailboxId!,
				{ verdict: params.verdict, q: params.q, limit: 500 },
				{ signal },
			),
		enabled: Boolean(mailboxId),
		select: (data) => data.rules,
	});
}

export function useUpsertSenderRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			...data
		}: {
			mailboxId: string;
			kind: SenderRuleKind;
			value: string;
			verdict: SenderRuleVerdict;
		}) => api.upsertSenderRule(mailboxId, data),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["sender-rules", mailboxId] });
		},
	});
}

export function useDeleteSenderRule() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, ruleId }: { mailboxId: string; ruleId: string }) =>
			api.deleteSenderRule(mailboxId, ruleId),
		onSuccess: (_data, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["sender-rules", mailboxId] });
		},
	});
}
