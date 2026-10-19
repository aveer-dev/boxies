// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface Env extends Cloudflare.Env {
	/** Cloudflare Access audience and team domain: operators on /ops/* only. */
	POLICY_AUD: string;
	TEAM_DOMAIN: string;
	/** iOS app bundle ID — Apple identity token `aud` (e.g. com.example.AgenticInbox). */
	APPLE_CLIENT_ID?: string;
	/** Google OAuth Web client ID — Google ID token `aud` for Android Sign-In. */
	GOOGLE_CLIENT_ID?: string;
	/**
	 * Apple Push Notification Service (APNs) credentials. `APNS_TOPIC` and
	 * `APNS_SANDBOX` are wrangler vars, so their types come from `Cloudflare.Env`.
	 */
	APNS_KEY_ID?: string;
	APNS_TEAM_ID?: string;
	APNS_PRIVATE_KEY?: string;
	/** Firebase service-account JSON string for FCM HTTP v1 (Android push). */
	FCM_SERVICE_ACCOUNT_JSON?: string;
	/**
	 * `admin_only` stops signed-in users creating extra addresses on the
	 * shared platform domains (sign-up and /ops still can). Anything else: open.
	 */
	MAILBOX_CREATE_POLICY?: string;
	/**
	 * "false" requires the emailed code to accept an invite. Otherwise app
	 * builds that predate invite codes can still create an account without one.
	 */
	LEGACY_INVITE_ACCEPT?: string;
	/** From address for invite emails (defaults to noreply@`MAIL_DOMAIN` / first `DOMAINS` / fallback). */
	INVITE_FROM_EMAIL?: string;
	/*
	 * `APP_BASE_URL` (the web app's origin: Better Auth's base URL and trusted
	 * origin, invite/reset links, Stripe returns; defaults to the request origin)
	 * and `WEB_REDIRECT_HOSTS` (hosts whose web pages 301 there, see
	 * `lib/web-host-redirect.ts`) are wrangler vars, so their types come from `Cloudflare.Env`.
	 */
	/** Primary mailbox domain suffix (e.g. `mail.example.com`).
	 * Wins over the first `DOMAINS` entry for create-address UI and invite From.
	 * When unset, falls back to first `DOMAINS` entry, then `inboxies.email`.
	 */
	MAIL_DOMAIN?: string;
	/** Operator Cloudflare API Token for Zone, DNS, and Email Routing provisioning. */
	CF_API_TOKEN?: string;
	/** Operator Cloudflare Account ID where custom zones and routes are provisioned. */
	CF_ACCOUNT_ID?: string;
	/** Target Cloudflare Worker script name for Email Routing catch-all trigger. */
	WORKER_NAME?: string;
	/** Stripe Secret Key for processing domain purchase checkout sessions. */
	STRIPE_SECRET_KEY?: string;
	/** Stripe Webhook Secret for validating checkout.session.completed signatures. */
	STRIPE_WEBHOOK_SECRET?: string;
	/** Optional: where operator alerts go (e.g. a renewed domain that must be renewed by hand at the registrar). */
	OPS_ALERT_EMAIL?: string;
	/** Better Auth signing secret (32+ random bytes). `AUTH_DB` comes from wrangler.jsonc. */
	BETTER_AUTH_SECRET?: string;
	/** Extra Google client ids (iOS, Android) accepted alongside GOOGLE_CLIENT_ID, comma-separated. */
	GOOGLE_EXTRA_CLIENT_IDS?: string;
	GOOGLE_CLIENT_SECRET?: string;
	/** Apple web sign-in secret; native iOS sign-in only needs the bundle id. */
	APPLE_CLIENT_SECRET?: string;
	/** iOS bundle id, the `aud` of native Apple ID tokens (defaults to APPLE_CLIENT_ID). */
	APPLE_APP_BUNDLE_ID?: string;
	/**
	 * Sign in with Apple Services ID for the web login page (Apple JS). Not a
	 * secret: it is sent to the browser via /api/v1/config. When set, Apple
	 * ID tokens with this audience are accepted alongside the bundle id.
	 */
	APPLE_WEB_SERVICES_ID?: string;
	/**
	 * Sign in with Apple key (Key ID + .p8 contents) and team id, used to
	 * revoke Apple tokens when an account is deleted. Team falls back to APNS_TEAM_ID.
	 */
	APPLE_TEAM_ID?: string;
	APPLE_SIGNIN_KEY_ID?: string;
	APPLE_SIGNIN_PRIVATE_KEY?: string;
}

