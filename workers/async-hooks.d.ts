// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// workerd provides `node:async_hooks` under `nodejs_compat` (wrangler.jsonc),
// but the Worker build doesn't load Node's types. Only what we use.
declare module "node:async_hooks" {
	export class AsyncLocalStorage<T> {
		getStore(): T | undefined;
		run<R>(store: T, fn: () => R): R;
	}
}
