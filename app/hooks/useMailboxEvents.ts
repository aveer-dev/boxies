// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "~/queries/keys";

/**
 * Subscribe to mailbox SSE and invalidate email queries when delivery
 * state (or other email fields) change via `email_updated`.
 */
export function useMailboxEvents(mailboxId: string | undefined) {
	const qc = useQueryClient();

	useEffect(() => {
		if (!mailboxId) return;

		const url = `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/events`;
		const source = new EventSource(url, { withCredentials: true });

		const invalidateEmailData = () => {
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
		};

		const onEmailUpdated = () => {
			invalidateEmailData();
		};

		const onNewEmail = () => {
			invalidateEmailData();
		};

		source.addEventListener("email_updated", onEmailUpdated);
		source.addEventListener("new_email", onNewEmail);
		source.addEventListener("email_moved", onEmailUpdated);
		source.addEventListener("emails_refiled", onEmailUpdated);
		source.addEventListener("sender_preference_updated", onEmailUpdated);

		source.onerror = () => {
			// Browser auto-reconnects EventSource; avoid noisy logs.
		};

		return () => {
			source.removeEventListener("email_updated", onEmailUpdated);
			source.removeEventListener("new_email", onNewEmail);
			source.removeEventListener("email_moved", onEmailUpdated);
			source.removeEventListener("emails_refiled", onEmailUpdated);
			source.removeEventListener("sender_preference_updated", onEmailUpdated);
			source.close();
		};
	}, [mailboxId, qc]);
}
