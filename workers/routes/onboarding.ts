// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, type Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Env } from "../types";
import type { MailboxContext } from "../lib/mailbox";
import { validatePasswordStrength } from "../lib/password-auth";
import {
	canonicalMailboxId,
	isReservedLocalPart,
} from "../lib/mailbox-routing";
import { mailDomainConfig } from "../lib/mail-domain";
import { authDb } from "../auth/authz";
import { isHostedEmailDomain } from "../auth/hooks";
import { codeEmail, sendSystemEmail } from "../auth/mail";
import {
	initializeMailboxStorage,
	isMailboxAddressTaken,
	isUniqueViolation,
	mailboxRowStatements,
} from "../auth/mailboxes";
import { issueOtp } from "../auth/otp";
import { clientIp, isRateLimited, TOO_MANY } from "../auth/rate-limit";
import * as schema from "../auth/schema";
import {
	createSessionForUser,
	findUserByEmail,
	sessionCookieHeader,
	userRowStatements,
} from "../auth/users";
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
import { isDevRuntime } from "../lib/dev-runtime";
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
	// Domain owners must have one: billing and renewal notices go there.
	backupEmail: z.string().trim().email("Please provide a valid backup email address"),
});

/** The secret domain-claim TXT values are derived from. */
function claimSecret(env: Env): string {
	return env.BETTER_AUTH_SECRET || (isDevRuntime() ? "dev-better-auth-secret-change-me" : "");
}

type SignupUser = {
	mailboxId: string;
	username: string;
	password: string;
	displayName?: string;
	backupEmail?: string;
};

type SignupResult =
	| { ok: true; userId: string; recoveryCode?: string }
	| { ok: false; status: 400 | 409; error: string };

/**
 * Create the user (whose login is the new mailbox address, owned by
 * construction), their password, the mailbox and its owner row in one D1
 * batch, plus `extraStatements` (domain rows). The backup email becomes an
 * unverified recovery email and gets a code.
 */
async function createSignupUser(
	env: Env,
	user: SignupUser,
	extraStatements: (userId: string) => unknown[] = () => [],
): Promise<SignupResult> {
	const db = authDb(env.AUTH_DB);
	if ((await isMailboxAddressTaken(env, db, user.mailboxId)) || (await findUserByEmail(db, user.mailboxId))) {
		return { ok: false, status: 409, error: "This username is already taken" };
	}
	const backup = user.backupEmail?.trim().toLowerCase();
	if (backup && (await isHostedEmailDomain(env, backup))) {
		return { ok: false, status: 400, error: "Use a backup email outside Inboxies" };
	}
	const { id: userId, statements } = await userRowStatements(db, {
		email: user.mailboxId,
		name: user.displayName || user.username,
		emailVerified: true,
		password: user.password,
	});
	try {
		await db.batch([
			...statements,
			...extraStatements(userId),
			...mailboxRowStatements(db, user.mailboxId, userId),
			...(backup ? [db.insert(schema.recoveryEmail).values({ userId, email: backup, verifiedAt: null })] : []),
		] as unknown as Parameters<typeof db.batch>[0]);
	} catch (e) {
		if (isUniqueViolation(e)) return { ok: false, status: 409, error: "This username is already taken" };
		throw e;
	}
	await initializeMailboxStorage(env, user.mailboxId, { name: user.displayName || user.username });
	let recoveryCode: string | undefined;
	if (backup) {
		const otp = await issueOtp(db, "recovery-email", userId, backup);
		if (otp.ok) {
			recoveryCode = otp.code;
			await sendSystemEmail(env, {
				to: backup,
				subject: "Your Inboxies verification code",
				...codeEmail({ purposeLine: "Confirm this address as your Inboxies recovery email.", code: otp.code }),
			});
		}
	}
	return { ok: true, userId, recoveryCode };
}

async function issueSignupSession(c: Context<MailboxContext>, userId: string) {
	const session = await createSessionForUser(c.env, userId, { headers: c.req.raw.headers });
	c.header("Set-Cookie", await sessionCookieHeader(c.env, session));
	return { token: session.token, expiresAt: session.expiresAt.toISOString() };
}

/** Local dev with no Cloudflare credentials provisions mock zones; skip the DNS proof there. */
function canSkipDomainVerification(env: Env): boolean {
	return isDevRuntime() && (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID);
}

