// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	/** HS256 secret used to sign/verify iOS mobile session JWTs after Apple Sign In. */
	MOBILE_JWT_SECRET?: string;
	/** iOS app bundle ID — Apple identity token `aud` (e.g. com.example.AgenticInbox). */
	APPLE_CLIENT_ID?: string;
	/** Google OAuth Web client ID — Google ID token `aud` for Android Sign-In. */
	GOOGLE_CLIENT_ID?: string;
	/** Apple Push Notification Service (APNs) credentials */
	APNS_KEY_ID?: string;
	APNS_TEAM_ID?: string;
	APNS_PRIVATE_KEY?: string;
	APNS_TOPIC?: string;
	APNS_SANDBOX?: string;
	/** Firebase service-account JSON string for FCM HTTP v1 (Android push). */
	FCM_SERVICE_ACCOUNT_JSON?: string;
	/**
	 * Domain Admin allowlist: comma-separated emails and optional `sub:…` keys.
	 * Matched against `principalKeys` from Access / mobile / password sessions.
	 */
	DOMAIN_ADMINS?: string;
	/**
	 * `open` (anyone authenticated may create) or `admin_only`.
	 * When unset: `admin_only` if DOMAIN_ADMINS is non-empty, else `open`.
	 */
	MAILBOX_CREATE_POLICY?: string;
	/** From address for invite emails (defaults to noreply@`MAIL_DOMAIN` / first `DOMAINS` / fallback). */
	INVITE_FROM_EMAIL?: string;
	/** Public site origin for invite links (defaults to request origin). */
	APP_BASE_URL?: string;
	/**
	 * Primary mailbox domain suffix (e.g. `mail.example.com`).
	 * Wins over the first `DOMAINS` entry for create-address UI and invite From.
	 * When unset, falls back to first `DOMAINS` entry, then `inboxies.email`.
	 */
	MAIL_DOMAIN?: string;
}
