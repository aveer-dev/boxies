// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { EMAIL_FRAME_SCRIPT_HASH } from "../../shared/email-frame-script";

/**
 * Content-Security-Policy for the web app's HTML (AVE-148).
 *
 * Applied to every document React Router renders (workers/app.ts), including
 * the MCP consent page. Mail renders in sandboxed `srcdoc` iframes, which
 * inherit this policy on top of their own `<meta>` CSP
 * (app/components/EmailIframe.tsx), so:
 *
 * - `img-src` allows `https:`: remote mail images load by default outside
 *   Spam (AVE-132). The agent panel doesn't render `<img>` from model output
 *   (AVE-108), which is the control there. `data:` stays for inline (cid)
 *   images (AVE-110) and `blob:` for local previews.
 * - `style-src` needs `'unsafe-inline'`: mail HTML is full of `style`
 *   attributes and the frame has its own `<style>`; the app's SSR markup and
 *   Kumo also emit `style` attributes.
 * - `script-src` uses a per-request nonce (React Router's inline scripts, the
 *   theme boot script) plus the hash of the frame's one fixed script.
 *   With a nonce present browsers ignore `'unsafe-inline'`, so it is not listed.
 *
 * Rollout: `CSP_MODE` below. It ships as report-only; flip it to "enforce"
 * once reports at `CSP_REPORT_PATH` (Workers Logs, `csp-violation`) are quiet.
 */
export type CspMode = "report-only" | "enforce";

/** The rollout switch. Change to "enforce" to block instead of report. */
export const CSP_MODE: CspMode = "report-only";

/** Violation reports land here (logged only; see `handleCspReport`). */
export const CSP_REPORT_PATH = "/api/csp-report";

export function cspHeaderName(mode: CspMode): string {
	return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/** Third-party origins the app loads, by what they are for. */
const GOOGLE_SIGN_IN = {
	// Google Identity Services: the "Sign in with Google" button (app/lib/google-identity.ts).
	script: "https://accounts.google.com/gsi/client",
	style: "https://accounts.google.com/gsi/style",
	connect: "https://accounts.google.com/gsi/",
	frame: "https://accounts.google.com",
};
const APPLE_SIGN_IN = {
	// Sign in with Apple JS (app/lib/apple-identity.ts); its popup is appleid.apple.com.
	script: "https://appleid.cdn-apple.com",
	frame: "https://appleid.apple.com",
	connect: "https://appleid.apple.com",
};
const GOOGLE_FONTS = { style: "https://fonts.googleapis.com", font: "https://fonts.gstatic.com" };
// Cloudflare Web Analytics, if the zone's automatic setup injects its beacon
// (AVE-126 turns it off for the app, but a stray injection mustn't break pages).
const CF_WEB_ANALYTICS = {
	script: "https://static.cloudflareinsights.com",
	connect: "https://cloudflareinsights.com",
};

/** A fresh nonce for one response (128 bits, base64). */
export function createCspNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * The policy for one HTML response. `requestUrl` gives the page's own
 * WebSocket origin (agents over `wss:`; Vite's HMR socket in dev): CSP3 lets
 * `'self'` match it, but older Safari doesn't, so it is listed explicitly.
 */
export function buildContentSecurityPolicy(options: { nonce: string; requestUrl: string }): string {
	const url = new URL(options.requestUrl);
	const wsOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
	const directives: Array<[string, string[]]> = [
		["default-src", ["'self'"]],
		[
			"script-src",
			[
				"'self'",
				`'nonce-${options.nonce}'`,
				EMAIL_FRAME_SCRIPT_HASH,
				GOOGLE_SIGN_IN.script,
				APPLE_SIGN_IN.script,
				CF_WEB_ANALYTICS.script,
			],
		],
		["style-src", ["'self'", "'unsafe-inline'", GOOGLE_FONTS.style, GOOGLE_SIGN_IN.style]],
		["img-src", ["'self'", "data:", "blob:", "https:"]],
		["font-src", ["'self'", "data:", GOOGLE_FONTS.font]],
		[
			"connect-src",
			["'self'", wsOrigin, GOOGLE_SIGN_IN.connect, APPLE_SIGN_IN.connect, CF_WEB_ANALYTICS.connect],
		],
		["frame-src", ["'self'", GOOGLE_SIGN_IN.frame, APPLE_SIGN_IN.frame]],
		["object-src", ["'none'"]],
		["base-uri", ["'self'"]],
		["frame-ancestors", ["'none'"]],
		["report-uri", [CSP_REPORT_PATH]],
	];
	return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/**
 * Adds the policy to an HTML response (anything else passes through). The
 * header is appended, so a policy already on the response (e.g. the OAuth
 * library's `frame-ancestors 'none'`) still applies alongside it.
 */
export function withContentSecurityPolicy(
	response: Response,
	options: { nonce: string; requestUrl: string; mode?: CspMode },
): Response {
	const type = response.headers.get("Content-Type") ?? "";
	if (!/^text\/html\b/i.test(type)) return response;
	const res = new Response(response.body, response); // headers may be immutable
	res.headers.append(cspHeaderName(options.mode ?? CSP_MODE), buildContentSecurityPolicy(options));
	return res;
}

const MAX_REPORT_BYTES = 8 * 1024;

/** Only the origin (or keyword such as "inline"/"eval") of a reported URL: paths can carry mail addresses. */
function originOnly(value: unknown): string | undefined {
	if (typeof value !== "string" || !value) return undefined;
	try {
		const url = new URL(value);
		return url.origin === "null" ? `${url.protocol}` : url.origin;
	} catch {
		return value.slice(0, 32);
	}
}

/** One violation from either `application/csp-report` or the Reporting API. */
function summarize(report: Record<string, unknown>): Record<string, string | undefined> {
	const pick = (...keys: string[]) => {
		for (const key of keys) {
			const value = report[key];
			if (typeof value === "string" && value) return value.slice(0, 64);
		}
		return undefined;
	};
	return {
		directive: pick("effective-directive", "effectiveDirective", "violated-directive"),
		blocked: originOnly(report["blocked-uri"] ?? report.blockedURL),
		source: originOnly(report["source-file"] ?? report.sourceFile),
		disposition: pick("disposition"),
	};
}

/**
 * `report-uri` endpoint: logs a short, PII-free summary of each violation
 * (directive and origins only) to Workers Logs and stores nothing. Bodies over
 * 8 KB are refused. Public by design: browsers send reports without cookies.
 */
export async function handleCspReport(request: Request): Promise<Response> {
	if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
	const declared = Number(request.headers.get("Content-Length") ?? "0");
	if (declared > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
	const text = await readCapped(request, MAX_REPORT_BYTES);
	if (text === null) return new Response(null, { status: 413 });

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return new Response(null, { status: 400 });
	}
	const reports: Record<string, unknown>[] = [];
	if (Array.isArray(parsed)) {
		// Reporting API: [{ type: "csp-violation", body: {...} }, ...]
		for (const entry of parsed.slice(0, 10)) {
			const body = (entry as { type?: unknown; body?: unknown } | null)?.body;
			if ((entry as { type?: unknown }).type === "csp-violation" && body && typeof body === "object") {
				reports.push(body as Record<string, unknown>);
			}
		}
	} else if (parsed && typeof parsed === "object") {
		const body = (parsed as { "csp-report"?: unknown })["csp-report"];
		if (body && typeof body === "object") reports.push(body as Record<string, unknown>);
	}
	for (const report of reports) {
		console.warn(JSON.stringify({ event: "csp-violation", ...summarize(report) }));
	}
	return new Response(null, { status: 204 });
}

async function readCapped(request: Request, limit: number): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}
