// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext, useContext } from "react";

/**
 * This response's Content-Security-Policy nonce (AVE-148), provided by
 * app/entry.server.tsx from the Worker's load context. Only the server render
 * has it; in the browser it is undefined (browsers hide the attribute anyway).
 */
export const CspNonceContext = createContext<string | undefined>(undefined);

export function useCspNonce(): string | undefined {
	return useContext(CspNonceContext);
}
