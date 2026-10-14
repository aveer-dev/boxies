// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * What happens after Stripe says a domain checkout was paid (or wasn't), and
 * over the life of the subscription that pays for the domain.
 *
 * Fulfillment runs from webhooks, which Stripe retries until we answer 2xx.
 * Every step either records its result on the checkout record or is safe to
 * repeat, so a retry picks up where the last attempt stopped:
 *
 *   claim the domain → register it (once) → zone + DNS (looked up by name
 *   first) → owner account (adopted on retry) → ownership row + metadata
 *   → record ready → release the claim
 *
 * When the domain can never be ours (someone else registered it, or another
 * buyer already holds it), the subscription is cancelled and the payment
 * refunded instead of keeping the money.
 */

import { and, eq } from "drizzle-orm";
import type { Env } from "../types";
import { authDb, type AuthDb } from "../auth/authz";
import {
	initializeMailboxStorage,
	isMailboxAddressTaken,
	isUniqueViolation,
	mailboxRowStatements,
} from "../auth/mailboxes";
import * as schema from "../auth/schema";
import { findUserByEmail, findUserById } from "../auth/users";
import { CloudflareApiError, ensureFullEmailDns, ensureZone } from "./cloudflare-client";
import {
	computeDomainPricing,
	getOwnedRegistration,
	registerDomain,
	type DomainPricingBreakdown,
} from "./cloudflare-registrar";
import {
	getDomainMetadata,
	saveDomainMetadata,
	type DomainBillingInfo,
	type DomainMetadata,
} from "./domain-registry";
import {
	claimForSession,
	endProvisioningLease,
	getReservation,
	PROVISIONING_LEASE_MS,
	releaseForSession,
} from "./domain-reservations";
import {
	endDomainService,
	needsManualRegistrarRenewal,
	refreshRegistration,
	restoreDomainService,
	setAutoRenewBestEffort,
	summarizeDomainService,
} from "./domain-service";
import { canonicalMailboxId } from "./mailbox-routing";
import { alertOps } from "./ops-alert";
import { remindIfDue, sendReminder, unwatchDomain, watchDomain } from "./service-reminders";
import {
	canCallStripeFor,
	cancelSubscription,
	refundCheckoutPayment,
	stripeId,
	stripeRequest,
	type StripeCheckoutSession,
} from "./stripe";

export type BillingSessionStatus =
	| "pending"
	| "awaiting_payment"
	| "provisioning"
	| "ready"
	| "failed"
	| "refunded"
	| "canceled";

export interface BillingSessionRecord {
	sessionId: string;
	domain: string;
	/** A new domain, or renewing one whose subscription ended. */
	purpose?: "purchase" | "renew";
	status: BillingSessionStatus;
	pricing: DomainPricingBreakdown;
	username?: string;
	displayName?: string;
	mailboxId?: string;
	/** The signed-in buyer at checkout, then the account fulfillment created. */
	ownerUserId?: string;
	client?: string;
	createdAt: string;
	updatedAt: string;
	error?: string;
	/** Set once checkout-return has handed out the owner session; never mint twice. */
	tokenIssuedAt?: string;
	/** Registrar result, kept so a webhook retry never pays for the domain twice. */
	registration?: Awaited<ReturnType<typeof registerDomain>>;
	/**
	 * Hash of the password picked at checkout. Server-side only: never sent to
	 * Stripe, and deleted once the account exists or the checkout ends.
	 */
	passwordHash?: string;
	/** The owner's mailbox storage is seeded; a retry must not seed it again. */
	mailboxInitializedAt?: string;
	zoneId?: string;
	/** Why this checkout can never be fulfilled; its payment is refunded. */
	terminalError?: string;
	refundIds?: string[];
	/** Ops were already told to renew the registration by hand (renewals). */
	opsAlertedAt?: string;
}

export function billingSessionKey(sessionId: string): string {
	return `billing/sessions/${sessionId}.json`;
}

export function billingEventKey(eventId: string): string {
	return `billing/events/${eventId}.json`;
}

/** Stripe customer → the domain its subscription pays for (one customer per checkout). */
export function billingCustomerKey(customerId: string): string {
	return `billing/customers/${customerId}.json`;
}

