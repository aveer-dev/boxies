// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One-time copy of identity and permissions from R2 into AUTH_DB.
 *
 * - Each identity account becomes a user (same id, so `account:<id>` ACL
 *   keys resolve). Password users outside any account become their own user.
 * - Passwords keep their PBKDF2 hash on a "credential" account.
 * - Apple/Google subs become provider accounts. Access/dev subs are dropped:
 *   Access is operator-only after the cutover.
 * - Mailbox ACL keys, domain owners/admins and pending invites resolve to
 *   rows keyed by user id.
 *
 * Nothing is guessed: an `email:` key only resolves to a user whose login is
 * that mailbox address, and anything unresolvable is reported in `issues`.
 * Ids are deterministic and inserts ignore conflicts, so re-running is safe.
 * Sessions are not migrated; everyone signs in again.
 */

import type { DrizzleD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { canonicalMailboxId } from "../lib/mailbox-routing";
import * as schema from "./schema";

type Bucketish = Pick<R2Bucket, "get" | "list">;

// Where the pre-D1 identity store kept users, logins and invites. Nothing
// reads these after the migration; `cleanupLegacyIdentity` and account
// deletion remove them. (`platform/domains/` is still the live domain
// registry and is not identity data.)
const PASSWORD_PREFIXES = ["platform/identity/passwords/", "platform/users/"];
const ACCOUNT_PREFIXES = ["platform/identity/accounts/", "platform/identity-accounts/"];
const SUB_LINK_PREFIX = "platform/identity-links/by-sub/";
const INVITE_PREFIX = "platform/invites/";
export const LEGACY_IDENTITY_PREFIXES = [...PASSWORD_PREFIXES, ...ACCOUNT_PREFIXES, SUB_LINK_PREFIX, INVITE_PREFIX];

type LegacyPlatformUser = {
	id: string;
	contactEmail?: string;
	mailboxEmail?: string;
	/** Typed at sign-up, never verified. */
	recoveryEmail?: string;
	passwordHash: string;
	linkedSubs?: string[];
	createdAt?: string;
};

type LegacyAccount = {
	id: string;
	principals: string[];
	providers?: Record<string, string>;
	primaryEmail?: string;
	createdAt?: string;
};

type LegacySubLink = {
	sub: string;
	provider: string;
	emails: string[];
	accountId?: string;
};

type LegacyDomain = {
	domain: string;
	ownerUserId?: string | null;
	adminUserIds?: Array<string | null>;
	status?: string;
	createdAt?: string;
};

type LegacyInvite = {
	token: string;
	mailboxId: string;
	role: "owner" | "member";
	inviteeEmail: string;
	inviteeName?: string;
	createdByKeys?: string[];
	expiresAt: string;
	status: string;
};

export type MigrationIssue = { kind: string; detail: string };

export type MigrationReport = {
	dryRun: boolean;
	counts: {
		users: number;
		credentialAccounts: number;
		providerAccounts: number;
		mailboxes: number;
		memberships: number;
		domains: number;
		domainAdmins: number;
		invites: number;
		recoveryEmails: number;
	};
	issues: MigrationIssue[];
};

const PLACEHOLDER_EMAIL_DOMAIN = "no-email.invalid";
const SOCIAL_PROVIDERS = new Set(["apple", "google"]);

// The legacy store records every non-password session sub as "access"
// (providersFromPrincipal), even for plain Apple/Google sign-ins, so the
// recorded provider can't be trusted. Apple and Google subs have
// recognisable shapes; Access subs are UUIDs.
const APPLE_SUB = /^\d{6}\.[0-9a-f]{32}\.\d{4}$/;
const GOOGLE_SUB = /^\d{10,30}$/;

/** The real sign-in provider for `sub`, given what legacy data recorded. */
export function inferProvider(sub: string, ...recorded: Array<string | undefined>): string | undefined {
	const social = recorded.find((p) => p && SOCIAL_PROVIDERS.has(p));
	if (social) return social;
	if (APPLE_SUB.test(sub)) return "apple";
	if (GOOGLE_SUB.test(sub)) return "google";
	return recorded.find(Boolean);
}

async function listKeys(bucket: Bucketish, prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		for (const obj of page.objects) keys.push(obj.key);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return keys;
}

async function readJson<T>(bucket: Bucketish, key: string): Promise<T | null> {
	try {
		const obj = await bucket.get(key);
		return obj ? ((await obj.json()) as T) : null;
	} catch {
		return null;
	}
}

/** Records under `prefixes`, keyed by file name; earlier prefixes win. */
async function loadRecords<T>(bucket: Bucketish, prefixes: string[]): Promise<Map<string, T>> {
	const out = new Map<string, T>();
	for (const prefix of prefixes) {
		for (const key of await listKeys(bucket, prefix)) {
			if (!key.endsWith(".json")) continue;
			const id = decodeURIComponent(key.slice(prefix.length, -".json".length));
			if (!id || id.includes("/") || out.has(id)) continue;
			const record = await readJson<T>(bucket, key);
			if (record) out.set(id, record);
		}
	}
	return out;
}

function normalizeEmail(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim().toLowerCase();
	return trimmed.includes("@") ? trimmed : null;
}

function toDate(value: string | undefined, fallback: Date): Date {
	const t = value ? Date.parse(value) : NaN;
	return Number.isFinite(t) ? new Date(t) : fallback;
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type PlannedUser = {
	id: string;
	email: string | null;
	emailVerified: boolean;
	createdAt: Date;
};

/** Everything the migration would write, worked out from R2 alone. */
async function planAuthMigration(bucket: Bucketish, now: Date) {
	const issues: MigrationIssue[] = [];
	const issue = (kind: string, detail: string) => issues.push({ kind, detail });

	const platformUsers = await loadRecords<LegacyPlatformUser>(bucket, PASSWORD_PREFIXES);
	const accounts = await loadRecords<LegacyAccount>(bucket, ACCOUNT_PREFIXES);
	const subLinks = await loadRecords<LegacySubLink>(bucket, [SUB_LINK_PREFIX]);

	const users = new Map<string, PlannedUser>();
	const credentials = new Map<string, string>(); // userId → password hash
	const providerAccounts = new Map<string, { userId: string; providerId: string; sub: string }>();
	const userByPlatformUser = new Map<string, string>();
	const userBySub = new Map<string, string>();

	const addProvider = (userId: string, sub: string, provider: string | undefined, source: string) => {
		if (!provider || !SOCIAL_PROVIDERS.has(provider)) {
			issue("sign-in dropped", `${provider ?? "unknown"} sign-in ${sub} (${source}) has no Apple/Google equivalent`);
			return;
		}
		const key = `${provider}:${sub}`;
		const existing = providerAccounts.get(key);
		if (existing && existing.userId !== userId) {
			issue("conflict", `${provider} account ${sub} is on users ${existing.userId} and ${userId}; kept ${existing.userId}`);
			return;
		}
		providerAccounts.set(key, { userId, providerId: provider, sub });
		userBySub.set(sub, userId);
	};

	// Identity accounts → users.
	for (const [id, account] of [...accounts].sort(([a], [b]) => a.localeCompare(b))) {
		const principals = account.principals ?? [];
		const memberPasswordIds = [
			...new Set(
				principals
					.filter((k) => k.startsWith("user:") || k.startsWith("sub:user:"))
					.map((k) => k.slice(k.lastIndexOf("user:") + "user:".length)),
			),
		].filter((pid) => platformUsers.has(pid));

		// One password per user: prefer the one that logs in with a mailbox address.
		const sorted = memberPasswordIds
			.map((pid) => platformUsers.get(pid)!)
			.sort((a, b) => Number(Boolean(b.mailboxEmail)) - Number(Boolean(a.mailboxEmail)) || a.id.localeCompare(b.id));
		const password = sorted[0];
		for (const extra of sorted.slice(1)) {
			issue("password dropped", `user ${id} had a second password login (${extra.mailboxEmail ?? extra.contactEmail}); kept ${password.mailboxEmail ?? password.contactEmail}`);
		}
		for (const pu of sorted) userByPlatformUser.set(pu.id, id);
		if (password) credentials.set(id, password.passwordHash);

		const firstEmailKey = principals.find((k) => k.startsWith("email:"))?.slice("email:".length);
		users.set(id, {
			id,
			email: normalizeEmail(password?.mailboxEmail) ?? normalizeEmail(password?.contactEmail) ?? normalizeEmail(account.primaryEmail) ?? normalizeEmail(firstEmailKey),
			emailVerified: Boolean(password?.mailboxEmail),
			createdAt: toDate(account.createdAt, now),
		});

		for (const key of principals) {
			if (!key.startsWith("sub:") || key.startsWith("sub:user:")) continue;
			const sub = key.slice("sub:".length);
			addProvider(id, sub, inferProvider(sub, account.providers?.[sub], subLinks.get(sub)?.provider), `account ${id}`);
		}
		for (const pu of sorted) {
			for (const sub of pu.linkedSubs ?? []) {
				if (!userBySub.has(sub)) addProvider(id, sub, inferProvider(sub, account.providers?.[sub], subLinks.get(sub)?.provider), `password user ${pu.id}`);
			}
		}
	}

	// Password users that never joined an account.
	for (const [id, pu] of [...platformUsers].sort(([a], [b]) => a.localeCompare(b))) {
		if (userByPlatformUser.has(id)) continue;
		userByPlatformUser.set(id, id);
		credentials.set(id, pu.passwordHash);
		users.set(id, {
			id,
			email: normalizeEmail(pu.mailboxEmail) ?? normalizeEmail(pu.contactEmail),
			emailVerified: Boolean(pu.mailboxEmail),
			createdAt: toDate(pu.createdAt, now),
		});
		for (const sub of pu.linkedSubs ?? []) {
			if (!userBySub.has(sub)) addProvider(id, sub, inferProvider(sub, subLinks.get(sub)?.provider), `password user ${id}`);
		}
	}

	// Legacy Apple/Google links that predate accounts.
	for (const [sub, link] of [...subLinks].sort(([a], [b]) => a.localeCompare(b))) {
		if (userBySub.has(sub)) continue;
		const provider = inferProvider(sub, link.provider);
		if (link.accountId && users.has(link.accountId)) {
			addProvider(link.accountId, sub, provider, "legacy link");
			continue;
		}
		if (!provider || !SOCIAL_PROVIDERS.has(provider)) {
			issue("sign-in dropped", `${provider ?? "unknown"} sign-in ${sub} (legacy link) has no Apple/Google equivalent`);
			continue;
		}
		const id = `legacy_${provider}_${sub}`;
		users.set(id, { id, email: normalizeEmail(link.emails?.[0]), emailVerified: false, createdAt: now });
		addProvider(id, sub, provider, "legacy link");
	}

	// Recovery emails were typed at sign-up and never verified: they carry
	// over unverified, and password resets wait until the user confirms one.
	const recoveryEmails = new Map<string, string>();
	for (const [pid, pu] of platformUsers) {
		const userId = userByPlatformUser.get(pid);
		const email = normalizeEmail(pu.recoveryEmail);
		if (userId && email && !recoveryEmails.has(userId)) recoveryEmails.set(userId, email);
	}

	// Emails are unique. Verified (mailbox login) emails claim first; anyone
	// left without one gets a placeholder and a report line.
	const emailOwner = new Map<string, string>();
	const ordered = [...users.values()].sort(
		(a, b) => Number(b.emailVerified) - Number(a.emailVerified) || a.id.localeCompare(b.id),
	);
	for (const u of ordered) {
		if (u.email && !emailOwner.has(u.email)) {
			emailOwner.set(u.email, u.id);
			continue;
		}
		if (u.email) issue("email conflict", `${u.email} already belongs to user ${emailOwner.get(u.email)}; user ${u.id} gets a placeholder email`);
		else issue("no email", `user ${u.id} has no email; gets a placeholder`);
		u.email = `${u.id}@${PLACEHOLDER_EMAIL_DOMAIN}`;
		u.emailVerified = false;
	}
	const verifiedEmailOwner = new Map(
		[...users.values()].filter((u) => u.emailVerified).map((u) => [u.email!, u.id]),
	);

	const resolveKey = (key: string): string | null => {
		const k = key.trim();
		if (k.startsWith("account:")) return users.has(k.slice(8)) ? k.slice(8) : null;
		if (k.startsWith("sub:user:")) return userByPlatformUser.get(k.slice(9)) ?? null;
		if (k.startsWith("user:")) return userByPlatformUser.get(k.slice(5)) ?? null;
		if (k.startsWith("sub:")) return userBySub.get(k.slice(4)) ?? null;
		if (k.startsWith("email:")) {
			const email = canonicalMailboxId(k.slice(6)) ?? normalizeEmail(k.slice(6));
			return email ? (verifiedEmailOwner.get(email) ?? null) : null;
		}
		return null;
	};

	// Mailboxes and memberships.
	const mailboxes: Array<typeof schema.mailbox.$inferInsert> = [];
	const memberships = new Map<string, typeof schema.mailboxMember.$inferInsert>();
	for (const key of await listKeys(bucket, "mailboxes/")) {
		if (!key.endsWith(".json")) continue;
		const mailboxId = canonicalMailboxId(key.slice("mailboxes/".length, -".json".length));
		if (!mailboxId) continue;
		const settings = await readJson<{ acl?: { owners?: string[]; members?: string[] } }>(bucket, key);
		mailboxes.push({ id: mailboxId, domain: mailboxId.slice(mailboxId.lastIndexOf("@") + 1) });

		let hasOwner = false;
		const grant = (raw: string, role: "owner" | "member") => {
			const userId = resolveKey(raw);
			if (!userId) {
				issue("unresolved access", `${mailboxId}: ${role} key ${raw} matches no migrated user`);
				return;
			}
			const id = `${mailboxId}|${userId}`;
			if (role === "owner") hasOwner = true;
			if (memberships.get(id)?.role === "owner") return;
			memberships.set(id, { mailboxId, userId, role });
		};
		for (const k of settings?.acl?.owners ?? []) grant(k, "owner");
		for (const k of settings?.acl?.members ?? []) grant(k, "member");

		if (!hasOwner) {
			// Same rule as the old auto-claim: the user who logs in as this address owns it.
			const loginOwner = verifiedEmailOwner.get(mailboxId);
			if (loginOwner) memberships.set(`${mailboxId}|${loginOwner}`, { mailboxId, userId: loginOwner, role: "owner" });
			else issue("orphaned mailbox", `${mailboxId} has no owner after migration`);
		}
	}
	const mailboxIds = new Set(mailboxes.map((m) => m.id));

	// Domains.
	const domains: Array<typeof schema.domain.$inferInsert> = [];
	const domainAdmins = new Map<string, typeof schema.domainAdmin.$inferInsert>();
	for (const [, meta] of await loadRecords<LegacyDomain>(bucket, ["platform/domains/"])) {
		const name = meta.domain?.trim().toLowerCase();
		if (!name) continue;
		// Refs are bare user/account ids, raw emails, or prefixed keys
		// (`account:<id>` from the admin connect-domain route).
		const resolveDomainUser = (ref: string | null | undefined) =>
			!ref
				? null
				: /^(account|user|sub|email):/.test(ref)
					? resolveKey(ref)
					: ref.includes("@")
						? resolveKey(`email:${ref}`)
						: (resolveKey(`user:${ref}`) ?? resolveKey(`account:${ref}`));
		const owner = resolveDomainUser(meta.ownerUserId);
		if (!owner) issue("domain without owner", `${name}: owner ${meta.ownerUserId ?? "(none)"} matches no migrated user`);
		const status = meta.status === "active" ? "active" : meta.status === "offboarding" ? "decommissioned" : "pending";
		domains.push({
			domain: name,
			ownerUserId: owner,
			status,
			// Active domains already proved control by delegating nameservers.
			verifiedAt: status === "active" ? toDate(meta.createdAt, now) : null,
		});
		for (const ref of meta.adminUserIds ?? []) {
			const userId = resolveDomainUser(ref);
			if (!userId) {
				issue("unresolved domain admin", `${name}: admin ${ref ?? "(null)"} matches no migrated user`);
				continue;
			}
			if (userId !== owner) domainAdmins.set(`${name}|${userId}`, { domain: name, userId });
		}
	}

	// Pending invites (tokens are stored hashed).
	const invites: Array<typeof schema.invite.$inferInsert> = [];
	for (const [, inv] of await loadRecords<LegacyInvite>(bucket, [INVITE_PREFIX])) {
		const expiresAt = toDate(inv.expiresAt, now);
		const mailboxId = canonicalMailboxId(inv.mailboxId);
		if (inv.status !== "pending" || expiresAt <= now || !mailboxId) continue;
		if (!mailboxIds.has(mailboxId)) {
			issue("invite dropped", `pending invite for ${inv.inviteeEmail} targets missing mailbox ${inv.mailboxId}`);
			continue;
		}
		invites.push({
			tokenHash: await sha256Hex(inv.token),
			mailboxId,
			role: inv.role,
			inviteeEmail: inv.inviteeEmail,
			inviteeName: inv.inviteeName ?? null,
			createdBy: (inv.createdByKeys ?? []).map(resolveKey).find(Boolean) ?? null,
			expiresAt,
		});
	}

	return { users, credentials, providerAccounts, mailboxes, memberships, domains, domainAdmins, invites, recoveryEmails, issues };
}

export async function migrateAuthFromR2(
	bucket: Bucketish,
	d1: D1Database,
	opts: { dryRun: boolean; now?: Date },
): Promise<MigrationReport> {
	const now = opts.now ?? new Date();
	const { users, credentials, providerAccounts, mailboxes, memberships, domains, domainAdmins, invites, recoveryEmails, issues } =
		await planAuthMigration(bucket, now);
	const report: MigrationReport = {
		dryRun: opts.dryRun,
		counts: {
			users: users.size,
			credentialAccounts: credentials.size,
			providerAccounts: providerAccounts.size,
			mailboxes: mailboxes.length,
			memberships: memberships.size,
			domains: domains.length,
			domainAdmins: domainAdmins.size,
			invites: invites.length,
			recoveryEmails: recoveryEmails.size,
		},
		issues,
	};
	if (opts.dryRun) return report;

	const db: DrizzleD1Database<typeof schema> = drizzle(d1, { schema });
	// Inserts ignore conflicts, so applying over existing rows would keep
	// stale passwords and memberships. The real run is into an empty DB, at
	// cutover; dry runs can be repeated any time.
	const existingUsers = await d1.prepare("select count(*) as n from user").first<number>("n");
	if (existingUsers) {
		throw new Error(`AUTH_DB already has ${existingUsers} users; apply only into an empty database`);
	}
	const rows = <T>(items: Iterable<T>) => [...items];
	const statements = [
		...rows(users.values()).map((u) =>
			db.insert(schema.user).values({
				id: u.id,
				name: u.email!.split("@")[0],
				email: u.email!,
				emailVerified: u.emailVerified,
				createdAt: u.createdAt,
				updatedAt: now,
			}).onConflictDoNothing(),
		),
		...rows(credentials).map(([userId, password]) =>
			db.insert(schema.account).values({
				id: `credential_${userId}`,
				accountId: userId,
				providerId: "credential",
				userId,
				password,
			}).onConflictDoNothing(),
		),
		...rows(providerAccounts.values()).map((p) =>
			db.insert(schema.account).values({
				id: `${p.providerId}_${p.sub}`,
				accountId: p.sub,
				providerId: p.providerId,
				userId: p.userId,
			}).onConflictDoNothing(),
		),
		...mailboxes.map((m) => db.insert(schema.mailbox).values(m).onConflictDoNothing()),
		...rows(memberships.values()).map((m) => db.insert(schema.mailboxMember).values(m).onConflictDoNothing()),
		...domains.map((d) => db.insert(schema.domain).values(d).onConflictDoNothing()),
		...rows(domainAdmins.values()).map((a) => db.insert(schema.domainAdmin).values(a).onConflictDoNothing()),
		...invites.map((i) => db.insert(schema.invite).values(i).onConflictDoNothing()),
		...rows(recoveryEmails).map(([userId, email]) =>
			db.insert(schema.recoveryEmail).values({ userId, email, verifiedAt: null }).onConflictDoNothing(),
		),
	];
	// D1 batches run as one transaction each; keep them small.
	for (let i = 0; i < statements.length; i += 50) {
		const chunk = statements.slice(i, i + 50);
		await db.batch(chunk as [typeof chunk[number], ...typeof chunk]);
	}
	return report;
}

// ── Legacy identity cleanup ──────────────────────────────────────

type DeletableBucket = Bucketish & Pick<R2Bucket, "delete">;

async function deleteKeys(bucket: DeletableBucket, keys: string[]): Promise<void> {
	// R2 deletes at most 1000 keys per call.
	for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
}

/** Both spellings a record id may have been stored under. */
function recordKeys(prefix: string, id: string): string[] {
	return [...new Set([`${prefix}${id}.json`, `${prefix}${encodeURIComponent(id)}.json`])];
}

async function readRecord<T>(bucket: Bucketish, prefixes: string[], id: string): Promise<T[]> {
	const out: T[] = [];
	for (const prefix of prefixes) {
		for (const key of recordKeys(prefix, id)) {
			const record = await readJson<T>(bucket, key);
			if (record) out.push(record);
		}
	}
	return out;
}

/**
 * Delete the legacy R2 identity records behind one D1 user (account
 * deletion). The migration kept ids, so the user id is the identity account
 * id or the password user id; `subs` are the user's Apple/Google subs from
 * AUTH_DB. Returns the keys that existed.
 */
export async function deleteLegacyIdentityForUser(
	bucket: DeletableBucket,
	userId: string,
	subs: string[] = [],
): Promise<string[]> {
	const passwordIds = new Set([userId]);
	const allSubs = new Set(subs);
	const legacySub = /^legacy_(?:apple|google)_(.+)$/.exec(userId)?.[1];
	if (legacySub) allSubs.add(legacySub);

	for (const account of await readRecord<LegacyAccount>(bucket, ACCOUNT_PREFIXES, userId)) {
		for (const key of account.principals ?? []) {
			if (key.startsWith("sub:user:")) passwordIds.add(key.slice("sub:user:".length));
			else if (key.startsWith("user:")) passwordIds.add(key.slice("user:".length));
			else if (key.startsWith("sub:")) allSubs.add(key.slice("sub:".length));
		}
	}
	for (const pid of passwordIds) {
		for (const pu of await readRecord<LegacyPlatformUser>(bucket, PASSWORD_PREFIXES, pid)) {
			for (const sub of pu.linkedSubs ?? []) allSubs.add(sub);
		}
	}

	const candidates = [
		...ACCOUNT_PREFIXES.flatMap((p) => recordKeys(p, userId)),
		...[...passwordIds].flatMap((pid) => PASSWORD_PREFIXES.flatMap((p) => recordKeys(p, pid))),
		...[...allSubs].flatMap((sub) => recordKeys(SUB_LINK_PREFIX, sub)),
	];
	const existing: string[] = [];
	for (const key of new Set(candidates)) if (await readJson(bucket, key)) existing.push(key);
	await deleteKeys(bucket, existing);
	return existing;
}

export type LegacyCleanupReport = {
	dryRun: boolean;
	/** Legacy users with no AUTH_DB row and no deletion record; nothing is deleted while any remain. */
	unmigratedUserIds: string[];
	keys: number;
	byPrefix: Record<string, number>;
	deleted: boolean;
};

/**
 * Delete every legacy identity record in R2 (contact and recovery emails,
 * password hashes, sign-in links, old invites) once AUTH_DB has them.
 *
 * Safe by construction: it re-plans the migration from R2 and refuses to
 * delete anything unless every user the migration would create exists in
 * AUTH_DB or was since deleted (a `user.delete` audit entry).
 */
export async function cleanupLegacyIdentity(
	bucket: DeletableBucket,
	d1: D1Database,
	opts: { dryRun: boolean },
): Promise<LegacyCleanupReport> {
	const { users } = await planAuthMigration(bucket, new Date());
	const unmigratedUserIds: string[] = [];
	for (const id of [...users.keys()].sort()) {
		const present = await d1
			.prepare(
				"select 1 as ok from user where id = ? union all select 1 from audit_log where action = 'user.delete' and target = ? limit 1",
			)
			.bind(id, id)
			.first("ok");
		if (!present) unmigratedUserIds.push(id);
	}

	const byPrefix: Record<string, number> = {};
	const keys: string[] = [];
	for (const prefix of LEGACY_IDENTITY_PREFIXES) {
		const found = await listKeys(bucket, prefix);
		byPrefix[prefix] = found.length;
		keys.push(...found);
	}

	const deleted = !opts.dryRun && unmigratedUserIds.length === 0 && keys.length > 0;
	if (deleted) await deleteKeys(bucket, keys);
	return { dryRun: opts.dryRun, unmigratedUserIds, keys: keys.length, byPrefix, deleted };
}
