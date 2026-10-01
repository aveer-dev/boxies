// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { principalKeys, type RequestPrincipal } from "./mailbox-acl";

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

export interface DomainMetadata {
	domain: string;
	zoneId: string;
	ownerUserId: string;
	adminUserIds: string[];
	status: "pending_nameservers" | "active" | "error" | "offboarding";
	nameservers: string[];
	emailRoutingEnabled: boolean;
	registration?: DomainRegistrationInfo;
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
	const listed = await bucket.list({ prefix: DOMAINS_PREFIX });
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
