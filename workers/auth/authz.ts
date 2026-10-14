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

import { and, eq, isNull, ne, or } from "drizzle-orm";
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

/**
 * Owner or listed admin of `domain`. Pending domains count (they still need
 * setting up); decommissioned ones grant nothing.
 */
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
				ne(schema.domain.status, "decommissioned"),
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
 * domain, or any name on a domain the user administers. Bring-your-own
 * domains stay `pending` until their nameservers move, but ownership was
 * already proven by the DNS TXT check at claim time, so pending is enough.
 * Aliases live in R2, so callers also check for alias collisions.
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

	if (await isDomainAdmin(db, opts.userId, domainName)) {
		const row = await db
			.select({ status: schema.domain.status })
			.from(schema.domain)
			.where(eq(schema.domain.domain, domainName))
			.get();
		if (row?.status === "suspended") {
			return { ok: false, status: 403, error: "This domain's subscription has ended. Renew it to add addresses." };
		}
		return { ok: true, mailboxId, domain: domainName };
	}
	return { ok: false, status: 403, error: "You can't create addresses on that domain" };
}

// ── Membership changes ───────────────────────────────────────────

export type MailboxMemberRow = {
	userId: string;
	email: string;
	name: string;
	role: MailboxRole;
};

/** Everyone on a live mailbox, owners first. */
export async function listMailboxMembers(db: AuthDb, mailboxId: string): Promise<MailboxMemberRow[]> {
	const rows = await db
		.select({
			userId: schema.mailboxMember.userId,
			email: schema.user.email,
			name: schema.user.name,
			role: schema.mailboxMember.role,
		})
		.from(schema.mailboxMember)
		.innerJoin(schema.user, eq(schema.user.id, schema.mailboxMember.userId))
		.where(eq(schema.mailboxMember.mailboxId, mailboxId))
		.all();
	return rows.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.email.localeCompare(b.email));
}

/**
 * Add `userId` to the mailbox, or raise them to `role`. Never demotes:
 * accepting a member invite doesn't strip an existing owner.
 */
export async function grantMailboxRole(
	db: AuthDb,
	mailboxId: string,
	userId: string,
	role: MailboxRole,
): Promise<void> {
	await db
		.insert(schema.mailboxMember)
		.values({ mailboxId, userId, role })
		.onConflictDoUpdate({
			target: [schema.mailboxMember.mailboxId, schema.mailboxMember.userId],
			set: { role: role === "owner" ? "owner" : schema.mailboxMember.role },
		});
}

export type MembershipChange = { ok: true } | { ok: false; status: 400 | 404; error: string };

async function ownerCount(db: AuthDb, mailboxId: string): Promise<number> {
	const rows = await db
		.select({ userId: schema.mailboxMember.userId })
		.from(schema.mailboxMember)
		.where(and(eq(schema.mailboxMember.mailboxId, mailboxId), eq(schema.mailboxMember.role, "owner")))
		.all();
	return rows.length;
}

/** Set an existing member's role. A mailbox always keeps at least one owner. */
export async function setMailboxRole(
	db: AuthDb,
	mailboxId: string,
	userId: string,
	role: MailboxRole,
): Promise<MembershipChange> {
	const current = await mailboxRole(db, userId, mailboxId);
	if (!current) return { ok: false, status: 404, error: "Not a member of this mailbox" };
	if (current === role) return { ok: true };
	if (current === "owner" && (await ownerCount(db, mailboxId)) <= 1) {
		return { ok: false, status: 400, error: "A mailbox needs at least one owner" };
	}
	await db
		.update(schema.mailboxMember)
		.set({ role })
		.where(and(eq(schema.mailboxMember.mailboxId, mailboxId), eq(schema.mailboxMember.userId, userId)));
	return { ok: true };
}

/** Remove a member. The last owner can't be removed (delete the mailbox instead). */
export async function removeMailboxMember(
	db: AuthDb,
	mailboxId: string,
	userId: string,
): Promise<MembershipChange> {
	const current = await mailboxRole(db, userId, mailboxId);
	if (!current) return { ok: false, status: 404, error: "Not a member of this mailbox" };
	if (current === "owner" && (await ownerCount(db, mailboxId)) <= 1) {
		return { ok: false, status: 400, error: "A mailbox needs at least one owner" };
	}
	await db
		.delete(schema.mailboxMember)
		.where(and(eq(schema.mailboxMember.mailboxId, mailboxId), eq(schema.mailboxMember.userId, userId)));
	return { ok: true };
}

// ── Domains ──────────────────────────────────────────────────────

/** Domains the user owns or administers (not decommissioned). */
export async function listDomainsForUser(db: AuthDb, userId: string): Promise<string[]> {
	const owned = await db
		.select({ domain: schema.domain.domain })
		.from(schema.domain)
		.where(and(eq(schema.domain.ownerUserId, userId), ne(schema.domain.status, "decommissioned")))
		.all();
	const administered = await db
		.select({ domain: schema.domain.domain })
		.from(schema.domainAdmin)
		.innerJoin(schema.domain, eq(schema.domain.domain, schema.domainAdmin.domain))
		.where(and(eq(schema.domainAdmin.userId, userId), ne(schema.domain.status, "decommissioned")))
		.all();
	return [...new Set([...owned, ...administered].map((r) => r.domain))].sort();
}

/** Mailbox ids on `domain`, live only. */
export async function listMailboxesOnDomain(db: AuthDb, domainName: string): Promise<string[]> {
	const rows = await db
		.select({ id: schema.mailbox.id })
		.from(schema.mailbox)
		.where(and(eq(schema.mailbox.domain, domainName.trim().toLowerCase()), isNull(schema.mailbox.deletedAt)))
		.orderBy(schema.mailbox.id)
		.all();
	return rows.map((r) => r.id);
}

/**
 * The domain's owner, whatever its status. Offboarding (export download,
 * transfer code, registrar lock) still needs the owner after the domain is
 * decommissioned and admin rights are gone.
 */
export async function isDomainOwner(db: AuthDb, userId: string, domainName: string): Promise<boolean> {
	const row = await db
		.select({ domain: schema.domain.domain })
		.from(schema.domain)
		.where(and(eq(schema.domain.domain, domainName.trim().toLowerCase()), eq(schema.domain.ownerUserId, userId)))
		.get();
	return Boolean(row);
}
