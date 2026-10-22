// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Retention after a domain is gone: when a domain we registered lapses
 * (subscription ended, renewal window closed), the registrar releases the name
 * 75 days after expiry. Its mail stays readable and exportable for 30 more
 * days, then this deletes it: every mailbox (mail, attachments, agent chats),
 * the domain's aliases, its Cloudflare zone and its rows (including its
 * bounce / complaint suppressions). User accounts stay
 * (people can still sign in and delete them).
 *
 * Runs from the hourly cron for watched domains. Re-checks everything first,
 * so a renewal or restore that landed in the meantime always wins.
 */

import { eq } from "drizzle-orm";
import type { Env } from "../types";
import { authDb, listMailboxesOnDomain } from "../auth/authz";
import * as schema from "../auth/schema";
import { billingCustomerKey } from "./billing-fulfillment";
import { deleteZone } from "./cloudflare-client";
import { getOwnedRegistration } from "./cloudflare-registrar";
import { deleteDomainMetadata, deleteEmailAlias, getDomainMetadata } from "./domain-registry";
import { purgeDate } from "./domain-service";
import { purgeEmailAgents } from "./email-agent";
import { deleteSuppressionsForDomain } from "./email-suppression";
import { mailboxMetadataKey } from "./mailbox-routing";
import { alertOps } from "./ops-alert";

/** Delete a released domain's mail if its retention has run out. Returns true when it did. */
export async function purgeExpiredDomain(env: Env, domain: string, now = new Date()): Promise<boolean> {
	const meta = await getDomainMetadata(env.BUCKET, domain);
	if (!meta?.billing?.serviceEndedAt || meta.status === "offboarding") return false;
	const purgeAt = purgeDate(meta);
	if (!purgeAt || now.getTime() < purgeAt.getTime()) return false;

	const db = authDb(env.AUTH_DB);
	const row = await db.select({ status: schema.domain.status }).from(schema.domain).where(eq(schema.domain.domain, domain)).get();
	if (row && row.status !== "suspended") return false;

	// Only once the registrar has really let the name go: if we still hold it
	// (e.g. restored by hand, or our stored expiry is stale), keep the mail.
	let stillOurs: boolean;
	try {
		stillOurs = Boolean(await getOwnedRegistration(env, domain));
	} catch (e) {
		console.warn(`[DomainPurge] ${domain}: registrar lookup failed, not purging:`, (e as Error).message || e);
		return false;
	}
	if (stillOurs) return false;

	for (const mailboxId of await listMailboxesOnDomain(db, domain)) {
		const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
		const { conversationIds } = await stub.purgeMailbox(mailboxId);
		await purgeEmailAgents(env, mailboxId, conversationIds);
		await db.delete(schema.mailbox).where(eq(schema.mailbox.id, mailboxId));
		await env.BUCKET.delete(mailboxMetadataKey(mailboxId));
	}
	for (const alias of meta.aliases ?? []) {
		await deleteEmailAlias(env.BUCKET, domain, alias.aliasLocal);
	}
	if (meta.zoneId) {
		await deleteZone(env, meta.zoneId).catch((e) =>
			alertOps(
				env,
				`Delete the Cloudflare zone for ${domain} by hand`,
				`${domain}'s mail was deleted after its retention ran out, but zone ${meta.zoneId} couldn't be deleted: ${(e as Error).message || e}`,
			),
		);
	}
	await deleteSuppressionsForDomain(db, domain);
	await db.delete(schema.domain).where(eq(schema.domain.domain, domain));
	if (meta.billing.customerId) await env.BUCKET.delete(billingCustomerKey(meta.billing.customerId));
	await deleteDomainMetadata(env.BUCKET, domain);
	console.log(`[DomainPurge] ${domain}: retention ended ${purgeAt.toISOString()}, mail deleted`);
	return true;
}
