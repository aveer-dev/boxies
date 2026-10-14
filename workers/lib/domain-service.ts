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
import { setDomainAutoRenew } from "./cloudflare-registrar";
import { getDomainMetadata, saveDomainMetadata, type DomainMetadata } from "./domain-registry";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days after expiry that Cloudflare Registrar still renews a domain at the normal price. */
export const REGISTRAR_RENEWAL_GRACE_DAYS = 40;

/** Cloudflare Registrar tries auto-renew about this long before expiry. */
export const REGISTRAR_AUTO_RENEW_LEAD_DAYS = 30;

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
}

export function isRegistrarManaged(meta: Pick<DomainMetadata, "registration">): boolean {
	return meta.registration?.provider === "cloudflare_registrar";
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
		canRenew: Boolean(billing) && (status === "ending" || (status === "ended" && beforeDeadline)),
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
 * The subscription ended: freeze the domain. Registrar auto-renew goes off so
 * the operator isn't billed to renew a domain nobody pays for. Safe to repeat.
 * Returns the updated metadata.
 */
export async function endDomainService(env: Env, domain: string, now = new Date()): Promise<DomainMetadata | null> {
	const meta = await getDomainMetadata(env.BUCKET, domain);
	if (!meta?.billing) return meta;

	await authDb(env.AUTH_DB)
		.update(schema.domain)
		.set({ status: "suspended" })
		.where(eq(schema.domain.domain, domain));

	if (isRegistrarManaged(meta) && meta.registration?.autoRenew !== false) {
		await setDomainAutoRenew(env, domain, false);
		meta.registration = { ...meta.registration!, autoRenew: false };
	}

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
	return meta;
}

/** Back in service (renewed or resumed): undo `endDomainService`. */
export async function restoreDomainService(env: Env, meta: DomainMetadata): Promise<void> {
	await authDb(env.AUTH_DB)
		.update(schema.domain)
		.set({ status: "active" })
		.where(eq(schema.domain.domain, meta.domain));

	if (isRegistrarManaged(meta) && meta.registration?.autoRenew === false) {
		await setDomainAutoRenew(env, meta.domain, true);
		meta.registration = { ...meta.registration!, autoRenew: true };
	}
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
