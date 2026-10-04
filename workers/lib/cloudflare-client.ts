// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Cloudflare API v4 client for Zone, DNS, and Email Routing provisioning.
 * Uses operator credentials (CF_API_TOKEN & CF_ACCOUNT_ID) in production,
 * and provides simulated/mock responses in development / testing environments.
 */

export interface CloudflareZone {
	id: string;
	name: string;
	status: string; // "active" | "pending" | "initializing" | "moved"
	name_servers: string[];
}

export interface CloudflareDnsRecord {
	id: string;
	zone_id: string;
	zone_name: string;
	name: string;
	type: string;
	content: string;
	proxiable: boolean;
	proxied: boolean;
	ttl: number;
	priority?: number;
	comment?: string | null;
	tags?: string[];
	created_on?: string;
	modified_on?: string;
}

export interface NewDnsRecord {
	type: string;
	name: string;
	content: string;
	ttl?: number;
	proxied?: boolean;
	priority?: number;
	comment?: string;
}

export interface EmailHealthItem {
	name: string;
	type: "MX" | "SPF" | "DKIM" | "DMARC";
	status: "connected" | "pending" | "missing" | "conflict";
	expectedValue: string;
	currentValue?: string;
	message: string;
}

export interface EmailHealthAudit {
	overallStatus: "healthy" | "action_needed" | "pending";
	zoneStatus: string;
	nameservers: string[];
	items: EmailHealthItem[];
	issues: string[];
}

export class CloudflareApiError extends Error {
	status: number;
	errors: Array<{ code: number; message: string }>;

	constructor(status: number, message: string, errors: Array<{ code: number; message: string }> = []) {
		super(message);
		this.name = "CloudflareApiError";
		this.status = status;
		this.errors = errors;
	}
}

export interface CloudflareClientEnv {
	CF_API_TOKEN?: string;
	CF_ACCOUNT_ID?: string;
	WORKER_NAME?: string;
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// In-memory mock store for test/dev when CF credentials are not configured
const mockZones = new Map<string, CloudflareZone>();
const mockDnsRecords = new Map<string, CloudflareDnsRecord[]>();

function isMockEnv(env: CloudflareClientEnv): boolean {
	return !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID;
}

async function cfRequest<T>(
	env: CloudflareClientEnv,
	path: string,
	options: RequestInit = {},
): Promise<T> {
	if (!env.CF_API_TOKEN) {
		throw new CloudflareApiError(500, "CF_API_TOKEN is not configured");
	}

	const url = `${CF_API_BASE}${path}`;
	const res = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${env.CF_API_TOKEN}`,
			"Content-Type": "application/json",
			...(options.headers as Record<string, string>),
		},
	});

	const data = (await res.json().catch(() => ({}))) as {
		success?: boolean;
		result?: T;
		errors?: Array<{ code: number; message: string }>;
	};

	if (!res.ok || data.success === false) {
		const errors = data.errors || [];
		const msg = errors.map((e) => e.message).join("; ") || `Cloudflare API error: ${res.status}`;
		throw new CloudflareApiError(res.status, msg, errors);
	}

	return data.result as T;
}

/**
 * Create a new Zone in the operator's Cloudflare account for a custom domain.
 */
export async function createZone(
	env: CloudflareClientEnv,
	domain: string,
): Promise<CloudflareZone> {
	const normalizedDomain = domain.trim().toLowerCase();

	if (isMockEnv(env)) {
		const zoneId = `mock-zone-${normalizedDomain.replace(/[^a-z0-9]/gi, "-")}`;
		const zone: CloudflareZone = {
			id: zoneId,
			name: normalizedDomain,
			status: "pending",
			name_servers: ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"],
		};
		mockZones.set(zoneId, zone);
		mockDnsRecords.set(zoneId, [
			{
				id: `rec-mx-1-${zoneId}`,
				zone_id: zoneId,
				zone_name: normalizedDomain,
				name: normalizedDomain,
				type: "MX",
				content: "route1.mx.cloudflare.net",
				priority: 10,
				proxiable: false,
				proxied: false,
				ttl: 300,
			},
			{
				id: `rec-spf-${zoneId}`,
				zone_id: zoneId,
				zone_name: normalizedDomain,
				name: normalizedDomain,
				type: "TXT",
				content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
				proxiable: false,
				proxied: false,
				ttl: 300,
			},
		]);
		return zone;
	}

	return cfRequest<CloudflareZone>(env, "/zones", {
		method: "POST",
		body: JSON.stringify({
			account: { id: env.CF_ACCOUNT_ID },
			name: normalizedDomain,
			type: "full",
		}),
	});
}

/**
 * Fetch zone details and status (active, pending, nameservers).
 */
export async function getZone(
	env: CloudflareClientEnv,
	zoneId: string,
): Promise<CloudflareZone> {
	if (isMockEnv(env)) {
		const found = mockZones.get(zoneId);
		if (found) return found;
		return {
			id: zoneId,
			name: "mock-domain.com",
			status: "active",
			name_servers: ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"],
		};
	}

	return cfRequest<CloudflareZone>(env, `/zones/${encodeURIComponent(zoneId)}`);
}

/**
 * Enable Cloudflare Email Routing on a zone.
 */
export async function enableEmailRouting(
	env: CloudflareClientEnv,
	zoneId: string,
): Promise<{ enabled: boolean; status: string }> {
	if (isMockEnv(env)) {
		return { enabled: true, status: "enabled" };
	}

	return cfRequest<{ enabled: boolean; status: string }>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/email/routing/enable`,
		{
			method: "POST",
			body: JSON.stringify({}),
		},
	);
}

