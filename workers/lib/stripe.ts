// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The few Stripe calls billing makes outside Checkout creation: expiring a
 * session, cancelling a subscription and refunding a checkout's payment.
 *
 * Requests pin `STRIPE_API_VERSION` so response shapes don't move with the
 * account's default version. From basil on, an invoice's payments live in
 * `invoice.payments`, not `invoice.payment_intent`.
 */

export const STRIPE_API_VERSION = "2025-03-31.basil";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

export interface StripeEnv {
	STRIPE_SECRET_KEY?: string;
}

export class StripeApiError extends Error {
	status: number;
	code?: string;

	constructor(status: number, message: string, code?: string) {
		super(message);
		this.name = "StripeApiError";
		this.status = status;
		this.code = code;
	}
}

/** Sessions the local `/checkout/mock` simulator made; Stripe has never heard of them. */
export function isMockCheckoutSessionId(sessionId: string): boolean {
	return sessionId.startsWith("mock_cs_");
}

/** True when `sessionId` is a real Checkout Session we can act on through the API. */
export function canCallStripeFor(env: StripeEnv, sessionId: string | undefined): boolean {
	return Boolean(env.STRIPE_SECRET_KEY && sessionId && !isMockCheckoutSessionId(sessionId));
}

export async function stripeRequest<T>(
	env: StripeEnv,
	method: "GET" | "POST" | "DELETE",
	path: string,
	params?: URLSearchParams,
	opts: { idempotencyKey?: string } = {},
): Promise<T> {
	if (!env.STRIPE_SECRET_KEY) throw new StripeApiError(500, "STRIPE_SECRET_KEY is not configured");
	const query = method === "GET" && params ? `?${params}` : "";
	const headers: Record<string, string> = {
		Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
		"Stripe-Version": STRIPE_API_VERSION,
	};
	if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
	if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

	const res = await fetch(`${STRIPE_API_BASE}${path}${query}`, {
		method,
		headers,
		body: method === "GET" ? undefined : (params ?? new URLSearchParams()).toString(),
	});
	const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
	if (!res.ok) {
		throw new StripeApiError(
			res.status,
			data.error?.message || `Stripe API error: ${res.status}`,
			data.error?.code,
		);
	}
	return data;
}

/**
 * Close an open Checkout Session so it can no longer be paid. Throws when the
 * session already completed: the caller must then keep its hold on the domain.
 */
export async function expireCheckoutSession(env: StripeEnv, sessionId: string): Promise<void> {
	await stripeRequest(env, "POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`);
}

/** Cancel a subscription now. A subscription that is already cancelled or gone is fine. */
export async function cancelSubscription(env: StripeEnv, subscriptionId: string): Promise<void> {
	const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;
	try {
		const sub = await stripeRequest<{ status?: string }>(env, "GET", path);
		if (sub.status === "canceled" || sub.status === "incomplete_expired") return;
		await stripeRequest(env, "DELETE", path);
	} catch (e) {
		if (e instanceof StripeApiError && e.code === "resource_missing") return;
		throw e;
	}
}

/**
 * Take back a scheduled cancellation, whichever way it was scheduled
 * (at period end, or at a set time).
 */
export async function resumeSubscription(env: StripeEnv, subscriptionId: string): Promise<void> {
	const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;
	const sub = await stripeRequest<{ cancel_at_period_end?: boolean; cancel_at?: number | null }>(env, "GET", path);
	const params = new URLSearchParams();
	if (sub.cancel_at_period_end) params.set("cancel_at_period_end", "false");
	else if (sub.cancel_at) params.set("cancel_at", "");
	else return;
	await stripeRequest(env, "POST", path, params);
}

interface StripeInvoice {
	id: string;
	payments?: {
		data?: Array<{
			status?: string;
			payment?: { type?: string; payment_intent?: string | { id: string } };
		}>;
	};
}

/** The fields of a Checkout Session object billing reads. */
export interface StripeCheckoutSession {
	id: string;
	payment_status?: string;
	payment_intent?: string | { id: string } | null;
	invoice?: string | { id: string } | null;
	subscription?: string | { id: string } | null;
	customer?: string | { id: string } | null;
	metadata?: Record<string, string>;
}

export function stripeId(ref: string | { id: string } | null | undefined): string | undefined {
	if (!ref) return undefined;
	return typeof ref === "string" ? ref : ref.id;
}

/** PaymentIntents that paid for this checkout: the session's own, or its first invoice's. */
async function checkoutPaymentIntents(env: StripeEnv, session: StripeCheckoutSession): Promise<string[]> {
	const direct = stripeId(session.payment_intent);
	if (direct) return [direct];
	const invoiceId = stripeId(session.invoice);
	if (!invoiceId) return [];
	const params = new URLSearchParams();
	params.append("expand[]", "payments");
	const invoice = await stripeRequest<StripeInvoice>(
		env,
		"GET",
		`/invoices/${encodeURIComponent(invoiceId)}`,
		params,
	);
	return (invoice.payments?.data ?? [])
		.filter((p) => p.status === "paid" && p.payment?.type === "payment_intent")
		.map((p) => stripeId(p.payment?.payment_intent))
		.filter((id): id is string => Boolean(id));
}

/**
 * Refund everything the customer paid for this checkout. Safe to repeat: each
 * refund carries an idempotency key, and an already-refunded payment is skipped.
 * Returns the refund ids.
 */
export async function refundCheckoutPayment(env: StripeEnv, session: StripeCheckoutSession): Promise<string[]> {
	const refunds: string[] = [];
	for (const paymentIntent of await checkoutPaymentIntents(env, session)) {
		const params = new URLSearchParams({ payment_intent: paymentIntent, reason: "requested_by_customer" });
		params.append("metadata[checkoutSessionId]", session.id);
		try {
			const refund = await stripeRequest<{ id: string }>(env, "POST", "/refunds", params, {
				idempotencyKey: `inboxies-refund-${paymentIntent}`,
			});
			refunds.push(refund.id);
		} catch (e) {
			if (e instanceof StripeApiError && e.code === "charge_already_refunded") continue;
			throw e;
		}
	}
	return refunds;
}
