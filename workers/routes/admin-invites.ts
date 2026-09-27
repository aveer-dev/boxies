// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Domain Admin HTTP routes + invite accept / password login.
 */

import type { Context, Hono } from "hono";
import { z } from "zod";
import { sendEmail } from "../email-sender";
import {
	appendAdminAudit,
	canCreateMailbox,
	isDomainAdmin,
	parseMailboxCreatePolicy,
	principalIsDomainAdmin,
	requireDomainAdmin,
	resolveAdminAllowlist,
} from "../lib/domain-admin";
import {
	createInviteRecord,
	inviteAcceptUrl,
	inviteIsActive,
	listInviteTokensForMailbox,
	loadInvite,
	publicInvitePayload,
	saveInvite,
} from "../lib/invites";
import {
	canManageAcl,
	aclFromOwnerKeys,
	loadMailboxSettingsRaw,
	mailboxAccessPayload,
	parseAcl,
	principalKeys,
	validateAclWrite,
	type RequestPrincipal,
} from "../lib/mailbox-acl";
import {
	attachIdpToSessionAccount,
	attachPasswordToSessionAccount,
	IdentityAlreadyLinkedError,
	listIdentitiesForPrincipal,
	mintIdentityLinkCode,
	ownerKeysForAssign,
	passwordUserForSessionAccount,
	redeemIdentityLinkCode,
	updatePasswordHashForSessionAccount,
	upsertIdentityLink,
} from "../lib/identity-links";
import { verifyAppleIdentityToken } from "../lib/apple-auth";
import { verifyGoogleIdentityToken } from "../lib/google-auth";
import type { MailboxContext } from "../lib/mailbox";
import {
	allowedMailboxSet,
	canonicalMailboxId,
	mailboxMetadataKey,
} from "../lib/mailbox-routing";
import { resolveMailDomain } from "../lib/mail-domain";
import { listMailboxes, getMailboxStub } from "../lib/email-helpers";
import {
	clearPasswordSessionCookieHeader,
	hashPassword,
	issuePasswordSessionToken,
	passwordSessionCookieHeader,
	validatePasswordStrength,
	verifyPassword,
} from "../lib/password-auth";
import {
	aclKeysForPlatformUser,
	findUserIdByLoginEmail,
	loadPlatformUser,
	principalFromPlatformUser,
	savePlatformUser,
	type PlatformUser,
} from "../lib/platform-users";
import { agentInstanceName } from "../../shared/agent-conversations";
import type { Env } from "../types";

type App = Hono<MailboxContext>;
type C = Context<MailboxContext>;

function isDevRuntime(): boolean {
	try {
		const metaEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
		return Boolean(metaEnv && metaEnv.DEV);
	} catch {
		return false;
	}
}

const CreateAdminMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1).max(200).optional(),
	assignTo: z
		.union([
			z.literal("self"),
			z.object({
				inviteEmail: z.string().email(),
				inviteeName: z.string().max(200).optional(),
				role: z.enum(["owner", "member"]).optional(),
			}),
		])
		.optional()
		.default("self"),
});

const AssignBody = z.object({
	assignTo: z.union([
		z.literal("self"),
		z.object({
			inviteEmail: z.string().email(),
			inviteeName: z.string().max(200).optional(),
			role: z.enum(["owner", "member"]).optional(),
		}),
	]),
});

const InviteBody = z.object({
	mailboxId: z.string().email(),
	inviteEmail: z.string().email(),
	inviteeName: z.string().max(200).optional(),
	role: z.enum(["owner", "member"]).optional(),
});

const AcceptInviteBody = z.object({
	password: z.string().min(10).max(200),
	displayName: z.string().max(200).optional(),
});

const PasswordLoginBody = z.object({
	email: z.string().email(),
	password: z.string().min(1).max(200),
});

const TransferAclBody = z.object({
	owners: z.array(z.string()).min(1),
	members: z.array(z.string()).optional(),
});

function defaultSettings(name: string) {
	return {
		fromName: name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		screener: { enabled: true },
	};
}

function appBaseUrl(c: C): string {
	if (c.env.APP_BASE_URL?.trim()) return c.env.APP_BASE_URL.trim().replace(/\/$/, "");
	return new URL(c.req.url).origin;
}

function inviteFromAddress(c: C): string {
	if (c.env.INVITE_FROM_EMAIL?.trim()) return c.env.INVITE_FROM_EMAIL.trim();
	return `noreply@${resolveMailDomain(c.env)}`;
}

