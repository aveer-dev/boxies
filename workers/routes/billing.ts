// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, type Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import {
	checkDomainAvailability,
	registerDomain,
} from "../lib/cloudflare-registrar";
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
import {
	hashPassword,
	issuePasswordSessionToken,
	PASSWORD_SESSION_COOKIE,
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
import { ensurePrincipalAccount } from "../lib/identity-links";
import { aclFromOwnerKeys } from "../lib/mailbox-acl";
import { seedWelcomeEmailsForMailbox } from "../lib/welcome-emails";

const CreateDomainCheckoutBody = z.object({
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
		.min(2)
		.max(50)
		.regex(/^[a-zA-Z0-9._-]+$/)
		.optional(),
	password: z.string().min(10).max(200).optional(),
	displayName: z.string().trim().max(200).optional(),
	returnUrl: z.string().url().optional(),
});

interface StripeSessionResponse {
	id: string;
	url: string;
}

export function registerBillingRoutes(app: Hono<{ Bindings: Env }>) {
	/**
	 * Initiate a $14.00/yr Stripe Checkout session to purchase and register a domain.
	 */
	app.post("/api/v1/billing/create-domain-checkout", async (c) => {
		const parsed = CreateDomainCheckoutBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid input" },
				400,
			);
		}

		const { domain: rawDomain, username, password, displayName, returnUrl } = parsed.data;
		const domain = rawDomain.toLowerCase();

		// 1. Verify not already registered inside Inboxies
		const existingDomain = await getDomainMetadata(c.env.BUCKET, domain);
		if (existingDomain) {
			return c.json(
				{ error: "This domain is already registered with Inboxies" },
				409,
			);
		}

		// 2. Pre-check availability via Cloudflare Registrar
		const avail = await checkDomainAvailability(c.env, domain);
		if (!avail.available && !avail.alreadyInInboxies) {
			return c.json(
				{ error: `Domain '${domain}' is not available for purchase` },
				400,
			);
		}

		const appBase = c.env.APP_BASE_URL || "https://inboxies.email";
		const deepLinkSuccess = `inboxies://onboarding/domain-ready?domain=${encodeURIComponent(domain)}`;
		const webReturnSuccess = `${appBase}/api/v1/billing/checkout-return?domain=${encodeURIComponent(domain)}&session_id={CHECKOUT_SESSION_ID}`;
		const effectiveSuccessUrl = returnUrl || webReturnSuccess;
		const cancelUrl = "inboxies://onboarding/cancelled";

		// 3. Create Stripe Checkout Session if STRIPE_SECRET_KEY is configured
		if (c.env.STRIPE_SECRET_KEY) {
			const form = new URLSearchParams();
			form.append("payment_method_types[0]", "card");
			form.append("mode", "payment");
			form.append("line_items[0][price_data][currency]", "usd");
			form.append(
				"line_items[0][price_data][product_data][name]",
				`Domain Registration: ${domain} (1 Year)`,
			);
			form.append(
				"line_items[0][price_data][product_data][description]",
				`Annual domain registration for ${domain} powered by Cloudflare Registrar`,
			);
			form.append("line_items[0][price_data][unit_amount]", "1400"); // $14.00 USD
			form.append("line_items[0][quantity]", "1");
			form.append("metadata[domain]", domain);
			if (username) form.append("metadata[username]", username.toLowerCase());
			if (displayName) form.append("metadata[displayName]", displayName);
			if (password) {
				const pwHash = await hashPassword(password);
				form.append("metadata[passwordHash]", pwHash);
			}
			form.append("metadata[retailPriceUsd]", "14.00");
			form.append("success_url", effectiveSuccessUrl);
			form.append("cancel_url", cancelUrl);

			const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: form.toString(),
			});

			if (!stripeRes.ok) {
				const errBody = (await stripeRes.json().catch(() => ({}))) as {
					error?: { message?: string };
				};
				const msg = errBody.error?.message || `Stripe session error: ${stripeRes.status}`;
				return c.json({ error: msg }, 502);
			}

			const session = (await stripeRes.json()) as StripeSessionResponse;
			return c.json({
				checkoutUrl: session.url,
				sessionId: session.id,
				domain,
				priceUsd: 14.0,
			});
		}

		// In development/testing without live Stripe credentials, return deterministic mock session
		const mockSessionId = `mock_cs_${domain.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}`;
		const mockUrl = `${appBase}/checkout/mock?session_id=${mockSessionId}&domain=${encodeURIComponent(domain)}`;

		return c.json({
			checkoutUrl: mockUrl,
			sessionId: mockSessionId,
			domain,
			priceUsd: 14.0,
			mock: true,
		});
	});

	/**
	 * Browser Return handler after Stripe checkout completes.
	 * Redirects mobile clients to native deep link `inboxies://onboarding/domain-ready`.
	 */
	app.get("/api/v1/billing/checkout-return", async (c) => {
		const domain = c.req.query("domain") || "";
		const sessionId = c.req.query("session_id") || "";
		const userAgent = c.req.header("user-agent") || "";
		const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);

		if (isMobile) {
			const deepLink = `inboxies://onboarding/domain-ready?domain=${encodeURIComponent(domain)}&session_id=${encodeURIComponent(sessionId)}`;
			return c.redirect(deepLink, 302);
		}

		// Web desktop return -> redirect to admin DNS overview
		return c.redirect(`/admin?tab=dns&domain=${encodeURIComponent(domain)}&purchased=true`, 302);
	});

	/**
	 * Stripe Webhook: listens for checkout.session.completed event.
	 * Automatically calls Cloudflare Registrar to register domain, provisions zone, and configures email.
	 */
	app.post("/api/v1/billing/stripe-webhook", async (c) => {
		const rawBody = await c.req.text();
		let event: any;

		try {
			event = JSON.parse(rawBody);
		} catch {
			return c.json({ error: "Invalid JSON payload" }, 400);
		}

		// Verify event type
		if (event.type !== "checkout.session.completed") {
			return c.json({ received: true, ignored: true });
		}

		const session = event.data?.object;
		if (!session) {
			return c.json({ error: "Missing session object" }, 400);
		}

		const domain = (session.metadata?.domain || "").toLowerCase().trim();
		if (!domain) {
			return c.json({ error: "No domain metadata in checkout session" }, 400);
		}

		const username = (session.metadata?.username || "").toLowerCase().trim();
		const displayName = session.metadata?.displayName || username;
		const passwordHash = session.metadata?.passwordHash;

		// 1. Check if domain was already provisioned
		let existing = await getDomainMetadata(c.env.BUCKET, domain);
		if (existing && existing.status === "active") {
			return c.json({ received: true, domain, status: "already_provisioned" });
		}

		// 2. Register domain via Cloudflare Registrar
		let registrationResult;
		try {
			registrationResult = await registerDomain(c.env, domain);
		} catch (regErr: unknown) {
			const msg = regErr instanceof Error ? regErr.message : "Registrar registration failed";
			return c.json({ error: `Registrar error: ${msg}` }, 502);
		}

		// 3. Provision Cloudflare Zone & Email Routing
		let zone;
		try {
			zone = await createZone(c.env, domain);
			await ensureFullEmailDns(c.env, zone.id, domain);
		} catch (cfErr: unknown) {
			const msg = cfErr instanceof Error ? cfErr.message : "Cloudflare setup failed";
			return c.json({ error: `Cloudflare setup failed: ${msg}` }, 502);
		}

		// 4. Provision primary admin user & mailbox if credentials provided
		let ownerUserId = "registrar_owner";
		if (username && passwordHash) {
			const fullEmail = `${username}@${domain}`;
			const canonical = canonicalMailboxId(fullEmail);
			if (canonical) {
				const existingUser = await findUserIdByLoginEmail(c.env.BUCKET, canonical);
				if (!existingUser) {
					ownerUserId = crypto.randomUUID();
					const user: PlatformUser = {
						id: ownerUserId,
						contactEmail: canonical,
						mailboxEmail: canonical,
						passwordHash,
						linkedSubs: [],
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					};
					await savePlatformUser(c.env.BUCKET, user);

					const principal = principalFromPlatformUser(user);
					const ensured = await ensurePrincipalAccount(c.env.BUCKET, principal);

					const metaKey = mailboxMetadataKey(canonical);
					const settings = {
						fromName: displayName || username,
						forwarding: { enabled: false, email: "" },
						signature: { enabled: false, text: "" },
						autoReply: { enabled: false, subject: "", message: "" },
						screener: { enabled: true },
						acl: aclFromOwnerKeys(ensured.ownerKeys),
					};
					await c.env.BUCKET.put(metaKey, JSON.stringify(settings));

					// Revive Durable Object stub
					const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(canonical));
					await stub.reviveMailbox();
					await stub.getFolders();
					await seedWelcomeEmailsForMailbox(c.env, canonical, canonical.split("@")[0]);
				}
			}
		}

		// 5. Persist Domain Metadata in R2
		const domainMetadata: DomainMetadata = {
			domain,
			zoneId: zone.id,
			ownerUserId,
			adminUserIds: [ownerUserId],
			status: "active",
			nameservers: zone.name_servers,
			emailRoutingEnabled: true,
			registration: {
				provider: "cloudflare_registrar",
				registeredAt: registrationResult.registeredAt,
				expiresAt: registrationResult.expiresAt,
				autoRenew: registrationResult.autoRenew,
				whoisPrivacy: registrationResult.whoisPrivacy,
				locked: registrationResult.locked,
				retailPriceUsd: 14.0,
			},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		await saveDomainMetadata(c.env.BUCKET, domainMetadata);

		return c.json({
			received: true,
			domain,
			status: "provisioned",
			retailPriceUsd: 14.0,
			zoneId: zone.id,
		});
	});
}
