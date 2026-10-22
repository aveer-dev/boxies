// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * `Idempotency-Key` for send / reply / forward (AVE-64, server side AVE-63).
 *
 * Each compose session gets one UUID and sends it on every attempt, so a
 * retry after a timeout or network drop can't send the message twice: the
 * server answers a repeated key with the original `202 { id, status }`
 * (plus `Idempotent-Replayed: true`), which the client treats as success.
 */

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** A fresh key: a v4 UUID (36 printable ASCII chars, within the 200 limit). */
export function newIdempotencyKey(): string {
	return crypto.randomUUID();
}

/** Request headers carrying `key`, or none when there is no key. */
export function idempotencyHeaders(key: string | undefined): Record<string, string> {
	return key ? { [IDEMPOTENCY_KEY_HEADER]: key } : {};
}

/**
 * One key per scope (a draft id, a reply target), kept until `release`:
 * retries of the same scope reuse its key; after a successful send the scope
 * is released so the next message gets a new one.
 */
export function createSendKeyStore(generate: () => string = newIdempotencyKey) {
	const keys = new Map<string, string>();
	return {
		keyFor(scope: string): string {
			let key = keys.get(scope);
			if (!key) {
				key = generate();
				keys.set(scope, key);
			}
			return key;
		},
		release(scope: string): void {
			keys.delete(scope);
		},
	};
}

export type SendKeyStore = ReturnType<typeof createSendKeyStore>;
