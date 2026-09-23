// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Durable linked identities: one Inboxies account ↔ set of principals
 * (`email:`, `sub:`, `user:`). Powers Domain Admin + mailbox ACL union across
 * Access, Apple, Google, and password sessions.
 *
 * R2:
 * - platform/identity-accounts/{accountId}.json
 * - platform/identity-accounts-by-key/{encodedPrincipal}.json → { accountId }
 * - platform/identity-links/by-sub/{sub}.json          (legacy + expand index)
 * - platform/identity-links/by-email/{email}.json      → { subs: string[] }
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
import { canonicalMailboxId } from "./mailbox-routing.ts";
import {
	findUserIdByLoginEmail,
	loadPlatformUser,
	savePlatformUser,
	type PlatformUser,
} from "./platform-users.ts";

export const IDENTITY_ACCOUNT_PREFIX = "platform/identity-accounts/";
export const IDENTITY_ACCOUNT_BY_KEY_PREFIX =
	"platform/identity-accounts-by-key/";
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
	accountId?: string;
};

export type IdentityAccount = {
	id: string;
	/** Normalized ACL principals: email:…, sub:…, user:… */
	principals: string[];
	primaryEmail?: string;
	createdAt: string;
	updatedAt: string;
};

export type IdentityLinkCode = {
	code: string;
	/** Account the redeemer joins (preferred). */
	accountId?: string;
	/** Snapshot of minter principals / emails (legacy codes use emails only). */
	emails: string[];
	principals?: string[];
	createdByKeys: string[];
	createdAt: string;
	expiresAt: string;
	usedAt?: string;
	usedBySub?: string;
	usedByKeys?: string[];
};

export type LinkedIdentityView = {
	type: "email" | "apple" | "google" | "password" | "sub" | "access";
	key: string;
	label: string;
	current: boolean;
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

export function identityAccountKey(accountId: string): string {
	return `${IDENTITY_ACCOUNT_PREFIX}${accountId}.json`;
}

export function identityAccountByKeyKey(principalKey: string): string {
	return `${IDENTITY_ACCOUNT_BY_KEY_PREFIX}${encodeURIComponent(principalKey)}.json`;
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
		accountId: typeof raw.accountId === "string" ? raw.accountId : undefined,
	};
}

export function parseIdentityAccount(raw: unknown): IdentityAccount | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.id !== "string" || !raw.id.trim()) return null;
	const principals = Array.isArray(raw.principals)
		? uniquePrincipalKeys(
				raw.principals.filter((k): k is string => typeof k === "string"),
			)
		: [];
	if (principals.length === 0) return null;
	const primaryEmail =
		typeof raw.primaryEmail === "string"
			? (normalizeEmailAddress(raw.primaryEmail) ?? undefined)
			: undefined;
	return {
		id: raw.id.trim(),
		principals,
		primaryEmail,
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

export function parseIdentityLinkCode(raw: unknown): IdentityLinkCode | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.code !== "string" || !raw.code) return null;
	const emails = Array.isArray(raw.emails)
		? raw.emails
				.filter((e): e is string => typeof e === "string")
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e))
		: [];
	const principals = Array.isArray(raw.principals)
		? uniquePrincipalKeys(
				raw.principals.filter((k): k is string => typeof k === "string"),
			)
		: [];
	if (emails.length === 0 && principals.length === 0 && !raw.accountId) {
		return null;
	}
	const createdByKeys = Array.isArray(raw.createdByKeys)
		? raw.createdByKeys.filter((k): k is string => typeof k === "string")
		: [];
	if (typeof raw.createdAt !== "string" || typeof raw.expiresAt !== "string") {
		return null;
	}
	return {
		code: raw.code,
		accountId: typeof raw.accountId === "string" ? raw.accountId : undefined,
		emails: [...new Set(emails)],
		principals: principals.length > 0 ? principals : undefined,
		createdByKeys,
		createdAt: raw.createdAt,
		expiresAt: raw.expiresAt,
		usedAt: typeof raw.usedAt === "string" ? raw.usedAt : undefined,
		usedBySub: typeof raw.usedBySub === "string" ? raw.usedBySub : undefined,
		usedByKeys: Array.isArray(raw.usedByKeys)
			? raw.usedByKeys.filter((k): k is string => typeof k === "string")
			: undefined,
	};
}

