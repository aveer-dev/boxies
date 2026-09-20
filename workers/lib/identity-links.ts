// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Durable identity links: Apple/Google `sub` ↔ verified emails (Domain Admin /
 * mailbox ACL). Fixes Access email principals vs mobile private-relay / hide-email.
 *
 * R2:
 * - platform/identity-links/by-sub/{sub}.json
 * - platform/identity-links/by-email/{email}.json  → { subs: string[] }
 * - platform/identity-link-codes/{code}.json
 */

import { normalizeEmailAddress } from "./mail-automations.ts";
import {
	normalizeAclKey,
	principalKeys,
	type RequestPrincipal,
} from "./mailbox-acl.ts";
import {
	principalIsDomainAdmin,
	resolveAdminAllowlist,
} from "./domain-admin.ts";

export const IDENTITY_LINK_BY_SUB_PREFIX = "platform/identity-links/by-sub/";
export const IDENTITY_LINK_BY_EMAIL_PREFIX = "platform/identity-links/by-email/";
export const IDENTITY_LINK_CODES_PREFIX = "platform/identity-link-codes/";

export const IDENTITY_LINK_CODE_TTL_MS = 15 * 60 * 1000;

export type IdentityLinkRecord = {
	sub: string;
	provider: "apple" | "google" | "dev" | "unknown";
	emails: string[];
	linkedAt: string;
	updatedAt: string;
	linkedByKeys: string[];
};

export type IdentityLinkCode = {
	code: string;
	emails: string[];
	createdByKeys: string[];
	createdAt: string;
	expiresAt: string;
	usedAt?: string;
	usedBySub?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function identityLinkBySubKey(sub: string): string {
	return `${IDENTITY_LINK_BY_SUB_PREFIX}${encodeURIComponent(sub)}.json`;
}

export function identityLinkByEmailKey(email: string): string {
	const normalized = normalizeEmailAddress(email) ?? email.toLowerCase();
	return `${IDENTITY_LINK_BY_EMAIL_PREFIX}${normalized}.json`;
}

export function identityLinkCodeKey(code: string): string {
	return `${IDENTITY_LINK_CODES_PREFIX}${code}.json`;
}

export function parseIdentityLink(raw: unknown): IdentityLinkRecord | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.sub !== "string" || !raw.sub.trim()) return null;
	const emails = Array.isArray(raw.emails)
		? raw.emails
				.filter((e): e is string => typeof e === "string")
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e))
		: [];
	const provider =
		raw.provider === "apple" ||
		raw.provider === "google" ||
		raw.provider === "dev"
			? raw.provider
			: "unknown";
	const linkedByKeys = Array.isArray(raw.linkedByKeys)
		? raw.linkedByKeys.filter((k): k is string => typeof k === "string")
		: [];
	return {
		sub: raw.sub.trim(),
		provider,
		emails: [...new Set(emails)],
		linkedAt:
			typeof raw.linkedAt === "string" ? raw.linkedAt : new Date().toISOString(),
		updatedAt:
			typeof raw.updatedAt === "string"
				? raw.updatedAt
				: new Date().toISOString(),
		linkedByKeys,
	};
}

export function parseIdentityLinkCode(raw: unknown): IdentityLinkCode | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.code !== "string" || !raw.code) return null;
	const emails = Array.isArray(raw.emails)
		? raw.emails
				.filter((e): e is string => typeof e === "string")
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e))
		: [];
	if (emails.length === 0) return null;
	const createdByKeys = Array.isArray(raw.createdByKeys)
		? raw.createdByKeys.filter((k): k is string => typeof k === "string")
		: [];
	if (typeof raw.createdAt !== "string" || typeof raw.expiresAt !== "string") {
		return null;
	}
	return {
		code: raw.code,
		emails: [...new Set(emails)],
		createdByKeys,
		createdAt: raw.createdAt,
		expiresAt: raw.expiresAt,
		usedAt: typeof raw.usedAt === "string" ? raw.usedAt : undefined,
		usedBySub: typeof raw.usedBySub === "string" ? raw.usedBySub : undefined,
	};
}

export async function loadIdentityLinkBySub(
	bucket: R2Bucket,
	sub: string,
): Promise<IdentityLinkRecord | null> {
	if (!sub.trim()) return null;
	const obj = await bucket.get(identityLinkBySubKey(sub));
	if (!obj) return null;
	try {
		return parseIdentityLink(await obj.json());
	} catch {
		return null;
	}
}

export async function loadSubsForEmail(
	bucket: R2Bucket,
	email: string,
): Promise<string[]> {
	const normalized = normalizeEmailAddress(email);
	if (!normalized) return [];
	const obj = await bucket.get(identityLinkByEmailKey(normalized));
	if (!obj) return [];
	try {
		const parsed = await obj.json();
		if (!isRecord(parsed) || !Array.isArray(parsed.subs)) return [];
		return parsed.subs.filter(
			(s): s is string => typeof s === "string" && Boolean(s.trim()),
		);
	} catch {
		return [];
	}
}

async function writeEmailIndex(
	bucket: R2Bucket,
	email: string,
	subs: string[],
): Promise<void> {
	const normalized = normalizeEmailAddress(email);
	if (!normalized) return;
	await bucket.put(
		identityLinkByEmailKey(normalized),
		JSON.stringify({ email: normalized, subs: [...new Set(subs)] }),
	);
}

