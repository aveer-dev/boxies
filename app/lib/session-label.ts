// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

function browserName(ua: string): string | null {
	if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
	if (/OPR\/|Opera/.test(ua)) return "Opera";
	if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
	if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
	if (/Safari\//.test(ua)) return "Safari";
	return null;
}

function osName(ua: string): string | null {
	if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
	if (/Android/.test(ua)) return "Android";
	if (/CrOS/.test(ua)) return "ChromeOS";
	if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
	if (/Windows/.test(ua)) return "Windows";
	if (/Linux/.test(ua)) return "Linux";
	return null;
}

/** Best-effort "Chrome on macOS" from a User-Agent string; null when unknown. */
export function describeUserAgent(userAgent: string | null | undefined): string | null {
	const ua = userAgent?.trim();
	if (!ua) return null;
	// The native apps use the platform HTTP stacks' default agents.
	if (/CFNetwork\//.test(ua)) return "Inboxies for iOS";
	if (/^okhttp\//i.test(ua)) return "Inboxies for Android";
	const browser = browserName(ua);
	const os = osName(ua);
	if (browser && os) return `${browser} on ${os}`;
	return browser ?? os;
}

/** What to call a session in the list: its label (e.g. "Browser extension"), else its device. */
export function describeSession(session: {
	label?: string | null;
	userAgent?: string | null;
}): string {
	const label = session.label?.trim();
	if (label) return label;
	return describeUserAgent(session.userAgent) ?? "Unknown device";
}
