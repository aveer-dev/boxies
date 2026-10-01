// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, type Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import type { RequestPrincipal } from "../lib/mailbox-acl";
import { isDomainAdmin } from "../lib/domain-admin";
import {
	getDomainMetadata,
	saveDomainMetadata,
	listDomainsForPrincipal,
	isPrincipalAdminForDomain,
	type DomainMetadata,
} from "../lib/domain-registry";
import {
	getZone,
	createZone,
	enableEmailRouting,
	createCatchAllWorkerRule,
	listDnsRecords,
	createDnsRecord,
	updateDnsRecord,
	deleteDnsRecord,
	autoConfigureEmailDns,
	auditEmailHealth,
	type NewDnsRecord,
} from "../lib/cloudflare-client";

type AppVariables = { principal?: RequestPrincipal };

const DnsRecordBody = z.object({
	type: z.enum(["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV"]),
	name: z.string().trim().min(1, "Name is required"),
	content: z.string().trim().min(1, "Content is required"),
	ttl: z.number().int().min(1).max(86400).optional().default(1),
	proxied: z.boolean().optional().default(false),
	priority: z.number().int().min(0).max(65535).optional(),
	comment: z.string().max(100).optional(),
});

export interface AuthorizedDomainContext {
	principal: RequestPrincipal;
	domainMeta: DomainMetadata;
	isSuperAdmin: boolean;
}

export async function authorizeDomainAdmin(
	c: Context<{ Bindings: Env; Variables: AppVariables }>,
	domainParam: string,
): Promise<AuthorizedDomainContext | Response> {
	const principal = c.get("principal") as RequestPrincipal | undefined;
	if (!principal) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const normalizedDomain = domainParam.trim().toLowerCase();
	const isSuperAdmin = await isDomainAdmin(c.env, principal);

	const domainMeta = await getDomainMetadata(c.env.BUCKET, normalizedDomain);
	if (!domainMeta) {
		return c.json({ error: `Domain '${normalizedDomain}' not found` }, 404);
	}

	const hasAccess = isPrincipalAdminForDomain(domainMeta, principal, isSuperAdmin);
	if (!hasAccess) {
		return c.json(
			{ error: `Forbidden: You do not have admin rights for '${normalizedDomain}'` },
			403,
		);
	}

	return { principal, domainMeta, isSuperAdmin };
}

