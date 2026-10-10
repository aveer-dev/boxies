// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * True only for local development (Vite dev server) or when a Node unit test
 * opts in via `globalThis.__INBOXIES_DEV__ = true`.
 *
 * Use this instead of bare `import.meta.env.DEV` in code that unit tests load:
 * Node has no `import.meta.env`, so the bare form throws there.
 * Anything that fakes billing, registrar, or DNS must be gated on this so a
 * missing secret in production fails closed instead of silently mocking.
 */
export function isDevRuntime(): boolean {
	if ((globalThis as { __INBOXIES_DEV__?: boolean }).__INBOXIES_DEV__ === true) {
		return true;
	}
	return Boolean(import.meta.env?.DEV);
}
