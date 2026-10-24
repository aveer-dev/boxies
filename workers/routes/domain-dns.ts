// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, type Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { and, eq } from "drizzle-orm";
import type { RequestPrincipal } from "../auth/principal";
import type { MailboxContext } from "../lib/mailbox";
import {
	authDb,
	authorizeMailboxAccess,
	canCreateMailbox,
	isDomainAdmin,
	isDomainOwner,
	listDomainsForUser,
} from "../auth/authz";
import { MailboxExistsError, provisionMailbox } from "../auth/mailboxes";
import { normalizeEmailAddress } from "../lib/mail-automations";
import { mailDomainConfig } from "../lib/mail-domain";
import * as schema from "../auth/schema";
import { insertInviteRow } from "./admin-invites";
import {
	getDomainMetadata,
	saveDomainMetadata,
	saveEmailAlias,
	deleteEmailAlias,
	AddressInUseError,
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
import { canonicalMailboxId, strictMailboxId } from "../lib/mailbox-routing";
import { isDevRuntime } from "../lib/dev-runtime";
import {
	domainVerificationChallenge,
	isDomainVerified,
	verificationRequiredBody,
} from "../lib/domain-verification";
import { isDomainSuspended, serviceEndedError } from "../lib/domain-service";
import { anyRecoveryEmail } from "../auth/users";

/** Local dev with no Cloudflare credentials provisions mock zones; skip the DNS proof there. */
function canSkipDomainVerification(env: Env): boolean {
	return isDevRuntime() && (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID);
}

/** Invite issued for a team member created by the onboarding setup-users step. */
type SetupUserInvite = { token: string; inviteUrl: string; inviteeEmail: string };

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
}

/** The caller owns or administers this domain (AUTH_DB rows). */
export async function authorizeDomainAdmin(
	c: Context<MailboxContext>,
	domainParam: string,
	opts: { offboarding?: boolean } = {},
): Promise<AuthorizedDomainContext | Response> {
	const principal = c.get("principal");
	if (!principal) return c.json({ error: "Unauthorized" }, 401);
	const normalizedDomain = domainParam.trim().toLowerCase();
	const db = authDb(c.env.AUTH_DB);
	const allowed =
		(await isDomainAdmin(db, principal.userId, normalizedDomain)) ||
		(opts.offboarding === true && (await isDomainOwner(db, principal.userId, normalizedDomain)));
	const domainMeta = allowed ? await getDomainMetadata(c.env.BUCKET, normalizedDomain) : null;
	// Missing and forbidden look the same, so domains can't be probed.
	if (!domainMeta) {
		return c.json({ error: `Forbidden: You do not have admin rights for '${normalizedDomain}'` }, 403);
	}
	return { principal, domainMeta };
}

/**
 * Domain changes an owner may still make after the subscription ended: get
 * their mail out, or take the domain elsewhere.
 */
const ALLOWED_WHEN_ENDED = /^\/(export|decommission-preflight|decommission|transfer-lock|finalize)$/;

