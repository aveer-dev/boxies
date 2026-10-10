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
	saveEmailAlias,
	deleteEmailAlias,
	listEmailAliases,
	type DomainMetadata,
	type DomainAlias,
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
	ensureFullEmailDns,
	auditEmailHealth,
	type NewDnsRecord,
} from "../lib/cloudflare-client";
import { canonicalMailboxId, mailboxMetadataKey } from "../lib/mailbox-routing";
import { ensurePrincipalAccount } from "../lib/identity-links";
import { aclFromOwnerKeys, principalKeys } from "../lib/mailbox-acl";
import { createInviteRecord, saveInvite, inviteAcceptUrl } from "../lib/invites";
import { seedWelcomeEmailsForMailbox } from "../lib/welcome-emails";
import { isDevRuntime } from "../lib/runtime-env";
import {
	domainVerificationChallenge,
	isDomainVerified,
	verificationRequiredBody,
} from "../lib/domain-verification";

/** Local dev with no Cloudflare credentials provisions mock zones; skip the DNS proof there. */
function canSkipDomainVerification(env: Env): boolean {
	return isDevRuntime() && (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID);
}

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
		if (!isSuper && principalKeys(principal).length === 0) {
			return c.json({ error: "Forbidden" }, 403);
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

		// The connecting account becomes this domain's admin.
		const ensured = await ensurePrincipalAccount(c.env.BUCKET, principal);
		const ownerKey = ensured.ownerKeys[0];

		// Non-super-admins must prove DNS control before we create a zone for them.
		if (!isSuper && !canSkipDomainVerification(c.env)) {
			const secret =
				c.env.MOBILE_JWT_SECRET || (isDevRuntime() ? "dev-mobile-jwt-secret-change-me" : "");
			if (!secret) {
				return c.json({ error: "Server authentication is not configured" }, 500);
			}
			const challenge = await domainVerificationChallenge(secret, domain, ownerKey);
			if (!(await isDomainVerified(challenge))) {
				return c.json(verificationRequiredBody(domain, challenge), 428);
			}
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

		// Password sessions keep the plain user id (checkout/billing look it up);
		// everyone else is recorded by their durable account key.
		const ownerUserId = principal.sub?.startsWith("user:")
			? principal.sub.slice("user:".length)
			: ownerKey;
		const domainMetadata: DomainMetadata = {
			domain,
			zoneId: zone.id,
			ownerUserId,
			adminUserIds: [ownerKey],
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
			// Ensure complete email DNS configuration (MX, SPF, DMARC, Catch-All)
			await ensureFullEmailDns(c.env, domainMeta.zoneId, domain);

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

	/**
	 * List all email aliases configured for a custom domain.
	 */
	app.get("/api/v1/admin/domains/:domain/aliases", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const aliases = await listEmailAliases(c.env.BUCKET, domainMeta.domain);
		return c.json({ domain: domainMeta.domain, aliases });
	});

	/**
	 * Create an email alias for a custom domain.
	 */
	app.post("/api/v1/admin/domains/:domain/aliases", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const body = (await c.req.json().catch(() => ({}))) as {
			aliasLocal?: string;
			targetMailboxId?: string;
		};

		const aliasLocal = (body.aliasLocal || "").trim().toLowerCase().replace(/^@+/, "");
		const targetMailboxId = (body.targetMailboxId || "").trim();

		if (!aliasLocal || !/^[a-zA-Z0-9._-]+$/.test(aliasLocal)) {
			return c.json({ error: "Invalid alias local part" }, 400);
		}
		if (!targetMailboxId) {
			return c.json({ error: "Target mailbox is required" }, 400);
		}

		try {
			const alias = await saveEmailAlias(
				c.env.BUCKET,
				domainMeta.domain,
				aliasLocal,
				targetMailboxId,
			);
			return c.json({ success: true, alias }, 201);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to create email alias";
			return c.json({ error: msg }, 500);
		}
	});

	/**
	 * Delete an email alias for a custom domain.
	 */
	app.delete("/api/v1/admin/domains/:domain/aliases/:aliasLocal", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const aliasLocal = c.req.param("aliasLocal");

		try {
			await deleteEmailAlias(c.env.BUCKET, domainMeta.domain, aliasLocal);
			return c.json({ success: true, aliasLocal });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to delete email alias";
			return c.json({ error: msg }, 500);
		}
	});

	/**
	 * Batch setup aliases during onboarding.
	 */
	app.post("/api/v1/admin/domains/:domain/setup-aliases", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta } = authz;
		const body = (await c.req.json().catch(() => ({}))) as {
			aliases?: Array<{ aliasLocal: string; targetMailboxId: string }>;
		};

		const inputAliases = body.aliases || [];
		const created: DomainAlias[] = [];

		for (const item of inputAliases) {
			const local = (item.aliasLocal || "").trim().toLowerCase().replace(/^@+/, "");
			const target = (item.targetMailboxId || "").trim();
			if (local && target && /^[a-zA-Z0-9._-]+$/.test(local)) {
				try {
					const record = await saveEmailAlias(c.env.BUCKET, domainMeta.domain, local, target);
					created.push(record);
				} catch {
					// continue with next
				}
			}
		}

		return c.json({ success: true, aliases: created });
	});

	/**
	 * Batch setup team members/users during onboarding.
	 */
	app.post("/api/v1/admin/domains/:domain/setup-users", async (c) => {
		const authz = await authorizeDomainAdmin(c, c.req.param("domain"));
		if (authz instanceof Response) return authz;

		const { domainMeta, principal } = authz;
		const body = (await c.req.json().catch(() => ({}))) as {
			users?: Array<{ fullName: string; contactEmail: string; username: string }>;
		};

		const inputUsers = body.users || [];
		const results = [];
		const domain = domainMeta.domain;

		for (const u of inputUsers) {
			const username = (u.username || "").trim().toLowerCase();
			if (!username) continue;
			const fullEmail = `${username}@${domain}`;
			const canonical = canonicalMailboxId(fullEmail);
			if (!canonical) continue;

			const key = mailboxMetadataKey(canonical);
			const exists = await c.env.BUCKET.head(key);
			if (!exists) {
				const ensured = await ensurePrincipalAccount(c.env.BUCKET, principal);
				const acl = aclFromOwnerKeys(ensured.ownerKeys);
				const settings = {
					fromName: u.fullName || username,
					forwarding: { enabled: false, email: "" },
					signature: { enabled: false, text: "" },
					autoReply: { enabled: false, subject: "", message: "" },
					screener: { enabled: true },
					acl,
				};
				await c.env.BUCKET.put(key, JSON.stringify(settings));
				const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(canonical));
				await stub.reviveMailbox();
				await stub.getFolders();
				await seedWelcomeEmailsForMailbox(c.env, canonical, u.fullName || username);
			}

			// If contactEmail provided, generate invite record
			let inviteData = null;
			if (u.contactEmail && u.contactEmail.includes("@")) {
				const invite = createInviteRecord({
					mailboxId: canonical,
					inviteeEmail: u.contactEmail.trim().toLowerCase(),
					inviteeName: u.fullName || username,
					role: "owner",
					createdByKeys: principalKeys(principal),
				});
				if ("token" in invite) {
					await saveInvite(c.env.BUCKET, invite);
					inviteData = {
						token: invite.token,
						inviteUrl: inviteAcceptUrl(c.env.APP_BASE_URL || "", invite.token),
						inviteeEmail: invite.inviteeEmail,
					};
				}
			}

			results.push({
				mailboxId: canonical,
				name: u.fullName || username,
				invite: inviteData,
			});
		}

		return c.json({ success: true, users: results });
	});
}
