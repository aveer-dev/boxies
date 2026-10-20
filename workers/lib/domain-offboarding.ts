// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Finalizing a decommissioned domain (AVE-43).
 *
 * Decommission (routes/export-and-offboarding.ts) stops mail and ends admin
 * rights, then leaves the data in place for a grace period so the owner can
 * export it. This module finishes the job:
 *
 *   decommission ── 23 days ──▶ warning email ── 7 days ──▶ finalize
 *
 * The owner can also finalize early by typing the domain name ("finalize
 * now"). Finalize deletes, in this order:
 *   1. billing   - the Stripe subscription is cancelled now, without proration
 *                  (only when no other domain uses it);
 *   2. mailboxes - every mailbox on the domain, through the same tombstone-first
 *                  purge as deleting one mailbox (MailboxDO.purgeMailbox), plus
 *                  its agent chats, members and invites;
 *   3. aliases   - the domain's aliases;
 *   4. access    - the domain admin rows;
 *   5. registry  - the R2 domain metadata, billing lookups and the D1 domain row.
 *
 * Progress lives in `domain_offboarding` (D1), which outlives the domain. Every
 * step is safe to repeat, so a run that dies part-way is resumed by the hourly
 * cron rather than started over, and a lease keeps two runners off one domain.
 *
 * The Cloudflare zone and any registrar registration are left alone: deleting
 * a zone the owner still points nameservers at would take down their DNS. Ops
 * get an alert to review them.
 */

import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import type { Env } from "../types";
import { authDb, type AuthDb } from "../auth/authz";
import { sendSystemEmail } from "../auth/mail";
import * as schema from "../auth/schema";
import { billingCustomerKey } from "./billing-fulfillment";
import {
	deleteDomainMetadata,
	deleteEmailAlias,
	getDomainMetadata,
	listAllRegisteredDomains,
	type DomainMetadata,
} from "./domain-registry";
import { isRegistrarManaged, setAutoRenewBestEffort } from "./domain-service";
import { purgeEmailAgents } from "./email-agent";
import { escapeHtml } from "./email-helpers";
import { mailboxMetadataKey } from "./mailbox-routing";
import { alertOps } from "./ops-alert";
import { listAllR2Objects } from "./r2-list";
import { reminderRecipients, renewUrl, unwatchDomain } from "./service-reminders";
import { cancelSubscription, isMockCheckoutSessionId } from "./stripe";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a decommissioned domain's data is kept for export. */
export const OFFBOARDING_GRACE_MS = 30 * DAY_MS;
/** The admins are warned this long before the scheduled finalize. */
export const OFFBOARDING_WARNING_MS = 7 * DAY_MS;
/** How long one runner holds a domain. Under the 15-minute cron limit. */
const LEASE_MS = 14 * 60 * 1000;
/** Domains finalized per cron run; the rest wait an hour. */
const FINALIZE_BATCH = 3;

export type OffboardingRow = typeof schema.domainOffboarding.$inferSelect;

export type FinalizeBlocker =
	| "not_decommissioned"
	| "already_finalized"
	| "grace_period"
	| "warning_pending";

export type FinalizeResult =
	| { status: "finalized"; domain: string; mailboxesPurged: number; subscriptionCanceled: boolean }
	| { status: "blocked"; domain: string; reason: FinalizeBlocker }
	| { status: "busy"; domain: string }
	| { status: "failed"; domain: string; error: string };

function normalize(domain: string): string {
	return domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

export function getOffboarding(db: AuthDb, domain: string): Promise<OffboardingRow | undefined> {
	return db
		.select()
		.from(schema.domainOffboarding)
		.where(eq(schema.domainOffboarding.domain, normalize(domain)))
		.get();
}

/**
 * Start the grace period for a domain that was just decommissioned. Keeps an
 * existing row, so calling it again never moves the deadline.
 */
export async function recordDecommission(db: AuthDb, domain: string, now = new Date()): Promise<OffboardingRow> {
	await db
		.insert(schema.domainOffboarding)
		.values({
			domain: normalize(domain),
			decommissionedAt: now,
			finalizeAfter: new Date(now.getTime() + OFFBOARDING_GRACE_MS),
		})
		.onConflictDoNothing();
	return (await getOffboarding(db, domain))!;
}

/**
 * Why the domain can't be finalized now, or null when it can. A finalize that
 * already started may always resume; otherwise the scheduled run needs the
 * grace period over and the warning sent, and "finalize now" needs neither.
 */
export function finalizeBlocker(
	row: OffboardingRow | undefined,
	domainStatus: string | undefined,
	now = new Date(),
): FinalizeBlocker | null {
	if (!row) return "not_decommissioned";
	if (row.finalizedAt) return "already_finalized";
	if (domainStatus === undefined) {
		// The domain row goes in the last step: only a started finalize may be missing it.
		return row.finalizeStartedAt ? null : "not_decommissioned";
	}
	if (domainStatus !== "decommissioned") return "not_decommissioned";
	if (row.finalizeStartedAt || row.finalizeRequestedAt) return null;
	if (!row.warningSentAt) return "warning_pending";
	if (now.getTime() < row.finalizeAfter.getTime()) return "grace_period";
	return null;
}

/** The wire shape clients show (grace period, finalize-now). */
export function offboardingPayload(row: OffboardingRow | undefined, domainStatus: string | undefined, now = new Date()) {
	if (!row) return null;
	const blocker = finalizeBlocker(row, domainStatus, now);
	return {
		decommissionedAt: row.decommissionedAt.toISOString(),
		finalizeAfter: row.finalizeAfter.toISOString(),
		graceDays: Math.round(OFFBOARDING_GRACE_MS / DAY_MS),
		warningSentAt: row.warningSentAt?.toISOString() ?? null,
		finalizeRequestedAt: row.finalizeRequestedAt?.toISOString() ?? null,
		finalizeStartedAt: row.finalizeStartedAt?.toISOString() ?? null,
		finalizedAt: row.finalizedAt?.toISOString() ?? null,
		step: row.step,
		lastError: row.lastError,
		canFinalizeNow: domainStatus === "decommissioned" && !row.finalizedAt,
		scheduledFinalizeDue: blocker === null,
	};
}

async function domainStatusOf(db: AuthDb, domain: string): Promise<string | undefined> {
	const row = await db
		.select({ status: schema.domain.status })
		.from(schema.domain)
		.where(eq(schema.domain.domain, domain))
		.get();
	return row?.status;
}

/** Take the domain for this runner. False when another runner holds it or it's done. */
async function claimLease(db: AuthDb, domain: string, now: Date): Promise<boolean> {
	const claimed = await db
		.update(schema.domainOffboarding)
		.set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
		.where(
			and(
				eq(schema.domainOffboarding.domain, domain),
				isNull(schema.domainOffboarding.finalizedAt),
				or(isNull(schema.domainOffboarding.leaseUntil), lte(schema.domainOffboarding.leaseUntil, now)),
			),
		)
		.returning({ domain: schema.domainOffboarding.domain });
	return claimed.length === 1;
}

function setProgress(db: AuthDb, domain: string, values: Partial<typeof schema.domainOffboarding.$inferInsert>) {
	return db.update(schema.domainOffboarding).set(values).where(eq(schema.domainOffboarding.domain, domain));
}

/**
 * Whether any other domain is paid for by this subscription. Billing gives
 * each domain its own checkout and subscription, but a subscription that
 * covers more than this domain must never be cancelled from here.
 */
async function subscriptionIsShared(
	env: Env,
	domain: string,
	subscriptionId: string,
	customerId: string | null,
): Promise<boolean> {
	if (customerId) {
		const mapping = await env.BUCKET.get(billingCustomerKey(customerId));
		if (mapping) {
			try {
				const entry = (await mapping.json()) as { domain?: string };
				if (entry.domain && normalize(entry.domain) !== domain) return true;
			} catch {
				// unreadable mapping: fall through to the registry scan
			}
		}
	}
	for (const meta of await listAllRegisteredDomains(env.BUCKET)) {
		if (normalize(meta.domain) !== domain && meta.billing?.subscriptionId === subscriptionId) return true;
	}
	return false;
}

/** Step 1: stop billing. Returns true when the subscription is (now) cancelled. */
async function cancelBilling(env: Env, db: AuthDb, row: OffboardingRow, meta: DomainMetadata | null): Promise<boolean> {
	if (row.subscriptionCanceledAt) return true;
	const subscriptionId = row.subscriptionId;
	if (!subscriptionId) return false;
	const checkoutSessionId = meta?.billing?.checkoutSessionId;
	// Local /checkout/mock purchases: Stripe has never heard of them.
	if (checkoutSessionId && isMockCheckoutSessionId(checkoutSessionId)) return false;

	if (await subscriptionIsShared(env, row.domain, subscriptionId, row.customerId)) {
		await alertOps(
			env,
			`Review billing for finalized domain ${row.domain}`,
			`${row.domain} was finalized, but its subscription ${subscriptionId} also pays for another domain, so it was not cancelled.`,
		);
		return false;
	}
	if (!env.STRIPE_SECRET_KEY) {
		// Never delete the domain while it may still be billed and nobody can cancel it.
		throw new Error(`STRIPE_SECRET_KEY is not configured; cannot cancel subscription ${subscriptionId}`);
	}
	// Cancels immediately; Stripe's defaults are no proration and no final invoice.
	await cancelSubscription(env, subscriptionId);
	await setProgress(db, row.domain, { subscriptionCanceledAt: new Date() });
	return true;
}

/** Every mailbox on the domain: D1 rows (soft-deleted too) and R2 metadata left behind. */
async function mailboxesOnDomain(env: Env, db: AuthDb, domain: string): Promise<string[]> {
	const rows = await db
		.select({ id: schema.mailbox.id })
		.from(schema.mailbox)
		.where(eq(schema.mailbox.domain, domain))
		.all();
	const ids = new Set(rows.map((r) => r.id));
	const suffix = `@${domain}.json`;
	for (const obj of await listAllR2Objects(env.BUCKET, "mailboxes/")) {
		if (obj.key.endsWith(suffix)) ids.add(obj.key.slice("mailboxes/".length, -".json".length));
	}
	return [...ids].sort();
}

/** Step 2: purge one mailbox. Same path as deleting a mailbox; safe to repeat. */
async function purgeOneMailbox(env: Env, db: AuthDb, mailboxId: string): Promise<void> {
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
	const { conversationIds } = await stub.purgeMailbox(mailboxId);
	await purgeEmailAgents(env, mailboxId, conversationIds);
	// Members and invites cascade from the mailbox row; delete them explicitly anyway.
	await db.delete(schema.invite).where(eq(schema.invite.mailboxId, mailboxId));
	await db.delete(schema.mailboxMember).where(eq(schema.mailboxMember.mailboxId, mailboxId));
	await db.delete(schema.mailbox).where(eq(schema.mailbox.id, mailboxId));
	await env.BUCKET.delete(mailboxMetadataKey(mailboxId));
}

/**
 * Finalize one domain if it may be finalized now. Safe to call repeatedly and
 * concurrently: a finished domain is left alone, a held one is skipped, and a
 * failed one keeps its progress for the next call.
 */
export async function finalizeDomainOffboarding(
	env: Env,
	domainParam: string,
	opts: { now?: Date; actorUserId?: string | null } = {},
): Promise<FinalizeResult> {
	const domain = normalize(domainParam);
	const now = opts.now ?? new Date();
	const db = authDb(env.AUTH_DB);

	const before = await getOffboarding(db, domain);
	const preBlock = finalizeBlocker(before, await domainStatusOf(db, domain), now);
	if (preBlock) return { status: "blocked", domain, reason: preBlock };
	if (!(await claimLease(db, domain, now))) return { status: "busy", domain };

	try {
		// Re-check under the lease: the state may have moved since the first read.
		let row = (await getOffboarding(db, domain))!;
		const blocker = finalizeBlocker(row, await domainStatusOf(db, domain), now);
		if (blocker) {
			await setProgress(db, domain, { leaseUntil: null });
			return { status: "blocked", domain, reason: blocker };
		}

		let meta = await getDomainMetadata(env.BUCKET, domain);
		await setProgress(db, domain, {
			finalizeStartedAt: row.finalizeStartedAt ?? now,
			attempts: row.attempts + 1,
			// Keep billing ids before the metadata that holds them is deleted.
			subscriptionId: row.subscriptionId ?? meta?.billing?.subscriptionId ?? null,
			customerId: row.customerId ?? meta?.billing?.customerId ?? null,
			step: "billing",
			lastError: null,
		});
		row = (await getOffboarding(db, domain))!;

		// 1. Billing first: nobody pays for a domain that is being deleted.
		const subscriptionCanceled = await cancelBilling(env, db, row, meta);

		// 2. Mailboxes.
		await setProgress(db, domain, { step: "mailboxes" });
		let purged = row.mailboxesPurged;
		for (const mailboxId of await mailboxesOnDomain(env, db, domain)) {
			await purgeOneMailbox(env, db, mailboxId);
			purged += 1;
			await setProgress(db, domain, { mailboxesPurged: purged });
		}

		// 3. Aliases.
		await setProgress(db, domain, { step: "aliases" });
		meta = await getDomainMetadata(env.BUCKET, domain);
		for (const alias of meta?.aliases ?? []) {
			await deleteEmailAlias(env.BUCKET, domain, alias.aliasLocal);
		}

		// 4. Access: domain admins (mailbox members and invites went with step 2).
		await setProgress(db, domain, { step: "access" });
		await db.delete(schema.domainAdmin).where(eq(schema.domainAdmin.domain, domain));

		// 5. Registry. Billing lookups go before the metadata, so a late Stripe
		// webhook finds nothing to write back.
		await setProgress(db, domain, { step: "registry" });
		meta = await getDomainMetadata(env.BUCKET, domain);
		if (meta && isRegistrarManaged(meta)) await setAutoRenewBestEffort(env, meta, false);
		await unwatchDomain(env, domain);
		if (row.customerId) await env.BUCKET.delete(billingCustomerKey(row.customerId));
		if (meta) {
			await alertOps(
				env,
				`Review the zone for finalized domain ${domain}`,
				`${domain}'s Inboxies data was deleted after offboarding. Its Cloudflare zone ${meta.zoneId || "(none)"} ` +
					(isRegistrarManaged(meta)
						? "and its Cloudflare Registrar registration (auto-renew turned off) were left in place; "
						: "was left in place; ") +
					"remove them by hand once the owner has moved the domain.",
			).catch((e) => console.error(`[Offboarding] ops alert for ${domain} failed:`, (e as Error).message || e));
		}
		await deleteDomainMetadata(env.BUCKET, domain);
		await db.delete(schema.domain).where(eq(schema.domain.domain, domain));

		await db.insert(schema.auditLog).values({
			id: crypto.randomUUID(),
			actorUserId: opts.actorUserId ?? row.finalizeRequestedBy ?? null,
			action: "domain.offboarding_finalized",
			target: domain,
			detail: JSON.stringify({
				mailboxesPurged: purged,
				subscriptionId: row.subscriptionId,
				subscriptionCanceled,
				requested: Boolean(row.finalizeRequestedAt),
				attempts: row.attempts,
			}),
		});
		await setProgress(db, domain, { step: "done", finalizedAt: now, leaseUntil: null, lastError: null });
		console.log(`[Offboarding] ${domain}: finalized (${purged} mailboxes)`);
		return { status: "finalized", domain, mailboxesPurged: purged, subscriptionCanceled };
	} catch (e) {
		const error = (e as Error).message || String(e);
		console.error(`[Offboarding] ${domain}: finalize failed, will resume:`, error);
		await setProgress(db, domain, { lastError: error.slice(0, 500), leaseUntil: null }).catch(() => {});
		return { status: "failed", domain, error };
	}
}

/** The warning email's subject and paragraphs. Plain text; escaped when sent. */
export function finalizeWarningContent(domain: string, finalizeAfter: Date): { subject: string; paragraphs: string[] } {
	const date = finalizeAfter.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
	return {
		subject: `${domain}: your Inboxies data will be deleted on ${date}`,
		paragraphs: [
			`${domain} was decommissioned from Inboxies. On ${date} we'll permanently delete everything on it: every mailbox and its mail, attachments, aliases, members and invites, and cancel its subscription.`,
			"Export your mail before then if you want to keep it. This can't be undone.",
		],
	};
}

/**
 * Warn the owner and admins 7 days before finalize. If the warning goes out
 * late (cron down, or a domain decommissioned before this shipped), the
 * finalize moves so they still get the full 7 days.
 */
async function sendFinalizeWarning(env: Env, db: AuthDb, row: OffboardingRow, now: Date): Promise<boolean> {
	const finalizeAfter = new Date(Math.max(row.finalizeAfter.getTime(), now.getTime() + OFFBOARDING_WARNING_MS));
	const meta = (await getDomainMetadata(env.BUCKET, row.domain)) ?? {
		domain: row.domain,
		ownerUserId: "",
	};
	const recipients = await reminderRecipients(env, meta as DomainMetadata, false);
	const { subject, paragraphs } = finalizeWarningContent(row.domain, finalizeAfter);
	const link = renewUrl(env, row.domain);
	const text = `${paragraphs.join("\n\n")}\n\nExport my mail: ${link}\n`;
	const html =
		paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
		`<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2659d9;color:#fff;text-decoration:none;border-radius:8px;">Export my mail</a></p>`;
	let sent = 0;
	for (const to of recipients) {
		if (await sendSystemEmail(env, { to, subject, text, html })) sent += 1;
	}
	// Every send failed: try again next hour.
	if (recipients.length > 0 && sent === 0) return false;
	if (recipients.length === 0) {
		console.warn(`[Offboarding] ${row.domain}: nobody to warn about finalize (no recovery email)`);
	}
	await setProgress(db, row.domain, { warningSentAt: now, finalizeAfter });
	return true;
}

export type OffboardingReport = { tracked: string[]; warned: string[]; finalized: string[]; errors: string[] };

/**
 * Hourly: start tracking decommissioned domains that have no row yet (the
 * grace period starts now for them), send due warnings, then finalize what is
 * due, a few domains per run.
 */
export async function runDomainOffboarding(env: Env, now = new Date()): Promise<OffboardingReport> {
	const db = authDb(env.AUTH_DB);
	const report: OffboardingReport = { tracked: [], warned: [], finalized: [], errors: [] };

	const untracked = await db
		.select({ domain: schema.domain.domain })
		.from(schema.domain)
		.leftJoin(schema.domainOffboarding, eq(schema.domainOffboarding.domain, schema.domain.domain))
		.where(and(eq(schema.domain.status, "decommissioned"), isNull(schema.domainOffboarding.domain)))
		.all();
	for (const { domain } of untracked) {
		await recordDecommission(db, domain, now);
		report.tracked.push(domain);
	}

	const toWarn = await db
		.select()
		.from(schema.domainOffboarding)
		.where(
			and(
				isNull(schema.domainOffboarding.finalizedAt),
				isNull(schema.domainOffboarding.warningSentAt),
				isNull(schema.domainOffboarding.finalizeStartedAt),
				lte(schema.domainOffboarding.finalizeAfter, new Date(now.getTime() + OFFBOARDING_WARNING_MS)),
			),
		)
		.all();
	for (const row of toWarn) {
		if ((await domainStatusOf(db, row.domain)) !== "decommissioned") continue;
		try {
			if (await sendFinalizeWarning(env, db, row, now)) report.warned.push(row.domain);
		} catch (e) {
			report.errors.push(`warn ${row.domain}: ${(e as Error).message}`);
		}
	}

	const due = await db
		.select({ domain: schema.domainOffboarding.domain })
		.from(schema.domainOffboarding)
		.where(
			and(
				isNull(schema.domainOffboarding.finalizedAt),
				or(
					isNotNull(schema.domainOffboarding.finalizeStartedAt),
					isNotNull(schema.domainOffboarding.finalizeRequestedAt),
					and(isNotNull(schema.domainOffboarding.warningSentAt), lte(schema.domainOffboarding.finalizeAfter, now)),
				),
			),
		)
		.orderBy(schema.domainOffboarding.finalizeAfter)
		.limit(FINALIZE_BATCH)
		.all();
	for (const { domain } of due) {
		const result = await finalizeDomainOffboarding(env, domain, { now });
		if (result.status === "finalized") report.finalized.push(domain);
		else if (result.status === "failed") report.errors.push(`finalize ${domain}: ${result.error}`);
	}
	return report;
}
