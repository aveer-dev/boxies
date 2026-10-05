// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { aliasMetadataKey, canonicalMailboxId } from "./mailbox-routing";

export interface StoredAliasMetadata {
	aliasId: string;
	aliasEmail: string;
	targetMailboxId: string;
	domain: string;
	baseDomain: string;
	label: string | null;
	isActive: boolean;
	pausedAction: "drop" | "reject";
	expiresAt: string | null;
	createdAt: string;
}

/**
 * Generate a random lowercase alphanumeric string suitable for masked emails.
 */
export function generateRandomAliasToken(length = 8): string {
	const charset = "abcdefghjkmnpqrstuvwxyz23456789"; // excludes easily confused 0, o, 1, i, l
	const randomBytes = new Uint8Array(length);
	crypto.getRandomValues(randomBytes);
	let result = "";
	for (let i = 0; i < length; i++) {
		result += charset[randomBytes[i] % charset.length];
	}
	return result;
}

/**
 * Normalize and construct the full private subdomain and address.
 * E.g., token="k8m2p9v4", baseDomain="example.com" -> "k8m2p9v4@private.example.com"
 */
export function buildMaskedAddress(token: string, rawBaseDomain: string): {
	aliasEmail: string;
	domain: string;
	baseDomain: string;
	local: string;
} {
	const cleanToken = token.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
	let baseDomain = rawBaseDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	
	// If baseDomain is already "private.something.com", extract the root
	let domain = baseDomain;
	if (baseDomain.startsWith("private.")) {
		baseDomain = baseDomain.slice("private.".length);
	} else {
		domain = `private.${baseDomain}`;
	}

	const aliasEmail = `${cleanToken}@${domain}`;
	return {
		aliasEmail,
		domain,
		baseDomain,
		local: cleanToken,
	};
}

/**
 * Check if an alias has reached its expiration time.
 */
export function isAliasExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
	if (!expiresAt) return false;
	const expiryTime = Date.parse(expiresAt);
	if (Number.isNaN(expiryTime)) return false;
	return expiryTime <= now;
}

/**
 * Validate paused action option ('drop' or 'reject').
 */
export function normalizePausedAction(raw: unknown): "drop" | "reject" {
	return raw === "reject" ? "reject" : "drop";
}

export { aliasMetadataKey };