async function trySendInviteEmail(
	c: C,
	invite: {
		token: string;
		mailboxId: string;
		inviteeEmail: string;
		inviteeName?: string;
	},
): Promise<{ sent: boolean; inviteUrl: string; error?: string }> {
	const inviteUrl = inviteAcceptUrl(appBaseUrl(c), invite.token);
	const from = inviteFromAddress(c);
	const name = invite.inviteeName ? ` ${invite.inviteeName}` : "";
	const text = `You've been invited to ${invite.mailboxId} on Inboxies.\n\nOpen this link to set your password and get started:\n${inviteUrl}\n`;
	const html = `<p>Hi${name},</p><p>You've been invited to <strong>${invite.mailboxId}</strong> on Inboxies.</p><p><a href="${inviteUrl}">Accept invite and set your password</a></p><p>Or copy this link:<br/>${inviteUrl}</p>`;
	try {
		if (!c.env.EMAIL) {
			return { sent: false, inviteUrl, error: "EMAIL binding unavailable" };
		}
		await sendEmail(c.env.EMAIL, {
			to: invite.inviteeEmail,
			from: { email: from, name: "Inboxies" },
			subject: `You're invited to ${invite.mailboxId}`,
			text,
			html,
		});
		return { sent: true, inviteUrl };
	} catch (e) {
		return {
			sent: false,
			inviteUrl,
			error: (e as Error).message || "Failed to send invite email",
		};
	}
}

async function createPendingInvite(
	c: C,
	principal: RequestPrincipal,
	opts: {
		mailboxId: string;
		inviteEmail: string;
		inviteeName?: string;
		role?: "owner" | "member";
	},
) {
	const record = createInviteRecord({
		mailboxId: opts.mailboxId,
		inviteeEmail: opts.inviteEmail,
		inviteeName: opts.inviteeName,
		role: opts.role ?? "owner",
		createdByKeys: principalKeys(principal),
	});
	if ("error" in record) return { ok: false as const, error: record.error };
	await saveInvite(c.env.BUCKET, record);
	const delivery = await trySendInviteEmail(c, record);
	await appendAdminAudit(c.env.BUCKET, {
		actorKeys: principalKeys(principal),
		action: "invite.create",
		mailboxId: record.mailboxId,
		detail: {
			inviteeEmail: record.inviteeEmail,
			role: record.role,
			sent: delivery.sent,
		},
	});
	return {
		ok: true as const,
		invite: record,
		inviteUrl: delivery.inviteUrl,
		emailSent: delivery.sent,
		emailError: delivery.error,
	};
}

function adminMailboxRow(
	mailboxId: string,
	settings: Record<string, unknown>,
) {
	const acl = parseAcl(settings);
	return {
		id: mailboxId,
		email: mailboxId,
		name:
			typeof settings.fromName === "string" && settings.fromName
				? settings.fromName
				: mailboxId,
		acl,
		claimed: acl.owners.length > 0,
		fromName:
			typeof settings.fromName === "string" ? settings.fromName : null,
	};
}

