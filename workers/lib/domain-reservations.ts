// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One in-flight purchase per domain (`domain_reservation` in AUTH_DB).
 *
 * - Checkout takes a hold. Another buyer gets a 409 until the hold lapses.
 * - A delayed payment (bank debit) keeps the hold until Stripe says how it went.
 * - Fulfillment claims the row with a short lease, so concurrent webhook
 *   deliveries can't both buy the domain.
 * - The row is deleted once the domain is provisioned, refunded or abandoned.
 *
 * Every transition is one conditional statement, so D1 settles races.
 */

import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import type { AuthDb } from "../auth/authz";
import * as schema from "../auth/schema";

const t = schema.domainReservation;

/** How long one fulfillment attempt holds the domain before a retry may take over. */
export const PROVISIONING_LEASE_MS = 5 * 60 * 1000;

/** Grace after the Checkout Session expires, for a completion webhook still in flight. */
export const CHECKOUT_GRACE_MS = 15 * 60 * 1000;

export type DomainReservation = typeof t.$inferSelect;

export async function getReservation(db: AuthDb, domain: string): Promise<DomainReservation | undefined> {
	const [row] = await db.select().from(t).where(eq(t.domain, domain)).limit(1);
	return row;
}

/**
 * Hold `domain` for a checkout that is about to be created. Takes over only a
 * checkout hold that has lapsed. Returns false while anyone else holds it.
 */
export async function holdForCheckout(
	db: AuthDb,
	domain: string,
	holdId: string,
	expiresAt: Date,
): Promise<boolean> {
	const now = new Date();
	const rows = await db
		.insert(t)
		.values({ domain, holdId, sessionId: null, status: "checkout", expiresAt })
		.onConflictDoUpdate({
			target: t.domain,
			set: { holdId, sessionId: null, status: "checkout", expiresAt, updatedAt: now },
			setWhere: and(eq(t.status, "checkout"), isNotNull(t.expiresAt), lt(t.expiresAt, now)),
		})
		.returning({ domain: t.domain });
	return rows.length > 0;
}

/** Record the Checkout Session that a hold belongs to. */
export async function attachCheckoutSession(
	db: AuthDb,
	domain: string,
	holdId: string,
	sessionId: string,
	expiresAt: Date,
): Promise<boolean> {
	const rows = await db
		.update(t)
		.set({ sessionId, expiresAt, updatedAt: new Date() })
		.where(and(eq(t.domain, domain), eq(t.holdId, holdId), eq(t.status, "checkout")))
		.returning({ domain: t.domain });
	return rows.length > 0;
}

/**
 * Move `domain` to `status` for `sessionId`. Succeeds when the row is this
 * session's (unless another attempt holds a live provisioning lease), when
 * there is no row, or when the row is a lapsed checkout hold.
 */
export async function claimForSession(
	db: AuthDb,
	domain: string,
	sessionId: string,
	status: "awaiting_payment" | "provisioning",
	expiresAt: Date | null,
): Promise<boolean> {
	const now = new Date();
	const rows = await db
		.insert(t)
		.values({ domain, sessionId, status, expiresAt })
		.onConflictDoUpdate({
			target: t.domain,
			set: { sessionId, status, expiresAt, updatedAt: now },
			setWhere: or(
				and(
					eq(t.sessionId, sessionId),
					or(sql`${t.status} != 'provisioning'`, lt(t.expiresAt, now)),
				),
				and(eq(t.status, "checkout"), isNotNull(t.expiresAt), lt(t.expiresAt, now)),
			),
		})
		.returning({ domain: t.domain });
	return rows.length > 0;
}

/** End this session's provisioning lease now, so a Stripe retry can claim straight away. */
export async function endProvisioningLease(db: AuthDb, domain: string, sessionId: string): Promise<void> {
	await db
		.update(t)
		.set({ expiresAt: new Date(0), updatedAt: new Date() })
		.where(and(eq(t.domain, domain), eq(t.sessionId, sessionId), eq(t.status, "provisioning")));
}

/** Drop the hold if it still belongs to `sessionId`. */
export async function releaseForSession(db: AuthDb, domain: string, sessionId: string): Promise<void> {
	await db.delete(t).where(and(eq(t.domain, domain), eq(t.sessionId, sessionId)));
}

/** Drop a checkout hold by its hold id (the browser that started the checkout gave up). */
export async function releaseCheckoutHold(db: AuthDb, domain: string, holdId: string): Promise<void> {
	await db.delete(t).where(and(eq(t.domain, domain), eq(t.holdId, holdId), eq(t.status, "checkout")));
}
