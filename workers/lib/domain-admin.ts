// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Domain Admin: deployment-scoped allowlist on top of per-mailbox ACL.
 * Env `DOMAIN_ADMINS` is comma-separated emails and optional `sub:…` keys.
 * Optional R2 `platform/admins.json` merges additional keys (Phase 3).
 */

import {
	normalizeAclKey,
	principalKeys,
	type RequestPrincipal,
} from "./mailbox-acl.ts";

export const PLATFORM_ADMINS_KEY = "platform/admins.json";
export const PLATFORM_AUDIT_PREFIX = "platform/audit/";

export type MailboxCreatePolicy = "open" | "admin_only";

/** Parse DOMAIN_ADMINS env into normalized ACL keys. */
export function parseDomainAdminsEnv(raw: string | undefined | null): string[] {
	if (!raw || !raw.trim()) return [];
	const keys: string[] = [];
	for (const part of raw.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const normalized = normalizeAclKey(trimmed);
		if (normalized) keys.push(normalized);
	}
	return [...new Set(keys)];
}

export function parseMailboxCreatePolicy(
	raw: string | undefined | null,
	hasDomainAdmins: boolean,
): MailboxCreatePolicy {
	const value = (raw ?? "").trim().toLowerCase();
	if (value === "open") return "open";
	if (value === "admin_only") return "admin_only";
	// Recommended prod posture once DOMAIN_ADMINS is configured.
	return hasDomainAdmins ? "admin_only" : "open";
}

export function parsePersistedAdmins(raw: unknown): string[] {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
	const admins = (raw as { admins?: unknown }).admins;
	if (!Array.isArray(admins)) return [];
	const keys: string[] = [];
	for (const item of admins) {
		if (typeof item !== "string") continue;
		const normalized = normalizeAclKey(item);
		if (normalized) keys.push(normalized);
	}
	return [...new Set(keys)];
}

export async function loadPersistedAdminKeys(
	bucket: R2Bucket,
): Promise<string[]> {
	const obj = await bucket.get(PLATFORM_ADMINS_KEY);
	if (!obj) return [];
	try {
		return parsePersistedAdmins(await obj.json());
	} catch {
		return [];
	}
}

export async function resolveAdminAllowlist(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
): Promise<Set<string>> {
	const fromEnv = parseDomainAdminsEnv(env.DOMAIN_ADMINS);
	const fromR2 = await loadPersistedAdminKeys(env.BUCKET);
	return new Set([...fromEnv, ...fromR2]);
}

export function principalIsDomainAdmin(
	principal: RequestPrincipal | null | undefined,
	allowlist: Set<string>,
): boolean {
	if (!principal || allowlist.size === 0) return false;
	return principalKeys(principal).some((key) => allowlist.has(key));
}

export async function isDomainAdmin(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	principal: RequestPrincipal | null | undefined,
): Promise<boolean> {
	const allowlist = await resolveAdminAllowlist(env);
	return principalIsDomainAdmin(principal, allowlist);
}

export async function requireDomainAdmin(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	principal: RequestPrincipal | null | undefined,
): Promise<boolean> {
	return isDomainAdmin(env, principal);
}

export function canCreateMailbox(
	principal: RequestPrincipal | null | undefined,
	opts: {
		isAdmin: boolean;
		policy: MailboxCreatePolicy;
	},
): boolean {
	if (!principal || principalKeys(principal).length === 0) return false;
	if (opts.policy === "open") return true;
	return opts.isAdmin;
}

export type AdminAuditEntry = {
	id: string;
	at: string;
	actorKeys: string[];
	action: string;
	mailboxId?: string;
	detail?: Record<string, unknown>;
};

export async function appendAdminAudit(
	bucket: R2Bucket,
	entry: Omit<AdminAuditEntry, "id" | "at"> & { id?: string; at?: string },
): Promise<AdminAuditEntry> {
	const full: AdminAuditEntry = {
		id: entry.id ?? crypto.randomUUID(),
		at: entry.at ?? new Date().toISOString(),
		actorKeys: entry.actorKeys,
		action: entry.action,
		mailboxId: entry.mailboxId,
		detail: entry.detail,
	};
	const key = `${PLATFORM_AUDIT_PREFIX}${full.at.slice(0, 10)}/${full.id}.json`;
	await bucket.put(key, JSON.stringify(full));
	return full;
}
