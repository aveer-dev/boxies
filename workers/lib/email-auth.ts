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
	/** false when source is none (fail-open). */
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

export function isAuthSpoofed(auth?: EmailAuth | null): boolean {
	return auth?.spoofed === true;
}

export function domainFromAddress(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim().replace(/^<|>$/g, "").replace(/\.+$/, "");
	if (!trimmed) return null;
	const addr = normalizeEmailAddress(trimmed) ?? trimmed.toLowerCase();
	const at = addr.lastIndexOf("@");
	if (at > 0 && at < addr.length - 1) {
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
	if (/^i=\d+$/i.test(parts[0])) index = 1;
	if (index >= parts.length) return null;

	const authserv = (parts[index] ?? "").trim().split(/\s+/)[0] ?? "";
	if (!authserv) return null;

	const methods: MethodHit[] = [];
	for (const part of parts.slice(index + 1)) {
		if (!part || /^none$/i.test(part)) continue;
		const hit = parseMethodPart(part);
		if (hit) methods.push(hit);
	}
	return { authserv, methods };
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

function lastTrusted(values: string[]): ParsedAuthHeader | null {
	let found: ParsedAuthHeader | null = null;
	for (const value of values) {
		const parsed = parseAuthenticationResultsValue(value);
		if (!parsed || !isTrustedAuthserv(parsed.authserv)) continue;
		found = parsed;
	}
	return found;
}

function pickVerdict(hits: MethodHit[], method: string): MethodHit | null {
	const matched = hits.filter((hit) => hit.method === method);
	if (matched.length === 0) return null;
	return matched.find((hit) => hit.result === "pass") ?? matched[matched.length - 1];
}

function emptyAuth(headerFrom: string, envelopeFrom: string): EmailAuth {
	return {
		headerFrom,
		envelopeFrom,
		aligned: null,
		spoofed: false,
		source: "none",
	};
}

export function parseAuthSignals(input: ParseAuthSignalsInput): EmailAuth {
	const headerFrom = (input.headerFrom ?? "").trim();
	const envelopeFrom = (input.envelopeFrom ?? "").trim();
	const envelopeMap = headerMapFromSource(input.envelopeHeaders);
	const mimeMap = headerMapFromSource(input.mimeHeaders);

	const envelopeAr = envelopeMap.get("authentication-results") ?? [];
	const mimeAr = mimeMap.get("authentication-results") ?? [];
	const envelopeArc = envelopeMap.get("arc-authentication-results") ?? [];
	const mimeArc = mimeMap.get("arc-authentication-results") ?? [];

	const trustedAr =
		lastTrusted(envelopeAr) ?? lastTrusted(mimeAr);
	const trustedArc =
		lastTrusted(envelopeArc) ?? lastTrusted(mimeArc);

	let source: AuthSource = "none";
	let methods: MethodHit[] = [];
	if (trustedAr) {
		source = "authentication-results";
		methods = trustedAr.methods;
	} else if (trustedArc) {
		source = "arc-authentication-results";
		methods = trustedArc.methods;
	}

	const envelopeSpf = envelopeMap.get("received-spf") ?? [];
	if (envelopeSpf.length > 0 && !pickVerdict(methods, "spf")) {
		const spfHit = parseReceivedSpf(envelopeSpf[envelopeSpf.length - 1] ?? "");
		if (spfHit) methods = [...methods, spfHit];
	}

	const dkimHit = pickVerdict(methods, "dkim");
	const spfHit = pickVerdict(methods, "spf");
	const dmarcHit = pickVerdict(methods, "dmarc");

	const dkimDomain = domainFromAddress(
		dkimHit?.properties["header.d"] ?? dkimHit?.properties["d"],
	);
	const spfMailfrom =
		spfHit?.properties["smtp.mailfrom"] ??
		spfHit?.properties["envelope-from"] ??
		undefined;
	const headerFromDomain = domainFromAddress(
		dmarcHit?.properties["header.from"] ?? headerFrom,
	);
	const spfDomain = domainFromAddress(spfMailfrom ?? null);

	const dkimAligned =
		dkimHit?.result === "pass" && domainsAligned(headerFromDomain, dkimDomain);
	const spfAligned =
		spfHit?.result === "pass" && domainsAligned(headerFromDomain, spfDomain);
	const dmarcPass = dmarcHit?.result === "pass";

	const auth: EmailAuth = {
		headerFrom,
		envelopeFrom,
		source,
		aligned: source === "none" ? null : Boolean(dkimAligned || spfAligned || dmarcPass),
		spoofed: false,
	};
	if (dkimHit) auth.dkim = dkimHit.result;
	if (spfHit) auth.spf = spfHit.result;
	if (dmarcHit) auth.dmarc = dmarcHit.result;
	if (dkimDomain) auth.dkimDomain = dkimDomain;
	if (spfMailfrom) auth.spfMailfrom = spfMailfrom;

	if (source !== "none") {
		auth.spoofed = auth.aligned !== true;
	}

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
		value.aligned === true ? true : value.aligned === false ? false : null;
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
		aligned: source === "none" ? null : aligned,
		spoofed: value.spoofed === true,
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
	const envelopeMap = headerMapFromSource(envelopeHeaders);
	for (const name of TRUSTED_AR_NAMES) {
		for (const value of envelopeMap.get(name) ?? []) {
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
