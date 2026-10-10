// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { principalKeys, type RequestPrincipal } from "./mailbox-acl";
import { aliasMetadataKey, canonicalMailboxId } from "./mailbox-routing";
import { listAllR2Objects } from "./r2-list";

export interface DomainRegistrationInfo {
	provider: "cloudflare_registrar" | "external";
	registeredAt?: string;
	expiresAt?: string;
	autoRenew: boolean;
	whoisPrivacy: boolean;
	locked: boolean;
	eppAuthCodeRequestedAt?: string;
	orderId?: string;
	retailPriceUsd?: number;
}

export interface DomainAlias {
	aliasLocal: string;
	aliasEmail: string;
	targetMailboxId: string;
	createdAt: string;
}

export interface DomainMetadata {
	domain: string;
	zoneId: string;
	ownerUserId: string;
	adminUserIds: string[];
	status: "pending_nameservers" | "active" | "error" | "offboarding";
	nameservers: string[];
	emailRoutingEnabled: boolean;
	registration?: DomainRegistrationInfo;
	aliases?: DomainAlias[];
	createdAt: string;
	updatedAt: string;
}

export const DOMAINS_PREFIX = "platform/domains/";

export function domainR2Key(domain: string): string {
	const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	return `${DOMAINS_PREFIX}${normalized}.json`;
}

/**
 * Retrieve domain metadata from R2.
 */
export async function getDomainMetadata(
	bucket: R2Bucket,
	domain: string,
): Promise<DomainMetadata | null> {
	const key = domainR2Key(domain);
	const obj = await bucket.get(key);
	if (!obj) return null;
	try {
		return (await obj.json()) as DomainMetadata;
	} catch {
		return null;
	}
}

/**
 * Persist or update domain metadata in R2.
 */
export async function saveDomainMetadata(
	bucket: R2Bucket,
	metadata: DomainMetadata,
): Promise<void> {
	const key = domainR2Key(metadata.domain);
	await bucket.put(key, JSON.stringify(metadata, null, 2), {
		httpMetadata: { contentType: "application/json" },
	});
}

/**
 * Delete domain metadata from R2.
 */
export async function deleteDomainMetadata(
	bucket: R2Bucket,
	domain: string,
): Promise<void> {
	const key = domainR2Key(domain);
	await bucket.delete(key);
}

/**
 * List all registered domains in R2.
 */
export async function listAllRegisteredDomains(
	bucket: R2Bucket,
): Promise<DomainMetadata[]> {
	const listed = { objects: await listAllR2Objects(bucket, DOMAINS_PREFIX) };
	const results: DomainMetadata[] = [];

	for (const object of listed.objects) {
		const obj = await bucket.get(object.key);
		if (obj) {
			try {
				const meta = (await obj.json()) as DomainMetadata;
				results.push(meta);
			} catch {
				// skip invalid entries
			}
		}
	}

	return results;
}

/**
 * Check if the given principal has administrative rights over the domain.
 */
export function isPrincipalAdminForDomain(
	domainMetadata: DomainMetadata,
	principal: RequestPrincipal | null | undefined,
	isSuperAdmin = false,
): boolean {
	if (isSuperAdmin) return true;
	if (!principal) return false;

	const keys = principalKeys(principal);
	const ownerKey = `user:${domainMetadata.ownerUserId}`;

	if (keys.includes(ownerKey)) return true;

	// Check if any principal key matches adminUserIds
	for (const adminId of domainMetadata.adminUserIds) {
		const adminKey = adminId.includes(":") ? adminId : `user:${adminId}`;
		if (keys.includes(adminKey)) return true;
	}

	// Check direct email match against domain admin list
	if (principal.email && domainMetadata.adminUserIds.includes(principal.email.toLowerCase())) {
		return true;
	}

	return false;
}

/**
 * List all domains that the given principal is authorized to administer.
 */
export async function listDomainsForPrincipal(
	bucket: R2Bucket,
	principal: RequestPrincipal | null | undefined,
	isSuperAdmin = false,
): Promise<DomainMetadata[]> {
	const all = await listAllRegisteredDomains(bucket);
	if (isSuperAdmin) return all;
	if (!principal) return [];

	return all.filter((meta) => isPrincipalAdminForDomain(meta, principal, isSuperAdmin));
}

/**
 * Save an email alias for a domain and store its fast-lookup record in R2.
 */
export async function saveEmailAlias(
	bucket: R2Bucket,
	domain: string,
	aliasLocal: string,
	targetMailboxId: string,
): Promise<DomainAlias> {
	const normalizedDomain = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	const cleanLocal = aliasLocal.trim().toLowerCase().replace(/^@+/, "");
	const aliasEmail = `${cleanLocal}@${normalizedDomain}`;
	const canonicalTarget = canonicalMailboxId(targetMailboxId) || targetMailboxId.trim().toLowerCase();

	const meta = await getDomainMetadata(bucket, normalizedDomain);
	if (!meta) {
		throw new Error(`Domain '${normalizedDomain}' not found`);
	}

	const aliasRecord: DomainAlias = {
		aliasLocal: cleanLocal,
		aliasEmail,
		targetMailboxId: canonicalTarget,
		createdAt: new Date().toISOString(),
	};

	// 1. Store direct O(1) resolution record in R2
	await bucket.put(
		aliasMetadataKey(aliasEmail),
		JSON.stringify({
			aliasEmail,
			targetMailboxId: canonicalTarget,
			domain: normalizedDomain,
			createdAt: aliasRecord.createdAt,
		}),
		{ httpMetadata: { contentType: "application/json" } },
	);

	// 2. Update DomainMetadata aliases array
	const existingAliases = (meta.aliases || []).filter((a) => a.aliasLocal !== cleanLocal);
	existingAliases.push(aliasRecord);
	meta.aliases = existingAliases;
	meta.updatedAt = new Date().toISOString();
	await saveDomainMetadata(bucket, meta);

	return aliasRecord;
}

/**
 * Delete an email alias for a domain.
 */
export async function deleteEmailAlias(
	bucket: R2Bucket,
	domain: string,
	aliasLocal: string,
): Promise<void> {
	const normalizedDomain = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	const cleanLocal = aliasLocal.trim().toLowerCase().replace(/^@+/, "");
	const aliasEmail = `${cleanLocal}@${normalizedDomain}`;

	const meta = await getDomainMetadata(bucket, normalizedDomain);
	if (!meta) {
		throw new Error(`Domain '${normalizedDomain}' not found`);
	}

	// 1. Delete O(1) lookup record
	await bucket.delete(aliasMetadataKey(aliasEmail));

	// 2. Remove from DomainMetadata
	if (meta.aliases) {
		meta.aliases = meta.aliases.filter((a) => a.aliasLocal !== cleanLocal);
		meta.updatedAt = new Date().toISOString();
		await saveDomainMetadata(bucket, meta);
	}
}

/**
 * List all email aliases configured for a domain.
 */
export async function listEmailAliases(
	bucket: R2Bucket,
	domain: string,
): Promise<DomainAlias[]> {
	const meta = await getDomainMetadata(bucket, domain);
	return meta?.aliases || [];
}
