// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Cloudflare Registrar client for domain availability, registration,
 * wholesale pricing, transfer locks, and EPP authorization codes.
 */

import { CloudflareApiError, type CloudflareClientEnv } from "./cloudflare-client";
import { isDevRuntime } from "./runtime-env";
import type { DomainRegistrationInfo } from "./domain-registry";

export interface DomainPricingBreakdown {
	domainFeeUsd: number;      // Wholesale domain cost (e.g. 10.44 for .com)
	platformFeeUsd: number;    // Platform, AI, storage & server fee (e.g. 9.56 or 10.00)
	totalAnnualUsd: number;    // Total annual subscription (e.g. 20.00 or wholesale + 10.00)
	billingInterval: "year";
	currency: "USD";
	features: {
		domain: string;
		aiAndPlatform: string[];
	};
}

export interface DomainAvailabilityResult {
	domain: string;
	available: boolean;
	registered: boolean;
	wholesalePriceUsd: number;
	retailPriceUsd: number;
	pricing: DomainPricingBreakdown;
	tldSupported: boolean;
	currency: "USD";
	supportedTld: string;
	alreadyInInboxies?: boolean;
}

export interface DomainContactInfo {
	firstName: string;
	lastName: string;
	organization?: string;
	address: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
	email: string;
	phone: string;
}