export function registerDomainDnsRoutes(app: Hono<MailboxContext>) {
	// A domain whose subscription ended is frozen: no DNS, alias or user changes.
	app.use("/api/v1/admin/domains/:domain/*", async (c, next) => {
		const method = c.req.method.toUpperCase();
		if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
		const domain = c.req.param("domain").trim().toLowerCase();
		const rest = c.req.path.slice(c.req.path.indexOf("/", "/api/v1/admin/domains/".length));
		if (ALLOWED_WHEN_ENDED.test(rest)) return next();
		if (await isDomainSuspended(c.env, domain)) return c.json(serviceEndedError(domain), 403);
		return next();
	});

	/**
	 * List all domains administered by the current user.
	 */
	app.get("/api/v1/admin/domains", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const names = await listDomainsForUser(authDb(c.env.AUTH_DB), principal.userId);
		const domains = (await Promise.all(names.map((d) => getDomainMetadata(c.env.BUCKET, d)))).filter(
			(d): d is DomainMetadata => Boolean(d),
		);
		return c.json({ domains });
	});

	/**
	 * Connect a custom domain directly in Domain Admin.
	 */
	app.post("/api/v1/admin/domains", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		// Domain owners need a recovery email outside Inboxies for domain and billing notices.
		if (!(await anyRecoveryEmail(authDb(c.env.AUTH_DB), principal.userId))) {
			return c.json(
				{ error: "Add a recovery email in Settings before connecting a domain", code: "recovery_email_required" },
				400,
			);
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
		const db = authDb(c.env.AUTH_DB);
		const existingRow = await db
			.select({ domain: schema.domain.domain })
			.from(schema.domain)
			.where(eq(schema.domain.domain, domain))
			.get();
		const existingDomain = existingRow || (await getDomainMetadata(c.env.BUCKET, domain));
		if (existingDomain || mailDomainConfig(c.env).domains.includes(domain)) {
			return c.json(
				{ error: "This domain is already registered with Inboxies" },
				409,
			);
		}

		// The connecting user must prove DNS control before we create a zone.
		if (!canSkipDomainVerification(c.env)) {
			const secret = c.env.BETTER_AUTH_SECRET || (isDevRuntime() ? "dev-better-auth-secret-change-me" : "");
			if (!secret) {
				return c.json({ error: "Server authentication is not configured" }, 500);
			}
			const challenge = await domainVerificationChallenge(secret, domain, `user:${principal.userId}`);
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

		// Ownership is the AUTH_DB row; the R2 copy is informational.
		try {
			await db.insert(schema.domain).values({
				domain,
				ownerUserId: principal.userId,
				status: zone.status === "active" ? "active" : "pending",
				verifiedAt: new Date(),
			});
		} catch {
			return c.json({ error: "This domain is already registered with Inboxies" }, 409);
		}
		const domainMetadata: DomainMetadata = {
			domain,
			zoneId: zone.id,
			ownerUserId: principal.userId,
			adminUserIds: [principal.userId],
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
	/**
	 * A domain alias delivers outside mail into `target`, so it may only point
	 * at a mailbox on the same domain or one the admin can already open.
	 * Otherwise anyone who adds a domain could route mail into strangers'
	 * mailboxes.
	 */
	const aliasTargetAllowed = async (
		c: Context<MailboxContext>,
		domain: string,
		target: string,
	): Promise<string | null> => {
		const mailboxId = strictMailboxId(target);
		if (!mailboxId) return null;
		const db = authDb(c.env.AUTH_DB);
		if (mailboxId.endsWith(`@${domain.toLowerCase()}`)) {
			const row = await db
				.select({ id: schema.mailbox.id })
				.from(schema.mailbox)
				.where(eq(schema.mailbox.id, mailboxId))
				.get();
			return row ? mailboxId : null;
		}
		const access = await authorizeMailboxAccess(db, c.get("principal")?.userId, mailboxId);
		return access.ok ? access.mailboxId : null;
	};

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
		const allowedTarget = await aliasTargetAllowed(c, domainMeta.domain, targetMailboxId);
		if (!allowedTarget) {
			return c.json({ error: "Aliases can only deliver to mailboxes on this domain or ones you can access" }, 403);
		}

		try {
			const alias = await saveEmailAlias(
				c.env.BUCKET,
				domainMeta.domain,
				aliasLocal,
				allowedTarget,
			);
			return c.json({ success: true, alias }, 201);
		} catch (err: unknown) {
			if (err instanceof AddressInUseError) return c.json({ error: err.message }, 409);
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
			const allowedTarget = target ? await aliasTargetAllowed(c, domainMeta.domain, target) : null;
			if (local && allowedTarget && /^[a-zA-Z0-9._-]+$/.test(local)) {
				try {
					const record = await saveEmailAlias(c.env.BUCKET, domainMeta.domain, local, allowedTarget);
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
		const results: Array<{
			mailboxId: string;
			name: string;
			invite: SetupUserInvite | null;
			error?: string;
		}> = [];
		const domain = domainMeta.domain;

		for (const u of inputUsers) {
			const username = (u.username || "").trim().toLowerCase();
			if (!username) continue;
			const fullEmail = `${username}@${domain}`;
			const canonical = canonicalMailboxId(fullEmail);
			if (!canonical) continue;

			const db = authDb(c.env.AUTH_DB);
			const existing = await db
				.select({ id: schema.mailbox.id })
				.from(schema.mailbox)
				.where(eq(schema.mailbox.id, canonical))
				.get();
			if (!existing) {
				const check = await canCreateMailbox(db, {
					userId: principal.userId,
					address: canonical,
					platformDomains: [],
				});
				if (!check.ok) {
					results.push({ mailboxId: canonical, name: u.fullName || username, invite: null, error: check.error });
					continue;
				}
				try {
					await provisionMailbox(c.env, {
						mailboxId: canonical,
						ownerUserId: principal.userId,
						name: u.fullName || username,
					});
				} catch (e) {
					if (!(e instanceof MailboxExistsError)) throw e;
					results.push({
						mailboxId: canonical,
						name: u.fullName || username,
						invite: null,
						error: "Address is already in use by an alias",
					});
					continue;
				}
			}

			// If contactEmail provided, generate invite record
			let inviteData: SetupUserInvite | null = null;
			const inviteeEmail = u.contactEmail ? normalizeEmailAddress(u.contactEmail) : null;
			if (inviteeEmail) {
				const invite = await insertInviteRow(db, {
					mailboxId: canonical,
					role: "owner",
					inviteeEmail,
					inviteeName: u.fullName || username,
					createdBy: principal.userId,
				});
				inviteData = {
					token: invite.token,
					inviteUrl: `${(c.env.APP_BASE_URL || new URL(c.req.url).origin).replace(/\/$/, "")}/invite/${invite.token}`,
					inviteeEmail,
				};
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
