// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Bounce / complaint suppression list (`email_suppression` in AUTH_DB).
 *
 * - A hard bounce or a spam complaint adds (sending domain, recipient).
 * - Every user send path checks the list before it creates a Sent row or
 *   reserves a send slot, and refuses with `recipient_suppressed`.
 * - Deleting the row is the un-suppress action.
 *
 * The table arrives with a D1 migration that is applied separately from the
 * Worker deploy, so every read and write here fails open: a missing table
 * (or any D1 error) logs a warning and lets mail go out as before.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { AuthDb } from "../auth/authz";
import * as schema from "../auth/schema";
import type { SuppressionReason, SuppressionSource } from "../auth/schema";
import { normalizeEmailAddress } from "./mail-automations";
import { collectOutboundRecipientAddresses } from "./sender-triage";

const t = schema.emailSuppression;

export type EmailSuppression = typeof t.$inferSelect;

/** Machine-readable code on the 409 a blocked send returns. */
export const RECIPIENT_SUPPRESSED_CODE = "recipient_suppressed";

/** D1 caps bound parameters per statement; stay well under it. */
const IN_CHUNK = 50;

/**
 * The domain a send's reputation lands on. Private aliases send from
 * `private.<domain>`, which belongs to the same customer as `<domain>`.
 */
export function suppressionDomainFor(address: string): string | null {
	const normalized = normalizeEmailAddress(address);
	if (!normalized) return null;
	const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
	return domain.replace(/^private\./, "") || null;
}

/** Bare, lower-cased recipient addresses from to / cc / bcc, de-duplicated. */
export function outboundRecipientList(to: unknown, cc?: unknown, bcc?: unknown): string[] {
	const out = new Set<string>();
	for (const raw of collectOutboundRecipientAddresses(to, cc, bcc)) {
		const addr = normalizeEmailAddress(raw);
		if (addr) out.add(addr);
	}
	return [...out];
}

/**
 * RFC 3463 enhanced status codes that say the recipient itself is
 * permanently unreachable. Deliberately narrower than "any 5.x.x": content
 * (5.6.x), policy / spam (5.7.x) and size or quota (5.2.2, 5.2.3, 5.3.4)
 * rejections are about the message or the sender, not the address, and
 * suppressing on them would block mail that could be delivered.
 */
export function isPermanentRecipientStatus(status: string | null | undefined): boolean {
	const m = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(status ?? "");
	if (!m || m[1] !== "5") return false;
	const subject = Number(m[2]);
	const detail = Number(m[3]);
	if (subject === 6 || subject === 7) return false;
	if (subject === 2 && (detail === 2 || detail === 3)) return false;
	if (subject === 3 && detail === 4) return false;
	return true;
}

function isMissingTable(error: unknown): boolean {
	return /no such table/i.test((error as Error)?.message ?? "");
}

function warnFailOpen(action: string, error: unknown): void {
	if (isMissingTable(error)) {
		console.warn(
			`[Suppression] ${action} skipped: email_suppression table missing (apply AUTH_DB migrations)`,
		);
		return;
	}
	console.warn(`[Suppression] ${action} failed, continuing without it:`, (error as Error)?.message ?? error);
}

export type SuppressionInput = {
	domain: string;
	recipient: string;
	reason: SuppressionReason;
	source: SuppressionSource;
	sourceEventId?: string | null;
	sourceMailboxId?: string | null;
	sourceMessageId?: string | null;
	detail?: string | null;
};

/**
 * Add or refresh a suppression. A complaint is never downgraded to a hard
 * bounce; otherwise the latest event wins. Returns false if it couldn't be
 * written (logged; never throws).
 */
export async function recordSuppression(db: AuthDb, input: SuppressionInput): Promise<boolean> {
	const recipient = normalizeEmailAddress(input.recipient);
	const domain = input.domain.trim().toLowerCase().replace(/^private\./, "");
	if (!recipient || !domain) return false;
	const values = {
		domain,
		recipient,
		reason: input.reason,
		source: input.source,
		sourceEventId: input.sourceEventId ?? null,
		sourceMailboxId: input.sourceMailboxId ?? null,
		sourceMessageId: input.sourceMessageId ?? null,
		detail: input.detail?.slice(0, 500) ?? null,
	};
	try {
		const existing = await db
			.select({ reason: t.reason })
			.from(t)
			.where(and(eq(t.domain, domain), eq(t.recipient, recipient)))
			.get();
		if (existing?.reason === "complaint" && input.reason !== "complaint") return true;
		await db
			.insert(t)
			.values(values)
			.onConflictDoUpdate({
				target: [t.domain, t.recipient],
				set: { ...values, updatedAt: new Date() },
			});
		console.log(`[Suppression] ${domain} suppressed ${recipient} (${input.reason} via ${input.source})`);
		return true;
	} catch (error) {
		warnFailOpen("record", error);
		return false;
	}
}

/** Suppressed rows among `recipients` for `domain`. Fails open to []. */
export async function findSuppressedRecipients(
	db: AuthDb,
	domain: string,
	recipients: string[],
): Promise<EmailSuppression[]> {
	const d = domain.trim().toLowerCase().replace(/^private\./, "");
	const list = [...new Set(recipients.map((r) => normalizeEmailAddress(r)).filter(Boolean) as string[])];
	if (!d || list.length === 0) return [];
	try {
		const out: EmailSuppression[] = [];
		for (let i = 0; i < list.length; i += IN_CHUNK) {
			const chunk = list.slice(i, i + IN_CHUNK);
			out.push(
				...(await db
					.select()
					.from(t)
					.where(and(eq(t.domain, d), inArray(t.recipient, chunk)))
					.all()),
			);
		}
		return out;
	} catch (error) {
		warnFailOpen("check", error);
		return [];
	}
}

