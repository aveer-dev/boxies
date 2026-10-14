// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import type { MailboxContext } from "../lib/mailbox";
import {
	checkDomainAvailability,
	computeDomainPricing,
} from "../lib/cloudflare-registrar";
import { getDomainMetadata } from "../lib/domain-registry";
import { hashPassword, verifyPassword } from "../lib/password-auth";
import { authDb } from "../auth/authz";
import { clientIp, isRateLimited, TOO_MANY } from "../auth/rate-limit";
import { createSessionForUser, findUserById, sessionCookieHeader } from "../auth/users";
import { isDevRuntime } from "../lib/dev-runtime";
import {
	applyLifecycleEvent,
	billingEventKey,
	billingSessionKey,
	endUnpaidCheckout,
	fulfillPaidCheckout,
	LIFECYCLE_EVENT_TYPES,
	loadBillingSession,
	markAwaitingPayment,
	saveBillingSession,
	type BillingSessionRecord,
	type StripeEvent,
	type WebhookOutcome,
} from "../lib/billing-fulfillment";
import {
	attachCheckoutSession,
	CHECKOUT_GRACE_MS,
	getReservation,
	holdForCheckout,
	releaseCheckoutHold,
	takeOverCheckoutHold,
} from "../lib/domain-reservations";
import {
	canCallStripeFor,
	expireCheckoutSession,
	stripeRequest,
	type StripeCheckoutSession,
} from "../lib/stripe";

export { billingEventKey, billingSessionKey, type BillingSessionRecord };

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
	client: z.enum(["web", "ios", "android"]).optional(),
	returnUrl: z.string().url().optional(),
});

interface StripeSessionResponse {
	id: string;
	url: string;
}

/**
 * How long a Checkout Session stays payable. Stripe's minimum is 30 minutes
 * from when it creates the session, so leave room for the round trip.
 */
const CHECKOUT_TTL_MS = 35 * 60 * 1000;

/** Stripe statuses that mean the customer actually owes nothing more. */
const SETTLED_PAYMENT_STATUSES = new Set(["paid", "no_payment_required"]);


function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Verify Stripe webhook signature using Web Crypto HMAC-SHA256.
 */
