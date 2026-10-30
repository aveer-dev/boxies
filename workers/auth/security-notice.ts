// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * "Was this you?" mail after a sensitive account change (AVE-113): the
 * recovery email, a sign-in method or passkey, the password, or the account
 * itself. One email per address: the login address and the verified recovery
 * email, plus any old address the change replaced (a stolen session that
 * swaps the recovery email still tells the previous one). Each links to the
 * web sign-in settings so the owner can react.
 *
 * Sending never fails the change: errors are logged by `sendSystemEmail`.
 */

import { escapeHtml } from "../lib/email-helpers";
import type { Env } from "../types";
import { authDb } from "./authz";
import { isHostedEmailDomain } from "./hooks";
import { appBaseUrl, sendSystemEmail } from "./mail";
import { isDeliverableLogin, maskEmail } from "./reauth";
import { findUserById, verifiedRecoveryEmail } from "./users";

export type SecurityChange =
	| { kind: "recovery_email_set"; email: string }
	| { kind: "recovery_email_removed" }
	| { kind: "password_added" }
	| { kind: "password_changed" }
	| { kind: "sign_in_method_added"; provider: string }
	| { kind: "sign_in_method_removed"; provider: string }
	| { kind: "passkey_added" }
	| { kind: "passkey_removed" }
	| { kind: "account_deleted" };

/** Web settings page the "wasn't me" link opens (`app/routes/account-settings.tsx`). */
export const SIGN_IN_SETTINGS_PATH = "/settings/sign-in";

function providerLabel(provider: string): string {
	if (provider === "google") return "Google";
	if (provider === "apple") return "Apple";
	if (provider === "password" || provider === "credential") return "password";
	return provider;
}

/** Subject and the one-line "what happened" for a change. Plain text. */
export function describeChange(change: SecurityChange): { subject: string; line: string } {
	switch (change.kind) {
		case "recovery_email_set":
			return {
				subject: "Your Inboxies recovery email was changed",
				line: `The recovery email on your Inboxies account was set to ${maskEmail(change.email)}. Password reset codes now go there once it's confirmed.`,
			};
		case "recovery_email_removed":
			return {
				subject: "Your Inboxies recovery email was removed",
				line: "The recovery email was removed from your Inboxies account. Password reset codes can't be sent until a new one is added.",
			};
		case "password_added":
			return { subject: "A password was added to your Inboxies account", line: "A password was added to your Inboxies account." };
		case "password_changed":
			return { subject: "Your Inboxies password was changed", line: "The password on your Inboxies account was changed." };
		case "sign_in_method_added":
			return {
				subject: `${providerLabel(change.provider)} sign-in was connected to your Inboxies account`,
				line: `Sign in with ${providerLabel(change.provider)} was connected to your Inboxies account.`,
			};
		case "sign_in_method_removed":
			return {
				subject: `A sign-in method was removed from your Inboxies account`,
				line: `Sign in with ${providerLabel(change.provider)} was removed from your Inboxies account.`,
			};
		case "passkey_added":
			return { subject: "A passkey was added to your Inboxies account", line: "A new passkey was added to your Inboxies account." };
		case "passkey_removed":
			return { subject: "A passkey was removed from your Inboxies account", line: "A passkey was removed from your Inboxies account." };
		case "account_deleted":
			return { subject: "Your Inboxies account was deleted", line: "Your Inboxies account and the mailboxes only you owned were deleted." };
	}
}

/** The notice for `change` on the account `login`. `settingsUrl` is null when there's nothing left to review. */
export function securityNoticeEmail(opts: { change: SecurityChange; login: string; when: Date; settingsUrl: string | null }) {
	const { subject, line } = describeChange(opts.change);
	const when = `${opts.when.toISOString().slice(0, 16).replace("T", " ")} UTC`;
	const account = `Account: ${opts.login}\nWhen: ${when}`;
	const action = opts.settingsUrl
		? `If this was you, you can ignore this email.\n\nIf it wasn't you, sign in now and review your sign-in methods and recovery email:\n${opts.settingsUrl}\n\nIf you can't sign in, use "Forgot password" on the sign-in page.\n`
		: "If this wasn't you, someone else had access to your account. Your data can't be recovered.\n";
	const text = `${line}\n\n${account}\n\n${action}`;
	const html =
		`<p>${escapeHtml(line)}</p>` +
		`<p style="color:#64748b;font-size:13px;">Account: ${escapeHtml(opts.login)}<br>When: ${escapeHtml(when)}</p>` +
		(opts.settingsUrl
			? `<p>If this was you, you can ignore this email.</p>` +
				`<p>If it wasn't you, <a href="${escapeHtml(opts.settingsUrl)}">sign in and review your sign-in settings</a> now. ` +
				`If you can't sign in, use “Forgot password” on the sign-in page.</p>`
			: `<p>If this wasn't you, someone else had access to your account. Your data can't be recovered.</p>`);
	return { subject, text, html };
}

/**
 * Who hears about a change: the login address (unless it's a placeholder, or
 * a hosted mailbox that `skipHostedLogin` says is going away) and the
 * verified recovery email, plus `extra` (e.g. the address a change
 * replaced). Lowercased and de-duplicated.
 */
export async function securityNoticeRecipients(
	env: Env,
	user: { id: string; email: string },
	opts: { extra?: (string | null | undefined)[]; skipHostedLogin?: boolean } = {},
): Promise<string[]> {
	const out = new Set<string>();
	const login = user.email.toLowerCase();
	if (isDeliverableLogin(login) && !(opts.skipHostedLogin && (await isHostedEmailDomain(env, login)))) out.add(login);
	const recovery = await verifiedRecoveryEmail(authDb(env.AUTH_DB), user.id);
	if (recovery) out.add(recovery.toLowerCase());
	for (const e of opts.extra ?? []) if (e && isDeliverableLogin(e)) out.add(e.toLowerCase());
	return [...out];
}

/**
 * Mail the notice for `change` to `recipients` (or, when omitted, to
 * `securityNoticeRecipients` of `userId`). Returns the addresses it went to.
 */
export async function sendSecurityNotice(
	env: Env,
	opts: {
		userId: string;
		requestUrl: string;
		change: SecurityChange;
		/** Precomputed, e.g. before the account is deleted. */
		recipients?: string[];
		login?: string;
		extra?: (string | null | undefined)[];
	},
): Promise<string[]> {
	let login = opts.login;
	let recipients = opts.recipients;
	if (!recipients || !login) {
		const user = await findUserById(authDb(env.AUTH_DB), opts.userId);
		if (!user) return [];
		login ??= user.email;
		recipients ??= await securityNoticeRecipients(env, user, { extra: opts.extra });
	}
	const settingsUrl =
		opts.change.kind === "account_deleted" ? null : `${appBaseUrl(env, opts.requestUrl)}${SIGN_IN_SETTINGS_PATH}`;
	const mail = securityNoticeEmail({ change: opts.change, login, when: new Date(), settingsUrl });
	const sent: string[] = [];
	for (const to of recipients) {
		if (await sendSystemEmail(env, { to, ...mail })) sent.push(to);
	}
	return sent;
}
