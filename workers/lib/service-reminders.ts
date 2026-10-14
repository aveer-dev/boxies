// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Emails about a domain's service ending, sent to the people who can renew it
 * (the domain's owner and admins) at their recovery emails. Before the
 * service ends their address on the domain still works, so it's included too.
 *
 * Schedule:
 * - in service: 7 days before each yearly charge (and when a charge fails);
 * - ending: when the subscription is set to end, then 7 days and 1 day before;
 * - ended: when it ends; for a domain we registered, then 30, 14, 7, 3 and 1
 *   days before the renewal deadline, once when the deadline has passed, and
 *   7 days and 1 day before the mail is deleted (30 days after the name is
 *   released).
 *
 * Each reminder is sent once (keys in `billing.remindersSent`). If several are
 * due at once (e.g. the cron was down), only the most urgent goes out.
 *
 * Billed domains sit on a small R2 watch list, so the hourly cron doesn't read
 * every domain. The cron also deletes the mail of a released domain once its
 * retention runs out (see domain-purge.ts).
 */

import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { authDb } from "../auth/authz";
import { appBaseUrl, sendSystemEmail } from "../auth/mail";
import * as schema from "../auth/schema";
import { anyRecoveryEmail, findUserById } from "../auth/users";
import { getDomainMetadata, saveDomainMetadata, type DomainMetadata } from "./domain-registry";
import { escapeHtml } from "./email-helpers";
import { refreshRegistration, summarizeDomainService, type DomainServiceSummary } from "./domain-service";
import { purgeExpiredDomain } from "./domain-purge";
import { listAllR2Objects } from "./r2-list";

const DAY_MS = 24 * 60 * 60 * 1000;
const ENDING_THRESHOLDS_DAYS = [7, 1];
const RENEW_THRESHOLDS_DAYS = [30, 14, 7, 3, 1];
const PURGE_THRESHOLDS_DAYS = [7, 1];
const CHARGE_NOTICE_DAYS = 7;

const WATCH_PREFIX = "billing/service-watch/";

export function watchDomain(env: Env, domain: string): Promise<unknown> {
	return env.BUCKET.put(`${WATCH_PREFIX}${domain}`, "1");
}

export function unwatchDomain(env: Env, domain: string): Promise<void> {
	return env.BUCKET.delete(`${WATCH_PREFIX}${domain}`);
}

export type ReminderKind =
	| { kind: "charge"; daysLeft: number }
	| { kind: "payment-failed" }
	| { kind: "ending"; daysLeft?: number }
	| { kind: "ended" }
	| { kind: "renew"; daysLeft: number }
	| { kind: "renew-closed" }
	| { kind: "purge"; daysLeft: number }
	| { kind: "restored" };

/**
 * The reminder due now, if any, and every key it settles (the skipped, less
 * urgent ones included).
 */
export function dueReminder(
	summary: DomainServiceSummary,
	sent: readonly string[],
	now = new Date(),
): { reminder: ReminderKind; keys: string[] } | null {
	const done = new Set(sent);
	const firstDue = (prefix: string, deadline: string | undefined, thresholds: number[]) => {
		if (!deadline) return null;
		const left = Date.parse(deadline) - now.getTime();
		if (left <= 0) return null;
		const due = thresholds.filter((d) => left <= d * DAY_MS);
		const unsent = due.filter((d) => !done.has(`${prefix}-${d}d`));
		if (unsent.length === 0) return null;
		return {
			daysLeft: Math.ceil(left / DAY_MS),
			keys: due.map((d) => `${prefix}-${d}d`),
		};
	};

	if (summary.status === "active") {
		if (!summary.nextChargeAt) return null;
		const left = Date.parse(summary.nextChargeAt) - now.getTime();
		const key = `charge-${summary.nextChargeAt.slice(0, 10)}`;
		if (left <= 0 || left > CHARGE_NOTICE_DAYS * DAY_MS || done.has(key)) return null;
		return { reminder: { kind: "charge", daysLeft: Math.ceil(left / DAY_MS) }, keys: [key] };
	}

	if (summary.status === "ending") {
		const soon = firstDue("ending", summary.endsAt, ENDING_THRESHOLDS_DAYS);
		if (!done.has("ending")) {
			return { reminder: { kind: "ending", daysLeft: soon?.daysLeft }, keys: ["ending", ...(soon?.keys ?? [])] };
		}
		if (soon) return { reminder: { kind: "ending", daysLeft: soon.daysLeft }, keys: soon.keys };
		return null;
	}

	if (summary.status === "ended") {
		const closed = summary.renewBy !== undefined && Date.parse(summary.renewBy) <= now.getTime();
		if (closed) {
			if (!done.has("renew-closed")) return { reminder: { kind: "renew-closed" }, keys: ["ended", "renew-closed"] };
			const purge = firstDue("purge", summary.purgeAt, PURGE_THRESHOLDS_DAYS);
			return purge ? { reminder: { kind: "purge", daysLeft: purge.daysLeft }, keys: purge.keys } : null;
		}
		if (!done.has("ended")) {
			const soon = firstDue("renew", summary.renewBy, RENEW_THRESHOLDS_DAYS);
			return { reminder: { kind: "ended" }, keys: ["ended", ...(soon?.keys ?? [])] };
		}
		const soon = firstDue("renew", summary.renewBy, RENEW_THRESHOLDS_DAYS);
		if (soon) return { reminder: { kind: "renew", daysLeft: soon.daysLeft }, keys: soon.keys };
	}
	return null;
}

function formatDate(iso: string | undefined): string {
	if (!iso) return "";
	return new Date(iso).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function renewUrl(env: Env, domain: string): string {
	return `${appBaseUrl(env, "https://inboxies.email")}/admin?tab=dns&domain=${encodeURIComponent(domain)}`;
}

/** Subject and paragraphs for one reminder. Plain text; escaped for HTML when sent. */
export function reminderContent(
	summary: DomainServiceSummary,
	reminder: ReminderKind,
): { subject: string; paragraphs: string[]; cta?: string } {
	const { domain } = summary;
	const readOnly =
		"When it ends, mail on this domain becomes read-only: you can still sign in, read and export it, but nothing is sent or received and settings can't be changed.";
	const deadline = summary.renewBy
		? `You can renew until ${formatDate(summary.renewBy)}. After that the domain registration lapses and ${domain} may be released for anyone to register.`
		: "You can renew at any time to restore it.";

	switch (reminder.kind) {
		case "charge": {
			const amount = summary.nextChargeUsd !== undefined ? `$${summary.nextChargeUsd.toFixed(2)}` : "your yearly price";
			return {
				subject: `${domain}: your Inboxies renewal of ${amount} on ${formatDate(summary.nextChargeAt)}`,
				paragraphs: [
					`On ${formatDate(summary.nextChargeAt)} we'll charge ${amount} to your card on file to renew your Inboxies subscription for ${domain} for another year.`,
					summary.registrarManaged && summary.registrationExpiresAt
						? `It pays for the domain registration, which renews before it expires on ${formatDate(summary.registrationExpiresAt)}, and for the Inboxies service.`
						: "It pays for the Inboxies service for the year ahead.",
					"To update your card or cancel, open your billing settings.",
				],
				cta: "Manage billing",
			};
		}
		case "payment-failed": {
			const by = summary.registrationExpiresAt
				? new Date(Date.parse(summary.registrationExpiresAt) - 30 * DAY_MS).toISOString()
				: undefined;
			return {
				subject: `${domain}: your renewal payment didn't go through`,
				paragraphs: [
					`We couldn't charge your card to renew your Inboxies subscription for ${domain}. We'll try again over the coming weeks.`,
					by
						? `Update your card before ${formatDate(by)} so the domain registration renews. If the payment doesn't go through, the service ends and ${domain} lapses.`
						: "Update your card so the service keeps running. If the payment doesn't go through, the service ends.",
				],
				cta: "Update payment",
			};
		}
		case "ending": {
			const when = summary.endsAt ? formatDate(summary.endsAt) : "the end of the billing period";
			const subject =
				reminder.daysLeft !== undefined
					? `${domain}: your Inboxies service ends in ${plural(reminder.daysLeft, "day")}`
					: `${domain}: your Inboxies service ends on ${when}`;
			return {
				subject,
				paragraphs: [
					`Your Inboxies subscription for ${domain} is set to end on ${when}.`,
					readOnly,
					"To keep it running, resume your subscription before then.",
				],
				cta: "Keep my subscription",
			};
		}
		case "ended":
			return {
				subject: `${domain}: your Inboxies service has ended`,
				paragraphs: [
					`Your Inboxies subscription for ${domain} has ended, so mail on it is now read-only. You can still sign in, read and export your mail, but nothing is sent or received.`,
					summary.registrarManaged ? deadline : "Renew at any time to restore it.",
				],
				cta: "Renew now",
			};
		case "renew":
			return {
				subject: `${domain}: ${plural(reminder.daysLeft, "day")} left to renew`,
				paragraphs: [
					`Your Inboxies subscription for ${domain} has ended. You have ${plural(reminder.daysLeft, "day")} left to renew it (until ${formatDate(summary.renewBy)}).`,
					`After that the domain registration lapses and ${domain} may be released for anyone to register. Renewing restores sending and receiving straight away.`,
				],
				cta: "Renew now",
			};
		case "renew-closed":
			return {
				subject: `${domain} can no longer be renewed`,
				paragraphs: [
					`The renewal window for ${domain} closed on ${formatDate(summary.renewBy)}. The domain registration has lapsed and will be released.`,
					summary.purgeAt
						? `Your mail on it stays readable in Inboxies until ${formatDate(summary.purgeAt)}, then it's deleted. Export it before then.`
						: "Your mail on it stays readable in Inboxies, and you can still export it.",
					"If you need the domain back, contact support soon: a restore may still be possible for a short time, at extra cost.",
				],
				cta: summary.purgeAt ? "Export my mail" : undefined,
			};
		case "purge":
			return {
				subject: `${domain}: your mail will be deleted in ${plural(reminder.daysLeft, "day")}`,
				paragraphs: [
					`The subscription for ${domain} ended and the domain has been released. On ${formatDate(summary.purgeAt)} we'll delete the mail on it for good.`,
					"Export it before then if you want to keep it.",
				],
				cta: "Export my mail",
			};
		case "restored":
			return {
				subject: `${domain} is back in service`,
				paragraphs: [`Thanks for renewing. Sending and receiving on ${domain} work again.`],
			};
	}
}

/**
 * Who hears about the domain's billing: the owner and admins, at their verified
 * recovery emails, plus their sign-in address while it can still receive.
 */
export async function reminderRecipients(env: Env, meta: DomainMetadata, includeOnDomain: boolean): Promise<string[]> {
	const db = authDb(env.AUTH_DB);
	const row = await db
		.select({ ownerUserId: schema.domain.ownerUserId })
		.from(schema.domain)
		.where(eq(schema.domain.domain, meta.domain))
		.get();
	const admins = await db
		.select({ userId: schema.domainAdmin.userId })
		.from(schema.domainAdmin)
		.where(eq(schema.domainAdmin.domain, meta.domain))
		.all();
	const userIds = new Set<string>(
		[row?.ownerUserId, meta.ownerUserId, ...admins.map((a) => a.userId)].filter(
			(id): id is string => Boolean(id) && id !== "registrar_owner",
		),
	);

	const to = new Set<string>();
	for (const userId of userIds) {
		// Unverified counts here: owners give it at sign-up and may never confirm it,
		// and a billing notice carries nothing sensitive.
		const recovery = await anyRecoveryEmail(db, userId);
		if (recovery) to.add(recovery.email.toLowerCase());
		const user = await findUserById(db, userId);
		const login = user?.email?.toLowerCase();
		if (login && (includeOnDomain || !login.endsWith(`@${meta.domain}`))) to.add(login);
	}
	return [...to];
}

export async function sendReminder(
	env: Env,
	meta: DomainMetadata,
	summary: DomainServiceSummary,
	reminder: ReminderKind,
): Promise<{ recipients: number; sent: number }> {
	const recipients = await reminderRecipients(env, meta, summary.status !== "ended");
	if (recipients.length === 0) {
		console.warn(`[ServiceReminders] ${meta.domain}: nobody to tell about "${reminder.kind}" (no verified recovery email)`);
		return { recipients: 0, sent: 0 };
	}
	const { subject, paragraphs, cta } = reminderContent(summary, reminder);
	const link = renewUrl(env, meta.domain);
	const text = `${paragraphs.join("\n\n")}\n\n${cta ? `${cta}: ${link}\n` : ""}`;
	const html =
		paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
		(cta
			? `<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#2659d9;color:#fff;text-decoration:none;border-radius:8px;">${escapeHtml(cta)}</a></p>`
			: "");
	let sent = 0;
	for (const to of recipients) {
		if (await sendSystemEmail(env, { to, subject, text, html })) sent += 1;
	}
	return { recipients: recipients.length, sent };
}

/** Send whatever reminder is due for `domain` now, and record it. */
export async function remindIfDue(env: Env, domain: string, now = new Date()): Promise<string | null> {
	const meta = await getDomainMetadata(env.BUCKET, domain);
	if (!meta?.billing || meta.status === "offboarding") {
		await unwatchDomain(env, domain);
		return null;
	}
	const initial = summarizeDomainService(meta, now);
	// In service with no charge date to announce: nothing to watch for.
	if (initial.status === "active" && !initial.nextChargeAt) {
		await unwatchDomain(env, domain);
		return null;
	}
	if (!dueReminder(summarizeDomainService(meta, now), meta.billing.remindersSent ?? [], now)) return null;

	// The deadline comes from the registration's expiry, which moves when it renews.
	await refreshRegistration(env, meta);
	const summary = summarizeDomainService(meta, now);
	const due = dueReminder(summary, meta.billing.remindersSent ?? [], now);
	if (!due) return null;

	const { recipients, sent } = await sendReminder(env, meta, summary, due.reminder);
	// Every send failed: try again next hour.
	if (recipients > 0 && sent === 0) return null;

	// Re-read before saving: a renewal may have landed while we were sending.
	const latest = await getDomainMetadata(env.BUCKET, domain);
	if (latest?.billing && summarizeDomainService(latest, now).status === summary.status) {
		latest.registration = meta.registration;
		latest.billing = {
			...latest.billing,
			remindersSent: [...new Set([...(latest.billing.remindersSent ?? []), ...due.keys])],
			updatedAt: now.toISOString(),
		};
		await saveDomainMetadata(env.BUCKET, latest);
	}
	// After the notice for a domain we didn't register there's no countdown (and no deletion).
	if (due.reminder.kind === "ended" && !summary.renewBy) await unwatchDomain(env, domain);
	return due.keys.join(",");
}

/**
 * Hourly: for every watched domain, delete the mail of a released domain whose
 * retention ran out, else send whatever reminder is due.
 */
export async function sendServiceReminders(
	env: Env,
	now = new Date(),
): Promise<{ reminded: string[]; purged: string[] }> {
	const reminded: string[] = [];
	const purged: string[] = [];
	for (const obj of await listAllR2Objects(env.BUCKET, WATCH_PREFIX)) {
		const domain = obj.key.slice(WATCH_PREFIX.length);
		try {
			if (await purgeExpiredDomain(env, domain, now)) {
				purged.push(domain);
				await unwatchDomain(env, domain);
			} else if (await remindIfDue(env, domain, now)) {
				reminded.push(domain);
			}
		} catch (e) {
			console.error(`[ServiceReminders] ${domain} failed:`, (e as Error).message || e);
		}
	}
	return { reminded, purged };
}
