// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Domain Admin mailbox routes, mailbox sharing (invites and members), and
 * public invite accept.
 *
 * Domain admins are `domain` owners and `domain_admin` rows in AUTH_DB, and
 * only ever act on their own domains; cross-tenant tools live under /ops.
 * Invites are rows keyed by the SHA-256 of their token (the token itself is
 * only in the invite link).
 */

import type { Context, Hono } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import {
	authDb,
	canCreateMailbox,
	grantMailboxRole,
	isDomainAdmin,
	listDomainsForUser,
	listMailboxMembers,
	listMailboxesOnDomain,
	mailboxRole,
	setMailboxRole,
	type AuthDb,
} from "../auth/authz";
import { isHostedEmailDomain } from "../auth/hooks";
import { appBaseUrl, codeEmail, sendSystemEmail } from "../auth/mail";
import {
	isUniqueViolation,
	mailboxPayload,
	MailboxExistsError,
	provisionMailbox,
	pruneDeviceTokensToMembership,
} from "../auth/mailboxes";
import { consumeOtp, issueOtp, sha256Hex } from "../auth/otp";
import { userKey } from "../auth/principal";
import { clientIp, isRateLimited, TOO_MANY } from "../auth/rate-limit";
import * as schema from "../auth/schema";
import type { MailboxRole } from "../auth/schema";
import {
	createSessionForUser,
	findUserByEmail,
	findUserById,
	sessionCookieHeader,
	userRowStatements,
} from "../auth/users";
import { isDevRuntime } from "../lib/dev-runtime";
import { escapeHtml, getMailboxStub } from "../lib/email-helpers";
import { purgeEmailAgents } from "../lib/email-agent";
import type { MailboxContext } from "../lib/mailbox";
import { normalizeEmailAddress } from "../lib/mail-automations";
import { allowedMailboxSet, canonicalMailboxId, mailboxMetadataKey, strictMailboxId } from "../lib/mailbox-routing";
import { validatePasswordStrength } from "../lib/password-auth";
import type { Env } from "../types";
import { compatKeys, leaveMailbox } from "./account";
import { serviceEndedErrorForMailbox } from "../lib/domain-service";

type App = Hono<MailboxContext>;
type C = Context<MailboxContext>;

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_INVITE_EMAILS = 5;
const INVITE_RESEND_COOLDOWN_MS = 5 * 60 * 1000;

const InviteeTarget = z.object({
	inviteEmail: z.string().email(),
	inviteeName: z.string().max(200).optional(),
	role: z.enum(["owner", "member"]).optional(),
});

const CreateAdminMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1).max(200).optional(),
	assignTo: z.union([z.literal("self"), InviteeTarget]).optional().default("self"),
});

const AssignBody = z.object({ assignTo: z.union([z.literal("self"), InviteeTarget]) });

const InviteBody = InviteeTarget.extend({ mailboxId: z.string().email() });

const AcceptInviteBody = z.object({
	/** Required to create a new account; ignored when signed in. */
	password: z.string().min(10).max(200).optional(),
	displayName: z.string().max(200).optional(),
	/** The code mailed to the invitee address (POST /invites/:token/otp). */
	code: z.string().min(4).max(12).optional(),
});

// ── Helpers ──────────────────────────────────────────────────────

function domainOf(mailboxId: string): string {
	return mailboxId.slice(mailboxId.lastIndexOf("@") + 1);
}