export async function loadBillingSession(
	bucket: R2Bucket,
	sessionId: string,
): Promise<BillingSessionRecord | null> {
	if (!sessionId) return null;
	const obj = await bucket.get(billingSessionKey(sessionId));
	if (!obj) return null;
	try {
		return (await obj.json()) as BillingSessionRecord;
	} catch {
		return null;
	}
}

export async function saveBillingSession(bucket: R2Bucket, record: BillingSessionRecord): Promise<void> {
	record.updatedAt = new Date().toISOString();
	await bucket.put(billingSessionKey(record.sessionId), JSON.stringify(record));
}

/** A webhook's answer. Anything but 2xx makes Stripe deliver the event again later. */
export interface WebhookOutcome {
	status: 200 | 400 | 409 | 502;
	body: Record<string, unknown>;
}

/** Fulfillment can never succeed for this checkout; refund it. */
class TerminalFulfillmentError extends Error {}

const DOMAIN_TAKEN_MESSAGE = "This domain was registered by someone else before your payment completed.";
const DOMAIN_HELD_MESSAGE = "Someone else is already buying this domain.";

function checkoutDomain(session: StripeCheckoutSession): string {
	return (session.metadata?.domain || "").toLowerCase().trim();
}

function recordFromSession(session: StripeCheckoutSession, domain: string): BillingSessionRecord {
	const now = new Date().toISOString();
	return {
		sessionId: session.id,
		domain,
		status: "pending",
		pricing: computeDomainPricing(parseFloat(session.metadata?.domainFeeUsd || "10.44")),
		username: session.metadata?.username?.toLowerCase().trim() || undefined,
		displayName: session.metadata?.displayName || session.metadata?.username,
		ownerUserId: session.metadata?.ownerUserId,
		client: session.metadata?.client,
		createdAt: now,
		updatedAt: now,
	};
}

async function loadRecordFor(
	env: Env,
	session: StripeCheckoutSession,
	domain: string,
): Promise<BillingSessionRecord | WebhookOutcome> {
	const record = await loadBillingSession(env.BUCKET, session.id);
	if (record && record.domain !== domain) {
		return { status: 400, body: { error: "Checkout session does not match its domain" } };
	}
	return record ?? recordFromSession(session, domain);
}

function isOutcome(value: unknown): value is WebhookOutcome {
	return typeof value === "object" && value !== null && "body" in value && "status" in value;
}

/**
 * A registrar answer that won't change on retry: the name is taken or can't be
 * registered. Auth, billing and throttling problems on our side are retried.
 */
function isTerminalRegistrarError(e: unknown): boolean {
	return (
		e instanceof CloudflareApiError &&
		e.status >= 400 &&
		e.status < 500 &&
		![401, 402, 403, 408, 429].includes(e.status)
	);
}

/**
 * Where this checkout stands, read fresh: an outcome when there's nothing to
 * do (or only a refund), otherwise the record and any domain metadata.
 */
async function loadFulfillmentState(
	env: Env,
	db: AuthDb,
	session: StripeCheckoutSession,
	domain: string,
): Promise<WebhookOutcome | { record: BillingSessionRecord; existing: DomainMetadata | null }> {
	const loaded = await loadRecordFor(env, session, domain);
	if (isOutcome(loaded)) return loaded;
	const record = loaded;
	if (record.status === "ready") {
		// A run that saved the record but died before releasing its claim.
		await releaseForSession(db, domain, session.id).catch(() => {});
		return { status: 200, body: { received: true, domain, status: "already_provisioned" } };
	}
	if (record.status === "refunded") {
		return { status: 200, body: { received: true, domain, status: "refunded" } };
	}
	if (record.terminalError) return refundAndFail(env, db, session, record, record.terminalError);

	const existing = await getDomainMetadata(env.BUCKET, domain);
	if (existing && existing.billing?.checkoutSessionId !== session.id) {
		return refundAndFail(env, db, session, record, DOMAIN_TAKEN_MESSAGE);
	}
	return { record, existing };
}

