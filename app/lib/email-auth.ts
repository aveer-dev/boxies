// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email } from "~/types";

type AuthTier = NonNullable<Email["auth_tier"]>;

/** Stored tier, else the tier inside the auth snapshot (older payloads). */
export function emailAuthTier(
	email: Pick<Email, "auth" | "auth_tier"> | null | undefined,
): AuthTier | null {
	if (!email) return null;
	if (email.auth_tier) return email.auth_tier;
	if (email.auth?.authTier) return email.auth.authTier;
	if (email.auth?.spoofed === true) return "failed";
	return null;
}

export function isAuthSpoofed(
	email: Pick<Email, "auth" | "auth_tier"> | null | undefined,
): boolean {
	return email?.auth?.spoofed === true || emailAuthTier(email) === "failed";
}
