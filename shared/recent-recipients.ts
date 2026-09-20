// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Aggregate a “people I’ve emailed” list from Sent rows.
 * Used by the recipients autocomplete API — not a contacts product.
 *
 * Kept free of sibling shared imports so Node unit tests can load it
 * with `--experimental-strip-types` (same pattern as workers/lib/email-fts).
 */

export interface SentRecipientRow {
	recipient?: string | null;
	cc?: string | null;
	bcc?: string | null;
	date?: string | null;
}

export interface RecentRecipient {
	email: string;
	name: string | null;
	lastEmailedAt: string | null;
}

export interface AggregateRecentRecipientsOptions {
	/** Case-insensitive substring filter on email or name. */
	q?: string | null;
	/** Max results to return (default 20, capped at hardCap). */
	limit?: number;
	/**
	 * Upper bound for `limit`. Autocomplete keeps 50; bootstrap may raise
	 * this to scan a larger Sent graph.
	 */
	hardCap?: number;
	/** Optional email → display name map from inbound senders. */
	knownNames?: Map<string, string> | Record<string, string | null | undefined>;
}

function splitAddressList(value?: string | null): string[] {
	return (value || "")
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function normalizeAddress(address: string): string {
	const trimmed = address.trim();
	if (!trimmed) return "";
	const angle = trimmed.match(/<([^>]+)>/);
	return (angle ? angle[1] : trimmed).trim().toLowerCase();
}

function looksLikeEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeDisplayName(name?: string | null): string | null {
	if (!name) return null;
	const trimmed = name.trim();
	if (!trimmed || looksLikeEmail(trimmed)) return null;
	return trimmed;
}

/** Pull a display name from `Name <email@x>` (or quoted name). */
function parseEntryDisplayName(value: string): string | null {
	const decoded = value.trim();
	if (!decoded) return null;
	const lt = decoded.lastIndexOf("<");
	const gt = decoded.lastIndexOf(">");
	if (lt === -1 || gt <= lt) return null;
	let name = decoded.slice(0, lt).trim();
	if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
		name = name.slice(1, -1).replace(/\\"/g, '"');
	}
	return normalizeDisplayName(name);
}

function lookupKnownName(
	email: string,
	knownNames?: AggregateRecentRecipientsOptions["knownNames"],
): string | null {
	if (!knownNames) return null;
	if (knownNames instanceof Map) {
		return normalizeDisplayName(knownNames.get(email) ?? null);
	}
	return normalizeDisplayName(knownNames[email] ?? null);
}

function extractEntry(entry: string): { email: string; name: string | null } | null {
	const email = normalizeAddress(entry);
	if (!email || !email.includes("@")) return null;
	return { email, name: parseEntryDisplayName(entry) };
}

/**
 * Build a ranked, deduped recipient suggestion list from recent Sent rows.
 * Rows should already be ordered newest-first; ranking follows first-seen order.
 */
export function aggregateRecentRecipients(
	rows: SentRecipientRow[],
	options: AggregateRecentRecipientsOptions = {},
): RecentRecipient[] {
	const hardCap = Math.max(options.hardCap ?? 50, 1);
	const limit = Math.min(Math.max(options.limit ?? 20, 1), hardCap);
	const query = (options.q || "").trim().toLowerCase();

	const byEmail = new Map<string, RecentRecipient>();

	for (const row of rows) {
		const date = row.date ?? null;
		const fields = [row.recipient, row.cc, row.bcc];
		for (const field of fields) {
			for (const entry of splitAddressList(field)) {
				const parsed = extractEntry(entry);
				if (!parsed) continue;
				const existing = byEmail.get(parsed.email);
				if (existing) {
					if (!existing.name && parsed.name) existing.name = parsed.name;
					continue;
				}
				const known = lookupKnownName(parsed.email, options.knownNames);
				byEmail.set(parsed.email, {
					email: parsed.email,
					name: parsed.name ?? known,
					lastEmailedAt: date,
				});
			}
		}
	}

	let results = Array.from(byEmail.values());

	if (query) {
		results = results.filter((r) => {
			const emailMatch = r.email.includes(query);
			const nameMatch = (r.name || "").toLowerCase().includes(query);
			return emailMatch || nameMatch;
		});
	}

	return results.slice(0, limit);
}