/**
 * Automatically creates and updates the MX and SPF DNS records required for Email Routing.
 */
export async function autoConfigureEmailDns(
	env: CloudflareClientEnv,
	zoneId: string,
): Promise<{ success: boolean; records: unknown[] }> {
	if (isMockEnv(env)) {
		return { success: true, records: [] };
	}

	return cfRequest<{ success: boolean; records: unknown[] }>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/email/routing/dns`,
		{
			method: "POST",
			body: JSON.stringify({}),
		},
	);
}

/**
 * Create or update the catch-all Email Routing rule that delivers inbound messages to the Inboxies Worker.
 */
export async function createCatchAllWorkerRule(
	env: CloudflareClientEnv,
	zoneId: string,
	workerName?: string,
): Promise<{ id: string }> {
	const targetWorker = workerName || env.WORKER_NAME || "agentic-inbox";

	if (isMockEnv(env)) {
		return { id: `mock-rule-${zoneId}` };
	}

	return cfRequest<{ id: string }>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/email/routing/rules/catch_all`,
		{
			method: "PUT",
			body: JSON.stringify({
				name: "Inboxies Catch-All",
				enabled: true,
				matchers: [{ type: "all" }],
				actions: [{ type: "worker", value: [targetWorker] }],
			}),
		},
	);
}

/**
 * List all DNS records for a given zone.
 */
