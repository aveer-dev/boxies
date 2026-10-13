// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Operator tools under /ops/* (Cloudflare Access only, see `auth/operators.ts`).
 * They replace the cross-tenant powers DOMAIN_ADMINS used to give app users:
 * listing every domain and mailbox, creating addresses anywhere (reserved
 * names included), managing domain admins, reading the audit log, and
 * signing a user out everywhere. Every write is audited with the operator.
 */

import type { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authDb, listMailboxMembers, type AuthDb } from "../auth/authz";
import { MailboxExistsError, provisionMailbox } from "../auth/mailboxes";
import type { Operator } from "../auth/operators";
import type { RequestPrincipal } from "../auth/principal";
import * as schema from "../auth/schema";
import { findUserByEmail, findUserById, revokeUserSessions } from "../auth/users";
import { strictMailboxId } from "../lib/mailbox-routing";
import type { Env } from "../types";

type OpsApp = Hono<{ Bindings: Env; Variables: { principal?: RequestPrincipal; operator?: Operator } }>;

async function auditOps(db: AuthDb, operator: Operator | undefined, action: string, target: string, detail?: unknown) {
	await db.insert(schema.auditLog).values({
		id: crypto.randomUUID(),
		actorUserId: null,
		action: `ops.${action}`,
		target,
		detail: JSON.stringify({ operator: operator?.email || operator?.sub, ...(detail ? { detail } : {}) }),
	});
}

export function registerOpsRoutes(app: OpsApp) {
	app.get("/ops/domains", async (c) => {
		const db = authDb(c.env.AUTH_DB);
		const rows = await db
			.select({
				domain: schema.domain.domain,
				status: schema.domain.status,
				ownerUserId: schema.domain.ownerUserId,
				ownerEmail: schema.user.email,
				createdAt: schema.domain.createdAt,
			})
			.from(schema.domain)
			.leftJoin(schema.user, eq(schema.user.id, schema.domain.ownerUserId))
			.orderBy(schema.domain.domain)
			.all();
		return c.json(rows);
	});

	app.get("/ops/mailboxes", async (c) => {
		const db = authDb(c.env.AUTH_DB);
		const domain = c.req.query("domain")?.trim().toLowerCase();
		const mailboxes = await db
			.select({ id: schema.mailbox.id })
			.from(schema.mailbox)
			.where(domain ? and(eq(schema.mailbox.domain, domain), isNull(schema.mailbox.deletedAt)) : isNull(schema.mailbox.deletedAt))
			.orderBy(schema.mailbox.id)
			.all();
		return c.json(
			await Promise.all(mailboxes.map(async (m) => ({ id: m.id, members: await listMailboxMembers(db, m.id) }))),
		);
	});

	app.get("/ops/users", async (c) => {
		const email = c.req.query("email");
		if (!email) return c.json({ error: "email query is required" }, 400);
		const db = authDb(c.env.AUTH_DB);
		const user = await findUserByEmail(db, email);
		if (!user) return c.json({ error: "Not found" }, 404);
		const accounts = await db
			.select({ providerId: schema.account.providerId })
			.from(schema.account)
			.where(eq(schema.account.userId, user.id))
			.all();
		return c.json({ ...user, signInMethods: accounts.map((a) => a.providerId) });
	});

	/** Create an address anywhere (reserved names included), owned by `ownerUserId`. */
	app.post("/ops/mailboxes", async (c) => {
		const body = z
			.object({ email: z.string().email(), ownerUserId: z.string().min(1), name: z.string().max(200).optional() })
			.parse(await c.req.json());
		const mailboxId = strictMailboxId(body.email);
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		if (!(await findUserById(db, body.ownerUserId))) return c.json({ error: "Owner not found" }, 404);
		try {
			await provisionMailbox(c.env, {
				mailboxId,
				ownerUserId: body.ownerUserId,
				name: body.name || mailboxId.split("@")[0],
			});
		} catch (e) {
			if (e instanceof MailboxExistsError) return c.json({ error: "Address is already in use" }, 409);
			throw e;
		}
		await auditOps(db, c.get("operator"), "mailbox.create", mailboxId, { ownerUserId: body.ownerUserId });
		return c.json({ id: mailboxId, ownerUserId: body.ownerUserId }, 201);
	});

	app.post("/ops/domains/:domain/admins", async (c) => {
		const domain = c.req.param("domain").trim().toLowerCase();
		const { userId } = z.object({ userId: z.string().min(1) }).parse(await c.req.json());
		const db = authDb(c.env.AUTH_DB);
		const row = await db.select().from(schema.domain).where(eq(schema.domain.domain, domain)).get();
		if (!row) return c.json({ error: "Domain not found" }, 404);
		if (!(await findUserById(db, userId))) return c.json({ error: "User not found" }, 404);
		await db.insert(schema.domainAdmin).values({ domain, userId }).onConflictDoNothing();
		await auditOps(db, c.get("operator"), "domain.admin_add", domain, { userId });
		return c.json({ ok: true });
	});

	app.delete("/ops/domains/:domain/admins/:userId", async (c) => {
		const domain = c.req.param("domain").trim().toLowerCase();
		const userId = c.req.param("userId");
		const db = authDb(c.env.AUTH_DB);
		await db
			.delete(schema.domainAdmin)
			.where(and(eq(schema.domainAdmin.domain, domain), eq(schema.domainAdmin.userId, userId)));
		await auditOps(db, c.get("operator"), "domain.admin_remove", domain, { userId });
		return c.json({ ok: true });
	});

	app.post("/ops/users/:userId/revoke-sessions", async (c) => {
		const userId = c.req.param("userId");
		const db = authDb(c.env.AUTH_DB);
		const revoked = await revokeUserSessions(c.env, userId);
		await auditOps(db, c.get("operator"), "user.revoke_sessions", userId, { revoked });
		return c.json({ ok: true, revoked });
	});

	app.get("/ops/audit", async (c) => {
		const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 100));
		const rows = await authDb(c.env.AUTH_DB)
			.select()
			.from(schema.auditLog)
			.orderBy(desc(schema.auditLog.createdAt))
			.limit(limit)
			.all();
		return c.json(rows);
	});
}
