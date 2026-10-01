// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Cloudflare Registrar client for domain availability, registration,
 * wholesale pricing, transfer locks, and EPP authorization codes.
 */

import { CloudflareApiError, type CloudflareClientEnv } from "./cloudflare-client";
import type { DomainRegistrationInfo } from "./domain-registry";

export interface DomainAvailabilityResult {
	domain: string;
	available: boolean;
	registered: boolean;
	wholesalePriceUsd: number;
	retailPriceUsd: number;
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

const STANDARD_RETAIL_PRICE = 14.0;

function isMockEnv(env: CloudflareClientEnv): boolean {
	return !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID;
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

export function computeRetailPrice(wholesalePrice: number): number {
	// Standard price is $14.00/yr. For premium/expensive TLDs (e.g. .io, .ai),
	// charge wholesale + standard $3.50 payment/handling margin.
	if (wholesalePrice <= 10.5) {
		return STANDARD_RETAIL_PRICE;
	}
	return Math.ceil(wholesalePrice + 3.5);
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
		return {
			domain,
			available: false,
			registered: false,
			wholesalePriceUsd: 0,
			retailPriceUsd: 0,
			tldSupported: false,
			currency: "USD",
			supportedTld: tld,
		};
	}

	const wholesalePrice = TLD_WHOLESALE_PRICING[tld] ?? 10.44;
	const retailPrice = computeRetailPrice(wholesalePrice);
	const isSupportedTld = tld in TLD_WHOLESALE_PRICING || ["com", "net", "org"].includes(tld);

	if (isMockEnv(env)) {
		const isTaken = mockRegisteredDomains.has(domain) || mockRegistrations.has(domain);
		return {
			domain,
			available: !isTaken && isSupportedTld,
			registered: isTaken,
			wholesalePriceUsd: wholesalePrice,
			retailPriceUsd: retailPrice,
			tldSupported: isSupportedTld,
			currency: "USD",
			supportedTld: tld,
		};
	}

	// Live Cloudflare API call to check registrar domain status
	const url = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}`;
	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	});

	if (res.status === 404) {
		// Domain not found in registrar -> check RDAP / general registry availability
		return {
			domain,
			available: true,
			registered: false,
			wholesalePriceUsd: wholesalePrice,
			retailPriceUsd: retailPrice,
			tldSupported: isSupportedTld,
			currency: "USD",
			supportedTld: tld,
		};
	}

	if (!res.ok) {
		const errData = (await res.json().catch(() => ({}))) as {
			errors?: Array<{ code: number; message: string }>;
		};
		const msg = errData.errors?.[0]?.message || `Cloudflare Registrar error: ${res.status}`;
		throw new CloudflareApiError(res.status, msg, errData.errors || []);
	}

	// Domain already exists in registrar
	return {
		domain,
		available: false,
		registered: true,
		wholesalePriceUsd: wholesalePrice,
		retailPriceUsd: retailPrice,
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

	const url = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains`;
	const res = await fetch(url, {
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

	const data = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		result?: {
			name: string;
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

	const url = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}/transfer_auth_code`;
	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		},
	});

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

	const url = `${CF_API_BASE}/accounts/${env.CF_ACCOUNT_ID}/registrar/domains/${encodeURIComponent(domain)}`;
	const res = await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ locked }),
	});

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
