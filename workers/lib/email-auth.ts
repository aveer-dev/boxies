// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbound SPF/DKIM/DMARC signals from Authentication-Results (RFC 8601)
 * and Cloudflare ARC-Authentication-Results. Trust-signal only — not a
 * cryptographic verifier.
 */

import {
	headerMapFromSource,
	normalizeEmailAddress,
	type HeaderEntry,
	type HeaderSource,
} from "./mail-automations.ts";

export type AuthVerdict =
	| "pass"
	| "fail"
	| "softfail"
	| "neutral"
	| "none"
	| "temperror"
	| "permerror"
	| "policy"
	| "unknown";

export type AuthSource =
	| "authentication-results"
	| "arc-authentication-results"
	| "none";

/**
 * How far the visible From can be trusted (docs/spam-management-plan.md §5).
 * - verified: DMARC pass, or SPF/DKIM pass aligned with the From domain.
 * - unverified: no trusted verdict, or passes only for another domain
 *   without an enforcing DMARC policy. Not spam on its own.
 * - failed: dmarc=fail under p=quarantine/reject, or SPF hard-fail with no
 *   DKIM pass for any domain. The only tier treated as spoofed.
 */
export type AuthTier = "verified" | "unverified" | "failed";

export type DmarcPolicy = "none" | "quarantine" | "reject";

export interface EmailAuth {
	spf?: AuthVerdict;
	dkim?: AuthVerdict;
	dmarc?: AuthVerdict;
	dkimDomain?: string;
	spfMailfrom?: string;
	headerFrom: string;
	envelopeFrom: string;
	/** null when no trusted Cloudflare verdict is present. */
	aligned: boolean | null;
	/** Published DMARC policy of the From domain, when the verdict states it. */
	dmarcPolicy?: DmarcPolicy;
	authTier: AuthTier;
	/**
	 * Set when the tier was raised to `verified` on the strength of a
	 * trusted upstream ARC sealer (see `TRUSTED_ARC_SEALERS`): the sealer's
	 * `d=` domain.
	 */
	arcSealer?: string;
	/**
	 * Compat for stored rows and clients: always `authTier === "failed"`.
	 * New code should read `authTier`.
	 */
	spoofed: boolean;
	source: AuthSource;
}

export interface ParseAuthSignalsInput {
	mimeHeaders?: HeaderSource;
	envelopeHeaders?: HeaderSource;
	headerFrom?: string | null;
	envelopeFrom?: string | null;
}

const TRUSTED_AR_NAMES = [
	"authentication-results",
	"arc-authentication-results",
	"received-spf",
] as const;

const VERDICT_WORDS = new Set<AuthVerdict>([
	"pass",
	"fail",
	"softfail",
	"neutral",
	"none",
	"temperror",
	"permerror",
	"policy",
	"unknown",
]);

interface MethodHit {
	method: string;
	result: AuthVerdict;
	properties: Record<string, string>;
}

