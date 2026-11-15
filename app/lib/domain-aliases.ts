// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Domain aliases (AVE-239): `sales@domain` delivers into one of the domain's
 * mailboxes. Admin-only, managed from Admin → Mailboxes → Aliases. Worker routes:
 * `GET|POST /api/v1/admin/domains/:domain/aliases`, `DELETE …/aliases/:aliasLocal`
 * (`workers/routes/domain-dns.ts`). Same rules and copy as the native
 * `DomainAliases` helpers on iOS and Android (AVE-219).
 */

export interface DomainAliasItem {
	aliasLocal: string;
	aliasEmail: string;
	targetMailboxId: string;
	createdAt?: string | null;
}

export interface AliasTargetMailbox {
	id: string;
	email: string;
	name: string;
}

export const DOMAIN_ALIAS_COPY = {
	sectionTitle: "Aliases",
	addTitle: "Add alias",
	emptyMessage:
		"No aliases yet. An alias like sales@ delivers into one of this domain's mailboxes.",
	invalidLocal: "Use only letters, numbers, dots, dashes and underscores.",
	forbiddenTarget:
		"Aliases can only deliver to mailboxes on this domain or ones you can access.",
	addFailed: "Couldn't add the alias. Try again.",
	deleteFailed: "Couldn't delete the alias. Try again.",
	loadFailed: "Couldn't load aliases.",
	noTargets: "Create a mailbox on this domain first.",
	added: "Alias added",
	deleted: "Alias deleted",
} as const;

/** What the Worker stores: trimmed, lowercased, no leading `@`, nothing after an `@`. */
export function normalizedAliasLocal(input: string): string {
	let local = input.trim().toLowerCase().replace(/^@+/, "");
	const at = local.indexOf("@");
	if (at >= 0) local = local.slice(0, at);
	return local;
}

/** The Worker's `^[a-zA-Z0-9._-]+$` check (on the normalised, lowercase local part). */
export function isValidAliasLocal(local: string): boolean {
	return /^[a-z0-9._-]+$/.test(local);
}

/** Mailboxes an alias may deliver to: the domain's own, else every listed one. */
export function aliasTargets<T extends AliasTargetMailbox>(rows: T[], domain: string): T[] {
	const suffix = `@${domain.toLowerCase()}`;
	const onDomain = rows.filter((row) => row.email.toLowerCase().endsWith(suffix));
	return onDomain.length > 0 ? onDomain : rows;
}

export function sortedAliases<T extends DomainAliasItem>(aliases: T[]): T[] {
	return [...aliases].sort((a, b) =>
		a.aliasLocal < b.aliasLocal ? -1 : a.aliasLocal > b.aliasLocal ? 1 : 0,
	);
}

/**
 * Checked before the request: the Worker would 409 on a mailbox and silently
 * re-point an existing alias, so both are caught here.
 */
export function aliasConflict(
	local: string,
	domain: string,
	aliases: DomainAliasItem[],
	mailboxes: AliasTargetMailbox[],
): string | null {
	const email = `${local}@${domain.toLowerCase()}`;
	if (aliases.some((alias) => alias.aliasLocal.toLowerCase() === local)) {
		return `${email} is already an alias`;
	}
	if (mailboxes.some((row) => row.email.toLowerCase() === email)) {
		return `${email} is already a mailbox`;
	}
	return null;
}

/** Toast copy for a failed add: the Worker's sentence when it sent one. */
export function aliasAddErrorMessage(
	status: number | undefined,
	serverMessage: string | undefined,
): string {
	const server = serverMessage?.trim() ?? "";
	switch (status) {
		case 400:
			// "Invalid alias local part" reads better as the rule it broke.
			return !server || server === "Invalid alias local part"
				? DOMAIN_ALIAS_COPY.invalidLocal
				: server;
		case 403:
			return server || DOMAIN_ALIAS_COPY.forbiddenTarget;
		default:
			// 409 carries "x@domain is already a mailbox" / "… in use by a private email".
			return server || DOMAIN_ALIAS_COPY.addFailed;
	}
}

/** Toast copy for a failed delete: the Worker's sentence when it sent one. */
export function aliasDeleteErrorMessage(serverMessage: string | undefined): string {
	const server = serverMessage?.trim() ?? "";
	return server || DOMAIN_ALIAS_COPY.deleteFailed;
}

export function aliasDeleteConfirmMessage(alias: DomainAliasItem): string {
	return `Mail sent to ${alias.aliasEmail} will stop reaching ${alias.targetMailboxId}.`;
}

export function aliasDeliversToFooter(local: string, domain: string): string {
	const address = local ? `${local}@${domain}` : "the alias";
	return `Mail sent to ${address} is delivered to this mailbox.`;
}