export function registerOnboardingRoutes(app: Hono<MailboxContext>) {
	/**
	 * Pre-check domain availability, WHOIS registration, and retail price.
	 */
	app.get("/api/v1/auth/domains/check", async (c) => {
		const rawDomain = c.req.query("domain") || "";
		const domain = rawDomain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
		if (!domain || !domain.includes(".")) {
			return c.json({ error: "Invalid domain format" }, 400);
		}

		if (await isRateLimited(c.env, "domain-check", clientIp(c.req.raw.headers))) {
			return c.json(TOO_MANY, 429);
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
		if (await isRateLimited(c.env, "sign-up", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);

		const strengthErr = validatePasswordStrength(password);
		if (strengthErr) return c.json({ error: strengthErr }, 400);

		const { mailDomain } = mailDomainConfig(c.env);
		const canonical = canonicalMailboxId(`${username.toLowerCase()}@${mailDomain}`);
		if (!canonical) return c.json({ error: "Invalid email address" }, 400);
		// Role addresses (postmaster@, admin@, security@, noreply@ …) on the
		// shared domain belong to the platform: certificate authorities and
		// users trust them.
		if (isReservedLocalPart(canonical.split("@")[0])) {
			return c.json({ error: "This username is reserved" }, 400);
		}

		const created = await createSignupUser(c.env, {
			mailboxId: canonical,
			username,
			password,
			displayName,
			backupEmail,
		});
		if (!created.ok) return c.json({ error: created.error }, created.status);
		const session = await issueSignupSession(c, created.userId);
		const name = displayName || username;
		return c.json(
			{
				...session,
				mailbox: { id: canonical, email: canonical, name },
				user: { id: created.userId, email: canonical },
				recoveryEmailPending: Boolean(backupEmail),
				...(isDevRuntime() && created.recoveryCode ? { devRecoveryCode: created.recoveryCode } : {}),
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
		if (await isRateLimited(c.env, "sign-up", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);

		const strengthErr = validatePasswordStrength(password);
		if (strengthErr) return c.json({ error: strengthErr }, 400);

		const db = authDb(c.env.AUTH_DB);
		const existingRow = await db
			.select({ domain: schema.domain.domain })
			.from(schema.domain)
			.where(eq(schema.domain.domain, domain))
			.get();
		if (existingRow || (await getDomainMetadata(c.env.BUCKET, domain))) {
			return c.json({ error: "This domain is already registered with Inboxies" }, 409);
		}
		if (mailDomainConfig(c.env).domains.includes(domain)) {
			return c.json({ error: "This domain is already registered with Inboxies" }, 409);
		}

		const canonical = canonicalMailboxId(`${username.toLowerCase()}@${domain}`);
		if (!canonical) return c.json({ error: "Invalid email address" }, 400);

		const secret = claimSecret(c.env);
		if (!secret) return c.json({ error: "Server authentication is not configured" }, 500);

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
		const active = zone.status === "active";

		// 3. User, domain ownership and admin mailbox, in one D1 batch.
		const created = await createSignupUser(
			c.env,
			{ mailboxId: canonical, username, password, displayName, backupEmail },
			(userId) => [
				db.insert(schema.domain).values({
					domain,
					ownerUserId: userId,
					status: active ? "active" : "pending",
					// The TXT record proved control (or, in dev, was skipped).
					verifiedAt: new Date(),
				}),
			],
		);
		if (!created.ok) return c.json({ error: created.error }, created.status);

		// 4. Registrar / DNS details stay in R2.
		const domainMeta: DomainMetadata = {
			domain,
			zoneId: zone.id,
			ownerUserId: created.userId,
			adminUserIds: [created.userId],
			status: active ? "active" : "pending_nameservers",
			nameservers: zone.name_servers,
			emailRoutingEnabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await saveDomainMetadata(c.env.BUCKET, domainMeta);

		const session = await issueSignupSession(c, created.userId);
		const name = displayName || username;
		return c.json(
			{
				...session,
				mailbox: { id: canonical, email: canonical, name },
				domain: {
					domain,
					zoneId: zone.id,
					status: domainMeta.status,
					nameservers: zone.name_servers,
				},
				audit,
				user: { id: created.userId, email: canonical },
				recoveryEmailPending: Boolean(backupEmail),
			},
			201,
		);
	});
}