interface ParsedAuthHeader {
	/** ARC instance (`i=N`), only on ARC-Authentication-Results. */
	instance?: number;
	authserv: string;
	methods: MethodHit[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isTrustedAuthserv(id: string | null | undefined): boolean {
	if (!id) return false;
	const host = id.trim().toLowerCase().replace(/\.$/, "").split(/\s+/)[0] ?? "";
	return host === "cloudflare.net" || host.endsWith(".cloudflare.net");
}

const AUTH_TIERS = new Set<AuthTier>(["verified", "unverified", "failed"]);

function isAuthTier(value: unknown): value is AuthTier {
	return typeof value === "string" && AUTH_TIERS.has(value as AuthTier);
}

/** Tier of an auth record; records from before tiers fall back to `spoofed`. */
export function authTierOf(
	auth?: Pick<EmailAuth, "authTier" | "spoofed" | "aligned"> | null,
): AuthTier {
	if (!auth) return "unverified";
	if (isAuthTier(auth.authTier)) return auth.authTier;
	if (auth.spoofed === true) return "failed";
	return auth.aligned === true ? "verified" : "unverified";
}

/** Proven forgery: the only tier that is spam on auth alone. */
export function isAuthFailed(auth?: EmailAuth | null): boolean {
	return authTierOf(auth) === "failed";
}

/**
 * The visible From isn't proven: auth failed, or a trusted verdict passed
 * only for some other domain. Sender filters and auto-drafts stay off for
 * this mail, as they did before tiers; it is not spam by itself.
 */
export function isFromUntrusted(auth?: EmailAuth | null): boolean {
	return isAuthFailed(auth) || auth?.aligned === false;
}

export function domainFromAddress(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim().replace(/^<|>$/g, "").replace(/\.+$/, "");
	if (!trimmed) return null;
	const addr = normalizeEmailAddress(trimmed) ?? trimmed.toLowerCase();
	const at = addr.lastIndexOf("@");
	if (at >= 0 && at < addr.length - 1) {
		const domain = addr.slice(at + 1).replace(/^\./, "").replace(/\.+$/, "");
		return domain || null;
	}
	if (addr.includes(".") && !/\s/.test(addr) && !addr.includes("@")) {
		return addr.replace(/^\./, "") || null;
	}
	return null;
}

/** Exact or dot-suffix match. No public-suffix list in v1. */
export function domainsAligned(
	headerDomain: string | null | undefined,
	authDomain: string | null | undefined,
): boolean {
	if (!headerDomain || !authDomain) return false;
	const a = headerDomain.toLowerCase().replace(/^\./, "").replace(/\.+$/, "");
	const b = authDomain.toLowerCase().replace(/^\./, "").replace(/\.+$/, "");
	if (!a || !b) return false;
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function stripComments(value: string): string {
	let out = "";
	let i = 0;
	let inQuote = false;
	let depth = 0;
	while (i < value.length) {
		const c = value[i];
		if (c === "\\" && inQuote) {
			out += c + (value[i + 1] ?? "");
			i += 2;
			continue;
		}
		if (c === '"') {
			inQuote = !inQuote;
			out += c;
			i++;
			continue;
		}
		if (!inQuote && c === "(") {
			depth++;
			i++;
			continue;
		}
		if (!inQuote && c === ")" && depth > 0) {
			depth--;
			i++;
			continue;
		}
		if (depth === 0) out += c;
		i++;
	}
	return out.replace(/\s+/g, " ").trim();
}

function splitUnquoted(value: string, delimiter: string): string[] {
	const parts: string[] = [];
	let current = "";
	let inQuote = false;
	for (let i = 0; i < value.length; i++) {
		const c = value[i];
		if (c === "\\" && inQuote) {
			current += c + (value[i + 1] ?? "");
			i++;
			continue;
		}
		if (c === '"') {
			inQuote = !inQuote;
			current += c;
			continue;
		}
		if (!inQuote && c === delimiter) {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += c;
	}
	if (current.trim()) parts.push(current.trim());
	return parts.filter(Boolean);
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
		return trimmed.slice(1, -1).replace(/\\"/g, '"');
	}
	return trimmed;
}

function parseMethodPart(part: string): MethodHit | null {
	const tokens = part.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return null;
	const first = tokens[0];
	const eq = first.indexOf("=");
	if (eq <= 0) return null;
	const method = first.slice(0, eq).trim().toLowerCase();
	const resultRaw = first.slice(eq + 1).trim().toLowerCase();
	if (!method || !resultRaw) return null;
	const result = VERDICT_WORDS.has(resultRaw as AuthVerdict)
		? (resultRaw as AuthVerdict)
		: "unknown";
	const properties: Record<string, string> = {};
	for (const token of tokens.slice(1)) {
		const propEq = token.indexOf("=");
		if (propEq <= 0) continue;
		const key = token.slice(0, propEq).trim().toLowerCase();
		const val = unquote(token.slice(propEq + 1));
		if (key) properties[key] = val;
	}
	return { method, result, properties };
}

export function parseAuthenticationResultsValue(
	value: string,
): ParsedAuthHeader | null {
	const stripped = stripComments(value);
	if (!stripped) return null;
	const parts = splitUnquoted(stripped, ";");
	if (parts.length === 0) return null;

	let index = 0;
	let instance: number | undefined;
	const instanceMatch = /^i=(\d+)$/i.exec(parts[0]);
	if (instanceMatch) {
		index = 1;
		instance = Number(instanceMatch[1]);
	}
	if (index >= parts.length) return null;

	const authserv = (parts[index] ?? "").trim().split(/\s+/)[0] ?? "";
	if (!authserv) return null;

	const methods: MethodHit[] = [];
	for (const part of parts.slice(index + 1)) {
		if (!part || /^none$/i.test(part)) continue;
		const hit = parseMethodPart(part);
		if (hit) methods.push(hit);
	}
	return instance === undefined ? { authserv, methods } : { instance, authserv, methods };
}

function parseReceivedSpf(value: string): MethodHit | null {
	const stripped = stripComments(value);
	const first = stripped.split(/\s+/)[0]?.toLowerCase() ?? "";
	if (!first) return null;
	const result = VERDICT_WORDS.has(first as AuthVerdict)
		? (first as AuthVerdict)
		: "unknown";
	const properties: Record<string, string> = {};
	const re = /([a-z0-9._-]+)=("(?:\\.|[^"\\])*"|[^\s;]+)/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(stripped)) !== null) {
		properties[match[1].toLowerCase()] = unquote(match[2]);
	}
	const envelope =
		properties["envelope-from"] ||
		properties["envelope_from"] ||
		properties["smtp.mailfrom"];
	if (envelope) properties["smtp.mailfrom"] = envelope;
	return { method: "spf", result, properties };
}

/**
 * Each receiving hop prepends its results, so the first Cloudflare-stamped
 * header from the top is ours; a sender can only add forged ones below it.
 * This relies on `values` being in true order and never merged.
 */
function firstTrusted(values: string[]): ParsedAuthHeader | null {
	for (const value of values) {
		const parsed = parseAuthenticationResultsValue(value);
		if (parsed && isTrustedAuthserv(parsed.authserv)) return parsed;
	}
	return null;
}

/**
 * When both a plain and an ARC results header are present we can't tell
 * which one our hop wrote, so take the one that passes less: a forged pass
 * must never outvote a real fail.
 */
function stricterResults(
	a: ParsedAuthHeader | null,
	b: ParsedAuthHeader | null,
): ParsedAuthHeader | null {
	if (!a || !b) return a ?? b;
	const passes = (h: ParsedAuthHeader) => h.methods.filter((m) => m.result === "pass").length;
	return passes(b) < passes(a) ? b : a;
}

/**
 * workerd's Headers joins duplicate headers with ", " in get(). A new
 * results header starts with an authserv-id (or ARC's `i=N`) followed by
 * `;`, so split there to get the instances back, topmost first.
 */
function splitJoinedResults(value: string): string[] {
	return value
		.split(/,\s*(?=(?:i=\d+\s*;)|(?:[A-Za-z0-9.-]+\s*;))/)
		.map((part) => part.trim())
		.filter(Boolean);
}

/**
 * Every instance of a header, topmost first, never merged. A merged value
 * would let a forged header lower in the message add `dmarc=pass` to the
 * real one.
 */
function orderedHeaderValues(source: HeaderSource, name: string): string[] {
	if (!source) return [];
	if (Array.isArray(source) || typeof source === "string") {
		return headerMapFromSource(source).get(name.toLowerCase()) ?? [];
	}
	const headers = source as { get(name: string): string | null; getAll?(name: string): string[] };
	if (typeof headers.getAll === "function") {
		try {
			return headers.getAll(name).map((value) => String(value)).filter(Boolean);
		} catch {
			// workerd only supports getAll for Set-Cookie.
		}
	}
	const joined = headers.get(name);
	return joined ? splitJoinedResults(joined) : [];
}

function pickVerdict(hits: MethodHit[], method: string): MethodHit | null {
	const matched = hits.filter((hit) => hit.method === method);
	if (matched.length === 0) return null;
	return matched.find((hit) => hit.result === "pass") ?? matched[matched.length - 1];
}

function dmarcPolicyOf(hit: MethodHit | null): DmarcPolicy | undefined {
	if (!hit) return undefined;
	const raw = (
		hit.properties["policy.dmarc"] ??
		hit.properties["policy.published-domain-policy"] ??
		hit.properties["policy.p"] ??
		""
	).toLowerCase();
	return raw === "none" || raw === "quarantine" || raw === "reject" ? raw : undefined;
}

const EVALUABLE_VERDICTS = new Set<AuthVerdict>([
	"pass",
	"fail",
	"softfail",
	"policy",
]);

function isEvaluableHit(hit: MethodHit | null): boolean {
	return Boolean(hit && EVALUABLE_VERDICTS.has(hit.result));
}

/** Prefer getAll so duplicate Authentication-Results are not comma-joined. */
function collectHeaderValues(source: HeaderSource, name: string): string[] {
	if (!source) return [];
	if (
		typeof source === "object" &&
		!Array.isArray(source) &&
		typeof (source as { get?: unknown }).get === "function"
	) {
		const headers = source as {
			get(name: string): string | null;
			getAll?(name: string): string[];
		};
		if (typeof headers.getAll === "function") {
			try {
				const all = headers.getAll(name);
				if (Array.isArray(all) && all.length > 0) {
					return all.map((value) => String(value)).filter(Boolean);
				}
			} catch {
				// Fall through to map / get().
			}
		}
	}
	return headerMapFromSource(source).get(name.toLowerCase()) ?? [];
}

/**
 * Failure wins over a pass: a forged pass must never outvote a real fail.
 * Without a trusted (Cloudflare) verdict nothing is failed or verified.
 */
function tierFor(signals: {
	trusted: boolean;
	aligned: boolean | null;
	dmarcFailEnforced: boolean;
	dmarcFromMismatch: boolean;
	spfHardFailNoDkim: boolean;
}): AuthTier {
	if (!signals.trusted) return "unverified";
	if (
		signals.dmarcFailEnforced ||
		signals.spfHardFailNoDkim ||
		(signals.dmarcFromMismatch && signals.aligned === false)
	) {
		return "failed";
	}
	return signals.aligned === true ? "verified" : "unverified";
}

/**
 * Upstream ARC sealers whose results we accept for forwarded mail (a user
 * forwarding another mailbox into Inboxies). A seal's `d=` must be one of
 * these or a subdomain of one; no suffix matching beyond a `.` boundary.
 * Only list domains owned by the mailbox provider itself (never a domain
 * where customers can get their own subdomain or DKIM keys). Cloudflare
 * validates the seal signature (`arc=pass`), so a listed domain that a
 * provider never seals with is inert, not a hole. Add new sealers here.
 *
 * Zoho Mail (`zohomail.com`, `zohomail.eu`) is left off on purpose. It seals
 * mail it sends, not only mail it forwards, and its results say `dmarc=pass`
 * for a verified "Send Mail As" address even when that domain's DMARC fails
 * (AVE-102: Cloudflare said `dmarc=fail … policy.dmarc=quarantine` on the
 * same message). The envelope check in `trustedArcSealerEvidence` stops that
 * case, but a sealer that records a DMARC pass it never evaluated isn't one
 * to rest `verified` on.
 */
export const TRUSTED_ARC_SEALERS: readonly string[] = [
	// Gmail / Google Workspace.
	"google.com",
	// Outlook.com / Microsoft 365.
	"outlook.com",
	"microsoft.com",
	// Apple iCloud Mail.
	"icloud.com",
	// Proton Mail (MX hosts are *.protonmail.ch).
	"protonmail.ch",
	"proton.me",
	// Fastmail (seals as its platform domain, not fastmail.com).
	"messagingengine.com",
	// Yahoo Mail and AOL (same platform).
	"yahoo.com",
	"aol.com",
];

/** Exact or proper-subdomain match against `TRUSTED_ARC_SEALERS`. */
export function isTrustedArcSealer(domain: string | null | undefined): boolean {
	if (!domain) return false;
	const d = domain.trim().toLowerCase().replace(/\.$/, "");
	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return false;
	return TRUSTED_ARC_SEALERS.some((sealer) => d === sealer || d.endsWith(`.${sealer}`));
}

interface ArcSeal {
	instance: number;
	cv: string;
	d: string;
}

/** ARC-Seal tag-list (RFC 8617 §4.1.3). Any duplicate tag makes it invalid. */
function parseArcSeal(value: string): ArcSeal | null {
	const tags = new Map<string, string>();
	for (const part of value.split(";")) {
		if (!part.trim()) continue;
		const eq = part.indexOf("=");
		if (eq <= 0) return null;
		const key = part.slice(0, eq).trim();
		if (tags.has(key)) return null;
		tags.set(key, part.slice(eq + 1).replace(/\s+/g, ""));
	}
	const i = tags.get("i") ?? "";
	if (!/^\d{1,2}$/.test(i)) return null;
	const instance = Number(i);
	const cv = (tags.get("cv") ?? "").toLowerCase();
	const d = (tags.get("d") ?? "").toLowerCase();
	if (instance < 1 || !cv || !d) return null;
	return { instance, cv, d };
}

function arcResults(header: ParsedAuthHeader | null): AuthVerdict[] {
	return header ? header.methods.filter((m) => m.method === "arc").map((m) => m.result) : [];
}

/** Every `arc=` verdict in the header says `pass`, and there is at least one. */
function arcPassed(header: ParsedAuthHeader): boolean {
	const verdicts = arcResults(header);
	return verdicts.length > 0 && verdicts.every((result) => result === "pass");
}

/**
 * Cloudflare's own ARC sealer. Email Routing adds a set to every message it
 * hands the Worker, one instance above whatever chain arrived:
 * `ARC-Seal: i=N; d=cloudflare-email.net; s=cf2024-1`, plus results at N
 * from `mx.cloudflare.net` repeating its Authentication-Results (AVE-102).
 */
const CLOUDFLARE_ARC_SEALER = "cloudflare-email.net";

function isCloudflareArcSealer(domain: string): boolean {
	const d = domain.replace(/\.$/, "");
	return d === CLOUDFLARE_ARC_SEALER || d.endsWith(`.${CLOUDFLARE_ARC_SEALER}`);
}

/** Envelope domains (`spf … smtp.mailfrom`) a results header names. */
function envelopeDomains(header: ParsedAuthHeader): string[] {
	return header.methods
		.filter((hit) => hit.method === "spf")
		.map((hit) => domainFromAddress(hit.properties["smtp.mailfrom"]))
		.filter((domain): domain is string => Boolean(domain));
}

/**
 * Whether the visible From is proven by the results a trusted upstream
 * sealer recorded: a DMARC pass for that exact From domain, or a DKIM/SPF
 * pass aligned with it. Any DMARC fail there vetoes.
 */
function upstreamProvesFrom(header: ParsedAuthHeader, fromDomain: string): boolean {
	const hits = header.methods;
	// `domainsAligned` is relaxed both ways; never let a bare TLD align.
	const aligned = (domain: string | null) =>
		Boolean(domain?.includes(".")) && domainsAligned(fromDomain, domain);
	if (hits.some((hit) => hit.method === "dmarc" && hit.result === "fail")) return false;
	return hits.some((hit) => {
		if (hit.result !== "pass") return false;
		if (hit.method === "dmarc") {
			return domainFromAddress(hit.properties["header.from"]) === fromDomain;
		}
		if (hit.method === "dkim") {
			const d = domainFromAddress(
				hit.properties["header.d"] ?? hit.properties["d"] ?? hit.properties["header.i"],
			);
			return aligned(d);
		}
		if (hit.method === "spf") {
			return aligned(domainFromAddress(hit.properties["smtp.mailfrom"]));
		}
		return false;
	});
}

/**
 * Trusted-sealer ARC evidence for forwarded mail. Returns the sealer domain
 * when the visible From is proven by it, else null. Every check fails closed.
 *
 * We can't verify ARC signatures in the Worker, so the trust anchor is
 * Cloudflare's own ARC validation: every Cloudflare-stamped results header
 * we trust (the topmost Authentication-Results and ARC-Authentication-Results
 * from `*.cloudflare.net`) must carry an `arc=` verdict, and all of them
 * must say `pass`. That means Cloudflare validated every set it received,
 * so the highest of those is the last hop before Cloudflare.
 *
 * Cloudflare seals what it delivers (see `CLOUDFLARE_ARC_SEALER`), so on
 * real mail the top instance N is Cloudflare's set and the upstream sealer
 * is at N-1. We accept Cloudflare's set only as exactly one seal and one
 * results header at N, with results from a trusted authserv that say
 * `arc=pass`. A Cloudflare seal below the top, or more than one, fails
 * closed. Without any Cloudflare seal (mail stored before it sealed, tests)
 * the top set is the upstream one.
 *
 * The upstream set needs exactly one seal and one results header, a seal
 * `d=` on `TRUSTED_ARC_SEALERS`, the `cv=` a valid chain needs there (`none`
 * at i=1, else `pass`), results that aren't ours, and a verdict that proves
 * the visible From. An older set is never used: a later, untrusted hop
 * could have altered the message after it.
 *
 * Last, the sealer must have forwarded the message, not sent it. Its results
 * can't tell us which: Zoho seals mail its users send and writes `dmarc=pass`
 * for their "Send Mail As" address, even where Cloudflare finds DMARC failing
 * under `p=quarantine` (AVE-102). What forwarding does change is the
 * envelope: a forwarder resends under its own return path (SRS, Gmail's
 * `+caf_`), so Cloudflare's SPF names a different domain from the one the
 * sealer received. When Cloudflare's `smtp.mailfrom` domain matches or
 * aligns with the sealer's, no forward happened between them: the sealer
 * sent or relayed the message as it was, and Cloudflare's verdict on that
 * same envelope stands. When either side names no envelope we can't tell,
 * so we don't upgrade. The cost is a forwarder that keeps the original
 * envelope. It breaks SPF for everything it forwards and doesn't upgrade.
 */
function trustedArcSealerEvidence(params: {
	trustedAr: ParsedAuthHeader | null;
	trustedArc: ParsedAuthHeader | null;
	arcResultsValues: string[];
	arcSealValues: string[];
	fromDomain: string | null;
}): string | null {
	const { fromDomain } = params;
	if (!fromDomain) return null;

	const anchors = [params.trustedAr, params.trustedArc].filter(
		(header): header is ParsedAuthHeader => header !== null,
	);
	if (anchors.length === 0 || !anchors.every(arcPassed)) return null;

	const seals: ArcSeal[] = [];
	for (const value of params.arcSealValues) {
		const parsed = parseArcSeal(value);
		if (!parsed) return null;
		seals.push(parsed);
	}
	const results: ParsedAuthHeader[] = [];
	for (const value of params.arcResultsValues) {
		const parsed = parseAuthenticationResultsValue(value);
		if (!parsed || parsed.instance === undefined) return null;
		results.push(parsed);
	}
	if (seals.length === 0) return null;

	const top = Math.max(...seals.map((seal) => seal.instance));
	if (results.some((r) => (r.instance ?? 0) > top)) return null;
	// The one seal and one results header at `instance`, if its `cv=` is what
	// a valid chain needs there.
	const setAt = (instance: number) => {
		const atSeals = seals.filter((seal) => seal.instance === instance);
		const atResults = results.filter((r) => r.instance === instance);
		if (atSeals.length !== 1 || atResults.length !== 1) return null;
		if (atSeals[0].cv !== (instance === 1 ? "none" : "pass")) return null;
		return { seal: atSeals[0], results: atResults[0] };
	};

	// Cloudflare's envelope, from each of its results headers.
	const cloudflareEnvelope = anchors.flatMap(envelopeDomains);
	let upstreamInstance = top;
	const cloudflareSeals = seals.filter((seal) => isCloudflareArcSealer(seal.d));
	if (cloudflareSeals.length > 0) {
		if (cloudflareSeals.length !== 1 || cloudflareSeals[0].instance !== top) return null;
		const cloudflare = setAt(top);
		if (!cloudflare) return null;
		if (!isTrustedAuthserv(cloudflare.results.authserv) || !arcPassed(cloudflare.results)) {
			return null;
		}
		cloudflareEnvelope.push(...envelopeDomains(cloudflare.results));
		upstreamInstance = top - 1;
	}

	const upstream = setAt(upstreamInstance);
	if (!upstream || !isTrustedArcSealer(upstream.seal.d)) return null;
	// Our own results header must not be the upstream one: that would make
	// the "trusted sealer's" results ours, or a forgery of ours.
	if (isTrustedAuthserv(upstream.results.authserv)) return null;
	if (!upstreamProvesFrom(upstream.results, fromDomain)) return null;

	// Forwarded, not sent by the sealer: Cloudflare saw another envelope.
	const sealerEnvelope = envelopeDomains(upstream.results);
	if (sealerEnvelope.length === 0 || cloudflareEnvelope.length === 0) return null;
	const sameEnvelope = cloudflareEnvelope.some((ours) =>
		sealerEnvelope.some((theirs) => domainsAligned(ours, theirs)),
	);
	return sameEnvelope ? null : upstream.seal.d;
}

/**
 * Our verdict comes from Cloudflare's Authentication-Results and
 * ARC-Authentication-Results (our own hop), via `firstTrusted`. Upstream
 * sealers' results only count through `trustedArcSealerEvidence`: an
 * allowlisted sealer whose chain Cloudflare validated can raise the tier
 * to `verified` for forwarded mail.
 */
export function parseAuthSignals(input: ParseAuthSignalsInput): EmailAuth {
	const headerFrom = (input.headerFrom ?? "").trim();
	const envelopeFrom = (input.envelopeFrom ?? "").trim();

	// Use the delivery headers when we have them. The message's own MIME
	// headers are what the sender wrote, so they only stand in when no
	// delivery headers were given (tests, re-parsing stored mail).
	const ordered = (name: string) =>
		input.envelopeHeaders != null
			? orderedHeaderValues(input.envelopeHeaders, name)
			: orderedHeaderValues(input.mimeHeaders, name);
	const trustedAr = firstTrusted(ordered("authentication-results"));
	const trustedArc = firstTrusted(ordered("arc-authentication-results"));
	const chosen = stricterResults(trustedAr, trustedArc);

	let source: AuthSource = "none";
	let methods: MethodHit[] = [];
	if (chosen) {
		source = chosen === trustedAr ? "authentication-results" : "arc-authentication-results";
		methods = chosen.methods;
	}

	const receivedSpf = ordered("received-spf");
	if (receivedSpf.length > 0 && !pickVerdict(methods, "spf")) {
		const spfHit = parseReceivedSpf(receivedSpf[0] ?? "");
		if (spfHit) methods = [...methods, spfHit];
	}

	const dkimHit = pickVerdict(methods, "dkim");
	const spfHit = pickVerdict(methods, "spf");
	const dmarcHit = pickVerdict(methods, "dmarc");

	const dkimDomain = domainFromAddress(
		dkimHit?.properties["header.d"] ??
			dkimHit?.properties["d"] ??
			dkimHit?.properties["header.i"],
	);
	const spfMailfrom =
		spfHit?.properties["smtp.mailfrom"] ??
		spfHit?.properties["envelope-from"] ??
		undefined;
	// Alignment is judged against the From the user sees, not a domain the
	// results header merely claims.
	const headerFromDomain = domainFromAddress(headerFrom || dmarcHit?.properties["header.from"]);
	const dmarcFromDomain = domainFromAddress(dmarcHit?.properties["header.from"]);
	const spfDomain = domainFromAddress(spfMailfrom ?? null);

	const dkimAligned =
		dkimHit?.result === "pass" && domainsAligned(headerFromDomain, dkimDomain);
	const spfAligned =
		spfHit?.result === "pass" && domainsAligned(headerFromDomain, spfDomain);
	const dmarcPass =
		dmarcHit?.result === "pass" && (!dmarcFromDomain || dmarcFromDomain === headerFromDomain);
	const hasEvaluableVerdict =
		isEvaluableHit(dkimHit) || isEvaluableHit(spfHit) || isEvaluableHit(dmarcHit);
	const dmarcPolicy = dmarcPolicyOf(dmarcHit);

	const aligned =
		source === "none" || !hasEvaluableVerdict
			? null
			: Boolean(dkimAligned || spfAligned || dmarcPass);
	// DMARC evaluated a different From than the one we show: the message
	// carries an ambiguous From, so the verdict can't vouch for it.
	const dmarcFromMismatch = Boolean(
		dmarcFromDomain && headerFromDomain && dmarcFromDomain !== headerFromDomain,
	);
	let authTier = tierFor({
		trusted: source !== "none",
		aligned,
		dmarcFailEnforced:
			dmarcHit?.result === "fail" &&
			(dmarcPolicy === "quarantine" || dmarcPolicy === "reject"),
		dmarcFromMismatch,
		spfHardFailNoDkim: spfHit?.result === "fail" && dkimHit?.result !== "pass",
	});

	// Forwarded mail: Cloudflare's own checks fail or don't align once a
	// forwarder rewrites the envelope, but a trusted sealer saw it pass.
	let arcSealer: string | null = null;
	if (authTier !== "verified" && !dmarcFromMismatch) {
		arcSealer = trustedArcSealerEvidence({
			trustedAr,
			trustedArc,
			arcResultsValues: ordered("arc-authentication-results"),
			arcSealValues: ordered("arc-seal"),
			fromDomain: domainFromAddress(headerFrom),
		});
	}

	const auth: EmailAuth = {
		headerFrom,
		envelopeFrom,
		source,
		aligned,
		authTier,
		spoofed: authTier === "failed",
	};
	if (arcSealer) {
		authTier = "verified";
		auth.authTier = authTier;
		auth.aligned = true;
		auth.spoofed = false;
		auth.arcSealer = arcSealer;
	}
	if (dkimHit) auth.dkim = dkimHit.result;
	if (spfHit) auth.spf = spfHit.result;
	if (dmarcHit) auth.dmarc = dmarcHit.result;
	if (dmarcPolicy) auth.dmarcPolicy = dmarcPolicy;
	if (dkimDomain) auth.dkimDomain = dkimDomain;
	if (spfMailfrom) auth.spfMailfrom = spfMailfrom;

	return auth;
}

function asVerdict(value: unknown): AuthVerdict | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return VERDICT_WORDS.has(normalized as AuthVerdict)
		? (normalized as AuthVerdict)
		: "unknown";
}

function asSource(value: unknown): AuthSource {
	if (value === "authentication-results" || value === "arc-authentication-results") {
		return value;
	}
	return "none";
}

export function parseStoredEmailAuth(raw: unknown): EmailAuth | null {
	if (raw == null || raw === "") return null;
	let value: unknown = raw;
	if (typeof raw === "string") {
		try {
			value = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!isRecord(value)) return null;
	const headerFrom =
		typeof value.headerFrom === "string" ? value.headerFrom : "";
	const envelopeFrom =
		typeof value.envelopeFrom === "string" ? value.envelopeFrom : "";
	const source = asSource(value.source);
	const aligned =
		source === "none"
			? null
			: value.aligned === true
				? true
				: value.aligned === false
					? false
					: null;
	const authTier = authTierOf({
		authTier: value.authTier as AuthTier,
		spoofed: value.spoofed === true,
		aligned,
	});
	const dmarcPolicy =
		value.dmarcPolicy === "none" ||
		value.dmarcPolicy === "quarantine" ||
		value.dmarcPolicy === "reject"
			? value.dmarcPolicy
			: undefined;
	return {
		spf: asVerdict(value.spf),
		dkim: asVerdict(value.dkim),
		dmarc: asVerdict(value.dmarc),
		dkimDomain:
			typeof value.dkimDomain === "string" ? value.dkimDomain : undefined,
		spfMailfrom:
			typeof value.spfMailfrom === "string" ? value.spfMailfrom : undefined,
		headerFrom,
		envelopeFrom,
		aligned,
		dmarcPolicy,
		authTier,
		...(typeof value.arcSealer === "string" ? { arcSealer: value.arcSealer } : {}),
		spoofed: authTier === "failed",
		source,
	};
}

export function serializeEmailAuth(auth: EmailAuth | null | undefined): string | null {
	if (!auth) return null;
	return JSON.stringify(auth);
}

function headerEntriesFromSource(source: HeaderSource): HeaderEntry[] {
	if (!source) return [];
	if (typeof source === "string") {
		try {
			const parsed = JSON.parse(source) as unknown;
			if (!Array.isArray(parsed)) return [];
			return parsed as HeaderEntry[];
		} catch {
			return [];
		}
	}
	if (Array.isArray(source)) return source;
	const map = headerMapFromSource(source);
	const entries: HeaderEntry[] = [];
	for (const [key, values] of map) {
		for (const value of values) entries.push({ key, value });
	}
	return entries;
}

function hasHeaderValue(
	entries: HeaderEntry[],
	name: string,
	value: string,
): boolean {
	const needle = name.toLowerCase();
	return entries.some((entry) => {
		const key = (entry.key || entry.name || "").trim().toLowerCase();
		return key === needle && (entry.value ?? "") === value;
	});
}

/** Copy trusted CF auth headers from the Worker envelope into stored MIME headers. */
export function mergeTrustedAuthHeaders(
	mimeHeaders: HeaderEntry[] | string | null | undefined,
	envelopeHeaders: HeaderSource,
): HeaderEntry[] {
	const merged = headerEntriesFromSource(mimeHeaders);
	for (const name of TRUSTED_AR_NAMES) {
		for (const value of collectHeaderValues(envelopeHeaders, name)) {
			if (!value) continue;
			if (name !== "received-spf") {
				const parsed = parseAuthenticationResultsValue(value);
				if (!parsed || !isTrustedAuthserv(parsed.authserv)) continue;
			}
			if (hasHeaderValue(merged, name, value)) continue;
			merged.push({ key: name, value });
		}
	}
	return merged;
}
