// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Creating and removing mailboxes. The permission rows live in AUTH_DB; the
 * mailbox's settings blob stays in R2 (`mailboxes/{id}.json`) and its mail in
 * the Durable Object. Every route that creates a mailbox goes through here.
 */

import { eq } from "drizzle-orm";
import { isAddressTaken, mailboxMetadataKey } from "../lib/mailbox-routing";
import { seedWelcomeEmailsForMailbox } from "../lib/welcome-emails";
import type { Env } from "../types";
import { authDb, listMailboxMembers, type AuthDb } from "./authz";
import * as schema from "./schema";
import type { MailboxRole } from "./schema";

export class MailboxExistsError extends Error {
	readonly mailboxId: string;
	constructor(mailboxId: string) {
		super("Mailbox already exists");
		this.mailboxId = mailboxId;
	}
}

export function defaultMailboxSettings(name: string): Record<string, unknown> {
	return {
		fromName: name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		screener: { enabled: true },
	};
}

/** Settings as stored, minus anything permission-shaped (that's in AUTH_DB now). */
export function stripAclFromSettings(settings: Record<string, unknown>): Record<string, unknown> {
	const { acl: _acl, ...rest } = settings;
	return rest;
}

/** Address in use by a mailbox (D1 or legacy R2 blob) or a private email. */
export async function isMailboxAddressTaken(env: Env, db: AuthDb, mailboxId: string): Promise<boolean> {
	const row = await db
		.select({ id: schema.mailbox.id })
		.from(schema.mailbox)
		.where(eq(schema.mailbox.id, mailboxId))
		.get();
	if (row) return true;
	return isAddressTaken(env.BUCKET, mailboxId);
}

/**
 * The row statements that create a mailbox owned by `ownerUserId`. Exposed so
 * sign-up can create the user and the mailbox in one D1 batch.
 */
export function mailboxRowStatements(db: AuthDb, mailboxId: string, ownerUserId: string) {
	return [
		db.insert(schema.mailbox).values({ id: mailboxId, domain: mailboxId.slice(mailboxId.lastIndexOf("@") + 1) }),
		db.insert(schema.mailboxMember).values({ mailboxId, userId: ownerUserId, role: "owner" as MailboxRole }),
	] as const;
}

/** Everything after the rows exist: settings blob, Durable Object, welcome mail. */
export async function initializeMailboxStorage(
	env: Env,
	mailboxId: string,
	opts: { name: string; settings?: Record<string, unknown>; seedWelcome?: boolean },
): Promise<Record<string, unknown>> {
	const settings = stripAclFromSettings({ ...defaultMailboxSettings(opts.name), ...(opts.settings ?? {}) });
	await env.BUCKET.put(mailboxMetadataKey(mailboxId), JSON.stringify(settings));
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
	await stub.reviveMailbox();
	await stub.getFolders();
	if (opts.seedWelcome !== false) await seedWelcomeEmailsForMailbox(env, mailboxId, opts.name);
	return settings;
}

function isUniqueViolation(e: unknown): boolean {
	const message = String((e as Error)?.message ?? e);
	const cause = String(((e as { cause?: Error })?.cause)?.message ?? "");
	return /UNIQUE|PRIMARY KEY|constraint/i.test(message) || /UNIQUE|PRIMARY KEY|constraint/i.test(cause);
}

/**
 * Create `mailboxId` with `ownerUserId` as its owner. The caller has already
 * checked the user may (`canCreateMailbox`); this re-checks the address is
 * free and lets the primary key settle races.
 */
export async function provisionMailbox(
	env: Env,
	opts: {
		mailboxId: string;
		ownerUserId: string;
		name: string;
		settings?: Record<string, unknown>;
		seedWelcome?: boolean;
	},
): Promise<Record<string, unknown>> {
	const db = authDb(env.AUTH_DB);
	if (await isMailboxAddressTaken(env, db, opts.mailboxId)) throw new MailboxExistsError(opts.mailboxId);
	try {
		await db.batch(mailboxRowStatements(db, opts.mailboxId, opts.ownerUserId));
	} catch (e) {
		if (isUniqueViolation(e)) throw new MailboxExistsError(opts.mailboxId);
		throw e;
	}
	return initializeMailboxStorage(env, opts.mailboxId, opts);
}

export { isUniqueViolation };

/** After the Durable Object purge: drop the rows (members and invites cascade). */
export async function deleteMailboxRows(db: AuthDb, mailboxId: string): Promise<void> {
	await db.delete(schema.mailbox).where(eq(schema.mailbox.id, mailboxId));
}

/** Drop push tokens of anyone no longer on the mailbox. */
export async function pruneDeviceTokensToMembership(env: Env, mailboxId: string): Promise<void> {
	const members = await listMailboxMembers(authDb(env.AUTH_DB), mailboxId);
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
	await stub.pruneDeviceTokensToMembers(members.map((m) => m.userId));
}

/** The mailbox JSON every client reads (`GET /mailboxes/:id`, create responses). */
export function mailboxPayload(
	mailboxId: string,
	settings: Record<string, unknown>,
	role: MailboxRole | null,
) {
	return {
		id: mailboxId,
		name: mailboxId,
		email: mailboxId,
		settings: stripAclFromSettings(settings),
		role,
		canManage: role === "owner",
	};
}