/**
 * Suppressions a mailbox may see: the ones its own sends caused, or every
 * one on the domain for a domain admin.
 */
export async function listSuppressions(
	db: AuthDb,
	opts: { domain: string; mailboxId: string; allOnDomain: boolean; limit?: number },
): Promise<EmailSuppression[]> {
	const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
	const where = opts.allOnDomain
		? eq(t.domain, opts.domain)
		: and(eq(t.domain, opts.domain), eq(t.sourceMailboxId, opts.mailboxId));
	try {
		return await db.select().from(t).where(where).orderBy(desc(t.createdAt)).limit(limit).all();
	} catch (error) {
		warnFailOpen("list", error);
		return [];
	}
}

export async function getSuppression(
	db: AuthDb,
	domain: string,
	recipient: string,
): Promise<EmailSuppression | null> {
	const addr = normalizeEmailAddress(recipient);
	if (!addr) return null;
	try {
		return (
			(await db
				.select()
				.from(t)
				.where(and(eq(t.domain, domain), eq(t.recipient, addr)))
				.get()) ?? null
		);
	} catch (error) {
		warnFailOpen("lookup", error);
		return null;
	}
}

export async function deleteSuppression(db: AuthDb, domain: string, recipient: string): Promise<boolean> {
	const addr = normalizeEmailAddress(recipient);
	if (!addr) return false;
	const rows = await db
		.delete(t)
		.where(and(eq(t.domain, domain), eq(t.recipient, addr)))
		.returning({ recipient: t.recipient });
	return rows.length > 0;
}

/** Remove every suppression for a domain (domain purge). */
export async function deleteSuppressionsForDomain(db: AuthDb, domain: string): Promise<void> {
	try {
		await db.delete(t).where(eq(t.domain, domain.trim().toLowerCase()));
	} catch (error) {
		warnFailOpen("domain purge", error);
	}
}

/** Whether the mailbox may lift this suppression (its own, or domain admin). */
export function canManageSuppression(
	row: Pick<EmailSuppression, "sourceMailboxId">,
	mailboxId: string,
	isDomainAdmin: boolean,
): boolean {
	return isDomainAdmin || row.sourceMailboxId === mailboxId;
}

export type SuppressionView = {
	address: string;
	domain: string;
	reason: SuppressionReason;
	source: SuppressionSource;
	detail: string | null;
	/** ISO 8601. */
	suppressedAt: string;
	canUnsuppress: boolean;
};

export function suppressionView(
	row: EmailSuppression,
	mailboxId: string,
	isDomainAdmin: boolean,
): SuppressionView {
	return {
		address: row.recipient,
		domain: row.domain,
		reason: row.reason,
		source: row.source,
		detail: row.detail ?? null,
		suppressedAt: new Date(row.createdAt).toISOString(),
		canUnsuppress: canManageSuppression(row, mailboxId, isDomainAdmin),
	};
}

function describeSuppression(row: Pick<EmailSuppression, "recipient" | "reason" | "createdAt">): string {
	const day = new Date(row.createdAt).toISOString().slice(0, 10);
	return row.reason === "complaint"
		? `${row.recipient} marked earlier mail as spam on ${day}`
		: `${row.recipient} bounced on ${day}`;
}

/**
 * Body of the 409 a blocked send returns. `error` is ready to show;
 * `suppressed` lets clients render each address and offer Un-suppress.
 */
export function suppressedRecipientsError(
	rows: EmailSuppression[],
	mailboxId: string,
	isDomainAdmin: boolean,
): {
	error: string;
	code: typeof RECIPIENT_SUPPRESSED_CODE;
	suppressed: SuppressionView[];
} {
	const sorted = [...rows].sort((a, b) => a.recipient.localeCompare(b.recipient));
	const first = describeSuppression(sorted[0]!);
	const more = sorted.length > 1 ? ` (and ${sorted.length - 1} more suppressed address${sorted.length > 2 ? "es" : ""})` : "";
	return {
		error: `Not sent: ${first}${more}. Remove the address or un-suppress it to send again.`,
		code: RECIPIENT_SUPPRESSED_CODE,
		suppressed: sorted.map((row) => suppressionView(row, mailboxId, isDomainAdmin)),
	};
}

/**
 * The send-path check. Returns the 409 body when any recipient is
 * suppressed for the sending domain, else null. Fails open.
 */
export async function checkOutboundSuppression(
	db: AuthDb,
	opts: {
		fromEmail: string;
		mailboxId: string;
		to: unknown;
		cc?: unknown;
		bcc?: unknown;
		isDomainAdmin?: (domain: string) => Promise<boolean>;
	},
): Promise<ReturnType<typeof suppressedRecipientsError> | null> {
	const domain = suppressionDomainFor(opts.fromEmail);
	if (!domain) return null;
	const rows = await findSuppressedRecipients(db, domain, outboundRecipientList(opts.to, opts.cc, opts.bcc));
	if (rows.length === 0) return null;
	let admin = false;
	if (opts.isDomainAdmin) {
		try {
			admin = await opts.isDomainAdmin(domain);
		} catch {
			admin = false;
		}
	}
	return suppressedRecipientsError(rows, opts.mailboxId, admin);
}
