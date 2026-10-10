// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import {
	hashPassword,
	issuePasswordSessionToken,
	PASSWORD_SESSION_COOKIE,
	validatePasswordStrength,
} from "../lib/password-auth";
import {
	findUserIdByLoginEmail,
	savePlatformUser,
	principalFromPlatformUser,
	type PlatformUser,
} from "../lib/platform-users";
import {
	canonicalMailboxId,
	mailboxMetadataKey,
} from "../lib/mailbox-routing";
import { mailDomainConfig } from "../lib/mail-domain";
import { ensurePrincipalAccount } from "../lib/identity-links";
import { aclFromOwnerKeys } from "../lib/mailbox-acl";
import {
	createZone,
	enableEmailRouting,
	createCatchAllWorkerRule,
	autoConfigureEmailDns,
	ensureFullEmailDns,
	listDnsRecords,
	auditEmailHealth,
} from "../lib/cloudflare-client";
import {
	getDomainMetadata,
	saveDomainMetadata,
	type DomainMetadata,
} from "../lib/domain-registry";
import { checkDomainAvailability, computeDomainPricing } from "../lib/cloudflare-registrar";
import { seedWelcomeEmailsForMailbox } from "../lib/welcome-emails";
import { isDevRuntime } from "../lib/runtime-env";
import {
	domainVerificationChallenge,
	isDomainVerified,
	signupClaimant,
	verificationRequiredBody,
} from "../lib/domain-verification";

const SignupPersonalBody = z.object({
	username: z
		.string()
		.trim()
		.min(2, "Username must be at least 2 characters")
		.max(50, "Username must be at most 50 characters")
		.regex(
			/^[a-zA-Z0-9._-]+$/,
			"Username may only contain letters, numbers, dots, hyphens, and underscores",
		),
	password: z.string().min(10, "Password must be at least 10 characters").max(200),
	displayName: z.string().trim().max(200).optional(),
	backupEmail: z.string().trim().email("Please provide a valid backup email address").optional(),
});

const SignupDomainBody = z.object({
	domain: z
		.string()
		.trim()
		.min(3, "Domain is required")
		.max(253)
		.regex(
			/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i,
			"Invalid domain format",
		),
	username: z
		.string()
		.trim()
		.min(2, "Username must be at least 2 characters")
		.max(50)
		.regex(
			/^[a-zA-Z0-9._-]+$/,
			"Username may only contain letters, numbers, dots, hyphens, and underscores",
		),
	password: z.string().min(10, "Password must be at least 10 characters").max(200),
	displayName: z.string().trim().max(200).optional(),
	backupEmail: z.string().trim().email("Please provide a valid backup email address").optional(),
});

function defaultMailboxSettings(name: string) {
	return {
		fromName: name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		screener: { enabled: true },
	};
}

function sessionSecret(env: Env): string {
	return (
		env.MOBILE_JWT_SECRET ||
		(isDevRuntime() ? "dev-mobile-jwt-secret-change-me" : "")
	);
}

/** Local dev with no Cloudflare credentials provisions mock zones; skip the DNS proof there. */
function canSkipDomainVerification(env: Env): boolean {
	return isDevRuntime() && (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID);
}

