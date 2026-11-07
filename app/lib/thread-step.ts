// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The thread j (`step` 1) or k (`step` -1) moves to, from `current` in the
 * list's on-screen order. With nothing current (or a thread no longer in the
 * list) it starts at the first thread. At either end it stays put (null):
 * it doesn't wrap, and it doesn't turn the page.
 */
export function stepThread(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
	if (ids.length === 0) return null;
	const i = current ? ids.indexOf(current) : -1;
	if (i === -1) return ids[0];
	return ids[i + step] ?? null;
}