export interface DomainRegistrationResult {
	domain: string;
	status: "active" | "pending";
	registeredAt: string;
	expiresAt: string;
	autoRenew: boolean;
	locked: boolean;
	whoisPrivacy: boolean;
	registrationInfo: DomainRegistrationInfo;
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// Baseline wholesale ICANN prices for popular TLDs (zero markup)
const TLD_WHOLESALE_PRICING: Record<string, number> = {
	com: 10.44,
	net: 11.0,
	org: 10.11,
	info: 14.0,
	biz: 13.0,
	co: 24.0,
	dev: 12.0,
	app: 14.0,
	me: 15.0,
	io: 35.0,
	ai: 70.0,
	tech: 16.0,
	email: 18.0,
};

const STANDARD_RETAIL_PRICE = 20.0;

// Mock only in local dev / tests. In production missing credentials must fail closed.
function isMockEnv(env: CloudflareClientEnv): boolean {
	return isDevRuntime() && (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID);
}

// In-memory mock registrar store for dev / test environments
const mockRegisteredDomains = new Set<string>([
	"google.com",
	"apple.com",
	"cloudflare.com",
	"inboxies.email",
	"inboxies.com",
	"taken.com",
	"taken.org",
]);

const mockRegistrations = new Map<string, DomainRegistrationResult>();

export function extractTld(domain: string): string {
	const parts = domain.trim().toLowerCase().split(".");
	return parts.length > 1 ? parts[parts.length - 1] : "";
}

/**
 * Transparent domain + platform/AI subscription fee calculator:
 * - When domain wholesale is <= $15.00: Total is $20.00/yr ($10.44 domain + $9.56 platform/AI/storage).
 * - When domain wholesale is > $15.00: Total is wholesale + $10.00/yr platform fee.
 */
export function computeDomainPricing(wholesalePrice: number): DomainPricingBreakdown {
	const domainFee = Math.round(wholesalePrice * 100) / 100;
	const isStandard = domainFee <= 15.0;
	const totalAnnualUsd = isStandard ? STANDARD_RETAIL_PRICE : Math.round((domainFee + 10.0) * 100) / 100;
	const platformFeeUsd = Math.round((totalAnnualUsd - domainFee) * 100) / 100;

	return {
		domainFeeUsd: domainFee,
		platformFeeUsd,
		totalAnnualUsd,
		billingInterval: "year",
		currency: "USD",
		features: {
			domain: "1-year domain registration & wholesale ICANN fee via Cloudflare Registrar",
			aiAndPlatform: [
				"Dedicated AI email agent (Workers AI triage, summaries & auto-drafting)",
				"Realtime mailbox sync & search indexing (Cloudflare Durable Objects)",
				"Encrypted email & attachment storage (Cloudflare R2)",
				"Global Anycast DNS, SSL & automated Email Routing",
				"Inbound spam protection & automated SPF/DKIM/DMARC signing",
			],
		},
	};
}

export function computeRetailPrice(wholesalePrice: number): number {
	return computeDomainPricing(wholesalePrice).totalAnnualUsd;
}

/**
 * Query DNS-over-HTTPS (DoH) via Cloudflare 1.1.1.1 to verify if a domain
 * currently has active NS / SOA records on the public internet.
 */
export async function checkDomainViaDns(domain: string): Promise<{ registered: boolean }> {
	try {
		const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`;
		const res = await fetch(dohUrl, {
			headers: { Accept: "application/dns-json" },
		});
		if (!res.ok) {
			return { registered: false };
		}
		const data = (await res.json().catch(() => null)) as {
			Status?: number; // 0 = NOERROR, 3 = NXDOMAIN
			Answer?: Array<{ name: string; type: number; data: string }>;
			Authority?: Array<{ name: string; type: number; data: string }>;
		} | null;

		if (!data) return { registered: false };

		// Status 0 (NOERROR) with NS answer or SOA authority record indicates existing delegation
		const hasNsAnswer = Array.isArray(data.Answer) && data.Answer.some((a) => a.type === 2);
		const hasAuthority = Array.isArray(data.Authority) && data.Authority.some((a) => a.type === 2 || a.type === 6);

		if (data.Status === 0 && (hasNsAnswer || hasAuthority)) {
			return { registered: true };
		}
		return { registered: false };
	} catch {
		return { registered: false };
	}
}

/**
 * Check if a domain is available for registration via Cloudflare Registrar.
 */
export async function checkDomainAvailability(
	env: CloudflareClientEnv,
	rawDomain: string,
): Promise<DomainAvailabilityResult> {
	const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	const tld = extractTld(domain);

	if (!tld || tld === domain) {
		const emptyPricing = computeDomainPricing(0);
		return {
			domain,
			available: false,
			registered: false,
			wholesalePriceUsd: 0,
			retailPriceUsd: 0,
			pricing: emptyPricing,
			tldSupported: false,
			currency: "USD",
			supportedTld: tld,
		};
	}

	const wholesalePrice = TLD_WHOLESALE_PRICING[tld] ?? 10.44;
	const pricing = computeDomainPricing(wholesalePrice);
	const retailPrice = pricing.totalAnnualUsd;
	const isSupportedTld = tld in TLD_WHOLESALE_PRICING || ["com", "net", "org"].includes(tld);

	if (isMockEnv(env)) {
		const isTaken = mockRegisteredDomains.has(domain) || mockRegistrations.has(domain);
		return {
			domain,
			available: !isTaken && isSupportedTld,
			registered: isTaken,
			wholesalePriceUsd: wholesalePrice,
			retailPriceUsd: retailPrice,
			pricing,
			tldSupported: isSupportedTld,
			currency: "USD",
			supportedTld: tld,
		};
	}

	// 1. Authoritative check via Cloudflare Registrar API:
	// POST /accounts/{account_id}/registrar/domain-check
	try {
		const checkUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domain-check`;
		const res = await fetch(checkUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ domains: [domain] }),
		});

		if (res.ok) {
			const data = (await res.json().catch(() => ({}))) as {
				success?: boolean;
				result?: {
					domains?: Array<{
						name: string;
						registrable?: boolean;
						tier?: string;
						reason?: string;
						pricing?: {
							currency?: "USD";
							registration_cost?: string | number;
							renewal_cost?: string | number;
						};
					}>;
				} | Array<{
					name: string;
					registrable?: boolean;
					tier?: string;
					reason?: string;
					pricing?: {
						currency?: "USD";
						registration_cost?: string | number;
						renewal_cost?: string | number;
					};
				}>;
				errors?: Array<{ code: number; message: string }>;
			};

			if (data.success !== false && data.result) {
				const domainList = Array.isArray(data.result)
					? data.result
					: Array.isArray(data.result?.domains)
					? data.result.domains
					: [];
				const match = domainList.find((d) => d.name?.toLowerCase() === domain) || domainList[0];

				if (match) {
					const isRegistrable = Boolean(match.registrable);
					const rawCost = match.pricing?.registration_cost != null ? Number(match.pricing.registration_cost) : wholesalePrice;
					const actualWholesale = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : wholesalePrice;
					const actualPricing = computeDomainPricing(actualWholesale);
					const actualRetail = actualPricing.totalAnnualUsd;
					const isTldSupported = match.reason !== "extension_not_supported" && match.reason !== "extension_not_supported_via_api";

					return {
						domain,
						available: isRegistrable,
						registered: !isRegistrable && isTldSupported,
						wholesalePriceUsd: actualWholesale,
						retailPriceUsd: actualRetail,
						pricing: actualPricing,
						tldSupported: isTldSupported && isSupportedTld,
						currency: "USD",
						supportedTld: tld,
					};
				}
			}
		}
	} catch (err: unknown) {
		console.warn(`[cloudflare-registrar] domain-check API query error for ${domain}:`, err);
	}

	// 2. Fallback: Query Public DNS over HTTPS (1.1.1.1) to verify whether domain is registered on the internet
	const dnsCheck = await checkDomainViaDns(domain);
	if (dnsCheck.registered) {
		return {
			domain,
			available: false,
			registered: true,
			wholesalePriceUsd: wholesalePrice,
			retailPriceUsd: retailPrice,
			pricing,
			tldSupported: isSupportedTld,
			currency: "USD",
			supportedTld: tld,
		};
	}

	// 3. Fallback: If not found on DNS and TLD is supported, domain is available to purchase
	return {
		domain,
		available: isSupportedTld,
		registered: false,
		wholesalePriceUsd: wholesalePrice,
		retailPriceUsd: retailPrice,
		pricing,
		tldSupported: isSupportedTld,
		currency: "USD",
		supportedTld: tld,
	};
}

/**
 * Register a domain via Cloudflare Registrar.
 */
