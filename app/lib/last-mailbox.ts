// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The last mailbox the user opened in this browser (AVE-90). Opening the app at
 * `/` goes back to it until another mailbox is opened. A URL that names a
 * mailbox always wins; only the bare root redirects. Stored per signed-in user
 * so a shared browser never sends one account into another's last mailbox.
 */

const KEY_PREFIX = "inboxies-last-mailbox:";

/** Router state that shows the mailbox list at `/` instead of redirecting. */
export const SHOW_ALL_MAILBOXES_STATE = { showAllMailboxes: true } as const;

export function wantsAllMailboxes(state: unknown): boolean {
	return Boolean(
		state &&
			typeof state === "object" &&
			(state as { showAllMailboxes?: unknown }).showAllMailboxes === true,
	);
}

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		// Blocked site data throws on access.
		return null;
	}
}

export function lastMailboxKey(userId: string): string {
	return `${KEY_PREFIX}${userId}`;
}

/**
 * Where `/` should go: the remembered mailbox while the user can still open it,
 * otherwise nowhere (the list shows, the current default).
 */
export function pickRememberedMailbox(
	remembered: string | null | undefined,
	mailboxIds: readonly string[],
): string | null {
	if (!remembered) return null;
	return mailboxIds.includes(remembered) ? remembered : null;
}

export function readLastMailbox(
	userId: string | null | undefined,
	storage: KeyValueStorage | null = defaultStorage(),
): string | null {
	if (!userId || !storage) return null;
	try {
		return storage.getItem(lastMailboxKey(userId)) || null;
	} catch {
		return null;
	}
}

export function rememberLastMailbox(
	userId: string | null | undefined,
	mailboxId: string,
	storage: KeyValueStorage | null = defaultStorage(),
): void {
	if (!userId || !mailboxId || !storage) return;
	try {
		storage.setItem(lastMailboxKey(userId), mailboxId);
	} catch {}
}

export function forgetLastMailbox(
	userId: string | null | undefined,
	storage: KeyValueStorage | null = defaultStorage(),
): void {
	if (!userId || !storage) return;
	try {
		storage.removeItem(lastMailboxKey(userId));
	} catch {}
}

/** Sign-out: drop every account's remembered mailbox from this browser. */
export function forgetAllLastMailboxes(
	storage: (KeyValueStorage & Pick<Storage, "key" | "length">) | null = defaultStorage(),
): void {
	if (!storage) return;
	try {
		const keys: string[] = [];
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key?.startsWith(KEY_PREFIX)) keys.push(key);
		}
		for (const key of keys) storage.removeItem(key);
	} catch {}
}
