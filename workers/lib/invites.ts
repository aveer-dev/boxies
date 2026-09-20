// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Pending mailbox invites stored in R2.
 */

import { normalizeEmailAddress } from "./mail-automations.ts";
import { canonicalMailboxId } from "./mailbox-routing.ts";

export const PLATFORM_INVITES_PREFIX = "platform/invites/";
export const PLATFORM_INVITES_BY_MAILBOX_PREFIX = "platform/invites-by-mailbox/";

export type InviteRole = "owner" | "member";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export type MailboxInvite = {
	token: string;
	mailboxId: string;
	role: InviteRole;
	inviteeEmail: string;
	inviteeName?: string;
	createdByKeys: string[];
	createdAt: string;
	expiresAt: string;
	status: InviteStatus;
	acceptedAt?: string;
	acceptedUserId?: string;
};

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function inviteR2Key(token: string): string {
	return `${PLATFORM_INVITES_PREFIX}${token}.json`;
}

export function inviteByMailboxKey(mailboxId: string, token: string): string {
	const id = canonicalMailboxId(mailboxId) ?? mailboxId;
	return `${PLATFORM_INVITES_BY_MAILBOX_PREFIX}${id}/${token}.json`;
}

export function parseInvite(raw: unknown): MailboxInvite | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.token !== "string" || !raw.token) return null;
	if (typeof raw.mailboxId !== "string" || !raw.mailboxId) return null;
	if (raw.role !== "owner" && raw.role !== "member") return null;
	if (typeof raw.inviteeEmail !== "string") return null;
	if (
		raw.status !== "pending" &&
		raw.status !== "accepted" &&
		raw.status !== "revoked" &&
		raw.status !== "expired"
	) {
		return null;
	}
	const createdByKeys = Array.isArray(raw.createdByKeys)
		? raw.createdByKeys.filter((k): k is string => typeof k === "string")
		: [];
	return {
		token: raw.token,
		mailboxId: raw.mailboxId,
		role: raw.role,
		inviteeEmail: raw.inviteeEmail,
		inviteeName:
			typeof raw.inviteeName === "string" ? raw.inviteeName : undefined,
		createdByKeys,
		createdAt:
			typeof raw.createdAt === "string"
				? raw.createdAt
				: new Date().toISOString(),
		expiresAt:
			typeof raw.expiresAt === "string"
				? raw.expiresAt
				: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
		status: raw.status,
		acceptedAt:
			typeof raw.acceptedAt === "string" ? raw.acceptedAt : undefined,
		acceptedUserId:
			typeof raw.acceptedUserId === "string" ? raw.acceptedUserId : undefined,
	};
}

export function generateInviteToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

export function createInviteRecord(input: {
	mailboxId: string;
	inviteeEmail: string;
	inviteeName?: string;
	role?: InviteRole;
	createdByKeys: string[];
	ttlMs?: number;
}): MailboxInvite | { error: string } {
	const mailboxId = canonicalMailboxId(input.mailboxId);
	if (!mailboxId) return { error: "Invalid mailbox email address" };
	const inviteeEmail = normalizeEmailAddress(input.inviteeEmail);
	if (!inviteeEmail) return { error: "Invalid invitee email" };
	const now = Date.now();
	const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
	return {
		token: generateInviteToken(),
		mailboxId,
		role: input.role ?? "owner",
		inviteeEmail,
		inviteeName: input.inviteeName?.trim() || undefined,
		createdByKeys: input.createdByKeys,
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + ttl).toISOString(),
		status: "pending",
	};
}

export async function saveInvite(
	bucket: R2Bucket,
	invite: MailboxInvite,
): Promise<void> {
	await bucket.put(inviteR2Key(invite.token), JSON.stringify(invite));
	await bucket.put(
		inviteByMailboxKey(invite.mailboxId, invite.token),
		JSON.stringify({ token: invite.token }),
	);
}

export async function loadInvite(
	bucket: R2Bucket,
	token: string,
): Promise<MailboxInvite | null> {
	if (!token || !/^[a-f0-9]{32,64}$/i.test(token)) return null;
	const obj = await bucket.get(inviteR2Key(token));
	if (!obj) return null;
	try {
		return parseInvite(await obj.json());
	} catch {
		return null;
	}
}

export function inviteIsActive(invite: MailboxInvite, now = Date.now()): boolean {
	if (invite.status !== "pending") return false;
	return new Date(invite.expiresAt).getTime() > now;
}

export function publicInvitePayload(invite: MailboxInvite) {
	return {
		mailboxId: invite.mailboxId,
		role: invite.role,
		inviteeEmail: invite.inviteeEmail,
		inviteeName: invite.inviteeName ?? null,
		expiresAt: invite.expiresAt,
		status: inviteIsActive(invite) ? invite.status : "expired",
	};
}

export async function listInviteTokensForMailbox(
	bucket: R2Bucket,
	mailboxId: string,
): Promise<string[]> {
	const id = canonicalMailboxId(mailboxId) ?? mailboxId;
	const prefix = `${PLATFORM_INVITES_BY_MAILBOX_PREFIX}${id}/`;
	const listed = await bucket.list({ prefix });
	const tokens: string[] = [];
	for (const obj of listed.objects) {
		const token = obj.key.slice(prefix.length).replace(/\.json$/, "");
		if (token) tokens.push(token);
	}
	return tokens;
}

export function inviteAcceptUrl(baseUrl: string, token: string): string {
	const base = baseUrl.replace(/\/$/, "");
	return `${base}/invite/${token}`;
}
