// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Every object under `prefix`. A single `bucket.list()` stops at 1,000 keys,
 * which silently dropped mailboxes, domains, exports and accounts past that.
 */
export async function listAllR2Objects(
	bucket: R2Bucket,
	prefix: string,
): Promise<R2Object[]> {
	const objects: R2Object[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
		objects.push(...page.objects);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return objects;
}