/** Paid (card, or a delayed method that has now settled): buy and set up the domain. */
export async function fulfillPaidCheckout(env: Env, session: StripeCheckoutSession): Promise<WebhookOutcome> {
	const domain = checkoutDomain(session);
	if (!domain) return { status: 400, body: { error: "No domain metadata in checkout session" } };
	const db = authDb(env.AUTH_DB);

	const before = await loadFulfillmentState(env, db, session, domain);
	if (isOutcome(before)) return before;
	await indexCustomer(env, session, domain);

	const leaseEnd = new Date(Date.now() + PROVISIONING_LEASE_MS);
	if (!(await claimForSession(db, domain, session.id, "provisioning", leaseEnd))) {
		const holder = await getReservation(db, domain);
		// Only another checkout's hold means the domain is theirs. Our own attempt in
		// flight, or one that just finished and let go, means: try again later.
		if (!holder || holder.sessionId === session.id) {
			return { status: 409, body: { error: "Provisioning is already in progress" } };
		}
		return refundAndFail(env, db, session, before.record, DOMAIN_HELD_MESSAGE);
	}

	// Another attempt may have got further while we waited for the claim.
	const state = await loadFulfillmentState(env, db, session, domain);
	if (isOutcome(state)) return state;

	try {
		return await provision(env, db, session, state.record, domain, state.existing);
	} catch (e) {
		await endProvisioningLease(db, domain, session.id).catch(() => {});
		if (e instanceof TerminalFulfillmentError) return refundAndFail(env, db, session, state.record, e.message);
		const msg = e instanceof Error ? e.message : "Provisioning failed";
		console.error(`[billing] provisioning ${domain} failed, Stripe will retry:`, msg);
		return { status: 502, body: { error: `Provisioning failed: ${msg}` } };
	}
}

/**
 * Remember which domain this checkout's customer pays for, before anything
 * else: subscription events can arrive while provisioning is still retrying.
 */
async function indexCustomer(env: Env, session: StripeCheckoutSession, domain: string): Promise<void> {
	const customerId = stripeId(session.customer);
	if (!customerId) return;
	await env.BUCKET.put(
		billingCustomerKey(customerId),
		JSON.stringify({ customerId, domain, sessionId: session.id, subscriptionId: stripeId(session.subscription) }),
	);
}

