// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { aliasMetadataKey } from "./mailbox-routing";

/**
 * R2 routing record for a private email (masked alias). Shares the
 * `platform/aliases/` prefix with admin domain aliases, which carry
 * neither `kind` nor `aliasId` — see isPrivateAliasMeta.
 */
export interface StoredAliasMetadata {
	kind?: "private";
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

/** Admin-created domain alias record (workers/lib/domain-registry.ts). */
export interface StoredDomainAliasMetadata {
	aliasEmail: string;
	targetMailboxId: string;
	domain?: string;
	createdAt?: string;
}

export type AnyAliasMetadata = StoredAliasMetadata | StoredDomainAliasMetadata;

/** MailboxDO `aliases` row as returned by listAliases / getAlias. */
export interface AliasRow {
	id: string;
	alias_email: string;
	domain: string;
	base_domain: string;
	label: string | null;
	is_active: number;
	paused_action: string;
	expires_at: string | null;
	created_at: string;
	stats_received: number;
	stats_blocked: number;
}

/** Upper bound on private emails per mailbox (active + paused). */
export const MAX_ALIASES_PER_MAILBOX = 1000;

/**
 * Generate a random lowercase alphanumeric string suitable for private emails.
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
 * Build a private address on the apex of the mailbox domain.
 * E.g. token="k8m2p9v4", domain="example.com" -> "k8m2p9v4@example.com".
 *
 * Email Routing catch-all rules only exist for apex domains, so aliases
 * must live there to reach the Worker without a per-address rule.
 */
export function buildPrivateAddress(token: string, mailboxDomain: string): {
	aliasEmail: string;
	domain: string;
	local: string;
} {
	const local = token.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
	const domain = mailboxDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	return { aliasEmail: `${local}@${domain}`, domain, local };
}

/** True for private-email records; false for admin domain aliases. */
export function isPrivateAliasMeta(
	meta: AnyAliasMetadata | null | undefined,
): meta is StoredAliasMetadata {
	if (!meta) return false;
	return (meta as StoredAliasMetadata).kind === "private" || Boolean((meta as StoredAliasMetadata).aliasId);
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

/** Active and not expired — may send and receive. */
export function isAliasUsable(
	alias: Pick<AliasRow, "is_active" | "expires_at"> | null | undefined,
	now = Date.now(),
): boolean {
	if (!alias) return false;
	return Boolean(alias.is_active) && !isAliasExpired(alias.expires_at, now);
}

/**
 * Validate paused action option ('drop' or 'reject').
 */
export function normalizePausedAction(raw: unknown): "drop" | "reject" {
	return raw === "reject" ? "reject" : "drop";
}

/**
 * Who a vacation auto-reply comes from for mail that arrived via an alias.
 * Private emails never auto-reply (that would reveal the mailbox exists
 * behind a throwaway address); admin domain aliases reply as themselves.
 */
export function autoReplySender(
	meta: AnyAliasMetadata | null | undefined,
	mailboxId: string,
): { skip: true } | { skip: false; from: string; fallback: string | null } {
	if (!meta) return { skip: false, from: mailboxId, fallback: null };
	if (isPrivateAliasMeta(meta)) return { skip: true };
	const aliasEmail = meta.aliasEmail?.trim().toLowerCase();
	if (!aliasEmail || aliasEmail === mailboxId.toLowerCase()) {
		return { skip: false, from: mailboxId, fallback: null };
	}
	return { skip: false, from: aliasEmail, fallback: mailboxId };
}

export { aliasMetadataKey };
