// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email } from "~/types";

export function isAuthSpoofed(
	email: Pick<Email, "auth"> | null | undefined,
): boolean {
	return email?.auth?.spoofed === true;
}