export async function verifyStripeWebhookSignature(
	rawBody: string,
	signatureHeader: string,
	secret: string,
	toleranceSeconds = 300,
): Promise<{ valid: boolean; error?: string }> {
	if (!signatureHeader || !secret) {
		return { valid: false, error: "Missing signature header or secret" };
	}

	const parts = signatureHeader.split(",");
	let timestamp: string | undefined;
	const signatures: string[] = [];

	for (const part of parts) {
		const [k, v] = part.split("=");
		if (k === "t") timestamp = v;
		else if (k === "v1") signatures.push(v);
	}

	if (!timestamp || signatures.length === 0) {
		return { valid: false, error: "Invalid signature header format" };
	}

	const tsNum = parseInt(timestamp, 10);
	if (isNaN(tsNum)) {
		return { valid: false, error: "Invalid timestamp in signature" };
	}

	const nowSeconds = Math.floor(Date.now() / 1000);
	if (Math.abs(nowSeconds - tsNum) > toleranceSeconds) {
		return { valid: false, error: "Webhook timestamp out of tolerance" };
	}

	const signedPayload = `${timestamp}.${rawBody}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const sigBuffer = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signedPayload),
	);

	const expectedSig = Array.from(new Uint8Array(sigBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	for (const sig of signatures) {
		if (timingSafeEqual(sig, expectedSig)) {
			return { valid: true };
		}
	}

	return { valid: false, error: "Signature mismatch" };
}

/** The value `.dev.vars.example` ships with; never a usable signing secret. */
const STRIPE_WEBHOOK_SECRET_PLACEHOLDER = "whsec_...";

function configuredStripeWebhookSecret(env: Env): string | undefined {
	const secret = env.STRIPE_WEBHOOK_SECRET;
	if (!secret || secret === STRIPE_WEBHOOK_SECRET_PLACEHOLDER) return undefined;
	return secret;
}

/** `/checkout/mock` and its React Router `.data` / nested variants, however the path is cased or encoded. */
function isMockCheckoutPath(pathname: string): boolean {
	let decoded = pathname;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {}
	return /^\/checkout\/mock(?:[/.]|$)/i.test(decoded);
}

export function registerBillingRoutes(app: Hono<MailboxContext>) {
	/**
	 * The mock checkout page simulates payment by posting an unsigned webhook event,
	 * so it only exists in local dev. Runs ahead of the React Router catch-all.
	 */
	app.use("*", async (c, next) => {
		if (!isDevRuntime() && isMockCheckoutPath(new URL(c.req.url).pathname)) {
			return c.text("Not Found", 404);
		}
		await next();
	});

	/**
	 * Initiate an annual Stripe Checkout subscription session to purchase and register a domain.
	 * Transparent fee breakdown:
	 * - Domain Registration: Wholesale cost ($10.44 for .com)
	 * - Inboxies Platform, AI & Cloud Infrastructure: Platform fee ($9.56 for standard; $10 for domains > $15)
	 * - Total: $20.00/yr (or wholesale + $10/yr)
	 *
	 * The domain is held for this checkout until it is paid, abandoned or expires,
	 * so a second buyer can't pay for the same name.
	 */
	app.post("/api/v1/billing/create-domain-checkout", async (c) => {
		const parsed = CreateDomainCheckoutBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message || "Invalid input" },
				400,
			);
		}

		const { domain: rawDomain, username, password, displayName, client } = parsed.data;
		const domain = rawDomain.toLowerCase();
		if (await isRateLimited(c.env, "checkout", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);

		// A signed-in caller (e.g. from the Admin DNS suite) owns the purchase; otherwise
		// the checkout creates the owner's account, so it needs a login for it.
		const callerUserId = c.get("principal")?.userId;
		if (!callerUserId && !(username && password)) {
			return c.json(
				{ error: "Sign in, or choose a username and password for the domain's first mailbox" },
				400,
			);
		}

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

		const pricing = computeDomainPricing(avail.wholesalePriceUsd);

		// Without live Stripe credentials only local dev gets the /checkout/mock simulator
		const useStripe = Boolean(c.env.STRIPE_SECRET_KEY);
		if (!useStripe && !isDevRuntime()) {
			return c.json({ error: "Domain checkout is not configured" }, 503);
		}

		// 3. Hold the domain for this checkout.
		const db = authDb(c.env.AUTH_DB);
		const holdId = crypto.randomUUID();
		const checkoutExpiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
		const holdUntil = new Date(checkoutExpiresAt.getTime() + CHECKOUT_GRACE_MS);
		const held =
			(await holdForCheckout(db, domain, holdId, holdUntil)) ||
			(await takeOverOwnCheckout(c.env, domain, holdId, holdUntil, { callerUserId, username, password }));
		if (!held) {
			return c.json(
				{ error: "Someone is already checking out this domain. Try again in a few minutes." },
				409,
			);
		}

		const appBase = c.env.APP_BASE_URL || "https://inboxies.email";
		const clientParam = client ? `&client=${encodeURIComponent(client)}` : "";
		const effectiveSuccessUrl = `${appBase}/api/v1/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}&domain=${encodeURIComponent(domain)}${clientParam}`;
		const effectiveCancelUrl = `${appBase}/api/v1/billing/checkout-cancel?domain=${encodeURIComponent(domain)}&hold=${encodeURIComponent(holdId)}${clientParam}`;

		// 4. Create the Stripe Checkout Subscription Session (or the dev mock).
		let sessionId: string;
		let checkoutUrl: string;
		try {
			if (useStripe) {
				const form = new URLSearchParams();
				form.append("mode", "subscription");

				// Item 1: Domain Registration (Annual ICANN wholesale fee)
				form.append("line_items[0][price_data][currency]", "usd");
				form.append("line_items[0][price_data][recurring][interval]", "year");
				form.append(
					"line_items[0][price_data][product_data][name]",
					`Domain Registration: ${domain} (Annual)`,
				);
				form.append(
					"line_items[0][price_data][product_data][description]",
					`1-year domain registration & wholesale ICANN fee via Cloudflare Registrar`,
				);
				form.append("line_items[0][price_data][unit_amount]", Math.round(pricing.domainFeeUsd * 100).toString());
				form.append("line_items[0][quantity]", "1");

				// Item 2: Inboxies Platform, AI & Cloud Infrastructure (Annual)
				form.append("line_items[1][price_data][currency]", "usd");
				form.append("line_items[1][price_data][recurring][interval]", "year");
				form.append(
					"line_items[1][price_data][product_data][name]",
					"Inboxies Platform, AI & Cloud Infrastructure (Annual)",
				);
				form.append(
					"line_items[1][price_data][product_data][description]",
					"Dedicated AI email agent, edge server sync, R2 storage, Anycast DNS, and email security",
				);
				form.append("line_items[1][price_data][unit_amount]", Math.round(pricing.platformFeeUsd * 100).toString());
				form.append("line_items[1][quantity]", "1");

				// Metadata is visible to anyone with Stripe Dashboard access: no secrets.
				// The password hash stays in our own checkout record.
				form.append("metadata[domain]", domain);
				form.append("metadata[domainFeeUsd]", pricing.domainFeeUsd.toFixed(2));
				form.append("metadata[platformFeeUsd]", pricing.platformFeeUsd.toFixed(2));
				form.append("metadata[totalAnnualUsd]", pricing.totalAnnualUsd.toFixed(2));
				if (username) form.append("metadata[username]", username.toLowerCase());
				if (displayName) form.append("metadata[displayName]", displayName);
				if (callerUserId) form.append("metadata[ownerUserId]", callerUserId);
				if (client) form.append("metadata[client]", client);
				form.append("subscription_data[metadata][domain]", domain);

				form.append("expires_at", Math.floor(checkoutExpiresAt.getTime() / 1000).toString());
				form.append("success_url", effectiveSuccessUrl);
				form.append("cancel_url", effectiveCancelUrl);

				const session = await stripeRequest<StripeSessionResponse>(c.env, "POST", "/checkout/sessions", form);
				sessionId = session.id;
				checkoutUrl = session.url;
			} else {
				sessionId = `mock_cs_${domain.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}`;
				checkoutUrl = `${appBase}/checkout/mock?session_id=${sessionId}&domain=${encodeURIComponent(domain)}&hold=${encodeURIComponent(holdId)}${clientParam}`;
			}
		} catch (e) {
			await releaseCheckoutHold(db, domain, holdId).catch(() => {});
			const msg = e instanceof Error ? e.message : "Stripe session error";
			return c.json({ error: msg }, 502);
		}

		// 5. Tie the hold to the session and save our record (with the password hash).
		const now = new Date().toISOString();
		const sessionRecord: BillingSessionRecord = {
			sessionId,
			domain,
			status: "pending",
			pricing,
			username: username?.toLowerCase(),
			displayName: displayName || username,
			ownerUserId: callerUserId,
			client,
			passwordHash: password ? await hashPassword(password) : undefined,
			createdAt: now,
			updatedAt: now,
		};
		try {
			if (!(await attachCheckoutSession(db, domain, holdId, sessionId, holdUntil))) {
				throw new Error("The domain hold was lost");
			}
			await saveBillingSession(c.env.BUCKET, sessionRecord);
		} catch (e) {
			// The buyer never gets this URL, so make sure nobody can pay it.
			if (canCallStripeFor(c.env, sessionId)) await expireCheckoutSession(c.env, sessionId).catch(() => {});
			await releaseCheckoutHold(db, domain, holdId).catch(() => {});
			console.error(`[billing] checkout setup for ${domain} failed:`, e);
			return c.json({ error: "Could not start checkout. Try again." }, 500);
		}

		return c.json({
			checkoutUrl,
			sessionId,
			domain,
			pricing,
			priceUsd: pricing.totalAnnualUsd,
			...(useStripe ? {} : { mock: true }),
		});
	});

	/**
	 * Hosted Bridge Return Handler after Stripe checkout completes.
	 * Redirects mobile clients to `inboxies://onboarding/domain-ready` with authenticated token,
	 * automatically closing the in-app browser (ASWebAuthenticationSession / Custom Tabs).
	 * Redirects desktop web users to `/checkout/success` with the session cookie set.
	 */
	app.get("/api/v1/billing/checkout-return", async (c) => {
		const domain = (c.req.query("domain") || "").toLowerCase().trim();
		const sessionId = c.req.query("session_id") || "";
		const clientQuery = c.req.query("client") || "";
		const userAgent = c.req.header("user-agent") || "";
		const isMobile = clientQuery === "ios" || clientQuery === "android" || /iPhone|iPad|iPod|Android/i.test(userAgent);

		// Mint the owner session only for the paid checkout this browser just completed:
		// the Stripe session id is the secret, it must be provisioned for this domain,
		// and the token is handed out exactly once.
		let token: string | undefined;
		let mailboxId: string | undefined;
		let sessionCookie: string | undefined;

		const record = await loadBillingSession(c.env.BUCKET, sessionId);
		if (
			record &&
			domain &&
			record.domain === domain &&
			record.status === "ready" &&
			!record.tokenIssuedAt &&
			record.ownerUserId &&
			record.mailboxId
		) {
			const db = authDb(c.env.AUTH_DB);
			const owner = await findUserById(db, record.ownerUserId);
			// Only the account this checkout created (its login is the new mailbox).
			if (owner && owner.email === record.mailboxId) {
				record.tokenIssuedAt = new Date().toISOString();
				record.updatedAt = record.tokenIssuedAt;
				await c.env.BUCKET.put(billingSessionKey(record.sessionId), JSON.stringify(record));
				mailboxId = record.mailboxId;
				const session = await createSessionForUser(c.env, owner.id, { headers: c.req.raw.headers });
				token = session.token;
				sessionCookie = await sessionCookieHeader(c.env, session);
			}
		}

		if (isMobile) {
			let deepLink = `inboxies://onboarding/domain-ready?domain=${encodeURIComponent(domain)}&session_id=${encodeURIComponent(sessionId)}`;
			if (token) deepLink += `&token=${encodeURIComponent(token)}`;
			if (mailboxId) deepLink += `&mailbox_id=${encodeURIComponent(mailboxId)}`;

			// 302 Redirect with HTML bridge script fallback to close in-app browser
			return c.html(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redirecting to Inboxies...</title>
<script>
window.location.href = ${JSON.stringify(deepLink)};
</script>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fafafb; color: #1f1f24;">
<div style="text-align: center; padding: 24px;">
  <p style="font-size: 16px; font-weight: 600;">Payment complete! Returning to Inboxies...</p>
  <a href="${deepLink}" style="display: inline-block; margin-top: 14px; padding: 10px 22px; background: #2659d9; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px;">Open Inboxies</a>
</div>
</body>
</html>`, 302, {
				Location: deepLink,
			});
		}

		// Web desktop return -> redirect to checkout success page with cookie
		const headers: Record<string, string> = {
			Location: `/checkout/success?session_id=${encodeURIComponent(sessionId)}&domain=${encodeURIComponent(domain)}`,
		};
		if (sessionCookie) headers["Set-Cookie"] = sessionCookie;
		return new Response(null, {
			status: 302,
			headers,
		});
	});

	/**
	 * Hosted Bridge Cancellation Handler.
	 * Gives the domain hold back (the checkout's own browser carries its hold id),
	 * then redirects mobile clients to `inboxies://onboarding/cancelled` (closing the
	 * in-app browser) and desktop web users to `/checkout/cancel`.
	 */
	app.get("/api/v1/billing/checkout-cancel", async (c) => {
		const domain = (c.req.query("domain") || "").toLowerCase().trim();
		const holdId = c.req.query("hold") || "";
		const clientQuery = c.req.query("client") || "";
		const userAgent = c.req.header("user-agent") || "";
		const isMobile = clientQuery === "ios" || clientQuery === "android" || /iPhone|iPad|iPod|Android/i.test(userAgent);

		if (domain && holdId) {
			await releaseAbandonedCheckout(c.env, domain, holdId).catch((e) =>
				console.warn(`[billing] could not release ${domain} after cancel:`, e),
			);
		}

		if (isMobile) {
			const cancelDeepLink = `inboxies://onboarding/cancelled?domain=${encodeURIComponent(domain)}`;
			return c.redirect(cancelDeepLink, 302);
		}

		return c.redirect(`/checkout/cancel?domain=${encodeURIComponent(domain)}`, 302);
	});

	/**
	 * Query Domain Checkout Provisioning Status.
	 * Used by Web and Mobile checkout success screens to live-poll DNS and mailbox activation.
	 */
	app.get("/api/v1/billing/checkout-status", async (c) => {
		const sessionId = c.req.query("session_id") || "";
		const domain = (c.req.query("domain") || "").toLowerCase().trim();

		if (!sessionId && !domain) {
			return c.json({ error: "Missing session_id or domain" }, 400);
		}

		const sessionRecord = await loadBillingSession(c.env.BUCKET, sessionId);
		const targetDomain = sessionRecord?.domain || domain;
		const meta = targetDomain ? await getDomainMetadata(c.env.BUCKET, targetDomain) : null;

		if (sessionRecord) {
			// Ready once this checkout's domain is live, even if the record lags behind.
			const live = meta?.status === "active" && meta.billing?.checkoutSessionId === sessionRecord.sessionId;
			const status = live ? "ready" : sessionRecord.status;
			return c.json({
				status,
				domain: sessionRecord.domain,
				// Recompute so records saved before the client field names existed still decode.
				pricing: computeDomainPricing(sessionRecord.pricing.domainFeeUsd),
				mailboxId: sessionRecord.mailboxId,
				...(status === "failed" || status === "refunded" || status === "canceled"
					? { error: sessionRecord.error }
					: {}),
			});
		}

		if (meta && meta.status === "active") {
			return c.json({
				status: "ready",
				domain: targetDomain,
				pricing: computeDomainPricing(10.44),
			});
		}

		return c.json({
			status: "pending",
			domain: targetDomain || "",
		});
	});

	/**
	 * Stripe Webhook. Cryptographically verifies signatures, then:
	 * - checkout.session.completed / async_payment_succeeded: buy the domain, set up DNS and the owner;
	 * - completed but unpaid (delayed payment methods): keep the domain held;
	 * - async_payment_failed / expired: release the domain;
	 * - invoice, subscription, refund and dispute events: track the subscription on the domain.
	 *
	 * Subscribe the endpoint to every event type handled below (see .dev.vars.example).
	 */
	app.post("/api/v1/billing/stripe-webhook", async (c) => {
		const rawBody = await c.req.text();
		const sigHeader = c.req.header("stripe-signature") || "";
		const webhookSecret = configuredStripeWebhookSecret(c.env);

		// Fulfillment buys domains, so unsigned events are only accepted from the local
		// /checkout/mock simulator. A real secret is always enforced, dev included.
		if (webhookSecret) {
			const verifyRes = await verifyStripeWebhookSignature(rawBody, sigHeader, webhookSecret);
			if (!verifyRes.valid) {
				return c.json({ error: `Webhook verification failed: ${verifyRes.error}` }, 400);
			}
		} else if (!isDevRuntime()) {
			return c.json({ error: "Stripe webhook secret is not configured" }, 503);
		} else if (sigHeader) {
			// A signed delivery (e.g. `stripe listen`) can't be checked without the secret
			return c.json({ error: "Webhook verification failed: STRIPE_WEBHOOK_SECRET is not set" }, 400);
		}
		const unsignedDevEvent = !webhookSecret;

		let event: StripeEvent;
		try {
			event = JSON.parse(rawBody);
		} catch {
			return c.json({ error: "Invalid JSON payload" }, 400);
		}

		// Stripe retries deliveries; skip events we already handled.
		const eventId = typeof event.id === "string" ? event.id : "";
		if (eventId && (await c.env.BUCKET.head(billingEventKey(eventId)))) {
			return c.json({ received: true, duplicate: true });
		}

		const type = event.type ?? "";
		let outcome: WebhookOutcome;
		if (type.startsWith("checkout.session.")) {
			const session = event.data?.object as StripeCheckoutSession | undefined;
			if (!session?.id) return c.json({ error: "Missing session object" }, 400);

			switch (type) {
				case "checkout.session.completed":
					if (SETTLED_PAYMENT_STATUSES.has(session.payment_status ?? "")) {
						outcome = await fulfillPaidCheckout(c.env, session);
					} else if (unsignedDevEvent && !session.payment_status) {
						// The /checkout/mock page doesn't model payment status.
						outcome = await fulfillPaidCheckout(c.env, session);
					} else if (session.payment_status === "unpaid") {
						outcome = await markAwaitingPayment(c.env, session);
					} else {
						outcome = { status: 200, body: { received: true, ignored: true, reason: "payment_not_settled" } };
					}
					break;
				case "checkout.session.async_payment_succeeded":
					outcome = await fulfillPaidCheckout(c.env, session);
					break;
				case "checkout.session.async_payment_failed":
					outcome = await endUnpaidCheckout(c.env, session, "failed");
					break;
				case "checkout.session.expired":
					outcome = await endUnpaidCheckout(c.env, session, "canceled");
					break;
				default:
					outcome = { status: 200, body: { received: true, ignored: true } };
			}
		} else if (LIFECYCLE_EVENT_TYPES.has(type)) {
			try {
				outcome = await applyLifecycleEvent(c.env, event);
			} catch (e) {
				const msg = e instanceof Error ? e.message : "Lifecycle update failed";
				console.error(`[billing] ${type} failed, Stripe will retry:`, msg);
				outcome = { status: 502, body: { error: msg } };
			}
		} else {
			outcome = { status: 200, body: { received: true, ignored: true } };
		}

		if (outcome.status === 200 && eventId) {
			await c.env.BUCKET.put(
				billingEventKey(eventId),
				JSON.stringify({ eventId, type, processedAt: new Date().toISOString() }),
			);
		}
		return c.json(outcome.body, outcome.status);
	});
}

/**
 * A buyer starting over (closed the Stripe tab, dismissed the in-app browser)
 * gets their own hold back instead of a 409. Same buyer means the same signed-in
 * account, or the same username with the password the earlier checkout hashed.
 */
async function takeOverOwnCheckout(
	env: Env,
	domain: string,
	newHoldId: string,
	holdUntil: Date,
	buyer: { callerUserId?: string; username?: string; password?: string },
): Promise<boolean> {
	const db = authDb(env.AUTH_DB);
	const hold = await getReservation(db, domain);
	if (!hold || hold.status !== "checkout" || !hold.holdId || !hold.sessionId) return false;
	const previous = await loadBillingSession(env.BUCKET, hold.sessionId);
	if (!previous || previous.status !== "pending") return false;

	const sameAccount = Boolean(buyer.callerUserId && previous.ownerUserId === buyer.callerUserId);
	const sameLogin = Boolean(
		buyer.username &&
			buyer.password &&
			previous.passwordHash &&
			previous.username === buyer.username.toLowerCase() &&
			(await verifyPassword(buyer.password, previous.passwordHash)),
	);
	if (!sameAccount && !sameLogin) return false;

	// Once the hold moves, the old session must not be payable. Stripe refuses
	// to expire a session that was already paid: then the hold stays put.
	if (canCallStripeFor(env, hold.sessionId)) {
		try {
			await expireCheckoutSession(env, hold.sessionId);
		} catch {
			return false;
		}
	}
	if (!(await takeOverCheckoutHold(db, domain, hold.holdId, newHoldId, holdUntil))) return false;

	previous.status = "canceled";
	previous.error = "Replaced by a newer checkout.";
	previous.passwordHash = undefined;
	await saveBillingSession(env.BUCKET, previous);
	return true;
}

/**
 * The checkout's browser gave up. Expire the Stripe session first, so it can't
 * be paid after the hold is gone; if Stripe refuses (already paid), keep it.
 */
async function releaseAbandonedCheckout(env: Env, domain: string, holdId: string): Promise<void> {
	const db = authDb(env.AUTH_DB);
	const hold = await getReservation(db, domain);
	if (!hold || hold.holdId !== holdId || hold.status !== "checkout") return;
	if (hold.sessionId && canCallStripeFor(env, hold.sessionId)) {
		await expireCheckoutSession(env, hold.sessionId);
	}
	await releaseCheckoutHold(db, domain, holdId);
	if (hold.sessionId) {
		const record = await loadBillingSession(env.BUCKET, hold.sessionId);
		if (record && record.status === "pending") {
			record.status = "canceled";
			record.error = "Checkout was cancelled.";
			record.passwordHash = undefined;
			await saveBillingSession(env.BUCKET, record);
		}
	}
}