async function provision(
	env: Env,
	db: AuthDb,
	session: StripeCheckoutSession,
	record: BillingSessionRecord,
	domain: string,
	existing: DomainMetadata | null,
): Promise<WebhookOutcome> {
	// 1. Register once. If an earlier attempt bought it without recording the
	// result, the registrar already lists it under our account.
	let registration = record.registration;
	if (!registration) {
		try {
			registration = await registerDomain(env, domain);
		} catch (e) {
			// A lookup error is retried (502), never read as "not ours": refunding a
			// domain we did buy would leave the operator paying for it.
			const owned = await getOwnedRegistration(env, domain);
			if (owned) registration = owned;
			else if (isTerminalRegistrarError(e)) throw new TerminalFulfillmentError(DOMAIN_TAKEN_MESSAGE);
			else throw e;
		}
		record.registration = registration;
		record.status = "provisioning";
		await saveBillingSession(env.BUCKET, record);
	}

	// 2. Zone and DNS. The registrar may have made the zone; a retry finds ours.
	const zone = await ensureZone(env, domain);
	if (record.zoneId !== zone.id) {
		record.zoneId = zone.id;
		await saveBillingSession(env.BUCKET, record);
	}
	await ensureFullEmailDns(env, zone.id, domain);

	// 3. The owner: the signed-in buyer, or the account this checkout creates.
	const ownerUserId = await resolveOwner(env, db, record, domain);
	if (record.mailboxId && record.ownerUserId && !record.mailboxInitializedAt) {
		await initializeMailboxStorage(env, record.mailboxId, { name: record.displayName || record.username || "" });
		record.mailboxInitializedAt = new Date().toISOString();
		await saveBillingSession(env.BUCKET, record);
	}

	// 4. Ownership row (a retry finds it already there).
	await db
		.insert(schema.domain)
		.values({ domain, ownerUserId, status: "active", verifiedAt: new Date() })
		.onConflictDoUpdate({
			target: schema.domain.domain,
			set: { status: "active", ...(ownerUserId ? { ownerUserId } : {}) },
		});

	// 5. Domain metadata, carrying the subscription that pays for it.
	const now = new Date().toISOString();
	const totalAnnualUsd = parseFloat(session.metadata?.totalAnnualUsd || "20.00");
	const customerId = stripeId(session.customer);
	const subscriptionId = stripeId(session.subscription);
	const billing: DomainBillingInfo = {
		status: "active",
		...existing?.billing,
		provider: "stripe",
		checkoutSessionId: session.id,
		customerId,
		subscriptionId,
		lastPaidAt: existing?.billing?.lastPaidAt ?? now,
		domainFeeUsd: parseFloat(session.metadata?.domainFeeUsd || "10.44"),
		platformFeeUsd: parseFloat(session.metadata?.platformFeeUsd || "9.56"),
		updatedAt: now,
	};
	const domainMetadata: DomainMetadata = {
		...existing,
		domain,
		zoneId: zone.id,
		ownerUserId: ownerUserId ?? "registrar_owner",
		adminUserIds: ownerUserId ? [ownerUserId] : [],
		status: "active",
		nameservers: zone.name_servers,
		emailRoutingEnabled: true,
		registration: {
			provider: "cloudflare_registrar",
			registeredAt: registration.registeredAt,
			expiresAt: registration.expiresAt,
			autoRenew: registration.autoRenew,
			whoisPrivacy: registration.whoisPrivacy,
			locked: registration.locked,
			retailPriceUsd: totalAnnualUsd,
		},
		billing,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	await saveDomainMetadata(env.BUCKET, domainMetadata);

	// 6. Done: the password hash has served its purpose.
	record.status = "ready";
	record.ownerUserId = ownerUserId ?? undefined;
	record.passwordHash = undefined;
	record.error = undefined;
	await saveBillingSession(env.BUCKET, record);
	await releaseForSession(db, domain, session.id);

	return {
		status: 200,
		body: {
			received: true,
			domain,
			status: "provisioned",
			retailPriceUsd: totalAnnualUsd,
			zoneId: zone.id,
			pricing: {
				domainFeeUsd: parseFloat(session.metadata?.domainFeeUsd || "10.44"),
				platformFeeUsd: parseFloat(session.metadata?.platformFeeUsd || "9.56"),
				totalAnnualUsd,
			},
		},
	};
}

/**
 * The account that owns the purchased domain. A retry adopts the account an
 * earlier attempt created (same login, same password hash) instead of leaving
 * the domain ownerless.
 */
async function resolveOwner(
	env: Env,
	db: AuthDb,
	record: BillingSessionRecord,
	domain: string,
): Promise<string | null> {
	if (record.ownerUserId && (await findUserById(db, record.ownerUserId))) return record.ownerUserId;

	const { username, passwordHash } = record;
	if (!username || !passwordHash) return null;
	const canonical = canonicalMailboxId(`${username}@${domain}`);
	if (!canonical) return null;

	const adopt = async (): Promise<string | null> => {
		const user = await findUserByEmail(db, canonical);
		if (!user) return null;
		const credential = await db
			.select({ password: schema.account.password })
			.from(schema.account)
			.where(and(eq(schema.account.userId, user.id), eq(schema.account.providerId, "credential")))
			.get();
		return credential?.password === passwordHash ? user.id : null;
	};

	let ownerUserId = await adopt();
	if (!ownerUserId && !(await findUserByEmail(db, canonical)) && !(await isMailboxAddressTaken(env, db, canonical))) {
		const userId = crypto.randomUUID();
		try {
			await db.batch([
				db.insert(schema.user).values({
					id: userId,
					email: canonical,
					name: record.displayName || username,
					emailVerified: true,
				}),
				// Hashed at checkout; never stored in plain text.
				db.insert(schema.account).values({
					id: `credential_${userId}`,
					accountId: userId,
					providerId: "credential",
					userId,
					password: passwordHash,
				}),
				...mailboxRowStatements(db, canonical, userId),
			] as unknown as Parameters<typeof db.batch>[0]);
			ownerUserId = userId;
		} catch (e) {
			if (!isUniqueViolation(e)) throw e;
			ownerUserId = await adopt();
		}
	}
	if (!ownerUserId) return null;

	record.ownerUserId = ownerUserId;
	record.mailboxId = canonical;
	await saveBillingSession(env.BUCKET, record);
	return ownerUserId;
}

/**
 * Give the money back: cancel the subscription first (no renewal charge), then
 * refund the payment. Both are safe to repeat, so a failure here answers 502
 * and Stripe's retry finishes the job.
 */
async function refundAndFail(
	env: Env,
	db: AuthDb,
	session: StripeCheckoutSession,
	record: BillingSessionRecord,
	reason: string,
): Promise<WebhookOutcome> {
	// Last check before giving money back: never refund a checkout that owns its domain.
	const latest = await loadBillingSession(env.BUCKET, session.id);
	if (latest?.status === "ready") {
		return { status: 200, body: { received: true, domain: record.domain, status: "already_provisioned" } };
	}
	if ((await getDomainMetadata(env.BUCKET, record.domain))?.billing?.checkoutSessionId === session.id) {
		return { status: 409, body: { error: "Provisioning is finishing; retry" } };
	}
	if (record.terminalError !== reason) {
		record.terminalError = reason;
		await saveBillingSession(env.BUCKET, record);
	}

	const canRefund = canCallStripeFor(env, session.id);
	if (canRefund) {
		try {
			const subscriptionId = stripeId(session.subscription);
			if (subscriptionId) await cancelSubscription(env, subscriptionId);
			record.refundIds = await refundCheckoutPayment(env, session);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Stripe error";
			console.error(`[billing] refund for ${session.id} failed, Stripe will retry:`, msg);
			return { status: 502, body: { error: `Refund failed: ${msg}` } };
		}
	}

	record.status = canRefund ? "refunded" : "failed";
	record.error = reason;
	record.passwordHash = undefined;
	await saveBillingSession(env.BUCKET, record);
	await releaseForSession(db, record.domain, session.id);
	console.warn(`[billing] ${record.domain}: ${reason} (${record.status})`);
	return { status: 200, body: { received: true, domain: record.domain, status: record.status, error: reason } };
}

/** Completed with a delayed payment method: keep the domain held until the money lands. */
export async function markAwaitingPayment(env: Env, session: StripeCheckoutSession): Promise<WebhookOutcome> {
	const domain = checkoutDomain(session);
	if (!domain) return { status: 400, body: { error: "No domain metadata in checkout session" } };
	const loaded = await loadRecordFor(env, session, domain);
	if (isOutcome(loaded)) return loaded;
	const record = loaded;
	if (record.status !== "pending" && record.status !== "awaiting_payment") {
		return { status: 200, body: { received: true, domain, status: record.status } };
	}

	await indexCustomer(env, session, domain);
	// If another buyer took the domain meanwhile, a later success is refunded.
	await claimForSession(authDb(env.AUTH_DB), domain, session.id, "awaiting_payment", null);
	record.status = "awaiting_payment";
	await saveBillingSession(env.BUCKET, record);
	return { status: 200, body: { received: true, domain, status: "awaiting_payment" } };
}

/** The delayed payment failed, or the checkout expired unpaid: let the domain go. */
export async function endUnpaidCheckout(
	env: Env,
	session: StripeCheckoutSession,
	outcome: "failed" | "canceled",
): Promise<WebhookOutcome> {
	const domain = checkoutDomain(session);
	if (!domain) return { status: 200, body: { received: true, ignored: true } };
	const record = await loadBillingSession(env.BUCKET, session.id);
	if (record && record.domain !== domain) {
		return { status: 400, body: { error: "Checkout session does not match its domain" } };
	}
	if (record && (record.status === "pending" || record.status === "awaiting_payment")) {
		record.status = outcome;
		record.error = outcome === "failed" ? "Your payment didn't go through." : "The checkout expired before payment.";
		record.passwordHash = undefined;
		await saveBillingSession(env.BUCKET, record);
	}
	await releaseForSession(authDb(env.AUTH_DB), domain, session.id);
	return { status: 200, body: { received: true, domain, status: outcome } };
}

// ── Renewal ──────────────────────────────────────────────────────

/** Checkouts that renew a domain whose subscription ended (vs. buying a new one). */
export function isRenewalCheckout(session: StripeCheckoutSession): boolean {
	return session.metadata?.purpose === "renew";
}

/** A renewal paid with a delayed method: note it; the domain stays as it is until the money lands. */
export async function markRenewalAwaitingPayment(env: Env, session: StripeCheckoutSession): Promise<WebhookOutcome> {
	const domain = checkoutDomain(session);
	if (!domain) return { status: 400, body: { error: "No domain metadata in checkout session" } };
	const loaded = await loadRecordFor(env, session, domain);
	if (isOutcome(loaded)) return loaded;
	if (loaded.status === "pending") {
		loaded.purpose = "renew";
		loaded.status = "awaiting_payment";
		await saveBillingSession(env.BUCKET, loaded);
	}
	return { status: 200, body: { received: true, domain, status: loaded.status } };
}

/**
 * A renewal was paid: the new subscription takes over and the domain is back
 * in service. Refunded instead when the domain can't come back (already
 * renewed by another checkout, or the registrar's renewal window closed).
 */
export async function fulfillRenewal(env: Env, session: StripeCheckoutSession, now = new Date()): Promise<WebhookOutcome> {
	const domain = checkoutDomain(session);
	if (!domain) return { status: 400, body: { error: "No domain metadata in checkout session" } };
	const db = authDb(env.AUTH_DB);

	const loaded = await loadRecordFor(env, session, domain);
	if (isOutcome(loaded)) return loaded;
	const record = loaded;
	record.purpose = "renew";
	if (record.status === "ready") return { status: 200, body: { received: true, domain, status: "renewed" } };
	if (record.status === "refunded") return { status: 200, body: { received: true, domain, status: "refunded" } };
	if (record.terminalError) return refundAndFail(env, db, session, record, record.terminalError);

	const initial = await getDomainMetadata(env.BUCKET, domain);
	if (!initial?.billing || initial.status === "offboarding") {
		return refundAndFail(env, db, session, record, "This domain is no longer with Inboxies.");
	}

	// One renewal at a time per domain: a second one paid at the same moment
	// waits, then finds the domain back in service and is refunded.
	const leaseEnd = new Date(now.getTime() + PROVISIONING_LEASE_MS);
	if (!(await claimForSession(db, domain, session.id, "provisioning", leaseEnd))) {
		return { status: 409, body: { error: "Another renewal for this domain is being processed" } };
	}

	try {
		const meta = (await getDomainMetadata(env.BUCKET, domain)) ?? initial;
		if (meta.billing?.checkoutSessionId !== session.id) {
			await refreshRegistration(env, meta);
			const summary = summarizeDomainService(meta, now);
			if (summary.status !== "ended") {
				return await refundAndFail(env, db, session, record, `${domain} was already renewed.`);
			}
			if (summary.renewBy && now.getTime() >= Date.parse(summary.renewBy)) {
				return await refundAndFail(env, db, session, record, `The renewal window for ${domain} has closed.`);
			}
			const stamp = now.toISOString();
			meta.billing = {
				provider: "stripe",
				checkoutSessionId: session.id,
				customerId: stripeId(session.customer) ?? meta.billing?.customerId,
				subscriptionId: stripeId(session.subscription),
				status: "active",
				lastPaidAt: stamp,
				domainFeeUsd: parseFloat(session.metadata?.domainFeeUsd || String(meta.billing?.domainFeeUsd ?? 10.44)),
				platformFeeUsd: parseFloat(session.metadata?.platformFeeUsd || String(meta.billing?.platformFeeUsd ?? 9.56)),
				renewedAt: stamp,
				updatedAt: stamp,
			};
		}
		// Safe to repeat: a retry after a crash finishes the D1 side.
		await restoreDomainService(env, meta, now);
		await indexCustomer(env, session, domain);
		await unwatchDomain(env, domain);

		if (needsManualRegistrarRenewal(meta, now) && !record.opsAlertedAt) {
			await alertOps(
				env,
				`Renew ${domain} at the registrar by hand`,
				`${domain} was renewed in Inboxies (checkout ${session.id}), but its registration expires ${meta.registration?.expiresAt}, ` +
					"too late for auto-renew, and the Registrar API can't renew. Renew it in the Cloudflare dashboard " +
					`(Domain Registration → Manage domains) before ${summarizeDomainService(meta, now).renewBy ?? "it lapses"}.`,
			);
			record.opsAlertedAt = now.toISOString();
		}

		record.status = "ready";
		record.error = undefined;
		await saveBillingSession(env.BUCKET, record);
		await releaseForSession(db, domain, session.id);

		await sendReminder(env, meta, summarizeDomainService(meta, now), { kind: "restored" }).catch((e) =>
			console.error(`[billing] renewal confirmation for ${domain} failed:`, (e as Error).message || e),
		);
		return { status: 200, body: { received: true, domain, status: "renewed" } };
	} catch (e) {
		await endProvisioningLease(db, domain, session.id).catch(() => {});
		const msg = e instanceof Error ? e.message : "Renewal failed";
		console.error(`[billing] renewal of ${domain} failed, Stripe will retry:`, msg);
		return { status: 502, body: { error: `Renewal failed: ${msg}` } };
	}
}

// ── Subscription lifecycle ───────────────────────────────────────

/** A Stripe event as delivered to the webhook. */
export interface StripeEvent {
	id?: string;
	type?: string;
	created?: number;
	data?: { object?: Record<string, any> };
}

export const LIFECYCLE_EVENT_TYPES = new Set([
	"invoice.paid",
	"invoice.payment_succeeded",
	"invoice.payment_failed",
	"customer.subscription.updated",
	"customer.subscription.deleted",
	"charge.refunded",
	"charge.dispute.created",
	"charge.dispute.closed",
]);

async function checkoutForCustomer(
	env: Env,
	customerId: string | undefined,
): Promise<{ domain: string; sessionId?: string } | null> {
	if (!customerId) return null;
	const obj = await env.BUCKET.get(billingCustomerKey(customerId));
	if (!obj) return null;
	try {
		const entry = (await obj.json()) as { domain?: string; sessionId?: string };
		return entry.domain ? { domain: entry.domain, sessionId: entry.sessionId } : null;
	} catch {
		return null;
	}
}

const IN_FLIGHT_STATUSES = new Set<BillingSessionStatus>(["pending", "awaiting_payment", "provisioning"]);

/** Disputes name the charge, not the customer. */
async function customerForCharge(env: Env, chargeId: string | undefined): Promise<string | undefined> {
	if (!chargeId || !env.STRIPE_SECRET_KEY) return undefined;
	const charge = await stripeRequest<{ customer?: string | { id: string } | null }>(
		env,
		"GET",
		`/charges/${encodeURIComponent(chargeId)}`,
	);
	return stripeId(charge.customer);
}

/**
 * Keep the domain's billing state in step with its subscription. When the
 * subscription ends, registrar auto-renew goes off so the operator isn't
 * billed to renew a domain nobody pays for. Mail keeps working until the
 * registration expires.
 */
export async function applyLifecycleEvent(env: Env, event: StripeEvent): Promise<WebhookOutcome> {
	const type = event.type ?? "";
	const obj = event.data?.object ?? {};
	const eventAt = typeof event.created === "number" ? event.created : Math.floor(Date.now() / 1000);

	// The first invoice belongs to the checkout, which has its own events.
	if (type.startsWith("invoice.") && obj.billing_reason === "subscription_create") {
		return { status: 200, body: { received: true, ignored: true } };
	}

	const customerId = type.startsWith("charge.dispute.")
		? await customerForCharge(env, stripeId(obj.charge))
		: stripeId(obj.customer);
	const checkout = await checkoutForCustomer(env, customerId);
	if (!checkout) return { status: 200, body: { received: true, ignored: true } };
	const { domain } = checkout;
	const meta = await getDomainMetadata(env.BUCKET, domain);
	if (!meta?.billing || (checkout.sessionId && meta.billing.checkoutSessionId !== checkout.sessionId)) {
		// The checkout is still being paid for or set up: have Stripe deliver this again later.
		const record = checkout.sessionId ? await loadBillingSession(env.BUCKET, checkout.sessionId) : null;
		if (record && IN_FLIGHT_STATUSES.has(record.status)) {
			return { status: 409, body: { error: "Checkout is not provisioned yet" } };
		}
		return { status: 200, body: { received: true, ignored: true } };
	}

	// A renewal starts a new subscription; the old one's late events change nothing.
	const eventSubscription =
		type.startsWith("customer.subscription.")
			? stripeId(obj.id)
			: stripeId(obj.subscription ?? obj.parent?.subscription_details?.subscription);
	if (eventSubscription && meta.billing.subscriptionId && eventSubscription !== meta.billing.subscriptionId) {
		return { status: 200, body: { received: true, ignored: true, reason: "previous_subscription" } };
	}

	const now = new Date().toISOString();
	const billing: DomainBillingInfo = { ...meta.billing };
	// Stripe doesn't promise order: an event older than the last status change
	// may still record facts (refunds, disputes) but never moves the service.
	const stale = Boolean(billing.statusEventAt && eventAt < billing.statusEventAt);
	const ended = Boolean(billing.serviceEndedAt);
	const cancelled = Boolean(billing.canceledAt);
	let serviceChange: "ending" | "resumed" | "ended" | "restored" | null = null;
	const setStatus = (status: string, force = false) => {
		if (!force && stale) return;
		billing.status = status;
		billing.statusEventAt = eventAt;
	};

	switch (type) {
		case "invoice.paid":
		case "invoice.payment_succeeded":
			billing.lastPaidAt = now;
			billing.pastDueSince = undefined;
			setStatus("active");
			// An unpaid subscription that gets paid is back (a cancelled one can't be).
			if (!stale && ended && !cancelled) serviceChange = "restored";
			break;
		case "invoice.payment_failed":
			billing.pastDueSince ??= now;
			setStatus("past_due");
			break;
		case "customer.subscription.updated": {
			if (stale) break;
			if (typeof obj.status === "string") setStatus(obj.status);
			if (ENDED_SUBSCRIPTION_STATUSES.has(obj.status)) {
				if (obj.status === "canceled") billing.canceledAt ??= now;
				if (!ended) serviceChange = "ended";
				break;
			}
			if (ended) {
				if (!cancelled && LIVE_SUBSCRIPTION_STATUSES.has(obj.status)) serviceChange = "restored";
				break;
			}
			const ending = Boolean(obj.cancel_at_period_end || obj.cancel_at);
			const wasEnding = Boolean(billing.cancelAtPeriodEnd);
			billing.cancelAtPeriodEnd = ending;
			billing.serviceEndsAt = ending ? scheduledEnd(obj) : undefined;
			if (ending && !wasEnding) serviceChange = "ending";
			if (!ending && wasEnding) serviceChange = "resumed";
			break;
		}
		case "customer.subscription.deleted":
			setStatus("canceled", true);
			billing.canceledAt ??= now;
			if (!ended) serviceChange = "ended";
			break;
		case "charge.refunded":
			billing.refundedAt = now;
			if (typeof obj.amount_refunded === "number") billing.amountRefunded = obj.amount_refunded;
			break;
		case "charge.dispute.created":
		case "charge.dispute.closed":
			billing.disputedAt ??= now;
			if (typeof obj.status === "string") billing.disputeStatus = obj.status;
			console.warn(`[billing] dispute on ${domain}: ${obj.status ?? type}`);
			break;
	}

	if (serviceChange === "ending" || serviceChange === "resumed") billing.remindersSent = [];
	billing.updatedAt = now;
	meta.billing = billing;
	meta.updatedAt = now;

	// The service follows the subscription.
	if (serviceChange === "restored") {
		await restoreDomainService(env, meta);
		await unwatchDomain(env, domain);
		await sendReminder(env, meta, summarizeDomainService(meta), { kind: "restored" }).catch((e) =>
			console.error(`[billing] restored notice for ${domain} failed:`, (e as Error).message || e),
		);
		return { status: 200, body: { received: true, domain, type, billingStatus: billing.status, service: "restored" } };
	}

	if (serviceChange === "ending") {
		// It's leaving: the registrar mustn't renew it in the meantime (auto-renew
		// runs ~30 days before expiry), and the deadline needs the real expiry.
		await refreshRegistration(env, meta);
		await setAutoRenewBestEffort(env, meta, false);
	}
	if (serviceChange === "resumed") await setAutoRenewBestEffort(env, meta, true);
	if (type.startsWith("invoice.paid") || type === "invoice.payment_succeeded") await refreshRegistration(env, meta);
	await saveDomainMetadata(env.BUCKET, meta);

	if (serviceChange === "ended") await endDomainService(env, domain);
	if (serviceChange === "ending" || serviceChange === "ended") {
		await watchDomain(env, domain);
		await remindIfDue(env, domain).catch((e) =>
			console.error(`[billing] reminder for ${domain} failed (the hourly run retries):`, (e as Error).message || e),
		);
	}
	if (serviceChange === "resumed") await unwatchDomain(env, domain);

	return { status: 200, body: { received: true, domain, type, billingStatus: billing.status } };
}

/** Statuses of a subscription that is collecting again. */
const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/** Subscription statuses after which Stripe won't collect again: the service ends. */
const ENDED_SUBSCRIPTION_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

/** When a subscription set to cancel will end, as ISO; undefined when it isn't set to cancel. */
function scheduledEnd(sub: Record<string, any>): string | undefined {
	const toIso = (s: unknown) => (typeof s === "number" ? new Date(s * 1000).toISOString() : undefined);
	if (typeof sub.cancel_at === "number") return toIso(sub.cancel_at);
	if (!sub.cancel_at_period_end) return undefined;
	// From basil on, the period lives on the subscription items.
	return toIso(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end);
}
