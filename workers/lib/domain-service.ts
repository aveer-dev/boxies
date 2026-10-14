// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Whether a paid domain is in service, and what happens when its subscription
 * ends.
 *
 * When the subscription ends the service ends with it: mailboxes on the domain
 * turn read-only (people can still sign in, read and export, but nothing is
 * sent or received and settings are frozen). The D1 `domain.status` becomes
 * `suspended`, which is what every gate checks.
 *
 * For a domain we registered, the owner can renew until the registrar's grace
 * period closes. Cloudflare Registrar lets an expired domain be renewed at the
 * normal price for 40 days after it expires (it shows a parking page from day
 * 31); after that it can only be restored, at extra cost, until day 70, and is
 * then released. Renewal isn't in the Registrar API, so a domain that already
 * expired is renewed by hand in the Cloudflare dashboard: ops are told.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Env } from "../types";
import { authDb } from "../auth/authz";
import * as schema from "../auth/schema";
import { getOwnedRegistration, setDomainAutoRenew } from "./cloudflare-registrar";
import { getDomainMetadata, saveDomainMetadata, type DomainMetadata } from "./domain-registry";
import { alertOps } from "./ops-alert";
import { canCallStripeFor, stripeRequest } from "./stripe";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after expiry that Cloudflare Registrar still renews a domain at the normal price. */
export const REGISTRAR_RENEWAL_GRACE_DAYS = 40;

/** Cloudflare Registrar tries auto-renew about this long before expiry. */
export const REGISTRAR_AUTO_RENEW_LEAD_DAYS = 30;

/**
 * The customer is charged this long before the registration expires: 30 days
 * ahead of the registrar's auto-renew, so a failed card has a month of retries
 * and auto-renew can be switched off before the operator pays.
 */
export const RENEWAL_CHARGE_LEAD_DAYS = 60;

/** Days after expiry until Cloudflare releases a lapsed domain (40 grace + 30 redemption + 5 pending delete). */
export const REGISTRAR_RELEASE_DAYS = 75;

/** Mail on a released domain is kept this long, then deleted. */
export const RETENTION_AFTER_RELEASE_DAYS = 30;

export type DomainServiceStatus = "active" | "ending" | "ended";

export interface DomainServiceSummary {
	domain: string;
	status: DomainServiceStatus;
	/** When the subscription is set to end (status "ending"). */
	endsAt?: string;
	/** When the service ended (status "ended"). */
	endedAt?: string;
	/** We registered the domain, so it lapses if nobody renews it. */
	registrarManaged: boolean;
	registrationExpiresAt?: string;
	/** Last day the domain can be renewed at the normal price (registrar-managed only). */
	renewBy?: string;
	/** Days left until `renewBy`, rounded up (0 once it has passed). */
	daysLeftToRenew?: number;
	/** A renewal (or resuming the subscription) is possible right now. */
	canRenew: boolean;
	/** In service: when the next yearly charge happens, and how much. */
	nextChargeAt?: string;
	nextChargeUsd?: number;
	/** Ended, registrar-managed: when the mail on it is deleted (30 days after the name is released). */
	purgeAt?: string;
}

export function isRegistrarManaged(meta: Pick<DomainMetadata, "registration">): boolean {
	return meta.registration?.provider === "cloudflare_registrar";
}

/** When the mail on an ended, registrar-managed domain is deleted. */
export function purgeDate(meta: Pick<DomainMetadata, "registration">): Date | undefined {
	const expiresAt = meta.registration?.expiresAt;
	if (!isRegistrarManaged(meta) || !expiresAt) return undefined;
	const expiry = Date.parse(expiresAt);
	if (Number.isNaN(expiry)) return undefined;
	return new Date(expiry + (REGISTRAR_RELEASE_DAYS + RETENTION_AFTER_RELEASE_DAYS) * DAY_MS);
}

/** Last moment the domain can be renewed at the normal price. */
export function renewalDeadline(meta: Pick<DomainMetadata, "registration">): Date | undefined {
	const expiresAt = meta.registration?.expiresAt;
	if (!isRegistrarManaged(meta) || !expiresAt) return undefined;
	const expiry = Date.parse(expiresAt);
	if (Number.isNaN(expiry)) return undefined;
	return new Date(expiry + REGISTRAR_RENEWAL_GRACE_DAYS * DAY_MS);
}

