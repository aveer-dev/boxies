// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Step-up re-authentication on the web (AVE-113). Sensitive account changes
 * answer 403 `{ code: "reauth_required", methods, twoFactor, emailCodeTo }`
 * when the session didn't sign in or re-authenticate in the last 5 minutes.
 * `requestReauth` opens the one `ReauthDialog` (mounted in root.tsx) and
 * resolves true once the user confirmed, so the caller can retry the request;
 * false when they cancelled.
 */

import { create } from "zustand";

export const REAUTH_REQUIRED_CODE = "reauth_required";

export type ReauthMethod = "password" | "passkey" | "email_code" | "sign_in";

export interface ReauthChallenge {
	methods: ReauthMethod[];
	/** A password re-auth also needs an authenticator or backup code. */
	twoFactor: boolean;
	/** Masked address an emailed code goes to. */
	emailCodeTo: string | null;
}

const KNOWN: readonly ReauthMethod[] = ["password", "passkey", "email_code", "sign_in"];

/** The challenge in a `reauth_required` error body, or null for any other error. */
export function reauthChallenge(body: unknown): ReauthChallenge | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (b.code !== REAUTH_REQUIRED_CODE) return null;
	const methods = Array.isArray(b.methods)
		? b.methods.filter((m): m is ReauthMethod => KNOWN.includes(m as ReauthMethod))
		: [];
	return {
		methods: methods.length > 0 ? methods : ["sign_in"],
		twoFactor: b.twoFactor === true,
		emailCodeTo: typeof b.emailCodeTo === "string" ? b.emailCodeTo : null,
	};
}

interface ReauthState {
	challenge: ReauthChallenge | null;
	waiters: Array<(ok: boolean) => void>;
	open: (challenge: ReauthChallenge, resolve: (ok: boolean) => void) => void;
	/** Close the dialog; `ok` says whether the session is fresh now. */
	finish: (ok: boolean) => void;
}

export const useReauthStore = create<ReauthState>((set, get) => ({
	challenge: null,
	waiters: [],
	open: (challenge, resolve) =>
		// Several requests may hit the gate at once: one dialog answers them all.
		set((s) => ({ challenge: s.challenge ?? challenge, waiters: [...s.waiters, resolve] })),
	finish: (ok) => {
		const { waiters } = get();
		set({ challenge: null, waiters: [] });
		for (const w of waiters) w(ok);
	},
}));

/** Ask the user to confirm it's them. Resolves true when they did. */
export function requestReauth(challenge: ReauthChallenge): Promise<boolean> {
	if (typeof window === "undefined") return Promise.resolve(false);
	return new Promise((resolve) => useReauthStore.getState().open(challenge, resolve));
}