export function registerAdminAndInviteRoutes(app: App) {
	// ── Admin mailboxes ───────────────────────────────────────────

	app.get("/api/v1/admin/mailboxes", async (c) => {
		const principal = c.get("principal");
		if (!(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const all = await listMailboxes(c.env.BUCKET);
		const rows = await Promise.all(
			all.map(async (m) => {
				const settings =
					(await loadMailboxSettingsRaw(c.env.BUCKET, m.id)) ?? {};
				return adminMailboxRow(m.id, settings);
			}),
		);
		rows.sort((a, b) => a.id.localeCompare(b.id));
		return c.json(rows);
	});

	app.post("/api/v1/admin/mailboxes", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const body = CreateAdminMailboxBody.parse(await c.req.json());
		const email = canonicalMailboxId(body.email);
		if (!email) return c.json({ error: "Invalid mailbox email address" }, 400);
		const allowed = allowedMailboxSet((c.env.EMAIL_ADDRESSES ?? []) as string[]);
		if (allowed.size > 0 && !allowed.has(email)) {
			return c.json(
				{ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" },
				403,
			);
		}
		const key = mailboxMetadataKey(email);
		if (await c.env.BUCKET.head(key)) {
			return c.json({ error: "Mailbox already exists" }, 409);
		}
		const name = body.name || email.split("@")[0] || email;
		const assignTo = body.assignTo ?? "self";
		// Always provisional-own as admin until invitee accepts — empty ACL
		// would be auto-claimable via claimIfUnclaimed.
		const ownerKeys = await ownerKeysForAssign(c.env.BUCKET, principal);
		const acl = aclFromOwnerKeys(ownerKeys);
		const settings = { ...defaultSettings(name), acl };
		await c.env.BUCKET.put(key, JSON.stringify(settings));
		const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
		await stub.reviveMailbox();
		await stub.getFolders();

		let inviteResult: Awaited<ReturnType<typeof createPendingInvite>> | null =
			null;
		if (assignTo !== "self") {
			inviteResult = await createPendingInvite(c, principal, {
				mailboxId: email,
				inviteEmail: assignTo.inviteEmail,
				inviteeName: assignTo.inviteeName,
				role: assignTo.role ?? "owner",
			});
			if (!inviteResult.ok) {
				return c.json({ error: inviteResult.error }, 400);
			}
		}

		await appendAdminAudit(c.env.BUCKET, {
			actorKeys: principalKeys(principal),
			action: "mailbox.create",
			mailboxId: email,
			detail: { assignTo: assignTo === "self" ? "self" : "invite" },
		});

		return c.json(
			{
				...mailboxAccessPayload(email, settings, principal),
				name,
				invite:
					inviteResult && inviteResult.ok
						? {
								token: inviteResult.invite.token,
								inviteUrl: inviteResult.inviteUrl,
								emailSent: inviteResult.emailSent,
								emailError: inviteResult.emailError ?? null,
								inviteeEmail: inviteResult.invite.inviteeEmail,
								role: inviteResult.invite.role,
							}
						: null,
			},
			201,
		);
	});

	app.post("/api/v1/admin/mailboxes/:mailboxId/assign", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const mailboxId = canonicalMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const settings = await loadMailboxSettingsRaw(c.env.BUCKET, mailboxId);
		if (settings === null) return c.json({ error: "Not found" }, 404);
		const body = AssignBody.parse(await c.req.json());

		if (body.assignTo === "self") {
			const ownerKeys = await ownerKeysForAssign(c.env.BUCKET, principal);
			const acl = aclFromOwnerKeys(ownerKeys);
			const next = { ...settings, acl };
			await c.env.BUCKET.put(mailboxMetadataKey(mailboxId), JSON.stringify(next));
			await appendAdminAudit(c.env.BUCKET, {
				actorKeys: principalKeys(principal),
				action: "mailbox.assign_self",
				mailboxId,
			});
			return c.json(mailboxAccessPayload(mailboxId, next, principal));
		}

		const inviteResult = await createPendingInvite(c, principal, {
			mailboxId,
			inviteEmail: body.assignTo.inviteEmail,
			inviteeName: body.assignTo.inviteeName,
			role: body.assignTo.role ?? "owner",
		});
		if (!inviteResult.ok) return c.json({ error: inviteResult.error }, 400);
		return c.json({
			mailboxId,
			invite: {
				token: inviteResult.invite.token,
				inviteUrl: inviteResult.inviteUrl,
				emailSent: inviteResult.emailSent,
				emailError: inviteResult.emailError ?? null,
				inviteeEmail: inviteResult.invite.inviteeEmail,
				role: inviteResult.invite.role,
				expiresAt: inviteResult.invite.expiresAt,
			},
		});
	});

	app.put("/api/v1/admin/mailboxes/:mailboxId/acl", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const mailboxId = canonicalMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const settings = await loadMailboxSettingsRaw(c.env.BUCKET, mailboxId);
		if (settings === null) return c.json({ error: "Not found" }, 404);
		const body = TransferAclBody.parse(await c.req.json());
		const validated = validateAclWrite({
			owners: body.owners,
			members: body.members ?? [],
		});
		if (!validated.ok) return c.json({ error: validated.error }, 400);
		const next = { ...settings, acl: validated.acl };
		await c.env.BUCKET.put(mailboxMetadataKey(mailboxId), JSON.stringify(next));
		await appendAdminAudit(c.env.BUCKET, {
			actorKeys: principalKeys(principal),
			action: "mailbox.transfer_acl",
			mailboxId,
			detail: { owners: validated.acl.owners, members: validated.acl.members },
		});
		return c.json(mailboxAccessPayload(mailboxId, next, principal));
	});

	app.delete("/api/v1/admin/mailboxes/:mailboxId", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const mailboxId = canonicalMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const settings = await loadMailboxSettingsRaw(c.env.BUCKET, mailboxId);
		if (settings === null) return c.json({ error: "Not found" }, 404);

		const stub = getMailboxStub(c.env, mailboxId);
		const { conversationIds } = await stub.purgeMailbox(mailboxId);
		const agentNames = new Set<string>([
			mailboxId,
			...conversationIds.map((id) => agentInstanceName(mailboxId, id)),
		]);
		for (const name of agentNames) {
			try {
				const agentStub = c.env.EMAIL_AGENT.get(
					c.env.EMAIL_AGENT.idFromName(name),
				);
				const purgable = agentStub as {
					purge?: () => Promise<unknown>;
					fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
				};
				if (typeof purgable.purge === "function") {
					await purgable.purge();
				} else {
					await purgable.fetch(
						new Request("https://agents/purge", { method: "POST" }),
					);
				}
			} catch (e) {
				console.error(
					`EmailAgent purge failed for ${name}:`,
					(e as Error).message,
				);
			}
		}
		await appendAdminAudit(c.env.BUCKET, {
			actorKeys: principalKeys(principal),
			action: "mailbox.delete",
			mailboxId,
		});
		return c.body(null, 204);
	});

	app.post("/api/v1/admin/invites", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const body = InviteBody.parse(await c.req.json());
		const mailboxId = canonicalMailboxId(body.mailboxId);
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const settings = await loadMailboxSettingsRaw(c.env.BUCKET, mailboxId);
		if (settings === null) return c.json({ error: "Not found" }, 404);
		const inviteResult = await createPendingInvite(c, principal, {
			mailboxId,
			inviteEmail: body.inviteEmail,
			inviteeName: body.inviteeName,
			role: body.role ?? "owner",
		});
		if (!inviteResult.ok) return c.json({ error: inviteResult.error }, 400);
		return c.json(
			{
				token: inviteResult.invite.token,
				inviteUrl: inviteResult.inviteUrl,
				emailSent: inviteResult.emailSent,
				emailError: inviteResult.emailError ?? null,
				mailboxId,
				inviteeEmail: inviteResult.invite.inviteeEmail,
				role: inviteResult.invite.role,
				expiresAt: inviteResult.invite.expiresAt,
			},
			201,
		);
	});

	app.get("/api/v1/admin/mailboxes/:mailboxId/invites", async (c) => {
		const principal = c.get("principal");
		if (!(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const mailboxId = canonicalMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const tokens = await listInviteTokensForMailbox(c.env.BUCKET, mailboxId);
		const invites = [];
		for (const token of tokens) {
			const invite = await loadInvite(c.env.BUCKET, token);
			if (!invite) continue;
			invites.push({
				...publicInvitePayload(invite),
				token: invite.token,
				createdAt: invite.createdAt,
			});
		}
		return c.json(invites);
	});

	app.post("/api/v1/admin/invites/:token/revoke", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const invite = await loadInvite(c.env.BUCKET, c.req.param("token"));
		if (!invite) return c.json({ error: "Not found" }, 404);
		if (invite.status !== "pending") {
			return c.json({ error: `Invite is ${invite.status}` }, 400);
		}
		const next = { ...invite, status: "revoked" as const };
		await saveInvite(c.env.BUCKET, next);
		await appendAdminAudit(c.env.BUCKET, {
			actorKeys: principalKeys(principal),
			action: "invite.revoke",
			mailboxId: invite.mailboxId,
			detail: { token: invite.token },
		});
		return c.json(publicInvitePayload(next));
	});

	app.post("/api/v1/admin/invites/:token/resend", async (c) => {
		const principal = c.get("principal");
		if (!principal || !(await requireDomainAdmin(c.env, principal))) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const invite = await loadInvite(c.env.BUCKET, c.req.param("token"));
		if (!invite) return c.json({ error: "Not found" }, 404);
		if (!inviteIsActive(invite)) {
			return c.json({ error: "Invite is not active" }, 400);
		}
		const delivery = await trySendInviteEmail(c, invite);
		return c.json({
			...publicInvitePayload(invite),
			token: invite.token,
			inviteUrl: delivery.inviteUrl,
			emailSent: delivery.sent,
			emailError: delivery.error ?? null,
		});
	});

	// Owner/member sharing invite (Phase 3) — creates pending invite + email
	app.post("/api/v1/mailboxes/:mailboxId/invites", async (c) => {
		const principal = c.get("principal");
		if (!principal) return c.json({ error: "Forbidden" }, 403);
		const mailboxId = canonicalMailboxId(c.req.param("mailboxId"));
		if (!mailboxId) return c.json({ error: "Invalid mailbox email address" }, 400);
		const settings = await loadMailboxSettingsRaw(c.env.BUCKET, mailboxId);
		if (settings === null) return c.json({ error: "Not found" }, 404);
		const admin = await isDomainAdmin(c.env, principal);
		if (!admin && !canManageAcl(settings, principal)) {
			return c.json({ error: "Forbidden" }, 403);
		}
		const body = z
			.object({
				inviteEmail: z.string().email(),
				inviteeName: z.string().max(200).optional(),
				role: z.enum(["owner", "member"]).optional(),
			})
			.parse(await c.req.json());
		const inviteResult = await createPendingInvite(c, principal, {
			mailboxId,
			inviteEmail: body.inviteEmail,
			inviteeName: body.inviteeName,
			role: body.role ?? "member",
		});
		if (!inviteResult.ok) return c.json({ error: inviteResult.error }, 400);
		return c.json(
			{
				token: inviteResult.invite.token,
				inviteUrl: inviteResult.inviteUrl,
				emailSent: inviteResult.emailSent,
				emailError: inviteResult.emailError ?? null,
				mailboxId,
				inviteeEmail: inviteResult.invite.inviteeEmail,
				role: inviteResult.invite.role,
				expiresAt: inviteResult.invite.expiresAt,
			},
			201,
		);
	});

	// ── Public invite + password auth ─────────────────────────────

	app.get("/api/v1/invites/:token", async (c) => {
		const invite = await loadInvite(c.env.BUCKET, c.req.param("token"));
		if (!invite) return c.json({ error: "Invite not found" }, 404);
		const payload = publicInvitePayload(invite);
		if (payload.status !== "pending") {
			return c.json({ error: `Invite is ${payload.status}`, invite: payload }, 410);
		}
		return c.json(payload);
	});

	app.post("/api/v1/invites/:token/accept", async (c) => {
		const token = c.req.param("token");
		const invite = await loadInvite(c.env.BUCKET, token);
		if (!invite) return c.json({ error: "Invite not found" }, 404);
		if (!inviteIsActive(invite)) {
			return c.json({ error: "Invite is not active" }, 410);
		}
		const body = AcceptInviteBody.parse(await c.req.json());
		const strength = validatePasswordStrength(body.password);
		if (strength) return c.json({ error: strength }, 400);

		const settings = await loadMailboxSettingsRaw(c.env.BUCKET, invite.mailboxId);
		if (settings === null) return c.json({ error: "Mailbox not found" }, 404);

		const mobileSecret =
			c.env.MOBILE_JWT_SECRET ||
			(isDevRuntime() ? "dev-mobile-jwt-secret-change-me" : "");
		if (!mobileSecret) {
			return c.json(
				{ error: "Password auth is not configured. Set MOBILE_JWT_SECRET." },
				500,
			);
		}

		// Only the first owner may claim mailbox-address password login.
		// Members (and later owners) sign in with contact email to avoid
		// overwriting platform/users-by-login/{mailbox}.
		const claimMailboxLogin = invite.role === "owner";
		if (claimMailboxLogin) {
			const existingLogin = await findUserIdByLoginEmail(
				c.env.BUCKET,
				invite.mailboxId,
			);
			if (existingLogin) {
				return c.json(
					{
						error:
							"This mailbox already has a password login. Sign in with that account, or ask an admin to reset access.",
					},
					409,
				);
			}
		}

		const userId = crypto.randomUUID();
		const passwordHash = await hashPassword(body.password);
		const now = new Date().toISOString();

		// Claim the invite before writing user/ACL so concurrent accepts lose.
		const stillPending = await loadInvite(c.env.BUCKET, token);
		if (!stillPending || !inviteIsActive(stillPending)) {
			return c.json({ error: "Invite is not active" }, 410);
		}
		const accepted = {
			...stillPending,
			status: "accepted" as const,
			acceptedAt: now,
			acceptedUserId: userId,
		};
		await saveInvite(c.env.BUCKET, accepted);

		const user: PlatformUser = {
			id: userId,
			contactEmail: invite.inviteeEmail,
			mailboxEmail: claimMailboxLogin ? invite.mailboxId : undefined,
			passwordHash,
			linkedSubs: [],
			createdAt: now,
			updatedAt: now,
		};
		await savePlatformUser(c.env.BUCKET, user);

		const userKeys = aclKeysForPlatformUser(user);
		const acl = parseAcl(settings);
		if (invite.role === "owner") {
			acl.owners = [...new Set([...acl.owners, ...userKeys])];
			acl.members = acl.members.filter((k) => !userKeys.includes(k));
		} else {
			const ownerSet = new Set(acl.owners);
			for (const k of userKeys) {
				if (!ownerSet.has(k) && !acl.members.includes(k)) acl.members.push(k);
			}
		}
		if (body.displayName?.trim()) {
			settings.fromName = body.displayName.trim();
		}
		const next = { ...settings, acl };
		await c.env.BUCKET.put(
			mailboxMetadataKey(invite.mailboxId),
			JSON.stringify(next),
		);

		const sessionEmail = claimMailboxLogin
			? invite.mailboxId
			: invite.inviteeEmail;
		const session = await issuePasswordSessionToken(mobileSecret, {
			userId,
			email: sessionEmail,
		});
		const principal = principalFromPlatformUser(user);
		c.header(
			"Set-Cookie",
			passwordSessionCookieHeader(session.token, {
				secure: !isDevRuntime(),
			}),
		);
		return c.json({
			mailboxId: invite.mailboxId,
			userId,
			token: session.token,
			expiresAt: session.expiresAt,
			principal: {
				email: principal.email ?? null,
				sub: principal.sub ?? null,
				keys: principalKeys(principal),
			},
		});
	});

	app.post("/api/v1/auth/password", async (c) => {
		const body = PasswordLoginBody.parse(await c.req.json());
		const mobileSecret =
			c.env.MOBILE_JWT_SECRET ||
			(isDevRuntime() ? "dev-mobile-jwt-secret-change-me" : "");
		if (!mobileSecret) {
			return c.json(
				{ error: "Password auth is not configured. Set MOBILE_JWT_SECRET." },
				500,
			);
		}
		const login = canonicalMailboxId(body.email) ?? body.email.toLowerCase();
		const userId = await findUserIdByLoginEmail(c.env.BUCKET, login);
		if (!userId) return c.json({ error: "Invalid email or password" }, 401);
		const user = await loadPlatformUser(c.env.BUCKET, userId);
		if (!user) return c.json({ error: "Invalid email or password" }, 401);
		const ok = await verifyPassword(body.password, user.passwordHash);
		if (!ok) return c.json({ error: "Invalid email or password" }, 401);
		const session = await issuePasswordSessionToken(mobileSecret, {
			userId: user.id,
			email: user.mailboxEmail ?? user.contactEmail,
		});
		c.header(
			"Set-Cookie",
			passwordSessionCookieHeader(session.token, {
				secure: !isDevRuntime(),
			}),
		);
		const principal = principalFromPlatformUser(user);
		return c.json({
			token: session.token,
			expiresAt: session.expiresAt,
			email: principal.email ?? null,
			sub: principal.sub ?? null,
			keys: principalKeys(principal),
		});
	});

	app.post("/api/v1/auth/password/logout", async (c) => {
		c.header(
			"Set-Cookie",
			clearPasswordSessionCookieHeader(!isDevRuntime()),
		);
		return c.json({ ok: true });
	});

	app.post("/api/v1/auth/link-provider", async (c) => {
		const principal = c.get("principal");
		if (!principal?.sub?.startsWith("user:")) {
			return c.json(
				{ error: "Only password accounts can link providers from this endpoint" },
				403,
			);
		}
		const userId = principal.sub.slice("user:".length);
		const body = z
			.object({
				provider: z.enum(["apple", "google"]),
				sub: z.string().min(1),
			})
			.parse(await c.req.json());
		const user = await loadPlatformUser(c.env.BUCKET, userId);
		if (!user) return c.json({ error: "User not found" }, 404);
		if (!user.linkedSubs.includes(body.sub)) {
			user.linkedSubs = [...user.linkedSubs, body.sub];
			user.updatedAt = new Date().toISOString();
			await savePlatformUser(c.env.BUCKET, user);
		}
		const emails = [
			user.mailboxEmail,
			user.contactEmail,
		].filter((e): e is string => Boolean(e));
		await upsertIdentityLink(c.env.BUCKET, {
			sub: body.sub,
			provider: body.provider,
			emails,
			linkedByKeys: [`user:${userId}`],
			extraPrincipals: [`user:${userId}`, ...emails.map((e) => `email:${e}`)],
		});
		return c.json({
			userId: user.id,
			linkedSubs: user.linkedSubs,
			keys: aclKeysForPlatformUser(user),
		});
	});

	/**
	 * List linked sign-in methods for the current identity account.
	 */
	app.get("/api/v1/me/identities", async (c) => {
		const principal = c.get("principal");
		if (!principal || principalKeys(principal).length === 0) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const { accountId, identities } = await listIdentitiesForPrincipal(
			c.env.BUCKET,
			principal,
		);
		return c.json({
			accountId,
			identities,
			keys: principalKeys(principal),
			linkedEmails: principal.linkedEmails ?? [],
		});
	});

	/**
	 * In-session Connect IdP / Add password: attach a freshly verified
	 * Apple/Google identity token (or a new password) to the durable account
	 * for this authenticated session. Primary linking UX; link codes remain
	 * for cross-device / when IdP cannot run on this surface.
	 */
	app.post("/api/v1/me/identities/attach", async (c) => {
		const principal = c.get("principal");
		if (!principal || principalKeys(principal).length === 0) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const body = z
			.discriminatedUnion("provider", [
				z.object({
					provider: z.literal("apple"),
					identityToken: z.string().min(1),
				}),
				z.object({
					provider: z.literal("google"),
					idToken: z.string().min(1),
				}),
				z.object({
					provider: z.literal("password"),
					password: z.string().min(1),
					loginEmail: z.string().email().optional(),
				}),
			])
			.safeParse(await c.req.json());
		if (!body.success) {
			return c.json(
				{
					error:
						"Invalid body. Use provider apple|google|password with the matching token/password fields.",
				},
				400,
			);
		}

		try {
			if (body.data.provider === "apple") {
				const appleClientId = c.env.APPLE_CLIENT_ID;
				if (!appleClientId) {
					return c.json(
						{
							error:
								"Apple Sign In is not configured. Set APPLE_CLIENT_ID.",
						},
						503,
					);
				}
				const claims = await verifyAppleIdentityToken(
					body.data.identityToken,
					appleClientId,
				);
				const result = await attachIdpToSessionAccount(
					c.env.BUCKET,
					principal,
					{
						sub: claims.sub,
						provider: "apple",
						emails: claims.email ? [claims.email] : [],
					},
				);
				c.set("principal", result.expanded);
				const admin = await isDomainAdmin(c.env, result.expanded);
				return c.json({
					ok: true,
					provider: "apple",
					accountId: result.account.id,
					linkedEmails: result.linkedEmails,
					keys: principalKeys(result.expanded),
					isAdmin: admin,
					identities: (
						await listIdentitiesForPrincipal(c.env.BUCKET, result.expanded)
					).identities,
				});
			}

			if (body.data.provider === "google") {
				const googleClientId = c.env.GOOGLE_CLIENT_ID;
				if (!googleClientId) {
					return c.json(
						{
							error:
								"Google Sign In is not configured. Set GOOGLE_CLIENT_ID.",
						},
						503,
					);
				}
				const claims = await verifyGoogleIdentityToken(
					body.data.idToken,
					googleClientId,
				);
				const result = await attachIdpToSessionAccount(
					c.env.BUCKET,
					principal,
					{
						sub: claims.sub,
						provider: "google",
						emails: claims.email ? [claims.email] : [],
					},
				);
				c.set("principal", result.expanded);
				const admin = await isDomainAdmin(c.env, result.expanded);
				return c.json({
					ok: true,
					provider: "google",
					accountId: result.account.id,
					linkedEmails: result.linkedEmails,
					keys: principalKeys(result.expanded),
					isAdmin: admin,
					identities: (
						await listIdentitiesForPrincipal(c.env.BUCKET, result.expanded)
					).identities,
				});
			}

			const strength = validatePasswordStrength(body.data.password);
			if (strength) return c.json({ error: strength }, 400);
			const passwordHash = await hashPassword(body.data.password);
			const result = await attachPasswordToSessionAccount(
				c.env.BUCKET,
				principal,
				{
					passwordHash,
					loginEmail: body.data.loginEmail,
				},
			);
			c.set("principal", result.expanded);
			const admin = await isDomainAdmin(c.env, result.expanded);
			return c.json({
				ok: true,
				provider: "password",
				accountId: result.account.id,
				userId: result.userId,
				linkedEmails: result.linkedEmails,
				keys: principalKeys(result.expanded),
				isAdmin: admin,
				identities: (
					await listIdentitiesForPrincipal(c.env.BUCKET, result.expanded)
				).identities,
			});
		} catch (err) {
			if (err instanceof IdentityAlreadyLinkedError) {
				return c.json({ error: err.message }, 409);
			}
			const message =
				err instanceof Error ? err.message : "Could not attach identity";
			if (message === "Unauthorized") {
				return c.json({ error: message }, 401);
			}
			if (
				message.includes("already has a password") ||
				message.includes("loginEmail is required") ||
				message.includes("already has a password login")
			) {
				return c.json({ error: message }, 409);
			}
			// Token verify failures from jose / our helpers
			if (
				message.includes("identity token") ||
				message.includes("JWT") ||
				message.includes("claim") ||
				message.includes("audience") ||
				message.toLowerCase().includes("invalid")
			) {
				return c.json({ error: "Invalid identity token" }, 401);
			}
			console.error("attach identity failed:", message);
			return c.json({ error: message }, 400);
		}
	});

	/**
	 * Change password for the password sign-in method on this account.
	 * Works from any authenticated session (Access / Apple / Google / password)
	 * as long as the account already has a password. Requires the current
	 * password — not a password-session-only path.
	 */
	app.post("/api/v1/me/identities/password", async (c) => {
		const principal = c.get("principal");
		if (!principal || principalKeys(principal).length === 0) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const body = z
			.object({
				currentPassword: z.string().min(1).max(200),
				newPassword: z.string().min(1).max(200),
			})
			.safeParse(await c.req.json());
		if (!body.success) {
			return c.json(
				{
					error:
						"Invalid body. Provide currentPassword and newPassword.",
				},
				400,
			);
		}

		const strength = validatePasswordStrength(body.data.newPassword);
		if (strength) return c.json({ error: strength }, 400);
		if (body.data.currentPassword === body.data.newPassword) {
			return c.json(
				{ error: "New password must be different from the current password" },
				400,
			);
		}

		try {
			const user = await passwordUserForSessionAccount(
				c.env.BUCKET,
				principal,
			);
			if (!user) {
				return c.json(
					{ error: "This account has no password sign-in method" },
					404,
				);
			}
			const currentOk = await verifyPassword(
				body.data.currentPassword,
				user.passwordHash,
			);
			if (!currentOk) {
				return c.json({ error: "Current password is incorrect" }, 401);
			}
			const passwordHash = await hashPassword(body.data.newPassword);
			const result = await updatePasswordHashForSessionAccount(
				c.env.BUCKET,
				principal,
				passwordHash,
			);
			await appendAdminAudit(c.env.BUCKET, {
				actorKeys: principalKeys(principal),
				action: "identity.password.change",
				detail: { userId: result.userId, accountId: result.account.id },
			});
			return c.json({
				ok: true,
				userId: result.userId,
				accountId: result.account.id,
				identities: (
					await listIdentitiesForPrincipal(c.env.BUCKET, principal)
				).identities,
			});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Could not change password";
			if (message === "Unauthorized") {
				return c.json({ error: message }, 401);
			}
			if (message.includes("no password sign-in method")) {
				return c.json({ error: message }, 404);
			}
			console.error("change password failed:", message);
			return c.json({ error: message }, 400);
		}
	});

	/**
	 * Any authenticated session: mint a short-lived code so another sign-in
	 * method (Apple / Google / Access / password) can join this account.
	 * Domain Admins also stamp DOMAIN_ADMINS emails onto the code.
	 * Secondary / cross-device fallback — prefer POST /me/identities/attach.
	 */
	app.post("/api/v1/me/identity-link-codes", async (c) => {
		const principal = c.get("principal");
		if (!principal || principalKeys(principal).length === 0) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		try {
			const record = await mintIdentityLinkCode(c.env, principal);
			await appendAdminAudit(c.env.BUCKET, {
				actorKeys: principalKeys(principal),
				action: "identity_link_code.create",
				detail: {
					emails: record.emails,
					accountId: record.accountId,
					principals: record.principals,
				},
			});
			return c.json({
				code: record.code,
				emails: record.emails,
				principals: record.principals ?? [],
				accountId: record.accountId,
				expiresAt: record.expiresAt,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : "Could not create link code";
			return c.json({ error: message }, 400);
		}
	});

	/**
	 * Authenticated session (Apple/Google/Access/password): redeem a link code
	 * minted by another method on the same person → durable account union.
	 * After redeem, /me and GET /mailboxes use the union of linked principals.
	 */
	app.post("/api/v1/auth/redeem-identity-link", async (c) => {
		const principal = c.get("principal");
		if (!principal || principalKeys(principal).length === 0) {
			return c.json({ error: "Unauthorized" }, 401);
		}
		const body = z.object({ code: z.string().min(4).max(64) }).parse(await c.req.json());
		try {
			const result = await redeemIdentityLinkCode(
				c.env.BUCKET,
				principal,
				body.code,
			);
			const admin = await isDomainAdmin(c.env, result.expanded);
			c.set("principal", result.expanded);
			return c.json({
				ok: true,
				accountId: result.account.id,
				linkedEmails: result.linkedEmails,
				sub: principal.sub ?? null,
				keys: principalKeys(result.expanded),
				isAdmin: admin,
				identities: (
					await listIdentitiesForPrincipal(c.env.BUCKET, result.expanded)
				).identities,
			});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Could not redeem link code";
			const status =
				message === "Unauthorized"
					? 401
					: message.includes("Invalid or expired")
						? 400
						: 400;
			return c.json({ error: message }, status);
		}
	});
}

/** Shared helpers for create-policy checks from index.ts */
export async function resolveCreateGate(
	env: Env,
	principal: RequestPrincipal | undefined,
) {
	const allowlist = await resolveAdminAllowlist(env);
	const hasAdmins = allowlist.size > 0;
	const policy = parseMailboxCreatePolicy(env.MAILBOX_CREATE_POLICY, hasAdmins);
	const admin = principalIsDomainAdmin(principal, allowlist);
	return {
		policy,
		isAdmin: admin,
		allowed: canCreateMailbox(principal, { isAdmin: admin, policy }),
	};
}
