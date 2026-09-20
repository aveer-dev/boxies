// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-mailbox authorization: explicit owners + members ACL, with
 * email-match bootstrap for unclaimed mailboxes.
 */

import { normalizeEmailAddress } from "./mail-automations.ts";
import {
	canonicalMailboxId,
	mailboxMetadataKey,
	resolveMailboxParam,
} from "./mailbox-routing.ts";

export const DEV_WEB_PRINCIPAL_EMAIL = "dev@localhost";

export type RequestPrincipal = {
	email?: string;
	sub?: string;
};

export type MailboxAcl = {
	owners: string[];
	members: string[];
};

export type AuthorizeMailboxResult =
	| { ok: true; mailboxId: string; settings: Record<string, unknown> }
	| { ok: false; status: 400 | 403 | 404; error: string };

export type AclWriteResult =
	| { ok: true; acl: MailboxAcl }
	| { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

/** Build a principal from Access or mobile JWT claims. */
export function principalFromClaims(claims: {
	email?: unknown;
	sub?: unknown;
}): RequestPrincipal {
	const emailRaw = typeof claims.email === "string" ? claims.email : undefined;
	const email = emailRaw
		? (normalizeEmailAddress(emailRaw) ?? undefined)
		: undefined;
	const sub =
		typeof claims.sub === "string" && claims.sub.trim()
			? claims.sub.trim()
			: undefined;
	return { email, sub };
}

export function devWebPrincipal(): RequestPrincipal {
	return { email: DEV_WEB_PRINCIPAL_EMAIL };
}

/**
 * Stable ACL keys for a principal. Email keys use both the normalized
 * address and the plus-stripped canonical form so hello+tag@x matches
 * an owner stored as email:hello@x.
 */
export function principalKeys(
	principal: RequestPrincipal | null | undefined,
): string[] {
	if (!principal) return [];
	const keys = new Set<string>();
	if (principal.email) {
		keys.add(`email:${principal.email}`);
		const canonical = canonicalMailboxId(principal.email);
		if (canonical) keys.add(`email:${canonical}`);
	}
	if (principal.sub) {
		keys.add(`sub:${principal.sub}`);
		// Password sessions use sub `user:<uuid>` — also match ACL `user:<uuid>`.
		if (principal.sub.startsWith("user:")) {
			keys.add(principal.sub);
		}
	}
	return [...keys];
}

export function normalizeAclKey(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const colon = trimmed.indexOf(":");
	const prefix = colon === -1 ? "" : trimmed.slice(0, colon).toLowerCase();
	const rest = colon === -1 ? trimmed : trimmed.slice(colon + 1);

	if (prefix === "email") {
		const email = normalizeEmailAddress(rest);
		return email ? `email:${email}` : null;
	}
	if (prefix === "sub") {
		const sub = rest.trim();
		return sub ? `sub:${sub}` : null;
	}
	if (prefix === "user") {
		const id = rest.trim();
		// Opaque password-account id (uuid). Also accept nested `user:user:<uuid>`.
		if (!id || id.includes(" ")) return null;
		return id.startsWith("user:") ? id : `user:${id}`;
	}
	const email = normalizeEmailAddress(trimmed);
	return email ? `email:${email}` : null;
}

function uniqueKeys(keys: string[]): string[] {
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

export function parseAcl(settings: unknown): MailboxAcl {
	if (!isRecord(settings) || !isRecord(settings.acl)) {
		return { owners: [], members: [] };
	}
	const owners = uniqueKeys(asStringArray(settings.acl.owners));
	const ownerSet = new Set(owners);
	const members = uniqueKeys(asStringArray(settings.acl.members)).filter(
		(key) => !ownerSet.has(key),
	);
	return { owners, members };
}

export function isUnclaimed(settings: unknown): boolean {
	return parseAcl(settings).owners.length === 0;
}

function principalSet(
	principal: RequestPrincipal | null | undefined,
): Set<string> {
	return new Set(principalKeys(principal));
}

/** Stored `email:hello+tag@x` matches a principal keyed as `email:hello@x`. */
function aclKeyMatchesPrincipal(aclKey: string, keys: Set<string>): boolean {
	if (keys.has(aclKey)) return true;
	if (!aclKey.startsWith("email:")) return false;
	const canonical = canonicalMailboxId(aclKey.slice("email:".length));
	return Boolean(canonical && keys.has(`email:${canonical}`));
}

function aclHasPrincipal(
	aclKeys: string[],
	principal: RequestPrincipal | null | undefined,
): boolean {
	const keys = principalSet(principal);
	if (keys.size === 0) return false;
	return aclKeys.some((key) => aclKeyMatchesPrincipal(key, keys));
}

function emailMatchesMailbox(
	principal: RequestPrincipal | null | undefined,
	mailboxId: string,
): boolean {
	if (!principal?.email) return false;
	const mailbox = canonicalMailboxId(mailboxId);
	const email = canonicalMailboxId(principal.email);
	return Boolean(mailbox && email && mailbox === email);
}

export function canAccessMailbox(
	settings: unknown,
	principal: RequestPrincipal | null | undefined,
	mailboxId: string,
): boolean {
	const acl = parseAcl(settings);
	if (aclHasPrincipal(acl.owners, principal)) return true;
	if (aclHasPrincipal(acl.members, principal)) return true;
	return isUnclaimed(settings) && emailMatchesMailbox(principal, mailboxId);
}

export function canManageAcl(
	settings: unknown,
	principal: RequestPrincipal | null | undefined,
): boolean {
	return aclHasPrincipal(parseAcl(settings).owners, principal);
}

/**
 * If the mailbox is unclaimed and the principal's email matches the
 * canonical mailbox id, return settings with that principal as sole owner.
 * Otherwise return null (caller should not write).
 */
export function claimIfUnclaimed(
	settings: Record<string, unknown>,
	principal: RequestPrincipal,
	mailboxId: string,
): Record<string, unknown> | null {
	if (!isUnclaimed(settings)) return null;
	if (!emailMatchesMailbox(principal, mailboxId)) return null;
	const mailbox = canonicalMailboxId(mailboxId);
	if (!mailbox) return null;
	return {
		...settings,
		acl: {
			owners: [`email:${mailbox}`],
			members: [] as string[],
		},
	};
}

export function validateAclWrite(incoming: unknown): AclWriteResult {
	if (!isRecord(incoming)) {
		return { ok: false, error: "ACL must be an object with owners and members" };
	}
	if (!Array.isArray(incoming.owners)) {
		return { ok: false, error: "ACL owners must be an array" };
	}
	const submittedOwners = asStringArray(incoming.owners);
	if (submittedOwners.some((key) => !normalizeAclKey(key))) {
		return { ok: false, error: "Invalid ACL owner key" };
	}
	const owners = uniqueKeys(submittedOwners);
	if (owners.length === 0) {
		return { ok: false, error: "Mailbox must have at least one owner" };
	}
	const submittedMembers = Array.isArray(incoming.members)
		? asStringArray(incoming.members)
		: [];
	if (submittedMembers.some((key) => !normalizeAclKey(key))) {
		return { ok: false, error: "Invalid ACL member key" };
	}
	const ownerSet = new Set(owners);
	const members = uniqueKeys(submittedMembers).filter((key) => !ownerSet.has(key));
	return { ok: true, acl: { owners, members } };
}

/** Non-owners cannot change acl; omitted acl is preserved by merge. */
export function applyIncomingAcl(
	existing: Record<string, unknown>,
	merged: Record<string, unknown>,
	incoming: unknown,
	principal: RequestPrincipal,
): { ok: true; settings: Record<string, unknown> } | { ok: false; error: string } {
	if (!isRecord(incoming) || !("acl" in incoming)) {
		return { ok: true, settings: merged };
	}
	if (!canManageAcl(existing, principal)) {
		if ("acl" in existing) merged.acl = existing.acl;
		else delete merged.acl;
		return { ok: true, settings: merged };
	}
	const validated = validateAclWrite(incoming.acl);
	if (!validated.ok) return { ok: false, error: validated.error };
	merged.acl = validated.acl;
	return { ok: true, settings: merged };
}

export async function loadMailboxSettingsRaw(
	bucket: R2Bucket,
	mailboxId: string,
): Promise<Record<string, unknown> | null> {
	const obj = await bucket.get(mailboxMetadataKey(mailboxId));
	if (!obj) return null;
	try {
		const parsed = await obj.json();
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* ignore corrupt blobs */
	}
	return {};
}

async function persistMailboxSettings(
	bucket: R2Bucket,
	mailboxId: string,
	settings: Record<string, unknown>,
): Promise<void> {
	await bucket.put(mailboxMetadataKey(mailboxId), JSON.stringify(settings));
}

export async function authorizeMailbox(
	bucket: R2Bucket,
	principal: RequestPrincipal | undefined,
	rawMailboxId: string,
): Promise<AuthorizeMailboxResult> {
	const mailboxId = resolveMailboxParam(rawMailboxId);
	if (!mailboxId) {
		return { ok: false, status: 400, error: "Invalid mailbox email address" };
	}
	if (!principal || principalKeys(principal).length === 0) {
		return { ok: false, status: 403, error: "Forbidden" };
	}
	const settings = await loadMailboxSettingsRaw(bucket, mailboxId);
	if (settings === null) {
		return { ok: false, status: 404, error: "Not found" };
	}
	if (!canAccessMailbox(settings, principal, mailboxId)) {
		return { ok: false, status: 403, error: "Forbidden" };
	}
	const claimed = claimIfUnclaimed(settings, principal, mailboxId);
	if (claimed) {
		await persistMailboxSettings(bucket, mailboxId, claimed);
		return { ok: true, mailboxId, settings: claimed };
	}
	return { ok: true, mailboxId, settings };
}

export async function filterMailboxesForPrincipal(
	bucket: R2Bucket,
	listed: { id: string; email: string }[],
	principal: RequestPrincipal,
): Promise<{ id: string; email: string }[]> {
	const allowed: { id: string; email: string }[] = [];
	await Promise.all(
		listed.map(async (entry) => {
			const mailboxId = canonicalMailboxId(entry.id) ?? entry.id;
			const settings = await loadMailboxSettingsRaw(bucket, mailboxId);
			if (settings === null) return;
			if (!canAccessMailbox(settings, principal, mailboxId)) return;
			const claimed = claimIfUnclaimed(settings, principal, mailboxId);
			if (claimed) {
				await persistMailboxSettings(bucket, mailboxId, claimed);
			}
			allowed.push({ id: mailboxId, email: mailboxId });
		}),
	);
	allowed.sort((a, b) => a.id.localeCompare(b.id));
	return allowed;
}

export function creatorAcl(principal: RequestPrincipal): MailboxAcl {
	const owners: string[] = [];
	if (principal.email) {
		const canonical = canonicalMailboxId(principal.email) ?? principal.email;
		owners.push(`email:${canonical}`);
	}
	if (principal.sub) owners.push(`sub:${principal.sub}`);
	return { owners: uniqueKeys(owners), members: [] };
}

export function mailboxAccessPayload(
	mailboxId: string,
	settings: Record<string, unknown>,
	principal: RequestPrincipal | undefined,
) {
	return {
		id: mailboxId,
		name: mailboxId,
		email: mailboxId,
		settings,
		canManage: canManageAcl(settings, principal),
	};
}
