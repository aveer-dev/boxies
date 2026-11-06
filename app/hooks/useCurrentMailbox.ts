// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext, useContext } from "react";

/**
 * The mailbox the `/mailbox/:mailboxRef` route resolved (routes/mailbox.tsx).
 * The URL holds only `mailboxRef`, the mailbox's index in the user's list
 * (AVE-126); `mailboxId` is the real id (its address) for API calls.
 */
export type CurrentMailbox = { mailboxId: string; mailboxRef: string };

export const CurrentMailboxContext = createContext<CurrentMailbox | null>(null);

/** The open mailbox's real id, or "" outside a mailbox route. Use it for API calls. */
export function useMailboxId(): string {
	return useContext(CurrentMailboxContext)?.mailboxId ?? "";
}

/** The open mailbox's URL segment (its index), or "" outside a mailbox route. Use it for links. */
export function useMailboxRef(): string {
	return useContext(CurrentMailboxContext)?.mailboxRef ?? "";
}
