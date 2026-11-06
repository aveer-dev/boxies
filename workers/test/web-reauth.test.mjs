/**
 * Web re-auth prompt plumbing (AVE-113): parsing the Worker's 403
 * `reauth_required` body, and one dialog answering every request that hit
 * the gate at once.
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import { reauthChallenge, requestReauth, useReauthStore } from "../../app/lib/reauth.ts";

// ── reauthChallenge ──
assert.equal(reauthChallenge(null), null);
assert.equal(reauthChallenge({ error: "Forbidden" }), null, "other 403s are not re-auth prompts");
assert.deepEqual(
	reauthChallenge({
		error: "For your security…",
		code: "reauth_required",
		methods: ["password", "passkey", "telepathy", "sign_in"],
		twoFactor: true,
		emailCodeTo: null,
	}),
	{ methods: ["password", "passkey", "sign_in"], twoFactor: true, emailCodeTo: null },
	"unknown methods are dropped",
);
assert.deepEqual(reauthChallenge({ code: "reauth_required" }), { methods: ["sign_in"], twoFactor: false, emailCodeTo: null });

// ── requestReauth: no window (SSR) never prompts ──
assert.equal(await requestReauth({ methods: ["password"], twoFactor: false, emailCodeTo: null }), false);

// ── one dialog, every waiter resolved ──
globalThis.window = globalThis;
{
	const first = requestReauth({ methods: ["password", "sign_in"], twoFactor: false, emailCodeTo: null });
	const second = requestReauth({ methods: ["passkey"], twoFactor: false, emailCodeTo: null });
	assert.deepEqual(useReauthStore.getState().challenge.methods, ["password", "sign_in"], "the open prompt stays");
	useReauthStore.getState().finish(true);
	assert.deepEqual(await Promise.all([first, second]), [true, true]);
	assert.equal(useReauthStore.getState().challenge, null);

	const cancelled = requestReauth({ methods: ["email_code"], twoFactor: false, emailCodeTo: "g•••s@gmail.com" });
	useReauthStore.getState().finish(false);
	assert.equal(await cancelled, false);
}

console.log("web-reauth: ok");