async function loadSettings(env: Env, mailboxId: string): Promise<Record<string, unknown> | null> {
	const obj = await env.BUCKET.get(mailboxMetadataKey(mailboxId));
	if (!obj) return null;
	try {
		const parsed = await obj.json();
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

async function mailboxExists(db: AuthDb, mailboxId: string): Promise<boolean> {
	const row = await db
		.select({ id: schema.mailbox.id })
		.from(schema.mailbox)
		.where(and(eq(schema.mailbox.id, mailboxId), isNull(schema.mailbox.deletedAt)))
		.get();
	return Boolean(row);
}

async function audit(db: AuthDb, actorUserId: string | null, action: string, target: string, detail?: unknown) {
	await db.insert(schema.auditLog).values({
		id: crypto.randomUUID(),
		actorUserId,
		action,
		target,
		detail: detail === undefined ? null : JSON.stringify(detail),
	});
}

/** `settings.acl` in the shape shipped clients render (display only). */
async function compatAclRow(db: AuthDb, mailboxId: string) {
	const members = await listMailboxMembers(db, mailboxId);
	return {
		owners: members.filter((m) => m.role === "owner").map((m) => `email:${m.email}`),
		members: members.filter((m) => m.role === "member").map((m) => `email:${m.email}`),
	};
}

async function adminMailboxRow(env: Env, db: AuthDb, mailboxId: string) {
	const settings = (await loadSettings(env, mailboxId)) ?? {};
	const acl = await compatAclRow(db, mailboxId);
	const fromName = typeof settings.fromName === "string" && settings.fromName ? settings.fromName : null;
	return {
		id: mailboxId,
		email: mailboxId,
		name: fromName ?? mailboxId,
		acl,
		claimed: acl.owners.length > 0,
		fromName,
	};
}

async function mailboxResponse(env: Env, db: AuthDb, mailboxId: string, role: MailboxRole | null) {
	const payload = mailboxPayload(mailboxId, (await loadSettings(env, mailboxId)) ?? {}, role);
	return { ...payload, settings: { ...payload.settings, acl: await compatAclRow(db, mailboxId) } };
}

/** May this user administer the mailbox's domain? */
async function canAdministerMailbox(db: AuthDb, userId: string | undefined, mailboxId: string): Promise<boolean> {
	return Boolean(userId) && (await isDomainAdmin(db, userId!, domainOf(mailboxId)));
}

/** Owner of the mailbox, or admin of its domain: may invite and manage members. */
async function canManageMembers(db: AuthDb, userId: string | undefined, mailboxId: string): Promise<boolean> {
	if (!userId) return false;
	if ((await mailboxRole(db, userId, mailboxId)) === "owner") return true;
	return isDomainAdmin(db, userId, domainOf(mailboxId));
}

// ── Invites ──────────────────────────────────────────────────────

type InviteRow = typeof schema.invite.$inferSelect;
type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

function inviteStatus(invite: InviteRow, now = Date.now()): InviteStatus {
	if (invite.revokedAt) return "revoked";
	if (invite.acceptedAt) return "accepted";
	if (invite.expiresAt.getTime() <= now) return "expired";
	return "pending";
}

function publicInvitePayload(invite: InviteRow) {
	return {
		id: invite.tokenHash,
		mailboxId: invite.mailboxId,
		role: invite.role,
		inviteeEmail: invite.inviteeEmail,
		inviteeName: invite.inviteeName ?? undefined,
		expiresAt: invite.expiresAt.toISOString(),
		status: inviteStatus(invite),
	};
}

function newInviteToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Find an invite by the token from its link, or by its id (the token hash, used in admin lists). */
async function findInvite(db: AuthDb, tokenOrId: string): Promise<InviteRow | undefined> {
	const value = tokenOrId.trim().toLowerCase();
	if (!/^[0-9a-f]{48}$|^[0-9a-f]{64}$/.test(value)) return undefined;
	const tokenHash = value.length === 64 ? value : await sha256Hex(value);
	return db.select().from(schema.invite).where(eq(schema.invite.tokenHash, tokenHash)).get();
}

/** Only by the link token: what the invitee holds. */
async function findInviteByToken(db: AuthDb, token: string): Promise<InviteRow | undefined> {
	const value = token.trim().toLowerCase();
	if (!/^[0-9a-f]{48}$/.test(value)) return undefined;
	return db.select().from(schema.invite).where(eq(schema.invite.tokenHash, await sha256Hex(value))).get();
}

async function sendInviteEmail(
	c: C,
	invite: { token: string; mailboxId: string; inviteeEmail: string; inviteeName?: string | null },
): Promise<{ sent: boolean; inviteUrl: string; error?: string }> {
	const inviteUrl = `${appBaseUrl(c.env, c.req.url)}/invite/${encodeURIComponent(invite.token)}`;
	// The inviter chooses the name; it goes out from our noreply address, so
	// it must never become markup (links, fake warnings).
	const name = invite.inviteeName ? ` ${escapeHtml(invite.inviteeName)}` : "";
	const mailbox = escapeHtml(invite.mailboxId);
	const url = escapeHtml(inviteUrl);
	const sent = await sendSystemEmail(c.env, {
		to: invite.inviteeEmail,
		subject: `You're invited to ${invite.mailboxId}`,
		text: `You've been invited to ${invite.mailboxId} on Inboxies.\n\nOpen this link to get started:\n${inviteUrl}\n`,
		html: `<p>Hi${name},</p><p>You've been invited to <strong>${mailbox}</strong> on Inboxies.</p><p><a href="${url}">Accept invite</a></p><p>Or copy this link:<br/>${url}</p>`,
	});
	return sent ? { sent, inviteUrl } : { sent, inviteUrl, error: "Invite email could not be sent" };
}

/** Store a pending invite; returns the link token (only its hash is kept). */
export async function insertInviteRow(
	db: AuthDb,
	opts: { mailboxId: string; role: MailboxRole; inviteeEmail: string; inviteeName?: string; createdBy: string },
): Promise<{ token: string; expiresAt: Date }> {
	const token = newInviteToken();
	const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
	await db.insert(schema.invite).values({
		tokenHash: await sha256Hex(token),
		mailboxId: opts.mailboxId,
		role: opts.role,
		inviteeEmail: opts.inviteeEmail,
		inviteeName: opts.inviteeName?.trim() || null,
		createdBy: opts.createdBy,
		expiresAt,
		lastEmailedAt: new Date(),
	});
	return { token, expiresAt };
}

async function createInvite(
	c: C,
	userId: string,
	opts: { mailboxId: string; inviteEmail: string; inviteeName?: string; role: MailboxRole },
) {
	const inviteeEmail = normalizeEmailAddress(opts.inviteEmail);
	if (!inviteeEmail) return { ok: false as const, status: 400 as const, error: "Invalid invitee email" };
	// Nobody joins a mailbox whose domain's subscription has ended.
	const ended = await serviceEndedErrorForMailbox(c.env, opts.mailboxId);
	if (ended) return { ok: false as const, status: 403 as const, error: ended.error };
	// Invites send mail from our own address to anyone: cap them per inviter
	// and per invitee.
	if (
		(await isRateLimited(c.env, "invite", `user:${userId}`)) ||
		(await isRateLimited(c.env, "invite", `to:${inviteeEmail}`))
	) {
		return { ok: false as const, status: 429 as const, error: "Too many invites; try again in a minute" };
	}
	const db = authDb(c.env.AUTH_DB);
	const { token, expiresAt } = await insertInviteRow(db, {
		mailboxId: opts.mailboxId,
		role: opts.role,
		inviteeEmail,
		inviteeName: opts.inviteeName,
		createdBy: userId,
	});
	const delivery = await sendInviteEmail(c, {
		token,
		mailboxId: opts.mailboxId,
		inviteeEmail,
		inviteeName: opts.inviteeName,
	});
	await audit(db, userId, "invite.create", opts.mailboxId, { inviteeEmail, role: opts.role, sent: delivery.sent });
	return {
		ok: true as const,
		body: {
			token,
			inviteUrl: delivery.inviteUrl,
			emailSent: delivery.sent,
			emailError: delivery.error ?? null,
			mailboxId: opts.mailboxId,
			inviteeEmail,
			role: opts.role,
			expiresAt: expiresAt.toISOString(),
		},
	};
}

/**
 * Accept an invite as `userId`. The update only matches a still-pending
 * invite, so two concurrent accepts can't both win.
 */
function claimInviteStatement(db: AuthDb, tokenHash: string, userId: string) {
	return db
		.update(schema.invite)
		.set({ acceptedAt: new Date(), acceptedBy: userId })
		.where(
			and(
				eq(schema.invite.tokenHash, tokenHash),
				isNull(schema.invite.acceptedAt),
				isNull(schema.invite.revokedAt),
				gt(schema.invite.expiresAt, new Date()),
			),
		)
		.returning({ tokenHash: schema.invite.tokenHash });
}

/** Without a code, new accounts can still be created by app builds that predate invite codes. */
function codelessAcceptAllowed(env: Env): boolean {
	return env.LEGACY_INVITE_ACCEPT?.trim().toLowerCase() !== "false";
}

// ── Routes ───────────────────────────────────────────────────────

export function registerAdminAndInviteRoutes(app: App) {
	// ── Domain Admin: mailboxes ───────────────────────────────────

	app.get("/api/v1/admin/mailboxes", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const db = authDb(c.env.AUTH_DB);
		const domains = await listDomainsForUser(db, principal.userId);
		if (domains.length === 0) return c.json({ error: "Forbidden" }, 403);
		const ids = (await Promise.all(domains.map((d) => listMailboxesOnDomain(db, d)))).flat().sort();
		return c.json(await Promise.all(ids.map((id) => adminMailboxRow(c.env, db, id))));
	});

	app.post("/api/v1/admin/mailboxes", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const body = CreateAdminMailboxBody.parse(await c.req.json());
		const email = strictMailboxId(body.email);
		if (!email) return c.json({ error: "Invalid mailbox email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		if (!(await canAdministerMailbox(db, principal.userId, email))) return c.json({ error: "Forbidden" }, 403);
		const allowed = allowedMailboxSet((c.env.EMAIL_ADDRESSES ?? []) as string[]);
		if (allowed.size > 0 && !allowed.has(email)) {
			return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
		}
		const check = await canCreateMailbox(db, { userId: principal.userId, address: email, platformDomains: [] });
		if (!check.ok) return c.json({ error: check.error }, check.status);
		const name = body.name || email.split("@")[0] || email;
		try {
			await provisionMailbox(c.env, { mailboxId: check.mailboxId, ownerUserId: principal.userId, name });
		} catch (e) {
			if (e instanceof MailboxExistsError) return c.json({ error: "Address is already in use" }, 409);
			throw e;
		}
		let invite: Record<string, unknown> | null = null;
		if (body.assignTo !== "self") {
			const result = await createInvite(c, principal.userId, {
				mailboxId: check.mailboxId,
				inviteEmail: body.assignTo.inviteEmail,
				inviteeName: body.assignTo.inviteeName,
				role: body.assignTo.role ?? "owner",
			});
			if (!result.ok) return c.json({ error: result.error }, result.status);
			invite = result.body;
		}
		await audit(db, principal.userId, "mailbox.create", check.mailboxId, {
			assignTo: body.assignTo === "self" ? "self" : "invite",
		});
		return c.json({ ...(await mailboxResponse(c.env, db, check.mailboxId, "owner")), name, invite }, 201);
	});

	app.post("/api/v1/admin/mailboxes/:mailboxId/assign", async (c) => {
		const principal = c.get("principal");
		const mailboxId = strictMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		if (!principal || !(await canAdministerMailbox(db, principal.userId, mailboxId))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		if (!(await mailboxExists(db, mailboxId))) return c.json({ error: "Not found" }, 404);
		const ended = await serviceEndedErrorForMailbox(c.env, mailboxId);
		if (ended) return c.json(ended, 403);
		const body = AssignBody.parse(await c.req.json());
		if (body.assignTo === "self") {
			await grantMailboxRole(db, mailboxId, principal.userId, "owner");
			await audit(db, principal.userId, "mailbox.assign_self", mailboxId);
			return c.json(await mailboxResponse(c.env, db, mailboxId, "owner"));
		}
		const result = await createInvite(c, principal.userId, {
			mailboxId,
			inviteEmail: body.assignTo.inviteEmail,
			inviteeName: body.assignTo.inviteeName,
			role: body.assignTo.role ?? "owner",
		});
		if (!result.ok) return c.json({ error: result.error }, result.status);
		return c.json({ mailboxId, invite: result.body });
	});

	// Raw ACL keys were how emails turned into access. Members change through
	// invites and /api/v1/mailboxes/:id/members now.
	app.put("/api/v1/admin/mailboxes/:mailboxId/acl", (c) =>
		c.json({ error: "Use invites and /api/v1/mailboxes/:id/members to change who has access" }, 410),
	);

	app.delete("/api/v1/admin/mailboxes/:mailboxId", async (c) => {
		const principal = c.get("principal");
		const mailboxId = strictMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		if (!principal || !(await canAdministerMailbox(db, principal.userId, mailboxId))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		if (!(await mailboxExists(db, mailboxId))) return c.json({ error: "Not found" }, 404);
		const ended = await serviceEndedErrorForMailbox(c.env, mailboxId);
		if (ended) return c.json(ended, 403);
		const stub = getMailboxStub(c.env, mailboxId);
		const { conversationIds } = await stub.purgeMailbox(mailboxId);
		await purgeEmailAgents(c.env, mailboxId, conversationIds);
		await db.delete(schema.mailbox).where(eq(schema.mailbox.id, mailboxId));
		await audit(db, principal.userId, "mailbox.delete", mailboxId);
		return c.body(null, 204);
	});

	// ── Invites (admins and owners) ───────────────────────────────

	app.post("/api/v1/admin/invites", async (c) => {
		const principal = c.get("principal");
		const body = InviteBody.parse(await c.req.json());
		const mailboxId = strictMailboxId(body.mailboxId);
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		if (!principal || !(await canAdministerMailbox(db, principal.userId, mailboxId))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		if (!(await mailboxExists(db, mailboxId))) return c.json({ error: "Not found" }, 404);
		const result = await createInvite(c, principal.userId, {
			mailboxId,
			inviteEmail: body.inviteEmail,
			inviteeName: body.inviteeName,
			role: body.role ?? "owner",
		});
		if (!result.ok) return c.json({ error: result.error }, result.status);
		return c.json(result.body, 201);
	});

	app.get("/api/v1/admin/mailboxes/:mailboxId/invites", async (c) => {
		const principal = c.get("principal");
		const mailboxId = strictMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const db = authDb(c.env.AUTH_DB);
		if (!(await canManageMembers(db, principal?.userId, mailboxId))) return c.json({ error: "Forbidden" }, 403);
		const rows = await db.select().from(schema.invite).where(eq(schema.invite.mailboxId, mailboxId)).all();
		return c.json(
			rows
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.map((r) => ({ ...publicInvitePayload(r), createdAt: r.createdAt.toISOString() })),
		);
	});

	app.post("/api/v1/admin/invites/:token/revoke", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const db = authDb(c.env.AUTH_DB);
		const invite = await findInvite(db, c.req.param("token"));
		if (!invite) return c.json({ error: "Not found" }, 404);
		if (!(await canManageMembers(db, principal.userId, invite.mailboxId))) return c.json({ error: "Forbidden" }, 403);
		const status = inviteStatus(invite);
		if (status !== "pending") return c.json({ error: `Invite is ${status}` }, 400);
		await db.update(schema.invite).set({ revokedAt: new Date() }).where(eq(schema.invite.tokenHash, invite.tokenHash));
		await audit(db, principal.userId, "invite.revoke", invite.mailboxId, { id: invite.tokenHash });
		return c.json({ ...publicInvitePayload(invite), status: "revoked" });
	});

	/**
	 * Resend needs the link token (only the inviter's copy of the link has it):
	 * we keep just its hash.
	 */
	app.post("/api/v1/admin/invites/:token/resend", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const db = authDb(c.env.AUTH_DB);
		const token = c.req.param("token");
		const invite = await findInviteByToken(db, token);
		if (!invite) return c.json({ error: "Not found" }, 404);
		if (!(await canManageMembers(db, principal.userId, invite.mailboxId))) return c.json({ error: "Forbidden" }, 403);
		if (inviteStatus(invite) !== "pending") return c.json({ error: "Invite is not active" }, 400);
		const ended = await serviceEndedErrorForMailbox(c.env, invite.mailboxId);
		if (ended) return c.json(ended, 403);
		if (invite.emailCount >= MAX_INVITE_EMAILS) {
			return c.json({ error: "This invite has been emailed too many times; revoke it and invite again" }, 429);
		}
		const last = (invite.lastEmailedAt ?? invite.createdAt).getTime();
		if (Date.now() - last < INVITE_RESEND_COOLDOWN_MS) {
			return c.json({ error: "Wait a few minutes before resending this invite" }, 429);
		}
		const delivery = await sendInviteEmail(c, { ...invite, token });
		await db
			.update(schema.invite)
			.set({ emailCount: invite.emailCount + 1, lastEmailedAt: new Date() })
			.where(eq(schema.invite.tokenHash, invite.tokenHash));
		return c.json({
			...publicInvitePayload(invite),
			token,
			inviteUrl: delivery.inviteUrl,
			emailSent: delivery.sent,
			emailError: delivery.error ?? null,
		});
	});

	/** Owners (or the domain's admins) share a mailbox by invite. */
	app.post("/api/v1/mailboxes/:mailboxId/invites", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Unauthorized" }, 401);
		const mailboxId = c.var.mailboxId;
		const db = authDb(c.env.AUTH_DB);
		if (!(await canManageMembers(db, principal.userId, mailboxId))) return c.json({ error: "Forbidden" }, 403);
		const body = InviteeTarget.parse(await c.req.json());
		const result = await createInvite(c, principal.userId, {
			mailboxId,
			inviteEmail: body.inviteEmail,
			inviteeName: body.inviteeName,
			role: body.role ?? "member",
		});
		if (!result.ok) return c.json({ error: result.error }, result.status);
		return c.json(result.body, 201);
	});

	// ── Members ───────────────────────────────────────────────────

	app.get("/api/v1/mailboxes/:mailboxId/members", async (c) => {
		const db = authDb(c.env.AUTH_DB);
		const members = await listMailboxMembers(db, c.var.mailboxId);
		const me = c.get("principal")?.userId;
		return c.json(members.map((m) => ({ ...m, you: m.userId === me })));
	});

	app.patch("/api/v1/mailboxes/:mailboxId/members/:userId", async (c) => {
		const principal = c.get("principal");
		const db = authDb(c.env.AUTH_DB);
		const mailboxId = c.var.mailboxId;
		if (!(await canManageMembers(db, principal?.userId, mailboxId))) return c.json({ error: "Forbidden" }, 403);
		const body = z.object({ role: z.enum(["owner", "member"]) }).parse(await c.req.json());
		const userId = c.req.param("userId");
		const result = await setMailboxRole(db, mailboxId, userId, body.role);
		if (!result.ok) return c.json({ error: result.error }, result.status);
		await audit(db, principal!.userId, "member.role", mailboxId, { userId, role: body.role });
		return c.json({ ok: true });
	});

	/** Owners remove anyone; a member may remove themselves (leave). */
	app.delete("/api/v1/mailboxes/:mailboxId/members/:userId", async (c) => {
		const principal = c.get("principal");
		const db = authDb(c.env.AUTH_DB);
		const mailboxId = c.var.mailboxId;
		const userId = c.req.param("userId");
		const self = principal?.userId === userId;
		if (!self && !(await canManageMembers(db, principal?.userId, mailboxId))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const result = await leaveMailbox(c.env, mailboxId, userId);
		if (!result.ok) return c.json({ error: result.error }, result.status);
		await audit(db, principal!.userId, self ? "member.leave" : "member.remove", mailboxId, { userId });
		return c.json({ ok: true });
	});

	// ── Public: view and accept an invite ─────────────────────────

	app.get("/api/v1/invites/:token", async (c) => {
		const invite = await findInviteByToken(authDb(c.env.AUTH_DB), c.req.param("token"));
		if (!invite) return c.json({ error: "Invite not found" }, 404);
		const payload = publicInvitePayload(invite);
		if (payload.status !== "pending") return c.json({ error: `Invite is ${payload.status}`, invite: payload }, 410);
		return c.json(payload);
	});

	/** Mail a code to the invitee address; accepting with it proves the invitee got the invite. */
	app.post("/api/v1/invites/:token/otp", async (c) => {
		const db = authDb(c.env.AUTH_DB);
		const invite = await findInviteByToken(db, c.req.param("token"));
		if (!invite || inviteStatus(invite) !== "pending") return c.json({ error: "Invite is not active" }, 410);
		if (
			(await isRateLimited(c.env, "otp-send", clientIp(c.req.raw.headers))) ||
			(await isRateLimited(c.env, "otp-send", invite.inviteeEmail))
		) {
			return c.json(TOO_MANY, 429);
		}
		const otp = await issueOtp(db, "invite", invite.tokenHash, invite.inviteeEmail);
		if (!otp.ok) return c.json({ error: "A code was just sent. Wait a minute before asking again." }, 429);
		const mail = codeEmail({ purposeLine: `Use this code to accept your invite to ${invite.mailboxId}.`, code: otp.code });
		await sendSystemEmail(c.env, { to: invite.inviteeEmail, subject: "Your Inboxies invite code", ...mail });
		return c.json({ ok: true, sentTo: invite.inviteeEmail, ...(isDevRuntime() ? { devCode: otp.code } : {}) });
	});

	/**
	 * Accept an invite.
	 * - Signed in: the code is required; the invite joins the signed-in user.
	 * - Signed out: creates a new user with `password`. With a valid code the
	 *   invitee address is verified (and becomes the recovery email); app
	 *   builds that predate codes may still accept without one
	 *   (LEGACY_INVITE_ACCEPT), leaving the address unverified.
	 */
	app.post("/api/v1/invites/:token/accept", async (c) => {
		const db = authDb(c.env.AUTH_DB);
		const invite = await findInviteByToken(db, c.req.param("token"));
		if (!invite) return c.json({ error: "Invite not found" }, 404);
		if (inviteStatus(invite) !== "pending") return c.json({ error: "Invite is not active" }, 410);
		if (!(await mailboxExists(db, invite.mailboxId))) return c.json({ error: "Mailbox not found" }, 404);
		const body = AcceptInviteBody.parse(await c.req.json().catch(() => ({})));
		if (await isRateLimited(c.env, "otp-verify", clientIp(c.req.raw.headers))) return c.json(TOO_MANY, 429);

		const verified = body.code ? (await consumeOtp(db, "invite", invite.tokenHash, body.code)).ok : false;
		if (body.code && !verified) return c.json({ error: "Invalid or expired code" }, 400);

		const principal = c.get("principal");
		if (principal) {
			if (!verified) {
				return c.json({ error: "Enter the code we emailed to the invited address", codeRequired: true }, 400);
			}
			const claimed = await claimInviteStatement(db, invite.tokenHash, principal.userId);
			if (claimed.length === 0) return c.json({ error: "Invite is not active" }, 410);
			await grantMailboxRole(db, invite.mailboxId, principal.userId, invite.role);
			await audit(db, principal.userId, "invite.accept", invite.mailboxId, { role: invite.role, existingUser: true });
			return c.json({ mailboxId: invite.mailboxId, userId: principal.userId, accountId: principal.userId });
		}

		if (!verified && !codelessAcceptAllowed(c.env)) {
			return c.json({ error: "Enter the code we emailed to the invited address", codeRequired: true }, 400);
		}
		if (!body.password) return c.json({ error: "Choose a password" }, 400);
		const strength = validatePasswordStrength(body.password);
		if (strength) return c.json({ error: strength }, 400);

		// The new login: an owner signs in as the mailbox (as before), unless
		// that address already belongs to someone; members use the invitee address.
		const ownerLogin = invite.role === "owner" && !(await findUserByEmail(db, invite.mailboxId));
		const email = ownerLogin ? invite.mailboxId : invite.inviteeEmail;
		if (!ownerLogin && (await findUserByEmail(db, email))) {
			return c.json({ error: `An account already uses ${email}. Sign in to it, then open the invite again.` }, 409);
		}
		const displayName = body.displayName?.trim() || invite.inviteeName || email.split("@")[0];
		const { id: userId, statements } = await userRowStatements(db, {
			email,
			name: displayName,
			// The mailbox login is owned by construction; the invitee address
			// only once the code proved it.
			emailVerified: ownerLogin || verified,
			password: body.password,
		});
		const recovery =
			verified && !(await isHostedEmailDomain(c.env, invite.inviteeEmail))
				? [db.insert(schema.recoveryEmail).values({ userId, email: invite.inviteeEmail, verifiedAt: new Date() })]
				: [];
		try {
			const results = await db.batch([
				...statements,
				...recovery,
				db.insert(schema.mailboxMember).values({ mailboxId: invite.mailboxId, userId, role: invite.role }),
				claimInviteStatement(db, invite.tokenHash, userId),
			] as unknown as Parameters<typeof db.batch>[0]);
			const claimed = results[results.length - 1] as unknown[];
			if (!Array.isArray(claimed) || claimed.length === 0) throw new Error("invite already claimed");
		} catch (e) {
			// The batch is one transaction: nothing was written.
			if (isUniqueViolation(e)) return c.json({ error: `An account already uses ${email}.` }, 409);
			if (/already claimed/.test((e as Error).message)) return c.json({ error: "Invite is not active" }, 410);
			throw e;
		}
		if (invite.role === "owner" && body.displayName?.trim()) {
			const settings = (await loadSettings(c.env, invite.mailboxId)) ?? {};
			await c.env.BUCKET.put(
				mailboxMetadataKey(invite.mailboxId),
				JSON.stringify({ ...settings, fromName: body.displayName.trim() }),
			);
		}
		await audit(db, userId, "invite.accept", invite.mailboxId, { role: invite.role, verified });
		const session = await createSessionForUser(c.env, userId, { headers: c.req.raw.headers });
		c.header("Set-Cookie", await sessionCookieHeader(c.env, session));
		const user = { id: userId, email };
		return c.json({
			mailboxId: invite.mailboxId,
			userId,
			accountId: userId,
			email,
			token: session.token,
			expiresAt: session.expiresAt.toISOString(),
			principal: { email, sub: userKey(userId), keys: compatKeys(user) },
		});
	});
}