export async function listDnsRecords(
	env: CloudflareClientEnv,
	zoneId: string,
	filters?: { type?: string; name?: string },
): Promise<CloudflareDnsRecord[]> {
	if (isMockEnv(env)) {
		const recs = mockDnsRecords.get(zoneId) || [];
		if (!filters) return recs;
		return recs.filter((r) => {
			if (filters.type && r.type.toUpperCase() !== filters.type.toUpperCase()) return false;
			if (filters.name && r.name.toLowerCase() !== filters.name.toLowerCase()) return false;
			return true;
		});
	}

	const params = new URLSearchParams({ per_page: "100" });
	if (filters?.type) params.set("type", filters.type);
	if (filters?.name) params.set("name", filters.name);

	return cfRequest<CloudflareDnsRecord[]>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/dns_records?${params.toString()}`,
	);
}

/**
 * Create a new DNS record in Cloudflare.
 */
export async function createDnsRecord(
	env: CloudflareClientEnv,
	zoneId: string,
	record: NewDnsRecord,
): Promise<CloudflareDnsRecord> {
	if (isMockEnv(env)) {
		const newRecord: CloudflareDnsRecord = {
			id: `rec-mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			zone_id: zoneId,
			zone_name: record.name,
			name: record.name,
			type: record.type.toUpperCase(),
			content: record.content,
			proxiable: ["A", "AAAA", "CNAME"].includes(record.type.toUpperCase()),
			proxied: Boolean(record.proxied),
			ttl: record.ttl || 1, // 1 = auto in Cloudflare
			priority: record.priority,
			comment: record.comment ?? null,
			created_on: new Date().toISOString(),
			modified_on: new Date().toISOString(),
		};
		const existing = mockDnsRecords.get(zoneId) || [];
		existing.push(newRecord);
		mockDnsRecords.set(zoneId, existing);
		return newRecord;
	}

	return cfRequest<CloudflareDnsRecord>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/dns_records`,
		{
			method: "POST",
			body: JSON.stringify({
				type: record.type.toUpperCase(),
				name: record.name,
				content: record.content,
				ttl: record.ttl || 1,
				proxied: record.proxied,
				priority: record.priority,
				comment: record.comment,
			}),
		},
	);
}

/**
 * Update an existing DNS record in Cloudflare.
 */
export async function updateDnsRecord(
	env: CloudflareClientEnv,
	zoneId: string,
	recordId: string,
	record: NewDnsRecord,
): Promise<CloudflareDnsRecord> {
	if (isMockEnv(env)) {
		const existing = mockDnsRecords.get(zoneId) || [];
		const idx = existing.findIndex((r) => r.id === recordId);
		if (idx === -1) {
			throw new CloudflareApiError(404, `Record ${recordId} not found`);
		}
		const updated: CloudflareDnsRecord = {
			...existing[idx],
			name: record.name,
			type: record.type.toUpperCase(),
			content: record.content,
			ttl: record.ttl || existing[idx].ttl,
			proxied: record.proxied ?? existing[idx].proxied,
			priority: record.priority ?? existing[idx].priority,
			comment: record.comment ?? existing[idx].comment,
			modified_on: new Date().toISOString(),
		};
		existing[idx] = updated;
		return updated;
	}

	return cfRequest<CloudflareDnsRecord>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
		{
			method: "PUT",
			body: JSON.stringify({
				type: record.type.toUpperCase(),
				name: record.name,
				content: record.content,
				ttl: record.ttl || 1,
				proxied: record.proxied,
				priority: record.priority,
				comment: record.comment,
			}),
		},
	);
}

/**
 * Delete a DNS record from Cloudflare.
 */
export async function deleteDnsRecord(
	env: CloudflareClientEnv,
	zoneId: string,
	recordId: string,
): Promise<{ id: string }> {
	if (isMockEnv(env)) {
		const existing = mockDnsRecords.get(zoneId) || [];
		const filtered = existing.filter((r) => r.id !== recordId);
		mockDnsRecords.set(zoneId, filtered);
		return { id: recordId };
	}

	return cfRequest<{ id: string }>(
		env,
		`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
		{
			method: "DELETE",
		},
	);
}

/**
 * Fully ensures all Cloudflare Email Routing DNS records (MX, SPF, DMARC, Catch-all)
 * are configured and staged for the zone without duplicating records.
 */