function uniquePrincipalKeys(keys: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const key of keys) {
		const normalized = normalizeAclKey(key);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}

/** Session keys that seed / resolve an identity account. */
export function accountSeedKeys(principal: RequestPrincipal): string[] {
	return uniquePrincipalKeys(principalKeys(principal));
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

export async function loadIdentityAccount(
	bucket: R2Bucket,
	accountId: string,
): Promise<IdentityAccount | null> {
	const obj = await bucket.get(identityAccountKey(accountId));
	if (!obj) return null;
	try {
		return parseIdentityAccount(await obj.json());
	} catch {
		return null;
	}
}

export async function findAccountIdByPrincipalKey(
	bucket: R2Bucket,
	principalKey: string,
): Promise<string | null> {
	const normalized = normalizeAclKey(principalKey);
	if (!normalized) return null;
	const obj = await bucket.get(identityAccountByKeyKey(normalized));
	if (!obj) return null;
	try {
		const parsed = await obj.json();
		if (isRecord(parsed) && typeof parsed.accountId === "string") {
			return parsed.accountId;
		}
	} catch {
		/* ignore */
	}
	return null;
}

async function indexAccountKeys(
	bucket: R2Bucket,
	account: IdentityAccount,
): Promise<void> {
	for (const key of account.principals) {
		await bucket.put(
			identityAccountByKeyKey(key),
			JSON.stringify({ accountId: account.id }),
		);
	}
}

export async function saveIdentityAccount(
	bucket: R2Bucket,
	account: IdentityAccount,
): Promise<void> {
	await bucket.put(identityAccountKey(account.id), JSON.stringify(account));
	await indexAccountKeys(bucket, account);
}

/**
 * Resolve an existing account for any of the principal's keys, or create one.
 */
export async function ensureIdentityAccount(
	bucket: R2Bucket,
	principal: RequestPrincipal,
	opts?: { extraPrincipals?: string[] },
): Promise<IdentityAccount> {
	const seed = uniquePrincipalKeys([
		...accountSeedKeys(principal),
		...(opts?.extraPrincipals ?? []),
	]);
	if (seed.length === 0) {
		throw new Error("cannot create identity account without principals");
	}

	let foundId: string | null = null;
	for (const key of seed) {
		const id = await findAccountIdByPrincipalKey(bucket, key);
		if (id) {
			foundId = id;
			break;
		}
	}

	const now = new Date().toISOString();
	if (foundId) {
		const existing = await loadIdentityAccount(bucket, foundId);
		if (existing) {
			const merged = uniquePrincipalKeys([...existing.principals, ...seed]);
			const primaryEmail =
				existing.primaryEmail ??
				seed.find((k) => k.startsWith("email:"))?.slice("email:".length) ??
				emailsForPrincipal(principal)[0];
			const updated: IdentityAccount = {
				...existing,
				principals: merged,
				primaryEmail,
				updatedAt: now,
			};
			await saveIdentityAccount(bucket, updated);
			await syncLegacyIndexesFromAccount(bucket, updated);
			return updated;
		}
	}

	const id = crypto.randomUUID();
	const primaryEmail =
		emailsForPrincipal(principal)[0] ??
		seed.find((k) => k.startsWith("email:"))?.slice("email:".length);
	const account: IdentityAccount = {
		id,
		principals: seed,
		primaryEmail,
		createdAt: now,
		updatedAt: now,
	};
	await saveIdentityAccount(bucket, account);
	await syncLegacyIndexesFromAccount(bucket, account);
	return account;
}

/** Merge two accounts; returns the surviving account (keeps `into` id). */
export async function mergeIdentityAccounts(
	bucket: R2Bucket,
	intoId: string,
	fromId: string,
): Promise<IdentityAccount> {
	if (intoId === fromId) {
		const one = await loadIdentityAccount(bucket, intoId);
		if (!one) throw new Error("identity account not found");
		return one;
	}
	const into = await loadIdentityAccount(bucket, intoId);
	const from = await loadIdentityAccount(bucket, fromId);
	if (!into || !from) throw new Error("identity account not found");

	const now = new Date().toISOString();
	const merged: IdentityAccount = {
		...into,
		principals: uniquePrincipalKeys([...into.principals, ...from.principals]),
		primaryEmail: into.primaryEmail ?? from.primaryEmail,
		updatedAt: now,
	};
	await saveIdentityAccount(bucket, merged);
	// Re-point from's keys to into, then drop the old account object.
	for (const key of from.principals) {
		await bucket.put(
			identityAccountByKeyKey(key),
			JSON.stringify({ accountId: merged.id }),
		);
	}
	await bucket.delete(identityAccountKey(from.id));
	await syncLegacyIndexesFromAccount(bucket, merged);
	await syncPlatformUsersFromAccount(bucket, merged);
	return merged;
}

/**
 * Keep by-sub / by-email indexes in sync so expandPrincipalWithLinks and
 * ownerKeysForAssign stay fast without a full account scan.
 */
async function syncLegacyIndexesFromAccount(
	bucket: R2Bucket,
	account: IdentityAccount,
): Promise<void> {
	const emails = account.principals
		.filter((k) => k.startsWith("email:"))
		.map((k) => k.slice("email:".length));
	const subs = account.principals
		.filter((k) => k.startsWith("sub:") && !k.slice("sub:".length).startsWith("user:"))
		.map((k) => k.slice("sub:".length));

	const now = new Date().toISOString();
	for (const sub of subs) {
		const existing = await loadIdentityLinkBySub(bucket, sub);
		const record: IdentityLinkRecord = {
			sub,
			provider: existing?.provider ?? "unknown",
			emails: [...new Set([...(existing?.emails ?? []), ...emails])],
			linkedAt: existing?.linkedAt ?? now,
			updatedAt: now,
			linkedByKeys: [
				...new Set([...(existing?.linkedByKeys ?? []), `account:${account.id}`]),
			],
			accountId: account.id,
		};
		await bucket.put(identityLinkBySubKey(sub), JSON.stringify(record));
		for (const email of record.emails) {
			const prior = await loadSubsForEmail(bucket, email);
			if (!prior.includes(sub)) {
				await writeEmailIndex(bucket, email, [...prior, sub]);
			}
		}
	}
}

/** When an account gains IdP subs, stamp them onto matching password users. */
async function syncPlatformUsersFromAccount(
	bucket: R2Bucket,
	account: IdentityAccount,
): Promise<void> {
	const userIds = account.principals
		.filter((k) => k.startsWith("user:"))
		.map((k) => k.slice("user:".length));
	const idpSubs = account.principals
		.filter((k) => k.startsWith("sub:") && !k.slice("sub:".length).startsWith("user:"))
		.map((k) => k.slice("sub:".length));
	if (userIds.length === 0 || idpSubs.length === 0) return;

	for (const userId of userIds) {
		const user = await loadPlatformUser(bucket, userId);
		if (!user) continue;
		const next = [...new Set([...user.linkedSubs, ...idpSubs])];
		if (next.length === user.linkedSubs.length) continue;
		user.linkedSubs = next;
		user.updatedAt = new Date().toISOString();
		await savePlatformUser(bucket, user);
	}
}

/** Merge emails onto an Apple/Google (or other) sub identity link + account. */
export async function upsertIdentityLink(
	bucket: R2Bucket,
	opts: {
		sub: string;
		provider: IdentityLinkRecord["provider"];
		emails: string[];
		linkedByKeys?: string[];
		extraPrincipals?: string[];
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
	const principal: RequestPrincipal = {
		sub,
		email: emails[0],
		linkedEmails: emails.slice(1),
	};
	const extra = [
		...(opts.extraPrincipals ?? []),
		...emails.map((e) => `email:${e}`),
		`sub:${sub}`,
	];
	const account = await ensureIdentityAccount(bucket, principal, {
		extraPrincipals: extra,
	});
	await syncPlatformUsersFromAccount(bucket, account);

	const existing = await loadIdentityLinkBySub(bucket, sub);
	const now = new Date().toISOString();
	const mergedEmails = [...new Set([...(existing?.emails ?? []), ...emails])];
	const record: IdentityLinkRecord = {
		sub,
		provider:
			opts.provider === "unknown" && existing ? existing.provider : opts.provider,
		emails: mergedEmails,
		linkedAt: existing?.linkedAt ?? now,
		updatedAt: now,
		linkedByKeys: [
			...new Set([
				...(existing?.linkedByKeys ?? []),
				...(opts.linkedByKeys ?? []),
				`account:${account.id}`,
			]),
		],
		accountId: account.id,
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

function applyAccountToPrincipal(
	principal: RequestPrincipal,
	account: IdentityAccount,
): RequestPrincipal {
	const linkedEmails = new Set(principal.linkedEmails ?? []);
	const linkedUserIds = new Set(principal.linkedUserIds ?? []);
	const linkedSubs = new Set(principal.linkedSubs ?? []);

	for (const key of account.principals) {
		if (key.startsWith("email:")) {
			linkedEmails.add(key.slice("email:".length));
		} else if (key.startsWith("user:")) {
			linkedUserIds.add(key.slice("user:".length));
		} else if (key.startsWith("sub:")) {
			const sub = key.slice("sub:".length);
			if (sub && sub !== principal.sub) linkedSubs.add(sub);
		}
	}

	const email =
		principal.email ??
		account.primaryEmail ??
		[...linkedEmails][0];

	return {
		...principal,
		email,
		linkedEmails: [...linkedEmails],
		linkedUserIds: [...linkedUserIds],
		linkedSubs: [...linkedSubs],
	};
}

/**
 * Expand a session principal with the durable identity account union.
 * Does not trust arbitrary clients — only R2-stored links / accounts.
 */
export async function expandPrincipalWithLinks(
	bucket: R2Bucket,
	principal: RequestPrincipal,
): Promise<RequestPrincipal> {
	const seed = accountSeedKeys(principal);
	for (const key of seed) {
		const accountId = await findAccountIdByPrincipalKey(bucket, key);
		if (accountId) {
			const account = await loadIdentityAccount(bucket, accountId);
			if (account) return applyAccountToPrincipal(principal, account);
		}
	}

	// Legacy path: by-sub link without an account index yet.
	if (!principal.sub) return principal;
	const link = await loadIdentityLinkBySub(bucket, principal.sub);
	if (!link || link.emails.length === 0) return principal;

	const linkedEmails = [
		...new Set([...(principal.linkedEmails ?? []), ...link.emails]),
	];
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
	const expanded = await expandPrincipalWithLinks(bucket, principal);
	const keys = new Set(principalKeys(expanded));
	for (const email of emailsForPrincipal(expanded)) {
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
	accountId?: string;
	principals?: string[];
	nowMs?: number;
}): IdentityLinkCode {
	const emails = [
		...new Set(
			opts.emails
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e)),
		),
	];
	const principals = uniquePrincipalKeys(opts.principals ?? []);
	if (emails.length === 0 && principals.length === 0 && !opts.accountId) {
		throw new Error("identity link code requires account, emails, or principals");
	}
	const now = opts.nowMs ?? Date.now();
	const code = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
	return {
		code,
		accountId: opts.accountId,
		emails,
		principals: principals.length > 0 ? principals : undefined,
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
 * Emails to stamp on a link code for the current session.
 * Domain Admins also include every `email:` on DOMAIN_ADMINS / R2 admins.
 * Any other authenticated user gets their session + linked emails (+ mailbox emails).
 */
export async function resolveLinkEmailsForPrincipal(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	principal: RequestPrincipal,
): Promise<string[]> {
	const emails = new Set(emailsForPrincipal(principal));

	const allowlist = await resolveAdminAllowlist(env);
	if (principalIsDomainAdmin(principal, allowlist)) {
		for (const key of allowlist) {
			if (key.startsWith("email:")) {
				emails.add(key.slice("email:".length));
			}
		}
	}

	// Password accounts: include contact / mailbox emails from the user record.
	if (principal.sub?.startsWith("user:")) {
		const user = await loadPlatformUser(
			env.BUCKET,
			principal.sub.slice("user:".length),
		);
		if (user) {
			const contact = normalizeEmailAddress(user.contactEmail);
			if (contact) emails.add(contact);
			if (user.mailboxEmail) {
				const mailbox =
					normalizeEmailAddress(user.mailboxEmail) ?? user.mailboxEmail;
				if (mailbox) emails.add(mailbox);
			}
		}
	}

	return [...emails];
}

/** @deprecated Prefer resolveLinkEmailsForPrincipal — kept for callers. */
export async function resolveAdminLinkEmails(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	principal: RequestPrincipal,
): Promise<string[]> {
	const allowlist = await resolveAdminAllowlist(env);
	if (!principalIsDomainAdmin(principal, allowlist)) return [];
	return resolveLinkEmailsForPrincipal(env, principal);
}

/**
 * Mint a short-lived code for any authenticated principal.
 * Redeemer joins the minter's identity account (union of principals).
 */
export async function mintIdentityLinkCode(
	env: { DOMAIN_ADMINS?: string; BUCKET: R2Bucket },
	principal: RequestPrincipal,
): Promise<IdentityLinkCode> {
	const emails = await resolveLinkEmailsForPrincipal(env, principal);
	const account = await ensureIdentityAccount(env.BUCKET, principal, {
		extraPrincipals: emails.map((e) => `email:${e}`),
	});
	const record = createIdentityLinkCode({
		emails: emails.length > 0 ? emails : account.primaryEmail ? [account.primaryEmail] : [],
		principals: account.principals,
		accountId: account.id,
		createdByKeys: principalKeys(principal),
	});
	// createIdentityLinkCode requires emails OR principals OR accountId — we always have accountId.
	if (record.emails.length === 0 && account.primaryEmail) {
		record.emails = [account.primaryEmail];
	}
	await saveIdentityLinkCode(env.BUCKET, record);
	return record;
}

/**
 * Redeem a link code into the current session: merge accounts / attach principals.
 * Requires an authenticated session (no open takeover).
 */
export async function redeemIdentityLinkCode(
	bucket: R2Bucket,
	principal: RequestPrincipal,
	codeRaw: string,
	opts?: { provider?: IdentityLinkRecord["provider"] },
): Promise<{
	account: IdentityAccount;
	linkedEmails: string[];
	expanded: RequestPrincipal;
}> {
	if (!principal.sub && !principal.email) {
		throw new Error("Unauthorized");
	}
	const record = await loadIdentityLinkCode(bucket, codeRaw.trim());
	if (!record || !identityLinkCodeIsActive(record)) {
		throw new Error("Invalid or expired link code");
	}

	const redeemerAccount = await ensureIdentityAccount(bucket, principal);
	let targetAccount: IdentityAccount | null = null;
	if (record.accountId) {
		targetAccount = await loadIdentityAccount(bucket, record.accountId);
	}

	let account: IdentityAccount;
	if (targetAccount) {
		account = await mergeIdentityAccounts(
			bucket,
			targetAccount.id,
			redeemerAccount.id,
		);
	} else {
		// Legacy code: emails only — attach to redeemer account.
		const extra = [
			...(record.principals ?? []),
			...record.emails.map((e) => `email:${e}`),
		];
		account = await ensureIdentityAccount(bucket, principal, {
			extraPrincipals: extra,
		});
		await syncPlatformUsersFromAccount(bucket, account);
	}

	if (principal.sub && !principal.sub.startsWith("user:")) {
		await upsertIdentityLink(bucket, {
			sub: principal.sub,
			provider: opts?.provider ?? "unknown",
			emails: [
				...record.emails,
				...(account.primaryEmail ? [account.primaryEmail] : []),
			],
			linkedByKeys: record.createdByKeys,
			extraPrincipals: account.principals,
		});
		// upsert creates/merges again — reload
		const reloaded = await loadIdentityAccount(bucket, account.id);
		if (reloaded) account = reloaded;
	}

	record.usedAt = new Date().toISOString();
	record.usedBySub = principal.sub;
	record.usedByKeys = principalKeys(principal);
	await saveIdentityLinkCode(bucket, record);

	const expanded = applyAccountToPrincipal(principal, account);
	return {
		account,
		linkedEmails: emailsForPrincipal(expanded),
		expanded,
	};
}

export function identitiesForAccount(
	account: IdentityAccount,
	principal: RequestPrincipal,
	providerBySub?: Map<string, IdentityLinkRecord["provider"]>,
	passwordLabelByUserKey?: Map<string, string>,
): LinkedIdentityView[] {
	const current = new Set(principalKeys(principal));
	const views: LinkedIdentityView[] = [];
	const seen = new Set<string>();

	for (const key of account.principals) {
		if (seen.has(key)) continue;
		seen.add(key);
		if (key.startsWith("email:")) {
			const email = key.slice("email:".length);
			views.push({
				type: "email",
				key,
				label: email,
				current: current.has(key),
			});
		} else if (key.startsWith("user:")) {
			const loginLabel = passwordLabelByUserKey?.get(key);
			views.push({
				type: "password",
				key,
				label: loginLabel ? `Password · ${loginLabel}` : "Password",
				current: current.has(key) || current.has(`sub:${key}`),
			});
		} else if (key.startsWith("sub:")) {
			const sub = key.slice("sub:".length);
			if (sub.startsWith("user:")) continue;
			const provider = providerBySub?.get(sub);
			if (provider === "apple") {
				views.push({
					type: "apple",
					key,
					label: "Apple",
					current: current.has(key),
				});
			} else if (provider === "google") {
				views.push({
					type: "google",
					key,
					label: "Google",
					current: current.has(key),
				});
			} else {
				views.push({
					type: "sub",
					key,
					label: `Sign-in provider (${sub.slice(0, 8)}…)`,
					current: current.has(key),
				});
			}
		}
	}
	return views;
}

/** Build UI-facing identity list for the current session (creates account if needed). */
export async function listIdentitiesForPrincipal(
	bucket: R2Bucket,
	principal: RequestPrincipal,
): Promise<{ accountId: string; identities: LinkedIdentityView[] }> {
	const account = await ensureIdentityAccount(bucket, principal);
	const providerBySub = new Map<string, IdentityLinkRecord["provider"]>();
	const passwordLabelByUserKey = new Map<string, string>();
	for (const key of account.principals) {
		if (key.startsWith("sub:")) {
			const sub = key.slice("sub:".length);
			if (!sub || sub.startsWith("user:")) continue;
			const link = await loadIdentityLinkBySub(bucket, sub);
			if (link) providerBySub.set(sub, link.provider);
		} else if (key.startsWith("user:")) {
			const userId = key.slice("user:".length);
			const user = await loadPlatformUser(bucket, userId);
			if (user) {
				const login =
					user.mailboxEmail ??
					normalizeEmailAddress(user.contactEmail) ??
					user.contactEmail;
				if (login) passwordLabelByUserKey.set(key, login);
			}
		}
	}
	return {
		accountId: account.id,
		identities: identitiesForAccount(
			account,
			principal,
			providerBySub,
			passwordLabelByUserKey,
		),
	};
}

/**
 * Resolve the platform password user linked to this session's durable account.
 * Returns null when the account has no password sign-in method.
 */
export async function passwordUserForSessionAccount(
	bucket: R2Bucket,
	session: RequestPrincipal,
): Promise<PlatformUser | null> {
	if (!session.sub && !session.email) return null;
	const account = await ensureIdentityAccount(bucket, session);
	const userIds = account.principals
		.filter((k) => k.startsWith("user:"))
		.map((k) => k.slice("user:".length));
	for (const userId of userIds) {
		const user = await loadPlatformUser(bucket, userId);
		if (user) return user;
	}
	return null;
}

/**
 * Update the password hash for the password principal on this session's account.
 * Caller must verify the current password and validate the new password first.
 */
export async function updatePasswordHashForSessionAccount(
	bucket: R2Bucket,
	session: RequestPrincipal,
	newPasswordHash: string,
): Promise<{ userId: string; account: IdentityAccount }> {
	if (!session.sub && !session.email) {
		throw new Error("Unauthorized");
	}
	const account = await ensureIdentityAccount(bucket, session);
	const userIds = account.principals
		.filter((k) => k.startsWith("user:"))
		.map((k) => k.slice("user:".length));
	if (userIds.length === 0) {
		throw new Error("This account has no password sign-in method");
	}
	const user = await loadPlatformUser(bucket, userIds[0]);
	if (!user) {
		throw new Error("This account has no password sign-in method");
	}
	const updated: PlatformUser = {
		...user,
		passwordHash: newPasswordHash,
		updatedAt: new Date().toISOString(),
	};
	await savePlatformUser(bucket, updated);
	return { userId: user.id, account };
}

/** Thrown when attaching an IdP/password principal already owned by another account. */
export class IdentityAlreadyLinkedError extends Error {
	constructor(
		message = "This identity is already linked to another Inboxies account",
	) {
		super(message);
		this.name = "IdentityAlreadyLinkedError";
	}
}

/**
 * Assert that candidate principal keys are free or already on `accountId`.
 * Rejects cross-account takeover.
 */
export async function assertPrincipalsAttachable(
	bucket: R2Bucket,
	accountId: string,
	candidateKeys: string[],
): Promise<void> {
	for (const raw of uniquePrincipalKeys(candidateKeys)) {
		const existingId = await findAccountIdByPrincipalKey(bucket, raw);
		if (existingId && existingId !== accountId) {
			throw new IdentityAlreadyLinkedError(
				"This identity is already linked to another Inboxies account",
			);
		}
	}
}

/**
 * In-session Connect IdP: attach a verified Apple/Google sub (+ optional emails)
 * to the current session's durable identity account. Does not change the
 * session token — next request expands via R2.
 */
export async function attachIdpToSessionAccount(
	bucket: R2Bucket,
	session: RequestPrincipal,
	opts: {
		sub: string;
		provider: "apple" | "google";
		emails?: string[];
	},
): Promise<{
	account: IdentityAccount;
	expanded: RequestPrincipal;
	linkedEmails: string[];
}> {
	if (!session.sub && !session.email) {
		throw new Error("Unauthorized");
	}
	const sub = opts.sub.trim();
	if (!sub) throw new Error("Identity subject is required");

	const emails = [
		...new Set(
			(opts.emails ?? [])
				.map((e) => normalizeEmailAddress(e))
				.filter((e): e is string => Boolean(e)),
		),
	];

	const sessionAccount = await ensureIdentityAccount(bucket, session);
	const candidateKeys = [
		`sub:${sub}`,
		...emails.map((e) => `email:${e}`),
	];
	await assertPrincipalsAttachable(bucket, sessionAccount.id, candidateKeys);

	const record = await upsertIdentityLink(bucket, {
		sub,
		provider: opts.provider,
		emails,
		linkedByKeys: [
			...principalKeys(session),
			`account:${sessionAccount.id}`,
			"attach:in-session",
		],
		extraPrincipals: sessionAccount.principals,
	});

	// upsertIdentityLink may have resolved a different account if indexes raced;
	// re-check and merge into the session account when needed.
	let account =
		(record.accountId
			? await loadIdentityAccount(bucket, record.accountId)
			: null) ?? sessionAccount;
	if (account.id !== sessionAccount.id) {
		await assertPrincipalsAttachable(bucket, sessionAccount.id, account.principals);
		account = await mergeIdentityAccounts(bucket, sessionAccount.id, account.id);
	} else {
		// Ensure session principals stayed on the account (upsert seeds from IdP).
		const merged = uniquePrincipalKeys([
			...account.principals,
			...sessionAccount.principals,
		]);
		if (merged.length !== account.principals.length) {
			account = {
				...account,
				principals: merged,
				updatedAt: new Date().toISOString(),
			};
			await saveIdentityAccount(bucket, account);
			await syncLegacyIndexesFromAccount(bucket, account);
			await syncPlatformUsersFromAccount(bucket, account);
		}
	}

	const expanded = applyAccountToPrincipal(session, account);
	return {
		account,
		expanded,
		linkedEmails: emailsForPrincipal(expanded),
	};
}

/**
 * In-session Add password: create (or reject if present) a password principal
 * on the current identity account. Login email defaults to the session email.
 */
export async function attachPasswordToSessionAccount(
	bucket: R2Bucket,
	session: RequestPrincipal,
	opts: {
		passwordHash: string;
		loginEmail?: string;
		contactEmail?: string;
	},
): Promise<{
	account: IdentityAccount;
	expanded: RequestPrincipal;
	userId: string;
	linkedEmails: string[];
}> {
	if (!session.sub && !session.email) {
		throw new Error("Unauthorized");
	}

	const sessionAccount = await ensureIdentityAccount(bucket, session);
	const existingUserIds = sessionAccount.principals
		.filter((k) => k.startsWith("user:"))
		.map((k) => k.slice("user:".length));
	if (existingUserIds.length > 0) {
		throw new Error("This account already has a password sign-in method");
	}

	const loginRaw =
		opts.loginEmail?.trim() ||
		session.email ||
		sessionAccount.primaryEmail ||
		emailsForPrincipal(session)[0];
	if (!loginRaw) {
		throw new Error("loginEmail is required when this session has no email");
	}
	const login =
		canonicalMailboxId(loginRaw) ??
		normalizeEmailAddress(loginRaw) ??
		loginRaw.toLowerCase();
	const contact =
		normalizeEmailAddress(opts.contactEmail ?? loginRaw) ?? login;

	const existingLogin = await findUserIdByLoginEmail(bucket, login);
	if (existingLogin) {
		const existingUserAccount = await findAccountIdByPrincipalKey(
			bucket,
			`user:${existingLogin}`,
		);
		if (existingUserAccount && existingUserAccount !== sessionAccount.id) {
			throw new IdentityAlreadyLinkedError(
				"That email already has a password on another Inboxies account",
			);
		}
		throw new Error("That email already has a password login");
	}

	const userId = crypto.randomUUID();
	const now = new Date().toISOString();
	const user: PlatformUser = {
		id: userId,
		contactEmail: contact,
		mailboxEmail: login.includes("@") ? login : undefined,
		passwordHash: opts.passwordHash,
		linkedSubs: sessionAccount.principals
			.filter((k) => k.startsWith("sub:") && !k.slice(4).startsWith("user:"))
			.map((k) => k.slice("sub:".length)),
		createdAt: now,
		updatedAt: now,
	};
	await savePlatformUser(bucket, user);

	const userKey = `user:${userId}`;
	await assertPrincipalsAttachable(bucket, sessionAccount.id, [
		userKey,
		`email:${login}`,
	]);

	const account: IdentityAccount = {
		...sessionAccount,
		principals: uniquePrincipalKeys([
			...sessionAccount.principals,
			userKey,
			`email:${login}`,
		]),
		primaryEmail: sessionAccount.primaryEmail ?? login,
		updatedAt: now,
	};
	await saveIdentityAccount(bucket, account);
	await syncLegacyIndexesFromAccount(bucket, account);
	await syncPlatformUsersFromAccount(bucket, account);

	const expanded = applyAccountToPrincipal(session, account);
	return {
		account,
		expanded,
		userId,
		linkedEmails: emailsForPrincipal(expanded),
	};
}