export function registerDomainDnsRoutes(app: Hono<{ Bindings: Env; Variables: AppVariables }>) {
	/**
	 * List all domains administered by the current user.
	 */
	app.get("/api/v1/admin/domains", async (c) => {
		const principal = c.get("principal") as RequestPrincipal | undefined;
		if (!principal) return c.json({ error: "Unauthorized" }, 401);

		const isSuperAdmin = await isDomainAdmin(c.env, principal);
		const domains = await listDomainsForPrincipal(c.env.BUCKET, principal, isSuperAdmin);

		return c.json({ domains });
	});

	/**
	 * Connect a custom domain directly in Domain Admin.
	 */
	app.post("/api/v1/admin/domains", async (c) => {
		const principal = c.get("principal") as RequestPrincipal | undefined;
		if (!principal) return c.json({ error: "Unauthorized" }, 401);

		const isSuper = await isDomainAdmin(c.env, principal);
		if (!isSuper && principal.kind !== "user") {
			return c.json({ error: "Forbidden: Only user accounts can administer domains" }, 403);
		}

		const parsed = z
			.object({
				domain: z
					.string()
					.trim()
					.min(3, "Domain is required")
					.max(253)
					.regex(
						/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
						"Invalid domain format",
					),
			})
			.safeParse(await c.req.json());

		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid domain" },
				400,
			);
		}

		const domain = parsed.data.domain.toLowerCase();

		// Check if domain is already registered in Inboxies
		const existingDomain = await getDomainMetadata(c.env.BUCKET, domain);
		if (existingDomain) {
			return c.json(
				{ error: "This domain is already registered with Inboxies" },
				409,
			);
		}

		// Provision Cloudflare Zone & Email Routing
		let zone;
		try {
			zone = await createZone(c.env, domain);
			await enableEmailRouting(c.env, zone.id);
			await createCatchAllWorkerRule(c.env, zone.id, c.env.WORKER_NAME);
			await autoConfigureEmailDns(c.env, zone.id);
		} catch (cfErr: unknown) {
			const msg =
				cfErr instanceof Error
					? cfErr.message
					: "Failed to provision domain in Cloudflare";
			return c.json({ error: `Cloudflare setup failed: ${msg}` }, 502);
		}

		const dnsRecords = await listDnsRecords(c.env, zone.id);
		const audit = auditEmailHealth(
			domain,
			dnsRecords,
			zone.status,
			zone.name_servers,
		);

		const ownerUserId = principal.userId || principal.id;
		const domainMetadata: DomainMetadata = {
			domain,
			zoneId: zone.id,
			ownerUserId,
			adminUserIds: [ownerUserId],
			status: zone.status === "active" ? "active" : "pending_nameservers",
			nameservers: zone.name_servers,
			emailRoutingEnabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await saveDomainMetadata(c.env.BUCKET, domainMetadata);

		return c.json(
			{
				domain: {
					domain: domainMetadata.domain,
					zoneId: domainMetadata.zoneId,
					status: domainMetadata.status,
					nameservers: domainMetadata.nameservers,
				},
				audit,
			},
			201,
		);
	});

	/**
	 * Get details and Cloudflare zone status for a specific domain.
	 */
	app.get("/api/v1/admin/domains/:domain", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		try {
			const zone = await getZone(c.env, domainMeta.zoneId);
			return c.json({
				domain: domainMeta.domain,
				zoneId: domainMeta.zoneId,
				status: zone.status,
				nameservers: zone.name_servers,
				createdAt: domainMeta.createdAt,
				updatedAt: domainMeta.updatedAt,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to fetch zone from Cloudflare";
			return c.json({
				domain: domainMeta.domain,
				zoneId: domainMeta.zoneId,
				status: domainMeta.status,
				nameservers: domainMeta.nameservers,
				warning: msg,
			});
		}
	});

	/**
	 * Audit email DNS health (MX, SPF, DKIM, DMARC) for a domain.
	 */
	app.get("/api/v1/admin/domains/:domain/dns/health", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		try {
			const zone = await getZone(c.env, domainMeta.zoneId);
			const records = await listDnsRecords(c.env, domainMeta.zoneId);
			const audit = auditEmailHealth(
				domainMeta.domain,
				records,
				zone.status,
				zone.name_servers,
			);

			return c.json({
				domain: domainMeta.domain,
				zoneId: domainMeta.zoneId,
				zoneStatus: zone.status,
				nameservers: zone.name_servers,
				audit,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Health check failed";
			return c.json({ error: msg }, 502);
		}
	});

	/**
	 * Automatically apply and repair Cloudflare Email Routing DNS records (MX, SPF, DMARC).
	 */
	app.post("/api/v1/admin/domains/:domain/dns/fix-email", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const domain = domainMeta.domain;

		try {
			// 1. Run Cloudflare automatic email DNS configuration
			await autoConfigureEmailDns(c.env, domainMeta.zoneId);

			// 2. Fetch current records to check SPF & DMARC
			const records = await listDnsRecords(c.env, domainMeta.zoneId);

			// Ensure SPF TXT record exists with include:_spf.mx.cloudflare.net without creating duplicate SPF records
			const rootTxt = records.filter(
				(r) =>
					r.type === "TXT" &&
					(r.name.toLowerCase() === domain || r.name.toLowerCase() === `@.${domain}`),
			);
			const existingSpf = rootTxt.find((r) => r.content.toLowerCase().includes("v=spf1"));

			if (!existingSpf) {
				await createDnsRecord(c.env, domainMeta.zoneId, {
					type: "TXT",
					name: domain,
					content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
					ttl: 1,
				});
			} else if (!existingSpf.content.toLowerCase().includes("include:_spf.mx.cloudflare.net")) {
				// Safely insert include:_spf.mx.cloudflare.net before all directive, or append
				let updatedContent: string;
				if (/(~all|-all|\?all|\+all)/i.test(existingSpf.content)) {
					updatedContent = existingSpf.content.replace(
						/(~all|-all|\?all|\+all)/i,
						"include:_spf.mx.cloudflare.net $1",
					);
				} else {
					updatedContent = `${existingSpf.content} include:_spf.mx.cloudflare.net ~all`;
				}
				await updateDnsRecord(c.env, domainMeta.zoneId, existingSpf.id, {
					type: "TXT",
					name: existingSpf.name,
					content: updatedContent,
					ttl: existingSpf.ttl || 1,
				});
			}

			// Ensure DMARC TXT record exists
			const hasDmarc = records.some(
				(r) =>
					r.type === "TXT" &&
					(r.name.toLowerCase().startsWith("_dmarc") || r.content.includes("v=DMARC1")),
			);

			if (!hasDmarc) {
				await createDnsRecord(c.env, domainMeta.zoneId, {
					type: "TXT",
					name: `_dmarc.${domain}`,
					content: "v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r;",
					ttl: 1,
				});
			}

			// Re-audit
			const updatedZone = await getZone(c.env, domainMeta.zoneId);
			const updatedRecords = await listDnsRecords(c.env, domainMeta.zoneId);
			const audit = auditEmailHealth(
				domain,
				updatedRecords,
				updatedZone.status,
				updatedZone.name_servers,
			);

			return c.json({
				success: true,
				audit,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to auto-configure email DNS";
			return c.json({ error: msg }, 502);
		}
	});

	/**
	 * List all DNS records for a domain from Cloudflare.
	 */
	app.get("/api/v1/admin/domains/:domain/dns/records", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const typeFilter = c.req.query("type");
		const nameFilter = c.req.query("name");

		try {
			const records = await listDnsRecords(c.env, domainMeta.zoneId, {
				type: typeFilter,
				name: nameFilter,
			});
			return c.json({ records });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to list DNS records";
			return c.json({ error: msg }, 502);
		}
	});

	/**
	 * Create a new DNS record in Cloudflare.
	 */
	app.post("/api/v1/admin/domains/:domain/dns/records", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const parsed = DnsRecordBody.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid DNS record payload" },
				400,
			);
		}

		try {
			const record = await createDnsRecord(
				c.env,
				domainMeta.zoneId,
				parsed.data as NewDnsRecord,
			);
			return c.json({ record }, 201);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to create DNS record";
			return c.json({ error: msg }, 502);
		}
	});

	/**
	 * Update an existing DNS record in Cloudflare.
	 */
	app.put("/api/v1/admin/domains/:domain/dns/records/:recordId", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const recordId = c.req.param("recordId");
		const parsed = DnsRecordBody.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid DNS record payload" },
				400,
			);
		}

		try {
			const record = await updateDnsRecord(
				c.env,
				domainMeta.zoneId,
				recordId,
				parsed.data as NewDnsRecord,
			);
			return c.json({ record });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to update DNS record";
			return c.json({ error: msg }, 502);
		}
	});

	/**
	 * Delete a DNS record from Cloudflare.
	 */
	app.delete("/api/v1/admin/domains/:domain/dns/records/:recordId", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const recordId = c.req.param("recordId");

		try {
			await deleteDnsRecord(c.env, domainMeta.zoneId, recordId);
			return c.json({ success: true, id: recordId });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to delete DNS record";
			return c.json({ error: msg }, 502);
		}
	});
}