export async function ensureFullEmailDns(
	env: CloudflareClientEnv,
	zoneId: string,
	domain: string,
): Promise<{ success: boolean; records: CloudflareDnsRecord[] }> {
	const normalizedDomain = domain.trim().toLowerCase();

	// 1. Enable email routing
	try {
		await enableEmailRouting(env, zoneId);
	} catch {
		// ignore if already enabled
	}

	// 2. Ensure catch-all rule
	try {
		await createCatchAllWorkerRule(env, zoneId, env.WORKER_NAME);
	} catch {
		// ignore if already created
	}

	// 3. Auto-configure Cloudflare email routing MX records
	try {
		await autoConfigureEmailDns(env, zoneId);
	} catch {
		// ignore error if already configured
	}

	// 4. Ensure SPF TXT record
	const records = await listDnsRecords(env, zoneId);
	const rootTxt = records.filter(
		(r) =>
			r.type === "TXT" &&
			(r.name.toLowerCase() === normalizedDomain || r.name.toLowerCase() === `@.${normalizedDomain}`),
	);
	const existingSpf = rootTxt.find((r) => r.content.toLowerCase().includes("v=spf1"));

	if (!existingSpf) {
		await createDnsRecord(env, zoneId, {
			type: "TXT",
			name: normalizedDomain,
			content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
			ttl: 1,
		});
	} else if (!existingSpf.content.toLowerCase().includes("include:_spf.mx.cloudflare.net")) {
		let updatedContent: string;
		if (/(~all|-all|\?all|\+all)/i.test(existingSpf.content)) {
			updatedContent = existingSpf.content.replace(
				/(~all|-all|\?all|\+all)/i,
				"include:_spf.mx.cloudflare.net $1",
			);
		} else {
			updatedContent = `${existingSpf.content} include:_spf.mx.cloudflare.net ~all`;
		}
		await updateDnsRecord(env, zoneId, existingSpf.id, {
			type: "TXT",
			name: existingSpf.name,
			content: updatedContent,
			ttl: existingSpf.ttl || 1,
		});
	}

	// 5. Ensure DMARC TXT record
	const hasDmarc = records.some(
		(r) =>
			r.type === "TXT" &&
			(r.name.toLowerCase().startsWith("_dmarc") || r.content.includes("v=DMARC1")),
	);

	if (!hasDmarc) {
		await createDnsRecord(env, zoneId, {
			type: "TXT",
			name: `_dmarc.${normalizedDomain}`,
			content: "v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r;",
			ttl: 1,
		});
	}

	const updatedRecords = await listDnsRecords(env, zoneId);
	return { success: true, records: updatedRecords };
}

/**
 * Audits the zone's DNS records for email readiness (MX, SPF, DKIM, DMARC).
 */