export async function registerDomain(
	env: CloudflareClientEnv,
	rawDomain: string,
	contact?: Partial<DomainContactInfo>,
): Promise<DomainRegistrationResult> {
	const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

	if (isMockEnv(env)) {
		const result: DomainRegistrationResult = {
			domain,
			status: "active",
			registeredAt: now.toISOString(),
			expiresAt,
			autoRenew: true,
			locked: true,
			whoisPrivacy: true,
			registrationInfo: {
				provider: "cloudflare_registrar",
				registeredAt: now.toISOString(),
				expiresAt,
				autoRenew: true,
				whoisPrivacy: true,
				locked: true,
				retailPriceUsd: STANDARD_RETAIL_PRICE,
			},
		};
		mockRegistrations.set(domain, result);
		mockRegisteredDomains.add(domain);
		return result;
	}

	// 1. Try modern Cloudflare Registrar API: POST /accounts/{account_id}/registrar/registrations
	const registrationsUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/registrations`;
	let res = await fetch(registrationsUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			domain_name: domain,
			auto_renew: true,
			privacy: true,
			contacts: contact,
		}),
	});

	// If 404/405 on registrations, fall back to legacy POST /accounts/{account_id}/registrar/domains
	if (res.status === 404 || res.status === 405) {
		const legacyUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains`;
		res = await fetch(legacyUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				name: domain,
				auto_renew: true,
				privacy: true,
				contacts: contact,
			}),
		});
	}

	const data = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		result?: {
			name?: string;
			domain_name?: string;
			expires_at?: string;
			auto_renew?: boolean;
			locked?: boolean;
			privacy?: boolean;
		};
		errors?: Array<{ code: number; message: string }>;
	};

	if (!res.ok || data.success === false) {
		const errors = data.errors || [];
		const msg = errors.map((e) => e.message).join("; ") || `Cloudflare Registration error: ${res.status}`;
		throw new CloudflareApiError(res.status, msg, errors);
	}

	const regInfo: DomainRegistrationInfo = {
		provider: "cloudflare_registrar",
		registeredAt: now.toISOString(),
		expiresAt: data.result?.expires_at || expiresAt,
		autoRenew: data.result?.auto_renew ?? true,
		whoisPrivacy: data.result?.privacy ?? true,
		locked: data.result?.locked ?? true,
		retailPriceUsd: STANDARD_RETAIL_PRICE,
	};

	return {
		domain,
		status: "active",
		registeredAt: now.toISOString(),
		expiresAt: regInfo.expiresAt || expiresAt,
		autoRenew: regInfo.autoRenew,
		locked: regInfo.locked,
		whoisPrivacy: regInfo.whoisPrivacy,
		registrationInfo: regInfo,
	};
}

/**
 * Retrieve the EPP Transfer Authorization Code for an offboarding domain.
 */
export async function getDomainEppCode(
	env: CloudflareClientEnv,
	rawDomain: string,
): Promise<string> {
	const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");

	if (isMockEnv(env)) {
		const prefix = domain.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
		return `EPP-${prefix || "MOCK"}-998877`;
	}

	// Try modern /registrar/registrations/{domain}/transfer_auth_code
	const modernUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/registrations/${encodeURIComponent(domain)}/transfer_auth_code`;
	let res = await fetch(modernUrl, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	});

	if (res.status === 404 || res.status === 405) {
		// Fallback to legacy /registrar/domains/{domain}/transfer_auth_code
		const legacyUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}/transfer_auth_code`;
		res = await fetch(legacyUrl, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				"Content-Type": "application/json",
			},
		});
	}

	const data = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		result?: { auth_code?: string };
		errors?: Array<{ code: number; message: string }>;
	};

	if (!res.ok || data.success === false || !data.result?.auth_code) {
		const errors = data.errors || [];
		const msg = errors.map((e) => e.message).join("; ") || `Failed to fetch EPP code: ${res.status}`;
		throw new CloudflareApiError(res.status, msg, errors);
	}

	return data.result.auth_code;
}

/**
 * Toggle registrar transfer lock for a domain.
 */
export async function setDomainTransferLock(
	env: CloudflareClientEnv,
	rawDomain: string,
	locked: boolean,
): Promise<boolean> {
	const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");

	if (isMockEnv(env)) {
		const existing = mockRegistrations.get(domain);
		if (existing) {
			existing.locked = locked;
			existing.registrationInfo.locked = locked;
		}
		return locked;
	}

	// Try modern PATCH /accounts/{account_id}/registrar/registrations/{domain}
	const patchUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/registrations/${encodeURIComponent(domain)}`;
	let res = await fetch(patchUrl, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ locked }),
	});

	if (res.status === 404 || res.status === 405) {
		// Fallback to legacy PUT /accounts/{account_id}/registrar/domains/{domain}
		const legacyUrl = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}`;
		res = await fetch(legacyUrl, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${env.CF_API_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ locked }),
		});
	}

	const data = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		result?: { locked?: boolean };
		errors?: Array<{ code: number; message: string }>;
	};

	if (!res.ok || data.success === false) {
		const errors = data.errors || [];
		const msg = errors.map((e) => e.message).join("; ") || `Failed to update transfer lock: ${res.status}`;
		throw new CloudflareApiError(res.status, msg, errors);
	}

	return data.result?.locked ?? locked;
}
