// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AuthShell } from "~/components/AuthShell";
import { OnboardingFlow } from "~/components/OnboardingFlow";
import { isWorkerPagePath, safeRedirectPath } from "~/lib/safe-redirect";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

export function meta() {
	return [{ title: "Get started — Inboxies" }];
}

/**
 * Onboarding as its own page, in the same frame as sign in.
 *
 * Opened from "Get started" on /login (`?next=` carries the sign-in target
 * through) and from the mailbox list's "Add" (`?from=mailboxes`). Cancel goes
 * back to where it was opened; finishing lands where that entry point used to
 * land when onboarding was a dialog.
 */
export default function OnboardingRoute() {
	const routerNavigate = useNavigate();
	const queryClient = useQueryClient();
	const [searchParams] = useSearchParams();
	const fromMailboxes = searchParams.get("from") === "mailboxes";
	const next = searchParams.get("next");

	// Pages the Worker handles first (MCP OAuth consent) need a full page load.
	const navigate = useCallback(
		(to: string) => (isWorkerPagePath(to) ? window.location.assign(to) : routerNavigate(to)),
		[routerNavigate],
	);

	const { data: config } = useQuery({
		queryKey: queryKeys.config,
		queryFn: () => api.getConfig(),
		staleTime: Infinity,
	});

	const handleClose = () => {
		if (fromMailboxes) {
			routerNavigate("/");
			return;
		}
		routerNavigate(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
	};

	const handleSuccess = async (mailboxId: string) => {
		if (fromMailboxes) {
			await queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
			routerNavigate(`/mailbox/${encodeURIComponent(mailboxId)}`);
			return;
		}
		// Same-origin paths only, so `next` can't be used as an open redirect.
		navigate(
			safeRedirectPath(
				next,
				typeof window === "undefined" ? "http://localhost" : window.location.origin,
			),
		);
	};

	return (
		<AuthShell wide>
			<OnboardingFlow
				onClose={handleClose}
				onSuccess={handleSuccess}
				mailDomain={config?.mailDomain || "inboxies.email"}
			/>
		</AuthShell>
	);
}
