// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
	MAILBOX_EVENT_TARGETS,
	mailboxEventTargets,
	queryKeysForTargets,
	type MailboxEventTarget,
} from "~/lib/mailbox-events";

/** One refetch per burst: a Screener decision emits several events at once. */
const COALESCE_MS = 150;

/**
 * Subscribe to mailbox SSE and invalidate the queries each live event makes
 * stale (see `MAILBOX_EVENT_TARGETS`), so a change made on another device
 * shows up here without waiting for a refetch interval.
 */
export function useMailboxEvents(mailboxId: string | undefined) {
	const qc = useQueryClient();

	useEffect(() => {
		if (!mailboxId) return;

		const url = `/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/events`;
		const source = new EventSource(url, { withCredentials: true });

		const pending = new Set<MailboxEventTarget>();
		let timer: ReturnType<typeof setTimeout> | undefined;

		const flush = () => {
			timer = undefined;
			const keys = queryKeysForTargets(mailboxId, pending);
			pending.clear();
			for (const queryKey of keys) qc.invalidateQueries({ queryKey });
		};

		const onEvent = (event: MessageEvent) => {
			const targets = mailboxEventTargets(event.type);
			if (targets.length === 0) return;
			for (const target of targets) pending.add(target);
			timer ??= setTimeout(flush, COALESCE_MS);
		};

		// EventSource only delivers named events to listeners registered by
		// name; unnamed ones arrive as "message" and fall back to a full refresh.
		const eventNames = [...Object.keys(MAILBOX_EVENT_TARGETS), "message"];
		for (const name of eventNames) source.addEventListener(name, onEvent);

		source.onerror = () => {
			// Browser auto-reconnects EventSource; avoid noisy logs.
		};

		return () => {
			for (const name of eventNames) source.removeEventListener(name, onEvent);
			if (timer) clearTimeout(timer);
			source.close();
		};
	}, [mailboxId, qc]);
}
