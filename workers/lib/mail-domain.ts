// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Mailbox domain resolution for OSS / self-hosted and hosted SaaS.
 *
 * Priority for the default suffix (`mailDomain`):
 *   1. `MAIL_DOMAIN` (single primary domain)
 *   2. First entry of `DOMAINS` (comma-separated)
 *   3. `inboxies.email` only when both are unset (migration default)
 *
 * `domains` is the create-UI picker list: `MAIL_DOMAIN` (if set) plus `DOMAINS`,
 * deduped, or `[mailDomain]` when nothing is configured.
 */

/** Hosted SaaS fallback — used only when env vars are unset. */
export const FALLBACK_MAIL_DOMAIN = "inboxies.email";

export type MailDomainEnv = {
	MAIL_DOMAIN?: string;
	DOMAINS?: string;
};

function normalizeDomain(raw: string): string {
	return raw.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

/** Parse comma-separated `DOMAINS` into unique lowercase hosts. */
export function parseDomainsList(domainsRaw: string | undefined): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of (domainsRaw || "").split(",")) {
		const d = normalizeDomain(part);
		if (!d || seen.has(d)) continue;
		seen.add(d);
		out.push(d);
	}
	return out;
}

/**
 * Default mailbox domain suffix for create-address UI and invite From addresses.
 */
export function resolveMailDomain(env: MailDomainEnv): string {
	const explicit = env.MAIL_DOMAIN ? normalizeDomain(env.MAIL_DOMAIN) : "";
	if (explicit) return explicit;
	const fromList = parseDomainsList(env.DOMAINS);
	return fromList[0] || FALLBACK_MAIL_DOMAIN;
}

/**
 * Domains offered in create-mailbox pickers. Always non-empty (includes fallback).
 * When `MAIL_DOMAIN` is set, it leads the list even if also present in `DOMAINS`.
 */
export function resolveConfiguredDomains(env: MailDomainEnv): string[] {
	const mailDomain = resolveMailDomain(env);
	const fromList = parseDomainsList(env.DOMAINS);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const d of [mailDomain, ...fromList]) {
		if (!d || seen.has(d)) continue;
		seen.add(d);
		out.push(d);
	}
	return out;
}

/** Public `/api/v1/config` payload slice for mail domains. */
export function mailDomainConfig(env: MailDomainEnv): {
	mailDomain: string;
	domains: string[];
} {
	return {
		mailDomain: resolveMailDomain(env),
		domains: resolveConfiguredDomains(env),
	};
}
