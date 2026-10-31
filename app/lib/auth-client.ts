// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Better Auth's browser client, for the passkey and two-factor routes it
 * serves at /api/auth/* (see workers/routes/better-auth.ts). Everything else
 * (password, Google, Apple sign-in, sessions) still goes through
 * `~/services/api`.
 *
 * Import this lazily (`await import("~/lib/auth-client")`): it pulls in
 * WebAuthn helpers the rest of the app doesn't need, and the client must only
 * be created in the browser. Each call throws an `Error` with a message fit
 * for a toast, or returns its data.
 */

import { passkeyClient } from "@better-auth/passkey/client";
import { startAuthentication, WebAuthnError } from "@simplewebauthn/browser";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/client";
import api from "~/services/api";
import { reauthChallenge, requestReauth } from "./reauth";
import { describeUserAgent } from "./session-label";

function makeClient() {
	return createAuthClient({
		baseURL: window.location.origin,
		basePath: "/api/auth",
		fetchOptions: { credentials: "include" },
		plugins: [passkeyClient(), twoFactorClient()],
	});
}

let client: ReturnType<typeof makeClient> | null = null;
function authClient() {
	client ??= makeClient();
	return client;
}

type BetterAuthError = { message?: string; code?: string; status?: number } | null | undefined;

/** WebAuthn ceremony codes from @simplewebauthn/browser, and Better Auth's own. */
const FRIENDLY: Record<string, string> = {
	ERROR_CEREMONY_ABORTED: "Cancelled.",
	AUTH_CANCELLED: "Passkey sign-in was cancelled.",
	REGISTRATION_CANCELLED: "Cancelled.",
	ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: "This device already has a passkey for your account.",
	PREVIOUSLY_REGISTERED: "This device already has a passkey for your account.",
	PASSKEY_NOT_FOUND: "That passkey isn't registered with Inboxies. Sign in another way.",
	AUTHENTICATION_FAILED: "Passkey sign-in failed. Try again or sign in another way.",
	INVALID_PASSWORD: "Incorrect password.",
	INVALID_CODE: "That code didn't work. Check your authenticator app and try again.",
	SESSION_NOT_FRESH: "For your security, sign out and sign in again, then retry.",
	TOTP_ALREADY_ENABLED: "Two-factor authentication is already on.",
};

function fail(error: BetterAuthError, fallback: string): never {
	if (error?.status === 429) throw new Error("Too many attempts. Wait a minute and try again.");
	const friendly = error?.code ? FRIENDLY[error.code] : undefined;
	throw new Error(friendly ?? (error?.message || fallback));
}

/**
 * Run a Better Auth call; when it answers 403 `reauth_required` (adding or
 * removing a passkey needs a fresh session, AVE-113), ask the user to confirm
 * it's them and run it once more.
 */
async function withReauth<R extends { error?: unknown }>(call: () => Promise<R>): Promise<R> {
	const first = await call();
	const challenge = first.error ? reauthChallenge(first.error) : null;
	if (!challenge || !(await requestReauth(challenge))) return first;
	return call();
}

