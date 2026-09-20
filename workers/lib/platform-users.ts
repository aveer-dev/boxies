// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Password / linked IdP user records in R2 under platform/users/.
 * Principal keys: `user:<uuid>` plus optional contact `email:` and IdP `sub:`.
 */

import { normalizeEmailAddress } from "./mail-automations.ts";
import { canonicalMailboxId } from "./mailbox-routing.ts";
import type { RequestPrincipal } from "./mailbox-acl.ts";

export const PLATFORM_USERS_PREFIX = "platform/users/";
export const PLATFORM_USERS_BY_EMAIL_PREFIX = "platform/users-by-email/";
export const PLATFORM_USERS_BY_LOGIN_PREFIX = "platform/users-by-login/";

export type PlatformUser = {
	id: string;
	/** Contact / notification email (invite destination). */
	contactEmail: string;
	/** Primary mailbox address this user owns (login email for password). */
	mailboxEmail?: string;
	passwordHash: string;
	/** Linked IdP subs (Apple/Google), stored without prefix. */
	linkedSubs: string[];
	createdAt: string;
	updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function userR2Key(userId: string): string {
	return `${PLATFORM_USERS_PREFIX}${userId}.json`;
}

export function userByEmailKey(email: string): string {
	const normalized = normalizeEmailAddress(email) ?? email.toLowerCase();
	return `${PLATFORM_USERS_BY_EMAIL_PREFIX}${normalized}.json`;
}

export function userByLoginKey(loginEmail: string): string {
	const canonical = canonicalMailboxId(loginEmail) ?? loginEmail.toLowerCase();
	return `${PLATFORM_USERS_BY_LOGIN_PREFIX}${canonical}.json`;
}

export function parsePlatformUser(raw: unknown): PlatformUser | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (typeof raw.contactEmail !== "string") return null;
	if (typeof raw.passwordHash !== "string") return null;
	const linkedSubs = Array.isArray(raw.linkedSubs)
		? raw.linkedSubs.filter((s): s is string => typeof s === "string")
		: [];
	return {
		id: raw.id,
		contactEmail: raw.contactEmail,
		mailboxEmail:
			typeof raw.mailboxEmail === "string" ? raw.mailboxEmail : undefined,
		passwordHash: raw.passwordHash,
		linkedSubs,
		createdAt:
			typeof raw.createdAt === "string"
				? raw.createdAt
				: new Date().toISOString(),
		updatedAt:
			typeof raw.updatedAt === "string"
				? raw.updatedAt
				: new Date().toISOString(),
	};
}

export async function loadPlatformUser(
	bucket: R2Bucket,
	userId: string,
): Promise<PlatformUser | null> {
	const obj = await bucket.get(userR2Key(userId));
	if (!obj) return null;
	try {
		return parsePlatformUser(await obj.json());
	} catch {
		return null;
	}
}

export async function findUserIdByLoginEmail(
	bucket: R2Bucket,
	loginEmail: string,
): Promise<string | null> {
	const byLogin = await bucket.get(userByLoginKey(loginEmail));
	if (byLogin) {
		try {
			const parsed = await byLogin.json();
			if (isRecord(parsed) && typeof parsed.userId === "string") {
				return parsed.userId;
			}
		} catch {
			/* ignore */
		}
	}
	// Members (no mailbox login claim) authenticate with invite contact email.
	const byEmail = await bucket.get(userByEmailKey(loginEmail));
	if (!byEmail) return null;
	try {
		const parsed = await byEmail.json();
		if (isRecord(parsed) && typeof parsed.userId === "string") {
			return parsed.userId;
		}
	} catch {
		/* ignore */
	}
	return null;
}

export async function savePlatformUser(
	bucket: R2Bucket,
	user: PlatformUser,
): Promise<void> {
	await bucket.put(userR2Key(user.id), JSON.stringify(user));
	const contact = normalizeEmailAddress(user.contactEmail);
	if (contact) {
		await bucket.put(
			userByEmailKey(contact),
			JSON.stringify({ userId: user.id }),
		);
	}
	if (user.mailboxEmail) {
		await bucket.put(
			userByLoginKey(user.mailboxEmail),
			JSON.stringify({ userId: user.id }),
		);
	}
}

export function principalFromPlatformUser(
	user: PlatformUser,
): RequestPrincipal {
	return {
		email: user.mailboxEmail
			? (canonicalMailboxId(user.mailboxEmail) ?? user.mailboxEmail)
			: (normalizeEmailAddress(user.contactEmail) ?? undefined),
		sub: `user:${user.id}`,
	};
}

/** ACL owner keys written when an invitee accepts. */
export function aclKeysForPlatformUser(user: PlatformUser): string[] {
	const keys = new Set<string>();
	keys.add(`user:${user.id}`);
	if (user.mailboxEmail) {
		const mailbox = canonicalMailboxId(user.mailboxEmail) ?? user.mailboxEmail;
		keys.add(`email:${mailbox}`);
	}
	for (const sub of user.linkedSubs) {
		if (sub.trim()) keys.add(`sub:${sub.trim()}`);
	}
	return [...keys];
}
