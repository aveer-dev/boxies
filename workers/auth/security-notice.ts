// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * "Was this you?" mail after a sensitive account change (AVE-113): the
 * recovery email, a sign-in method or passkey, the password, two-factor, or
 * the account itself; and after a sign-in from a new device (AVE-151). One email per address: the login address and the verified recovery
 * email, plus any old address the change replaced (a stolen session that
 * swaps the recovery email still tells the previous one). Each links to the
 * web sign-in settings so the owner can react.
 *
 * Each change is also recorded as a security event (`auth/security-activity.ts`)
 * for the "Recent security activity" list.
 *
 * Sending never fails the change: errors are logged by `sendSystemEmail`.
 */

import { escapeHtml } from "../lib/email-helpers";
import type { Env } from "../types";
import { authDb } from "./authz";
import { isHostedEmailDomain } from "./hooks";
import { appBaseUrl, sendSystemEmail } from "./mail";
import { isDeliverableLogin, maskEmail } from "./reauth";
import {
	locationLabel,
	noteSecurityNotice,
	recordSecurityEvent,
	type RequestDevice,
	type SecurityEventKind,
} from "./security-activity";
import { findUserById, verifiedRecoveryEmail } from "./users";

export type SecurityChange =
	| { kind: "recovery_email_set"; email: string }
	| { kind: "recovery_email_removed" }
	| { kind: "password_added" }
	| { kind: "password_changed" }
	| { kind: "password_reset" }
	| { kind: "two_factor_enabled" }
	| { kind: "two_factor_disabled" }
	| { kind: "new_device_sign_in" }
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

/** The activity-list kind for a change; null for the account's deletion (nothing left to list). */
function recordedKind(change: SecurityChange): SecurityEventKind | null {
	if (change.kind === "account_deleted") return null;
	if (change.kind === "new_device_sign_in") return "sign_in";
	return change.kind;
}

function changeDetail(change: SecurityChange): Record<string, string> | null {
	if (change.kind === "sign_in_method_added" || change.kind === "sign_in_method_removed") {
		return { provider: change.provider === "credential" ? "password" : change.provider };
	}
	return null;
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
		case "password_reset":
			return {
				subject: "Your Inboxies password was reset",
				line: "The password on your Inboxies account was reset with a code sent to your recovery email. Your other devices were signed out.",
			};
		case "two_factor_enabled":
			return {
				subject: "Two-factor authentication was turned on for your Inboxies account",
				line: "Two-factor authentication was turned on for your Inboxies account.",
			};
		case "two_factor_disabled":
			return {
				subject: "Two-factor authentication was turned off for your Inboxies account",
				line: "Two-factor authentication was turned off for your Inboxies account. Signing in now needs only your password.",
			};
		case "new_device_sign_in":
			return {
				subject: "New sign-in to your Inboxies account",
				line: "Your Inboxies account was signed in to from a device or place it hasn't been used from recently.",
			};
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

/**
 * The notice for `change` on the account `login`. `settingsUrl` is null when
 * there's nothing left to review. `device` adds the browser/app and the
 * approximate location the change came from, when known (never an address).
 */
export function securityNoticeEmail(opts: {
	change: SecurityChange;
	login: string;
	when: Date;
	settingsUrl: string | null;
	device?: RequestDevice | null;
}) {
	const { subject, line } = describeChange(opts.change);
	const when = `${opts.when.toISOString().slice(0, 16).replace("T", " ")} UTC`;
	const deviceName = opts.device?.device ?? null;
	const location = opts.device ? locationLabel(opts.device.country, opts.device.city) : null;
	const details: [string, string][] = [["Account", opts.login], ["When", when]];
	if (deviceName) details.push(["Device", deviceName]);
	if (location) details.push(["Location", `${location} (approximate)`]);
	const account = details.map(([k, v]) => `${k}: ${v}`).join("\n");
	const action = opts.settingsUrl
		? `If this was you, you can ignore this email.\n\nIf it wasn't you, sign in now and review your sign-in methods and recovery email:\n${opts.settingsUrl}\n\nIf you can't sign in, use "Forgot password" on the sign-in page.\n`
		: "If this wasn't you, someone else had access to your account. Your data can't be recovered.\n";
	const text = `${line}\n\n${account}\n\n${action}`;
	const html =
		`<p>${escapeHtml(line)}</p>` +
		`<p style="color:#64748b;font-size:13px;">${details.map(([k, v]) => `${k}: ${escapeHtml(v)}`).join("<br>")}</p>` +
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
		/** Where the change came from (`requestDevice`): shown in the mail and recorded. */
		device?: RequestDevice | null;
		/** Already recorded by the caller (new-device sign-ins). */
		skipRecord?: boolean;
	},
): Promise<string[]> {
	// Synchronous, so it lands in the request's scope before the caller moves on.
	noteSecurityNotice(opts.userId);
	if (!opts.skipRecord) {
		const kind = recordedKind(opts.change);
		if (kind) {
			await recordSecurityEvent(authDb(env.AUTH_DB), {
				userId: opts.userId,
				kind,
				device: opts.device,
				detail: changeDetail(opts.change),
			}).catch((e) => console.error("[Auth] Security event not recorded:", (e as Error).message || e));
		}
	}
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
	const mail = securityNoticeEmail({ change: opts.change, login, when: new Date(), settingsUrl, device: opts.device });
	const sent: string[] = [];
	for (const to of recipients) {
		if (await sendSystemEmail(env, { to, ...mail })) sent.push(to);
	}
	return sent;
}
