// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Account mail (codes, reset links, invites) sent from the platform's noreply address. */

import { sendEmail } from "../email-sender";
import { escapeHtml } from "../lib/email-helpers";
import { resolveMailDomain } from "../lib/mail-domain";
import type { Env } from "../types";

export function systemFromAddress(env: Env): string {
	if (env.INVITE_FROM_EMAIL?.trim()) return env.INVITE_FROM_EMAIL.trim();
	return `noreply@${resolveMailDomain(env)}`;
}

export function appBaseUrl(env: Env, requestUrl: string): string {
	if (env.APP_BASE_URL?.trim()) return env.APP_BASE_URL.trim().replace(/\/$/, "");
	return new URL(requestUrl).origin;
}

/** Send one account email. Returns false (and logs, never the body) when it can't. */
export async function sendSystemEmail(
	env: Env,
	mail: { to: string; subject: string; text: string; html: string },
): Promise<boolean> {
	if (!env.EMAIL) {
		console.warn(`[AccountMail] EMAIL binding not configured; "${mail.subject}" not sent`);
		return false;
	}
	try {
		await sendEmail(env.EMAIL, {
			to: mail.to,
			from: { email: systemFromAddress(env), name: "Inboxies" },
			subject: mail.subject,
			text: mail.text,
			html: mail.html,
		});
		return true;
	} catch (e) {
		console.error(`[AccountMail] "${mail.subject}" failed:`, (e as Error).message || e);
		return false;
	}
}

/** A 6-digit code email. `purposeLine` is plain text (escaped here). */
export function codeEmail(opts: { purposeLine: string; code: string; extraLinkUrl?: string; extraLinkLabel?: string }) {
	const text =
		`${opts.purposeLine}\n\nYour code is: ${opts.code}\n\n` +
		(opts.extraLinkUrl ? `Or open this link:\n${opts.extraLinkUrl}\n\n` : "") +
		"It expires in 15 minutes. If you didn't ask for it, ignore this email.\n";
	const link = opts.extraLinkUrl
		? `<p><a href="${escapeHtml(opts.extraLinkUrl)}">${escapeHtml(opts.extraLinkLabel ?? "Open link")}</a></p>`
		: "";
	const html =
		`<p>${escapeHtml(opts.purposeLine)}</p>` +
		`<p style="font-size:26px;font-weight:bold;letter-spacing:4px;margin:16px 0;color:#1e293b;">${escapeHtml(opts.code)}</p>` +
		link +
		`<p style="color:#64748b;font-size:13px;">It expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`;
	return { text, html };
}
