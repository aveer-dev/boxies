// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

let devRuntimeOverride: boolean | undefined;

/**
 * True only under the local Vite dev server (`react-router dev`). Production
 * builds replace `import.meta.env.DEV` with `false`, and plain Node (unit tests)
 * has no `import.meta.env`, so anything gated on this fails closed by default.
 */
export function isDevRuntime(): boolean {
	if (devRuntimeOverride !== undefined) return devRuntimeOverride;
	try {
		const metaEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
		return Boolean(metaEnv && metaEnv.DEV);
	} catch {
		return false;
	}
}

/** Unit tests only: force dev (`true`) or production (`false`); `undefined` restores detection. */
export function setDevRuntimeForTesting(value: boolean | undefined): void {
	devRuntimeOverride = value;
}