/** True when this browser can do WebAuthn at all. */
export function passkeysSupported(): boolean {
	return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

/** True for the "user dismissed the browser's passkey sheet" failure (not worth a red toast). */
export function isCancelled(err: unknown): boolean {
	return err instanceof Error && err.message === FRIENDLY.ERROR_CEREMONY_ABORTED;
}

// ── Passkeys ─────────────────────────────────────────────────────

/** Sign in with any passkey this browser offers; sets the session cookie. */
export async function signInWithPasskey(): Promise<void> {
	const { error } = await authClient().signIn.passkey();
	if (error) {
		// The library reports every browser-side failure (dismissed sheet, no
		// passkey on this device, timeout) as AUTH_CANCELLED.
		if ((error as { code?: string }).code === "AUTH_CANCELLED" || (error as { code?: string }).code === "ERROR_CEREMONY_ABORTED") {
			throw new Error(FRIENDLY.ERROR_CEREMONY_ABORTED);
		}
		fail(error, "Passkey sign-in failed");
	}
}

export interface PasskeyRow {
	id: string;
	name: string | null;
	createdAt: string;
	deviceType: string;
	backedUp: boolean;
}

/** Register a passkey for the signed-in user, named after this browser. */
export async function addPasskey(name?: string): Promise<void> {
	const label =
		name?.trim() || describeUserAgent(typeof navigator === "undefined" ? null : navigator.userAgent) || "Passkey";
	const { error } = await withReauth(() => authClient().passkey.addPasskey({ name: label }));
	if (error) fail(error, "Couldn't add the passkey");
}

export async function listPasskeys(): Promise<PasskeyRow[]> {
	const { data, error } = await authClient().$fetch<
		Array<{ id: string; name?: string | null; createdAt: string; deviceType: string; backedUp: boolean }>
	>("/passkey/list-user-passkeys", { method: "GET" });
	if (error) fail(error, "Couldn't load passkeys");
	return (data ?? []).map((p) => ({
		id: p.id,
		name: p.name ?? null,
		createdAt: String(p.createdAt),
		deviceType: p.deviceType,
		backedUp: Boolean(p.backedUp),
	}));
}

export async function renamePasskey(id: string, name: string): Promise<void> {
	const { error } = await authClient().$fetch("/passkey/update-passkey", {
		method: "POST",
		body: { id, name },
	});
	if (error) fail(error, "Couldn't rename the passkey");
}

export async function deletePasskey(id: string): Promise<void> {
	const { error } = await withReauth(() =>
		authClient().$fetch("/passkey/delete-passkey", {
			method: "POST",
			body: { id },
		}),
	);
	if (error) fail(error, "Couldn't remove the passkey");
}

/**
 * Confirm it's you with one of this account's passkeys, without signing in
 * again: the Worker checks the assertion and marks this session fresh.
 */
export async function reauthWithPasskey(): Promise<void> {
	const { data: options, error } = await authClient().$fetch<Parameters<typeof startAuthentication>[0]["optionsJSON"]>(
		"/passkey/generate-authenticate-options",
		{ method: "GET" },
	);
	if (error || !options) fail(error, "Couldn't start the passkey check");
	let response: Awaited<ReturnType<typeof startAuthentication>>;
	try {
		response = await startAuthentication({ optionsJSON: options });
	} catch (err) {
		// Dismissed sheet, no passkey here, timeout: all read as cancelled.
		if (err instanceof WebAuthnError || (err instanceof Error && err.name === "NotAllowedError")) {
			throw new Error(FRIENDLY.ERROR_CEREMONY_ABORTED);
		}
		throw err;
	}
	const { clientExtensionResults: _ignored, ...body } = response;
	await api.reauth({ method: "passkey", response: body });
}

// ── Two-factor (TOTP + backup codes) ─────────────────────────────

/**
 * Start TOTP setup: returns the otpauth:// URI for the authenticator app and
 * the one-time backup codes. 2FA isn't on until `confirmTwoFactor` checks a
 * code from the app.
 */
export async function startTwoFactorSetup(password: string): Promise<{ totpURI: string; backupCodes: string[] }> {
	const { data, error } = await authClient().$fetch<{ totpURI: string; backupCodes: string[] }>(
		"/two-factor/enable",
		{ method: "POST", body: { password } },
	);
	if (error || !data) fail(error, "Couldn't start two-factor setup");
	return { totpURI: data.totpURI, backupCodes: data.backupCodes };
}

/** Finish setup with a code from the authenticator app (rotates this session's cookie). */
export async function confirmTwoFactor(code: string): Promise<void> {
	const { error } = await authClient().$fetch("/two-factor/verify-totp", {
		method: "POST",
		body: { code: code.replace(/\s+/g, "") },
	});
	if (error) fail(error, "That code didn't work");
}

export async function disableTwoFactor(password: string): Promise<void> {
	const { error } = await authClient().$fetch("/two-factor/disable", {
		method: "POST",
		body: { password },
	});
	if (error) fail(error, "Couldn't turn off two-factor authentication");
}

/** New backup codes; the old ones stop working. */
export async function regenerateBackupCodes(password: string): Promise<string[]> {
	const { data, error } = await authClient().$fetch<{ backupCodes: string[] }>(
		"/two-factor/generate-backup-codes",
		{ method: "POST", body: { password } },
	);
	if (error || !data) fail(error, "Couldn't create new backup codes");
	return data.backupCodes;
}