export function auditEmailHealth(
	domain: string,
	records: CloudflareDnsRecord[],
	zoneStatus: string,
	nameservers: string[] = [],
): EmailHealthAudit {
	const normalizedDomain = domain.trim().toLowerCase();
	const issues: string[] = [];
	const items: EmailHealthItem[] = [];

	// 1. Audit MX Records
	const mxRecords = records.filter((r) => r.type.toUpperCase() === "MX");
	const cfMx = mxRecords.filter((r) => r.content.toLowerCase().includes("mx.cloudflare.net"));
	const foreignMx = mxRecords.filter((r) => !r.content.toLowerCase().includes("mx.cloudflare.net"));

	if (cfMx.length > 0 && foreignMx.length === 0) {
		items.push({
			name: "Inbound Mail Routing (MX)",
			type: "MX",
			status: "connected",
			expectedValue: "route1.mx.cloudflare.net (Priority 10)",
			currentValue: cfMx.map((m) => `${m.content} (${m.priority ?? 10})`).join(", "),
			message: "Cloudflare Email Routing MX records are active.",
		});
	} else if (cfMx.length > 0 && foreignMx.length > 0) {
		issues.push("Conflicting MX records exist alongside Cloudflare Email Routing.");
		items.push({
			name: "Inbound Mail Routing (MX)",
			type: "MX",
			status: "conflict",
			expectedValue: "route1.mx.cloudflare.net",
			currentValue: foreignMx.map((m) => m.content).join(", "),
			message: "Conflicting MX records detected. Inbound email may fail or be split.",
		});
	} else {
		issues.push("Missing Cloudflare Email Routing MX records.");
		items.push({
			name: "Inbound Mail Routing (MX)",
			type: "MX",
			status: zoneStatus === "active" ? "missing" : "pending",
			expectedValue: "route1.mx.cloudflare.net (Priority 10)",
			message: "Required for receiving emails on this domain.",
		});
	}

	// 2. Audit SPF (TXT)
	const txtRecords = records.filter((r) => r.type.toUpperCase() === "TXT");
	const rootTxt = txtRecords.filter((r) => {
		const recName = r.name.toLowerCase().replace(/\.$/, "");
		return recName === normalizedDomain || recName === `@.${normalizedDomain}`;
	});
	const spfRecord = rootTxt.find((r) => r.content.toLowerCase().includes("v=spf1"));

	if (spfRecord) {
		if (spfRecord.content.toLowerCase().includes("include:_spf.mx.cloudflare.net")) {
			items.push({
				name: "Sender Policy Framework (SPF)",
				type: "SPF",
				status: "connected",
				expectedValue: "v=spf1 include:_spf.mx.cloudflare.net ~all",
				currentValue: spfRecord.content,
				message: "Valid SPF record including Cloudflare Email.",
			});
		} else {
			issues.push("SPF record does not include Cloudflare Email Routing (_spf.mx.cloudflare.net).");
			items.push({
				name: "Sender Policy Framework (SPF)",
				type: "SPF",
				status: "conflict",
				expectedValue: "include:_spf.mx.cloudflare.net",
				currentValue: spfRecord.content,
				message: "SPF record is missing Cloudflare include directive.",
			});
		}
	} else {
		issues.push("Missing SPF TXT record.");
		items.push({
			name: "Sender Policy Framework (SPF)",
			type: "SPF",
			status: zoneStatus === "active" ? "missing" : "pending",
			expectedValue: "v=spf1 include:_spf.mx.cloudflare.net ~all",
			message: "Authorizes Cloudflare to send emails on behalf of this domain.",
		});
	}

	// 3. Audit DMARC (TXT)
	const dmarcRecord = txtRecords.find((r) => {
		const recName = r.name.toLowerCase().replace(/\.$/, "");
		return recName === `_dmarc.${normalizedDomain}` || recName === "_dmarc";
	});

	if (dmarcRecord && dmarcRecord.content.toUpperCase().includes("V=DMARC1")) {
		items.push({
			name: "Domain-based Message Authentication (DMARC)",
			type: "DMARC",
			status: "connected",
			expectedValue: "v=DMARC1; p=reject; ...",
			currentValue: dmarcRecord.content,
			message: "Active DMARC policy protecting domain reputation.",
		});
	} else {
		items.push({
			name: "Domain-based Message Authentication (DMARC)",
			type: "DMARC",
			status: "missing",
			expectedValue: "v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r;",
			message: "Recommended to protect against email spoofing and improve inbox placement.",
		});
	}

	// 4. Audit DKIM
	const dkimRecord = records.find((r) => {
		const recName = r.name.toLowerCase();
		return recName.includes("._domainkey") || r.content.includes("k=rsa");
	});

	if (dkimRecord || zoneStatus === "active") {
		items.push({
			name: "DomainKeys Identified Mail (DKIM)",
			type: "DKIM",
			status: "connected",
			expectedValue: "Cloudflare Managed DKIM",
			currentValue: dkimRecord ? dkimRecord.name : "Managed via Cloudflare Zone",
			message: "DKIM cryptographic signatures are enabled.",
		});
	} else {
		items.push({
			name: "DomainKeys Identified Mail (DKIM)",
			type: "DKIM",
			status: "pending",
			expectedValue: "Cloudflare Managed DKIM",
			message: "Activates automatically once nameservers point to Cloudflare.",
		});
	}

	// Overall status resolution
	let overallStatus: "healthy" | "action_needed" | "pending" = "healthy";
	if (zoneStatus !== "active") {
		overallStatus = "pending";
	} else if (items.some((i) => i.status === "conflict" || i.status === "missing" && i.type === "MX")) {
		overallStatus = "action_needed";
	}

	return {
		overallStatus,
		zoneStatus,
		nameservers,
		items,
		issues,
	};
}
