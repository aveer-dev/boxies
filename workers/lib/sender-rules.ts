// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Sender rules: the explicit per-mailbox allow / block list
 * (docs/spam-management-plan.md §5 "Sender rules", §7; AVE-96). Stored in
 * the mailbox Durable Object's `sender_rules` table (migration
 * `38_sender_rules`) and queried with raw SQL here, so the same code runs
 * in the DO and on node:sqlite in tests.
 *
 * - A rule is an **address** (`ada@acme.com`) or a **domain** (`acme.com`)
 *   with a verdict of `allow` or `block`.
 * - Domain values are the registrable domain from the Public Suffix List
 *   (`mail.acme.co.uk` → `acme.co.uk`) and match the domain and every
 *   subdomain (relaxed, like DMARC). A public suffix (`co.uk`, `github.io`)
 *   or a free-mail provider (`gmail.com`) can't be a domain rule.
 * - Address rules beat domain rules. A domain **allow** only ever applies to
 *   `verified` mail; a block applies whatever the tier. Auth `failed` mail
 *   matches no rule: it goes to Spam whatever the user said (§5 step 1).
 *
 * `sender_triage` keeps its Screener role; this table is the explicit spam
 * list the inbound path consults before it.
 */

import { parse as parseHostname } from "tldts";
import type { AuthTier } from "./email-auth.ts";
import { normalizeEmailAddress } from "./mail-automations.ts";
import { canonicalMailboxId } from "./mailbox-routing.ts";

type Sql = Pick<SqlStorage, "exec">;

export const SENDER_RULE_KINDS = ["address", "domain"] as const;
export type SenderRuleKind = (typeof SENDER_RULE_KINDS)[number];

export const SENDER_RULE_VERDICTS = ["allow", "block"] as const;
export type SenderRuleVerdict = (typeof SENDER_RULE_VERDICTS)[number];

/** Who made the rule (§5). Settings is the only place domain rules come from. */
export const SENDER_RULE_SOURCES = [
	"not_spam",
	"report_spam",
	"settings",
	"screener",
	"sent",
	"bootstrap",
] as const;
export type SenderRuleSource = (typeof SENDER_RULE_SOURCES)[number];

export interface SenderRule {
	id: string;
	kind: SenderRuleKind;
	value: string;
	verdict: SenderRuleVerdict;
	source: string;
	createdAt: string;
	updatedAt: string;
	lastMatchedAt: string | null;
	matchCount: number;
}

const ADDRESS_MAX = 320;
const DOMAIN_MAX = 253;
const LIST_LIMIT_DEFAULT = 100;
const LIST_LIMIT_MAX = 500;

// ── Free-mail providers ──────────────────────────────────────────

/**
 * Shared mail services: a domain rule here would allow or block everyone who
 * uses them, so Settings refuses it (§7, decision 6). Address rules still work.
 * Registrable domains, compared after PSL normalization.
 */
export const FREE_MAIL_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
	// Google
	"gmail.com",
	"googlemail.com",
	// Microsoft (hotmail.* / outlook.* / live.* are covered by brand below)
	"msn.com",
	"passport.com",
	// Yahoo (yahoo.* by brand)
	"ymail.com",
	"rocketmail.com",
	// Apple
	"icloud.com",
	"me.com",
	"mac.com",
	// AOL (aol.* by brand)
	"aim.com",
	// Proton
	"proton.me",
	"protonmail.com",
	"protonmail.ch",
	"pm.me",
	// GMX / mail.com / web.de (gmx.* by brand)
	"mail.com",
	"email.com",
	"web.de",
	// Zoho
	"zoho.com",
	"zohomail.com",
	"zohomail.eu",
	// Yandex / Mail.ru (yandex.* by brand)
	"ya.ru",
	"mail.ru",
	"inbox.ru",
	"list.ru",
	"bk.ru",
	// Tuta / Fastmail / HEY
	"tutanota.com",
	"tutanota.de",
	"tutamail.com",
	"tuta.io",
	"tuta.com",
	"fastmail.com",
	"fastmail.fm",
	"hey.com",
	// Asia
	"qq.com",
	"163.com",
	"126.com",
	"yeah.net",
	"sina.com",
	"naver.com",
	"daum.net",
	"hanmail.net",
	"rediffmail.com",
	// ISPs and national providers
	"t-online.de",
	"orange.fr",
	"wanadoo.fr",
	"free.fr",
	"laposte.net",
	"libero.it",
	"virgilio.it",
	"comcast.net",
	"verizon.net",
	"att.net",
	"sbcglobal.net",
	"bellsouth.net",
	"cox.net",
	"btinternet.com",
	"sky.com",
	// Inboxies' own shared address domain: one domain, many unrelated people.
	"inboxies.email",
]);

