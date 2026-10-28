// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Client-side helpers for Settings → Senders (AVE-97). The server
 * (`workers/lib/sender-rules.ts`) is the source of truth for validation;
 * this only decides which `kind` the Add field means and labels rows.
 * iOS (`SenderRuleInput`) and Android (`SenderRuleInput`) mirror it.
 */

export type SenderRuleInputKind = "address" | "domain";

/**
 * "ada@acme.com" is an address; "@acme.com" or "acme.com" is a domain.
 * Returns null for an empty field.
 */
export function parseSenderRuleInput(
	raw: string,
): { kind: SenderRuleInputKind; value: string } | null {
	const value = raw.trim().toLowerCase();
	if (!value) return null;
	if (value.startsWith("@")) return { kind: "domain", value: value.slice(1) };
	if (value.includes("@")) return { kind: "address", value };
	return { kind: "domain", value };
}

const SOURCE_LABELS: Record<string, string> = {
	not_spam: "Not spam",
	report_spam: "Reported spam",
	settings: "Added in Settings",
	screener: "Screener",
	sent: "You emailed them",
	bootstrap: "Imported",
};

/** Human label for a rule's `source`. */
export function senderRuleSourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? "Other";
}

/** What a rule row shows: `@acme.com` for domains, the address otherwise. */
export function senderRuleDisplayValue(rule: { kind: string; value: string }): string {
	return rule.kind === "domain" ? `@${rule.value}` : rule.value;
}