export function summarizeDomainService(meta: DomainMetadata, now = new Date()): DomainServiceSummary {
	const billing = meta.billing;
	const registrarManaged = isRegistrarManaged(meta);
	const renewBy = renewalDeadline(meta);
	const ended = Boolean(billing?.serviceEndedAt);
	const ending = !ended && Boolean(billing?.cancelAtPeriodEnd);
	const status: DomainServiceStatus = ended ? "ended" : ending ? "ending" : "active";
	const beforeDeadline = !renewBy || now.getTime() < renewBy.getTime();

	return {
		domain: meta.domain,
		status,
		endsAt: ending ? billing?.serviceEndsAt : undefined,
		endedAt: ended ? billing?.serviceEndedAt : undefined,
		registrarManaged,
		registrationExpiresAt: registrarManaged ? meta.registration?.expiresAt : undefined,
		renewBy: renewBy?.toISOString(),
		daysLeftToRenew: renewBy
			? Math.max(0, Math.ceil((renewBy.getTime() - now.getTime()) / DAY_MS))
			: undefined,
		nextChargeAt: status === "active" ? billing?.nextChargeAt : undefined,
		nextChargeUsd:
			status === "active" && billing?.nextChargeAt && billing.domainFeeUsd !== undefined && billing.platformFeeUsd !== undefined
				? Math.round((billing.domainFeeUsd + billing.platformFeeUsd) * 100) / 100
				: undefined,
		purgeAt: ended ? purgeDate(meta)?.toISOString() : undefined,
		// A domain moved out of Inboxies (offboarding) can't come back this way.
		canRenew:
			Boolean(billing) &&
			meta.status !== "offboarding" &&
			(status === "ending" || (status === "ended" && beforeDeadline)),
	};
}

function domainOf(mailboxId: string): string {
	return mailboxId.slice(mailboxId.lastIndexOf("@") + 1).toLowerCase();
}

/** True when `domain`'s subscription ended and its mailboxes are read-only. */
export async function isDomainSuspended(env: Env, domain: string): Promise<boolean> {
	const row = await authDb(env.AUTH_DB)
		.select({ status: schema.domain.status })
		.from(schema.domain)
		.where(eq(schema.domain.domain, domain.toLowerCase()))
		.get();
	return row?.status === "suspended";
}

/** Which of `domains` are suspended (one query, for mailbox lists). */
export async function suspendedDomains(env: Env, domains: readonly string[]): Promise<Set<string>> {
	const unique = [...new Set(domains.map((d) => d.toLowerCase()))];
	if (unique.length === 0) return new Set();
	const rows = await authDb(env.AUTH_DB)
		.select({ domain: schema.domain.domain })
		.from(schema.domain)
		.where(and(inArray(schema.domain.domain, unique), eq(schema.domain.status, "suspended")))
		.all();
	return new Set(rows.map((r) => r.domain));
}

/** For a mailbox page: where its domain's service stands, or null for a domain without billing. */
export async function mailboxServiceSummary(env: Env, mailboxId: string): Promise<DomainServiceSummary | null> {
	const meta = await getDomainMetadata(env.BUCKET, domainOf(mailboxId));
	return meta?.billing ? summarizeDomainService(meta) : null;
}

/** True when `mailboxId` is on a domain whose service ended. */
export function isMailboxSuspended(env: Env, mailboxId: string): Promise<boolean> {
	return isDomainSuspended(env, domainOf(mailboxId));
}

/** The 403 body every blocked action answers with. Clients key off `code`. */
export function serviceEndedError(domain: string) {
	return {
		error: `The subscription for ${domain} has ended. Mail on it is read-only until it's renewed.`,
		code: "service_ended" as const,
		domain,
	};
}

/** For a mailbox address: the 403 body, or null when it's in service. */
export async function serviceEndedErrorForMailbox(env: Env, mailboxId: string) {
	return (await isMailboxSuspended(env, mailboxId)) ? serviceEndedError(domainOf(mailboxId)) : null;
}

/**
 * Bring the stored registration in line with the registrar: the expiry moves a
 * year on every auto-renewal, and deadlines are computed from it. Best effort.
 */
export async function refreshRegistration(env: Env, meta: DomainMetadata): Promise<DomainMetadata> {
	if (!isRegistrarManaged(meta)) return meta;
	try {
		const current = await getOwnedRegistration(env, meta.domain);
		if (current) {
			meta.registration = { ...meta.registration!, expiresAt: current.expiresAt, autoRenew: current.autoRenew };
		}
	} catch (e) {
		console.warn(`[DomainService] couldn't refresh the registration for ${meta.domain}:`, (e as Error).message || e);
	}
	return meta;
}

/**
 * Turn registrar auto-renew on or off. A failure (e.g. the registration
 * already lapsed) mustn't wedge the billing state, so ops are told instead.
 */
export async function setAutoRenewBestEffort(env: Env, meta: DomainMetadata, on: boolean): Promise<void> {
	if (!isRegistrarManaged(meta) || meta.registration?.autoRenew === on) return;
	try {
		await setDomainAutoRenew(env, meta.domain, on);
		meta.registration = { ...meta.registration!, autoRenew: on };
	} catch (e) {
		await alertOps(
			env,
			`Turn registrar auto-renew ${on ? "on" : "off"} for ${meta.domain} by hand`,
			`Inboxies couldn't change auto-renew for ${meta.domain}: ${(e as Error).message || e}. ` +
				(on
					? "Its subscription is active again, so the registration should renew."
					: "Nobody pays for it any more, so it shouldn't renew."),
		);
	}
}

