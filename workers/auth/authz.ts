// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Who may do what, answered from AUTH_DB rows keyed by `user.id`.
 *
 * Replaces the email/sub/user/account key matching in `lib/mailbox-acl.ts`
 * and `lib/domain-admin.ts` once the server cuts over (R2). Every check here
 * is a single indexed query; no R2 reads, no email comparisons.
 */

import { and, eq, isNull, or } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { isReservedLocalPart, strictMailboxId } from "../lib/mailbox-routing";
import * as schema from "./schema";
import type { MailboxRole } from "./schema";

export type AuthDb = DrizzleD1Database<typeof schema>;

export function authDb(d1: D1Database): AuthDb {
	return drizzle(d1, { schema });
}

const ROLE_RANK: Record<MailboxRole, number> = { member: 1, owner: 2 };

export function roleSatisfies(role: MailboxRole | null, min: MailboxRole): boolean {
	return role !== null && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** The user's role on a live mailbox, or null when they have none. */
export async function mailboxRole(
	db: AuthDb,
	userId: string,
	mailboxId: string,
): Promise<MailboxRole | null> {
	const row = await db
		.select({ role: schema.mailboxMember.role })
		.from(schema.mailboxMember)
		.innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMember.mailboxId))
		.where(
			and(
				eq(schema.mailboxMember.userId, userId),
				eq(schema.mailboxMember.mailboxId, mailboxId),
				isNull(schema.mailbox.deletedAt),
			),
		)
		.get();
	return row?.role ?? null;
}

export type MailboxAccess =
	| { ok: true; mailboxId: string; role: MailboxRole }
	| { ok: false; status: 400 | 403; error: string };

/**
 * Authorize `rawMailboxId` for `userId` at `minRole` or above. Callers must
 * act on the returned canonical `mailboxId`, never on the raw input.
 */
export async function authorizeMailboxAccess(
	db: AuthDb,
	userId: string | null | undefined,
	rawMailboxId: string,
	minRole: MailboxRole = "member",
): Promise<MailboxAccess> {
	const mailboxId = strictMailboxId(rawMailboxId);
	if (!mailboxId) return { ok: false, status: 400, error: "Invalid mailbox email address" };
	if (!userId) return { ok: false, status: 403, error: "Forbidden" };
	const role = await mailboxRole(db, userId, mailboxId);
	// Missing and forbidden look the same, so ids can't be probed.
	if (!roleSatisfies(role, minRole)) return { ok: false, status: 403, error: "Forbidden" };
	return { ok: true, mailboxId, role: role! };
}

/** Every live mailbox the user belongs to, in one query. */
export async function listMailboxesForUser(
	db: AuthDb,
	userId: string,
): Promise<Array<{ mailboxId: string; role: MailboxRole }>> {
	return db
		.select({ mailboxId: schema.mailboxMember.mailboxId, role: schema.mailboxMember.role })
		.from(schema.mailboxMember)
		.innerJoin(schema.mailbox, eq(schema.mailbox.id, schema.mailboxMember.mailboxId))
		.where(and(eq(schema.mailboxMember.userId, userId), isNull(schema.mailbox.deletedAt)))
		.orderBy(schema.mailboxMember.mailboxId)
		.all();
}

/** Owner or listed admin of `domain` (any status, so pending domains can be verified). */
export async function isDomainAdmin(
	db: AuthDb,
	userId: string,
	domainName: string,
): Promise<boolean> {
	const d = domainName.trim().toLowerCase();
	const row = await db
		.select({ domain: schema.domain.domain })
		.from(schema.domain)
		.leftJoin(
			schema.domainAdmin,
			and(eq(schema.domainAdmin.domain, schema.domain.domain), eq(schema.domainAdmin.userId, userId)),
		)
		.where(
			and(
				eq(schema.domain.domain, d),
				or(eq(schema.domain.ownerUserId, userId), eq(schema.domainAdmin.userId, userId)),
			),
		)
		.get();
	return Boolean(row);
}

export type CreateMailboxCheck =
	| { ok: true; mailboxId: string; domain: string }
	| { ok: false; status: 400 | 403 | 409; error: string };

/**
 * Whether `userId` may create `address`: a non-reserved name on a platform
 * domain, or any name on an active domain the user administers.
 */
export async function canCreateMailbox(
	db: AuthDb,
	opts: { userId: string; address: string; platformDomains: readonly string[] },
): Promise<CreateMailboxCheck> {
	const mailboxId = strictMailboxId(opts.address);
	if (!mailboxId) return { ok: false, status: 400, error: "Invalid mailbox email address" };
	const at = mailboxId.lastIndexOf("@");
	const local = mailboxId.slice(0, at);
	const domainName = mailboxId.slice(at + 1);

	const existing = await db
		.select({ id: schema.mailbox.id })
		.from(schema.mailbox)
		.where(eq(schema.mailbox.id, mailboxId))
		.get();
	if (existing) return { ok: false, status: 409, error: "Mailbox already exists" };

	const platform = new Set(opts.platformDomains.map((d) => d.trim().toLowerCase()));
	if (platform.has(domainName)) {
		if (isReservedLocalPart(local)) {
			return { ok: false, status: 400, error: "That address is reserved" };
		}
		return { ok: true, mailboxId, domain: domainName };
	}

	const row = await db
		.select({ status: schema.domain.status })
		.from(schema.domain)
		.where(eq(schema.domain.domain, domainName))
		.get();
	if (row?.status === "active" && (await isDomainAdmin(db, opts.userId, domainName))) {
		return { ok: true, mailboxId, domain: domainName };
	}
	return { ok: false, status: 403, error: "You can't create addresses on that domain" };
}