/** Merge emails onto an Apple/Google (or other) sub identity link. */
export async function upsertIdentityLink(
	bucket: R2Bucket,
	opts: {
		sub: string;
		provider: IdentityLinkRecord["provider"];
		emails: string[];
		linkedByKeys?: string[];
	},
): Promise<IdentityLinkRecord> {
	const sub = opts.sub.trim();
	const emails = [
		...new Set(
			opts.emails
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e)),
		),
	];
	const existing = await loadIdentityLinkBySub(bucket, sub);
	const now = new Date().toISOString();
	const mergedEmails = [...new Set([...(existing?.emails ?? []), ...emails])];
	const record: IdentityLinkRecord = {
		sub,
		provider: opts.provider === "unknown" && existing ? existing.provider : opts.provider,
		emails: mergedEmails,
		linkedAt: existing?.linkedAt ?? now,
		updatedAt: now,
		linkedByKeys: [
			...new Set([
				...(existing?.linkedByKeys ?? []),
				...(opts.linkedByKeys ?? []),
			]),
		],
	};
	await bucket.put(identityLinkBySubKey(sub), JSON.stringify(record));

	for (const email of mergedEmails) {
		const prior = await loadSubsForEmail(bucket, email);
		if (!prior.includes(sub)) {
			await writeEmailIndex(bucket, email, [...prior, sub]);
		}
	}
	return record;
}

/**
 * Expand a session principal with emails linked to its `sub`.
 * Does not trust arbitrary clients — only R2-stored links.
 */
export async function expandPrincipalWithLinks(
	bucket: R2Bucket,
	principal: RequestPrincipal,
): Promise<RequestPrincipal> {
	if (!principal.sub) return principal;
	const link = await loadIdentityLinkBySub(bucket, principal.sub);
	if (!link || link.emails.length === 0) return principal;

	const linkedEmails = [
		...new Set([
			...(principal.linkedEmails ?? []),
			...link.emails,
		]),
	];
	// Prefer session email; else first linked email for display / claim helpers.
	const email = principal.email ?? linkedEmails[0];
	return { ...principal, email, linkedEmails };
}

/** Emails associated with a principal (session + linked). */
export function emailsForPrincipal(principal: RequestPrincipal): string[] {
	const out = new Set<string>();
	if (principal.email) {
		const n = normalizeEmailAddress(principal.email);
		if (n) out.add(n);
	}
	for (const e of principal.linkedEmails ?? []) {
		const n = normalizeEmailAddress(e);
		if (n) out.add(n);
	}
	return [...out];
}

/**
 * Owner keys for assign-to-me / create: session keys plus reverse-linked
 * IdP subs for each email (so web Access assign also stamps Apple `sub:`).
 */
export async function ownerKeysForAssign(
	bucket: R2Bucket,
	principal: RequestPrincipal,
): Promise<string[]> {
	const keys = new Set(principalKeys(principal));
	for (const email of emailsForPrincipal(principal)) {
		const subs = await loadSubsForEmail(bucket, email);
		for (const sub of subs) {
			if (sub.trim()) keys.add(`sub:${sub.trim()}`);
		}
	}
	return [...keys];
}

export function createIdentityLinkCode(opts: {
	emails: string[];
	createdByKeys: string[];
	nowMs?: number;
}): IdentityLinkCode {
	const emails = [
		...new Set(
			opts.emails
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e)),
		),
	];
	if (emails.length === 0) {
		throw new Error("identity link code requires at least one email");
	}
	const now = opts.nowMs ?? Date.now();
	const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
	return {
		code,
		emails,
		createdByKeys: opts.createdByKeys,
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + IDENTITY_LINK_CODE_TTL_MS).toISOString(),
	};
}

export function identityLinkCodeIsActive(
	code: IdentityLinkCode,
	nowMs = Date.now(),
): boolean {
	if (code.usedAt) return false;
	return Date.parse(code.expiresAt) > nowMs;
}

export async function saveIdentityLinkCode(
	bucket: R2Bucket,
	record: IdentityLinkCode,
): Promise<void> {
	await bucket.put(identityLinkCodeKey(record.code), JSON.stringify(record));
}

export async function loadIdentityLinkCode(
	bucket: R2Bucket,
	code: string,
): Promise<IdentityLinkCode | null> {
	const obj = await bucket.get(identityLinkCodeKey(code));
	if (!obj) return null;
	try {
		return parseIdentityLinkCode(await obj.json());
	} catch {
		return null;
	}
}

/**
 * If the IdP email is on DOMAIN_ADMINS (or R2 admins), auto-link sub → email.
 * Safe: only links when the verified token email is already an admin allowlist key.
 */
export async function autoLinkSubIfAdminEmail(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	opts: {
		sub: string;
		email?: string;
		provider: IdentityLinkRecord["provider"];
	},
): Promise<IdentityLinkRecord | null> {
	const email = opts.email
		? (normalizeEmailAddress(opts.email) ?? undefined)
		: undefined;
	if (!email || !opts.sub.trim()) return null;

	const allowlist = await resolveAdminAllowlist(env);
	const emailKey = normalizeAclKey(email) ?? `email:${email}`;
	if (!allowlist.has(emailKey)) return null;

	return upsertIdentityLink(env.BUCKET, {
		sub: opts.sub,
		provider: opts.provider,
		emails: [email],
		linkedByKeys: ["auto:admin-email-match"],
	});
}

/**
 * For a Domain Admin creating a link code: stamp session emails plus every
 * `email:` entry on DOMAIN_ADMINS / R2 admins. Hide-my-email Apple sessions
 * can then redeem and inherit the Gmail admin identity.
 */
export async function resolveAdminLinkEmails(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	principal: RequestPrincipal,
): Promise<string[]> {
	const allowlist = await resolveAdminAllowlist(env);
	if (!principalIsDomainAdmin(principal, allowlist)) return [];

	const emails = new Set(emailsForPrincipal(principal));
	for (const key of allowlist) {
		if (key.startsWith("email:")) {
			emails.add(key.slice("email:".length));
		}
	}
	return [...emails];
}