/**
 * The subscription ended: freeze the domain. Registrar auto-renew goes off so
 * the operator isn't billed to renew a domain nobody pays for. Safe to repeat.
 * R2 is written before D1: inbound mail and the summary read R2, the gates D1.
 * A domain already moved out (decommissioned/offboarding) is left alone.
 */
export async function endDomainService(env: Env, domain: string, now = new Date()): Promise<DomainMetadata | null> {
	const meta = await getDomainMetadata(env.BUCKET, domain);
	if (!meta?.billing || meta.status === "offboarding") return meta;

	await refreshRegistration(env, meta);
	await setAutoRenewBestEffort(env, meta, false);

	const stamp = now.toISOString();
	const newlyEnded = !meta.billing.serviceEndedAt;
	meta.billing = {
		...meta.billing,
		serviceEndedAt: meta.billing.serviceEndedAt ?? stamp,
		// A fresh end of service gets a fresh set of reminders.
		remindersSent: newlyEnded ? [] : meta.billing.remindersSent,
		cancelAtPeriodEnd: false,
		serviceEndsAt: undefined,
		updatedAt: stamp,
	};
	meta.updatedAt = stamp;
	await saveDomainMetadata(env.BUCKET, meta);

	await authDb(env.AUTH_DB)
		.update(schema.domain)
		.set({ status: "suspended" })
		.where(and(eq(schema.domain.domain, domain), inArray(schema.domain.status, ["active", "pending"])));
	return meta;
}

/**
 * Back in service (renewed, resumed, or an unpaid subscription got paid).
 * `meta.billing` already describes the paying subscription; this clears the
 * end of service, turns auto-renew back on and saves, R2 first then D1. Only
 * a suspended domain is reactivated. Safe to repeat.
 */
export async function restoreDomainService(env: Env, meta: DomainMetadata, now = new Date()): Promise<void> {
	if (meta.billing) {
		meta.billing = { ...meta.billing, serviceEndedAt: undefined, remindersSent: [], updatedAt: now.toISOString() };
	}
	await setAutoRenewBestEffort(env, meta, true);
	meta.updatedAt = now.toISOString();
	await saveDomainMetadata(env.BUCKET, meta);

	await authDb(env.AUTH_DB)
		.update(schema.domain)
		.set({ status: "active" })
		.where(and(eq(schema.domain.domain, meta.domain), eq(schema.domain.status, "suspended")));
}

/**
 * Whether an operator has to renew the registration by hand: it already
 * expired (auto-renew no longer runs) or expires too soon for auto-renew's
 * own attempts.
 */
export function needsManualRegistrarRenewal(meta: DomainMetadata, now = new Date()): boolean {
	if (!isRegistrarManaged(meta) || !meta.registration?.expiresAt) return false;
	const expiry = Date.parse(meta.registration.expiresAt);
	return !Number.isNaN(expiry) && expiry - now.getTime() < REGISTRAR_AUTO_RENEW_LEAD_DAYS * DAY_MS;
}

/**
 * Move the next yearly charge to 60 days before `coveredUntil`, the end of the
 * registration year the latest payment covers, so the customer pays before the
 * registrar renews. In Stripe that's `trial_end` with no proration on the
 * subscription: no charge until then, the full yearly price on that date, and
 * yearly from there. Best effort (ops are told); the caller saves `meta`.
 */
export async function scheduleRenewalCharge(
	env: Env,
	meta: DomainMetadata,
	coveredUntil: Date,
	now = new Date(),
): Promise<void> {
	const billing = meta.billing;
	if (!billing) return;
	const chargeAt = new Date(coveredUntil.getTime() - RENEWAL_CHARGE_LEAD_DAYS * DAY_MS);
	// Too close to move: the subscription's own cycle stands.
	if (chargeAt.getTime() - now.getTime() < 2 * DAY_MS) return;

	if (billing.subscriptionId && canCallStripeFor(env, billing.checkoutSessionId)) {
		try {
			await stripeRequest(
				env,
				"POST",
				`/subscriptions/${encodeURIComponent(billing.subscriptionId)}`,
				new URLSearchParams({ trial_end: String(Math.floor(chargeAt.getTime() / 1000)), proration_behavior: "none" }),
			);
		} catch (e) {
			await alertOps(
				env,
				`Move ${meta.domain}'s next charge by hand`,
				`Couldn't move subscription ${billing.subscriptionId} to charge on ${chargeAt.toISOString()} ` +
					`(60 days before the registration it pays for expires): ${(e as Error).message || e}. ` +
					"Set its trial end to that date with no proration in the Stripe dashboard.",
			);
			return;
		}
	}
	meta.billing = { ...billing, nextChargeAt: chargeAt.toISOString() };
}
