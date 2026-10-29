/**
 * RFC 8058 one-click unsubscribe (AVE-99, docs/spam-management-plan.md §4–5).
 *
 * Report spam on bulk mail can also unsubscribe. We only offer it when the
 * message carries both:
 *   List-Unsubscribe: <https://…>          (RFC 2369; mailto-only doesn't count)
 *   List-Unsubscribe-Post: List-Unsubscribe=One-Click
 * and the Worker then sends exactly one POST with the body
 * `List-Unsubscribe=One-Click` to that https URI.
 *
 * SSRF: only https, no credentials in the URL, no IP literals, no
 * localhost / single-label / .local / .internal hosts, and redirects are not
 * followed (`redirect: "manual"`). Workers egress can't reach private
 * networks anyway; this keeps sender-controlled URLs to public hostnames.
 */

import { headerMapFromSource, type HeaderSource } from "./mail-automations.ts";

export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";
export const ONE_CLICK_TIMEOUT_MS = 5_000;

/** Hostnames a sender-supplied unsubscribe URL may never point at. */
function isRefusedHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (!host || !host.includes(".")) return true; // localhost, intranet names
	if (host.startsWith("[") || host.includes(":")) return true; // IPv6 literal
	if (/^\d+(\.\d+){3}$/.test(host)) return true; // IPv4 literal
	if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return true; // odd numeric forms
	return [".localhost", ".local", ".internal", ".home.arpa", ".lan"].some(
		(suffix) => host === suffix.slice(1) || host.endsWith(suffix),
	);
}

/** A URI from List-Unsubscribe that's safe to POST to, or null. */
export function safeUnsubscribeUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;
	if (url.username || url.password) return null;
	if (url.port && url.port !== "443") return null;
	if (isRefusedHost(url.hostname)) return null;
	return url.toString();
}

/**
 * The https URI to POST to when the message supports RFC 8058 one-click
 * unsubscribe, else null (no Post header, mailto-only, unsafe host…).
 */
export function oneClickUnsubscribeUrl(headers: HeaderSource): string | null {
	const map = headerMapFromSource(headers);
	const post = map.get("list-unsubscribe-post") ?? [];
	const isOneClick = post.some(
		(value) => value.replace(/\s+/g, "").toLowerCase() === ONE_CLICK_BODY.toLowerCase(),
	);
	if (!isOneClick) return null;
	for (const value of map.get("list-unsubscribe") ?? []) {
		// RFC 2369: a comma-separated list of <URI>s; use the first https one.
		for (const match of value.matchAll(/<([^>]*)>/g)) {
			const uri = match[1].replace(/\s+/g, "");
			if (!/^https:/i.test(uri)) continue;
			const safe = safeUnsubscribeUrl(uri);
			if (safe) return safe;
		}
	}
	return null;
}

export function supportsOneClickUnsubscribe(headers: HeaderSource): boolean {
	return oneClickUnsubscribeUrl(headers) !== null;
}

export type OneClickResult =
	| { status: "sent"; httpStatus: number }
	| { status: "failed"; httpStatus?: number; error?: string };

/**
 * Send the one-click POST. Never throws: a failed unsubscribe must not
 * undo or fail the Report spam move that triggered it.
 */
export async function sendOneClickUnsubscribe(
	url: string,
	options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<OneClickResult> {
	const safe = safeUnsubscribeUrl(url);
	if (!safe) return { status: "failed", error: "unsafe_url" };
	const doFetch = options.fetch ?? fetch;
	try {
		const res = await doFetch(safe, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: ONE_CLICK_BODY,
			redirect: "manual",
			signal: AbortSignal.timeout(options.timeoutMs ?? ONE_CLICK_TIMEOUT_MS),
		});
		// Drain so the connection is released.
		await res.body?.cancel().catch(() => undefined);
		return res.status >= 200 && res.status < 300
			? { status: "sent", httpStatus: res.status }
			: { status: "failed", httpStatus: res.status };
	} catch (err) {
		return { status: "failed", error: err instanceof Error ? err.name : "error" };
	}
}
