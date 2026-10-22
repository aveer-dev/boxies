// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Bounce / complaint suppressions (AVE-37).
 *
 * Suppressions are stored per sending domain, but the API is mailbox-scoped
 * (`requireMailbox` has already authorized the caller as a member):
 *
 * - A member sees and may lift the suppressions its own mailbox's sends
 *   caused. On a shared platform domain this keeps one customer from seeing
 *   who another customer emailed, or lifting their suppressions.
 * - An owner/admin of the mailbox's domain sees and may lift every
 *   suppression on the domain.
 *
 *   GET    /api/v1/mailboxes/:mailboxId/suppressions
 *   GET    /api/v1/mailboxes/:mailboxId/suppressions/:address
 *   DELETE /api/v1/mailboxes/:mailboxId/suppressions/:address   (un-suppress)
 */

import type { Context, Hono } from "hono";
import { authDb, isDomainAdmin } from "../auth/authz";
import type { MailboxContext } from "../lib/mailbox";
import {
	canManageSuppression,
	checkOutboundSuppression,
	deleteSuppression,
	getSuppression,
	listSuppressions,
	suppressionDomainFor,
	suppressionView,
} from "../lib/email-suppression";
import { normalizeEmailAddress } from "../lib/mail-automations";

type AppContext = Context<MailboxContext>;

async function callerIsDomainAdmin(c: AppContext, domain: string): Promise<boolean> {
	const userId = c.get("principal")?.userId;
	if (!userId) return false;
	return isDomainAdmin(authDb(c.env.AUTH_DB), userId, domain);
}

/**
 * Send-path guard shared by send / reply / forward. Call it after the From
 * address is validated and before a send slot is reserved or a Sent row is
 * created, so a blocked send costs nothing and leaves nothing behind.
 * Returns the 409 response, or null to carry on.
 */
export async function blockSuppressedSend(
	c: AppContext,
	opts: { fromEmail: string; to: unknown; cc?: unknown; bcc?: unknown },
): Promise<Response | null> {
	const blocked = await checkOutboundSuppression(authDb(c.env.AUTH_DB), {
		...opts,
		mailboxId: c.var.mailboxId,
		isDomainAdmin: (domain) => callerIsDomainAdmin(c, domain),
	});
	return blocked ? c.json(blocked, 409) : null;
}

function addressParam(c: AppContext): string | null {
	const raw = c.req.param("address") ?? "";
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return null;
	}
	return normalizeEmailAddress(decoded);
}

export function registerSuppressionRoutes(app: Hono<MailboxContext>) {
	app.get("/api/v1/mailboxes/:mailboxId/suppressions", async (c) => {
		const mailboxId = c.var.mailboxId;
		const domain = suppressionDomainFor(mailboxId);
		if (!domain) return c.json({ error: "Invalid mailbox email address" }, 400);
		const admin = await callerIsDomainAdmin(c, domain);
		const rows = await listSuppressions(authDb(c.env.AUTH_DB), {
			domain,
			mailboxId,
			allOnDomain: admin,
		});
		return c.json({
			domain,
			scope: admin ? "domain" : "mailbox",
			suppressions: rows.map((row) => suppressionView(row, mailboxId, admin)),
		});
	});

	app.get("/api/v1/mailboxes/:mailboxId/suppressions/:address", async (c) => {
		const mailboxId = c.var.mailboxId;
		const domain = suppressionDomainFor(mailboxId);
		const address = addressParam(c);
		if (!domain || !address) return c.json({ error: "Invalid email address" }, 400);
		const row = await getSuppression(authDb(c.env.AUTH_DB), domain, address);
		if (!row) return c.json({ error: "Not suppressed" }, 404);
		const admin = await callerIsDomainAdmin(c, domain);
		return c.json({ suppression: suppressionView(row, mailboxId, admin) });
	});

	app.delete("/api/v1/mailboxes/:mailboxId/suppressions/:address", async (c) => {
		const mailboxId = c.var.mailboxId;
		const domain = suppressionDomainFor(mailboxId);
		const address = addressParam(c);
		if (!domain || !address) return c.json({ error: "Invalid email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		const row = await getSuppression(db, domain, address);
		if (!row) return c.json({ error: "Not suppressed" }, 404);
		const admin = await callerIsDomainAdmin(c, domain);
		if (!canManageSuppression(row, mailboxId, admin)) {
			return c.json(
				{
					error: "Another mailbox on this domain suppressed this address. Ask a domain admin to un-suppress it.",
					code: "suppression_not_manageable",
				},
				403,
			);
		}
		await deleteSuppression(db, domain, address);
		console.log(
			`[Suppression] ${mailboxId} un-suppressed ${address} on ${domain} (was ${row.reason})`,
		);
		return c.json({ ok: true, address, domain });
	});
}