function sessionCookieHeader(token: string): string {
	const maxAge = 60 * 60 * 24 * 30; // 30 days
	return `${PASSWORD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

export function registerOnboardingRoutes(app: Hono<{ Bindings: Env }>) {
	/**
	 * Pre-check domain availability, WHOIS registration, and retail price.
	 */
	app.get("/api/v1/auth/domains/check", async (c) => {
		const rawDomain = c.req.query("domain") || "";
		const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
		if (!domain || !domain.includes(".")) {
			return c.json({ error: "Invalid domain format" }, 400);
		}

		// 1. Check if already managed inside Inboxies
		const existingDomain = await getDomainMetadata(c.env.BUCKET, domain);
		if (existingDomain) {
			const pricing = computeDomainPricing(10.44);
			return c.json({
				domain,
				available: false,
				registered: true,
				alreadyInInboxies: true,
				retailPriceUsd: pricing.totalAnnualUsd,
				wholesalePriceUsd: 10.44,
				pricing,
				currency: "USD",
				tldSupported: true,
				message: "This domain is already registered with Inboxies.",
			});
		}

		// 2. Query Cloudflare Registrar availability
		try {
			const availability = await checkDomainAvailability(c.env, domain);
			return c.json({
				...availability,
				alreadyInInboxies: false,
			});
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to check domain availability";
			return c.json({ error: msg }, 502);
		}
	});

	/**
	 * Track 1: Personal @inboxies.email account creation.
	 */
	app.post("/api/v1/auth/signup-personal", async (c) => {
		const parsed = SignupPersonalBody.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid input" },
				400,
			);
		}
		const { username, password, displayName, backupEmail } = parsed.data;

		const strengthErr = validatePasswordStrength(password);
		if (strengthErr) return c.json({ error: strengthErr }, 400);

		const { mailDomain } = mailDomainConfig(c.env);
		const fullEmail = `${username.toLowerCase()}@${mailDomain}`;
		const canonical = canonicalMailboxId(fullEmail);
		if (!canonical) return c.json({ error: "Invalid email address" }, 400);

		// Check if mailbox already exists in R2
		const metaKey = mailboxMetadataKey(canonical);
		if (await c.env.BUCKET.head(metaKey)) {
			return c.json({ error: "This username is already taken" }, 409);
		}

		// Check if platform user exists
		const existingUser = await findUserIdByLoginEmail(c.env.BUCKET, canonical);
		if (existingUser) {
			return c.json({ error: "This username is already taken" }, 409);
		}

		const secret = sessionSecret(c.env);
		if (!secret) {
			return c.json(
				{ error: "Server authentication is not configured" },
				500,
			);
		}

		const userId = crypto.randomUUID();
		const passwordHash = await hashPassword(password);
		const user: PlatformUser = {
			id: userId,
			contactEmail: canonical,
			...(backupEmail ? { recoveryEmail: backupEmail } : {}),
			mailboxEmail: canonical,
			passwordHash,
			linkedSubs: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await savePlatformUser(c.env.BUCKET, user);

		const principal = principalFromPlatformUser(user);
		const ensured = await ensurePrincipalAccount(c.env.BUCKET, principal);

		const settings = {
			...defaultMailboxSettings(displayName || username),
			acl: aclFromOwnerKeys(ensured.ownerKeys),
		};
		await c.env.BUCKET.put(metaKey, JSON.stringify(settings));

		// Revive Durable Object for immediate mailbox access
		const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(canonical));
		await stub.reviveMailbox();
		await stub.getFolders();
		await seedWelcomeEmailsForMailbox(c.env, canonical, displayName || username);

		const { token, expiresAt } = await issuePasswordSessionToken(secret, {
			userId,
			email: canonical,
		});

		c.header("Set-Cookie", sessionCookieHeader(token));

		return c.json(
			{
				token,
				expiresAt,
				mailbox: {
					id: canonical,
					email: canonical,
					name: displayName || username,
				},
				user: {
					id: userId,
					email: canonical,
				},
			},
			201,
		);
	});

	/**
	 * Track 2: Custom domain registration & provisioning under operator Cloudflare account.
	 */
	app.post("/api/v1/auth/signup-domain", async (c) => {
		const parsed = SignupDomainBody.safeParse(await c.req.json());
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid input" },
				400,
			);
		}
		const { domain: rawDomain, username, password, displayName, backupEmail } = parsed.data;
		const domain = rawDomain.toLowerCase();

		const strengthErr = validatePasswordStrength(password);
		if (strengthErr) return c.json({ error: strengthErr }, 400);

		// Check if domain is already registered in Inboxies
		const existingDomain = await getDomainMetadata(c.env.BUCKET, domain);
		if (existingDomain) {
			return c.json(
				{ error: "This domain is already registered with Inboxies" },
				409,
			);
		}

		const fullEmail = `${username.toLowerCase()}@${domain}`;
		const canonical = canonicalMailboxId(fullEmail);
		if (!canonical) return c.json({ error: "Invalid email address" }, 400);

		const secret = sessionSecret(c.env);
		if (!secret) {
			return c.json(
				{ error: "Server authentication is not configured" },
				500,
			);
		}

		// Bring-your-own domains must prove DNS control before we create a zone
		// (purchased domains are provisioned by the paid Stripe webhook instead).
		if (!canSkipDomainVerification(c.env)) {
			const challenge = await domainVerificationChallenge(
				secret,
				domain,
				await signupClaimant(username, password),
			);
			if (!(await isDomainVerified(challenge))) {
				return c.json(verificationRequiredBody(domain, challenge), 428);
			}
		}

		// 1. Provision Cloudflare Zone & Email Routing
		let zone;
		try {
			zone = await createZone(c.env, domain);
			await ensureFullEmailDns(c.env, zone.id, domain);
		} catch (cfErr: unknown) {
			const msg = cfErr instanceof Error ? cfErr.message : "Failed to provision domain in Cloudflare";
			return c.json({ error: `Cloudflare setup failed: ${msg}` }, 502);
		}

		// 2. Fetch initial DNS records to audit
		const dnsRecords = await listDnsRecords(c.env, zone.id);
		const audit = auditEmailHealth(domain, dnsRecords, zone.status, zone.name_servers);

		// 3. Create Admin Platform User
		const userId = crypto.randomUUID();
		const passwordHash = await hashPassword(password);
		const user: PlatformUser = {
			id: userId,
			contactEmail: canonical,
			...(backupEmail ? { recoveryEmail: backupEmail } : {}),
			mailboxEmail: canonical,
			passwordHash,
			linkedSubs: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await savePlatformUser(c.env.BUCKET, user);

		// 4. Save Domain Metadata in R2
		const domainMeta: DomainMetadata = {
			domain,
			zoneId: zone.id,
			ownerUserId: userId,
			adminUserIds: [userId, canonical],
			status: zone.status === "active" ? "active" : "pending_nameservers",
			nameservers: zone.name_servers,
			emailRoutingEnabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await saveDomainMetadata(c.env.BUCKET, domainMeta);

		// 5. Create Admin Mailbox
		const principal = principalFromPlatformUser(user);
		const ensured = await ensurePrincipalAccount(c.env.BUCKET, principal);
		const metaKey = mailboxMetadataKey(canonical);
		const settings = {
			...defaultMailboxSettings(displayName || username),
			acl: aclFromOwnerKeys(ensured.ownerKeys),
		};
		await c.env.BUCKET.put(metaKey, JSON.stringify(settings));

		const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(canonical));
		await stub.reviveMailbox();
		await stub.getFolders();
		await seedWelcomeEmailsForMailbox(c.env, canonical, displayName || username);

		// 6. Issue Session Token
		const { token, expiresAt } = await issuePasswordSessionToken(secret, {
			userId,
			email: canonical,
		});

		c.header("Set-Cookie", sessionCookieHeader(token));

		return c.json(
			{
				token,
				expiresAt,
				mailbox: {
					id: canonical,
					email: canonical,
					name: displayName || username,
				},
				domain: {
					domain,
					zoneId: zone.id,
					status: domainMeta.status,
					nameservers: zone.name_servers,
				},
				audit,
				user: {
					id: userId,
					email: canonical,
				},
			},
			201,
		);
	});
}