/**
 * Providers that run the same service under many country domains
 * (`hotmail.co.uk`, `yahoo.co.jp`, `gmx.at`…): matched on the registrable
 * domain's first label, whatever the public suffix.
 */
export const FREE_MAIL_PROVIDER_BRANDS: ReadonlySet<string> = new Set([
	"gmail",
	"hotmail",
	"outlook",
	"live",
	"windowslive",
	"yahoo",
	"aol",
	"gmx",
	"yandex",
]);

// ── Domain normalization ─────────────────────────────────────────

/** Lower-case ASCII (punycode) hostname, or null when it isn't one. */
function asciiHostname(raw: string): string | null {
	const host = raw.trim().toLowerCase().replace(/\.+$/, "");
	if (!host || host.length > DOMAIN_MAX || /[\s/@:?#[\]\\]/.test(host)) return null;
	try {
		// WHATWG URL applies IDNA, so `bücher.de` and `xn--bcher-kva.de` agree.
		return new URL(`http://${host}/`).hostname || null;
	} catch {
		return null;
	}
}

export type DomainCheck =
	| { ok: true; domain: string }
	| { ok: false; reason: "invalid" | "public_suffix" };

/**
 * The registrable domain (eTLD+1, private PSL section included) for a
 * hostname. `co.uk`, `com` and `github.io` are public suffixes; IP literals
 * and single labels are invalid.
 */
export function checkRegistrableDomain(raw: string): DomainCheck {
	const host = asciiHostname(raw);
	if (!host) return { ok: false, reason: "invalid" };
	const parsed = parseHostname(host, { allowPrivateDomains: true });
	if (parsed.isIp || !parsed.hostname) return { ok: false, reason: "invalid" };
	if (!parsed.hostname.includes(".")) {
		// `com` is a public suffix; `acme` isn't a domain at all.
		const known = parsed.isIcann === true || parsed.isPrivate === true;
		return { ok: false, reason: known ? "public_suffix" : "invalid" };
	}
	// A TLD the bundled list doesn't know yet falls under the PSL default
	// rule (`*`), so `acme.newtld` is still registrable.
	if (!parsed.domain) return { ok: false, reason: "public_suffix" };
	return { ok: true, domain: parsed.domain };
}

/** Registrable domain of an address's domain part, or null. */
export function senderRegistrableDomain(address: string | null | undefined): string | null {
	const normalized = normalizeEmailAddress(address);
	if (!normalized) return null;
	const check = checkRegistrableDomain(normalized.slice(normalized.lastIndexOf("@") + 1));
	return check.ok ? check.domain : null;
}

/** Whether a registrable domain belongs to a shared free-mail service. */
export function isFreeMailDomain(domain: string): boolean {
	const normalized = domain.trim().toLowerCase();
	if (FREE_MAIL_PROVIDER_DOMAINS.has(normalized)) return true;
	const brand = normalized.split(".")[0];
	return FREE_MAIL_PROVIDER_BRANDS.has(brand);
}

// ── Request validation ───────────────────────────────────────────

export type SenderRuleErrorCode =
	| "invalid_kind"
	| "invalid_verdict"
	| "invalid_source"
	| "invalid_address"
	| "own_address"
	| "invalid_domain"
	| "public_suffix"
	| "free_mail_provider";

export type SenderRuleInputResult =
	| {
			ok: true;
			rule: { kind: SenderRuleKind; value: string; verdict: SenderRuleVerdict; source: SenderRuleSource };
	  }
	| { ok: false; code: SenderRuleErrorCode; error: string };

function fail(code: SenderRuleErrorCode, error: string): SenderRuleInputResult {
	return { ok: false, code, error };
}

/**
 * Validates and normalizes a `PUT sender-rules` body. Domain values may be
 * written `acme.com`, `@acme.com` or `mail.acme.com`; they're stored as the
 * registrable domain. Your own address can't be a rule.
 */
export function normalizeSenderRuleInput(
	body: unknown,
	options: { mailboxId: string },
): SenderRuleInputResult {
	const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
	const { kind, verdict, value } = input;
	const source = input.source ?? "settings";

	if (typeof kind !== "string" || !(SENDER_RULE_KINDS as readonly string[]).includes(kind)) {
		return fail("invalid_kind", "kind must be address or domain");
	}
	if (typeof verdict !== "string" || !(SENDER_RULE_VERDICTS as readonly string[]).includes(verdict)) {
		return fail("invalid_verdict", "verdict must be allow or block");
	}
	if (typeof source !== "string" || !(SENDER_RULE_SOURCES as readonly string[]).includes(source)) {
		return fail("invalid_source", `source must be one of ${SENDER_RULE_SOURCES.join(", ")}`);
	}
	const raw = typeof value === "string" ? value.trim() : "";

	if (kind === "address") {
		const address = raw.length <= ADDRESS_MAX ? normalizeEmailAddress(raw) : null;
		if (!address || !checkRegistrableDomain(address.slice(address.lastIndexOf("@") + 1)).ok) {
			return fail("invalid_address", "Enter a valid email address");
		}
		if (canonicalMailboxId(address) === canonicalMailboxId(options.mailboxId)) {
			return fail("own_address", "You can't allow or block your own address");
		}
		return {
			ok: true,
			rule: { kind, value: address, verdict: verdict as SenderRuleVerdict, source: source as SenderRuleSource },
		};
	}

	const check = checkRegistrableDomain(raw.replace(/^@/, ""));
	if (!check.ok) {
		return check.reason === "public_suffix"
			? fail("public_suffix", `${raw.replace(/^@/, "")} is shared by many organizations; add an address or a full domain instead`)
			: fail("invalid_domain", "Enter a valid domain, like @example.com");
	}
	if (isFreeMailDomain(check.domain)) {
		return fail(
			"free_mail_provider",
			`${check.domain} is a free email provider; add the sender's address instead`,
		);
	}
	return {
		ok: true,
		rule: { kind: "domain", value: check.domain, verdict: verdict as SenderRuleVerdict, source: source as SenderRuleSource },
	};
}

// ── Matching ─────────────────────────────────────────────────────

/**
 * Which rule decides a message (§5 precedence, first match wins):
 * auth `failed` → none (Spam regardless); then the address rule, allow or
 * block; then the domain rule, where an allow needs `verified` mail.
 * An unverified message never matches a domain allow.
 */
export function pickSenderRule<R extends Pick<SenderRule, "kind" | "verdict">>(input: {
	addressRule: R | null;
	domainRule: R | null;
	authTier: AuthTier | null | undefined;
}): R | null {
	if (input.authTier === "failed") return null;
	if (input.addressRule) return input.addressRule;
	const domain = input.domainRule;
	if (!domain) return null;
	if (domain.verdict === "allow" && input.authTier !== "verified") return null;
	return domain;
}

/** A sender_triage row as the inbound router reads it. */
export interface TriageLike {
	sender: string;
	status: "allowed" | "rejected";
	destination_folder_id: string | null;
	display_name?: string | null;
	decided_at: string;
	updated_at: string;
}

/**
 * The Screener status the inbound router should act on once a rule matched:
 * a block files like a rejected sender (Screened out, or Spam with Screener
 * off); an allow lets the sender past Screener, keeping any purpose box the
 * triage row already had. With no rule, the triage row stands.
 */
export function triageWithSenderRule<T extends TriageLike>(
	triage: T | null,
	rule: Pick<SenderRule, "verdict"> | null,
	sender: string,
	now = new Date().toISOString(),
): T | TriageLike | null {
	if (!rule) return triage;
	const base: TriageLike = triage ?? {
		sender,
		status: "allowed",
		destination_folder_id: null,
		display_name: null,
		decided_at: now,
		updated_at: now,
	};
	if (rule.verdict === "block") {
		return triage?.status === "rejected" ? triage : { ...base, status: "rejected", destination_folder_id: null };
	}
	return triage?.status === "allowed" ? triage : { ...base, status: "allowed", destination_folder_id: null };
}

// ── SQL ──────────────────────────────────────────────────────────

type SenderRuleRow = {
	id: string;
	kind: string;
	value: string;
	verdict: string;
	source: string;
	created_at: string;
	updated_at: string;
	last_matched_at: string | null;
	match_count: number | bigint;
};

const COLUMNS = `id, kind, value, verdict, source, created_at, updated_at, last_matched_at, match_count`;

function toRule(row: SenderRuleRow): SenderRule {
	return {
		id: row.id,
		kind: row.kind as SenderRuleKind,
		value: row.value,
		verdict: row.verdict as SenderRuleVerdict,
		source: row.source,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		lastMatchedAt: row.last_matched_at ?? null,
		matchCount: Number(row.match_count) || 0,
	};
}

function first(sql: Sql, query: string, ...bindings: unknown[]): SenderRule | null {
	const row = [...sql.exec(query, ...bindings)][0] as SenderRuleRow | undefined;
	return row ? toRule(row) : null;
}

export function getSenderRule(sql: Sql, id: string): SenderRule | null {
	return first(sql, `SELECT ${COLUMNS} FROM sender_rules WHERE id = ?1`, id);
}

export function findSenderRule(sql: Sql, kind: SenderRuleKind, value: string): SenderRule | null {
	return first(sql, `SELECT ${COLUMNS} FROM sender_rules WHERE kind = ?1 AND value = ?2`, kind, value);
}

export function listSenderRules(
	sql: Sql,
	options: { verdict?: string | null; kind?: string | null; q?: string | null; limit?: number | null } = {},
): SenderRule[] {
	const clauses: string[] = [];
	const params: (string | number)[] = [];
	if (options.verdict && (SENDER_RULE_VERDICTS as readonly string[]).includes(options.verdict)) {
		params.push(options.verdict);
		clauses.push(`verdict = ?${params.length}`);
	}
	if (options.kind && (SENDER_RULE_KINDS as readonly string[]).includes(options.kind)) {
		params.push(options.kind);
		clauses.push(`kind = ?${params.length}`);
	}
	const q = (options.q ?? "").trim().toLowerCase().replace(/^@/, "");
	if (q) {
		// instr, not LIKE: `_` and `%` in a search are literal characters.
		params.push(q);
		clauses.push(`instr(value, ?${params.length}) > 0`);
	}
	const limit = Math.min(Math.max(Math.trunc(options.limit ?? LIST_LIMIT_DEFAULT) || LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
	params.push(limit);
	const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
	return [
		...sql.exec(
			`SELECT ${COLUMNS} FROM sender_rules ${where}
			 ORDER BY updated_at DESC, value ASC
			 LIMIT ?${params.length}`,
			...params,
		),
	].map((row) => toRule(row as SenderRuleRow));
}

/**
 * Creates the rule, or changes the verdict and source of the existing rule
 * for the same address / domain (one rule per value). Input must already be
 * normalized (normalizeSenderRuleInput).
 */
export function upsertSenderRule(
	sql: Sql,
	input: { kind: SenderRuleKind; value: string; verdict: SenderRuleVerdict; source: string },
	options: { id?: string; now?: string } = {},
): { rule: SenderRule; created: boolean } {
	const now = options.now ?? new Date().toISOString();
	const existing = findSenderRule(sql, input.kind, input.value);
	if (existing) {
		sql.exec(
			`UPDATE sender_rules SET verdict = ?1, source = ?2, updated_at = ?3 WHERE id = ?4`,
			input.verdict,
			input.source,
			now,
			existing.id,
		);
		return { rule: getSenderRule(sql, existing.id)!, created: false };
	}
	const id = options.id ?? crypto.randomUUID();
	sql.exec(
		`INSERT INTO sender_rules (id, kind, value, verdict, source, created_at, updated_at)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
		id,
		input.kind,
		input.value,
		input.verdict,
		input.source,
		now,
	);
	return { rule: getSenderRule(sql, id)!, created: true };
}

/**
 * Deletes a rule; returns it, or null when there's none with that id.
 * Removing an address **block** also drops the sender's `rejected` Screener
 * row, so "unblock" in Settings really unblocks: their next message goes
 * back through Screener as an undecided sender instead of to Screened out.
 * Run inside `transactionSync` in the DO.
 */
export function deleteSenderRule(sql: Sql, id: string): SenderRule | null {
	const rule = getSenderRule(sql, id);
	if (!rule) return null;
	sql.exec(`DELETE FROM sender_rules WHERE id = ?1`, id);
	if (rule.kind === "address" && rule.verdict === "block") {
		sql.exec(`DELETE FROM sender_triage WHERE sender = ?1 AND status = 'rejected'`, rule.value);
	}
	return rule;
}

/**
 * The rule that decides inbound mail from `sender` with this auth tier
 * (pickSenderRule), with its match stats bumped. Null when none applies.
 */
export function matchSenderRule(
	sql: Sql,
	sender: string | null | undefined,
	authTier: AuthTier | null | undefined,
	now = new Date().toISOString(),
): SenderRule | null {
	if (authTier === "failed") return null;
	const address = normalizeEmailAddress(sender);
	if (!address) return null;
	const domain = senderRegistrableDomain(address);
	const rule = pickSenderRule({
		addressRule: findSenderRule(sql, "address", address),
		domainRule: domain ? findSenderRule(sql, "domain", domain) : null,
		authTier,
	});
	if (!rule) return null;
	sql.exec(
		`UPDATE sender_rules SET match_count = match_count + 1, last_matched_at = ?1 WHERE id = ?2`,
		now,
		rule.id,
	);
	return { ...rule, matchCount: rule.matchCount + 1, lastMatchedAt: now };
}

/**
 * The `matched_rule_id` to store on an inbound email: the rule's id when it
 * decided the folder, else null. A block decides when the sender was filed
 * as rejected; an allow decides unless the message still went to Spam
 * (spam headers on unverified mail, for one).
 */
export function decidingSenderRuleId(
	rule: Pick<SenderRule, "id" | "verdict"> | null,
	decision: { triageAction: string },
): string | null {
	if (!rule) return null;
	if (rule.verdict === "block") return decision.triageAction === "rejected" ? rule.id : null;
	return decision.triageAction === "spam" ? null : rule.id;
}
