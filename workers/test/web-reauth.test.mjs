/**
 * Web re-auth prompt plumbing (AVE-113): parsing the Worker's 403
 * `reauth_required` body, and one dialog answering every request that hit
 * the gate at once.
 * Run: pnpm test:unit (includes this file)
 */

import assert from "node:assert/strict";
import { reauthChallenge, requestReauth, staleSessionChallenge, useReauthStore } from "../../app/lib/reauth.ts";

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

// ── staleSessionChallenge (MCP consent page, AVE-213) ──
{
	const now = Date.parse("2026-11-16T12:00:00Z");
	const status = (fresh, inMs) => ({
		fresh,
		freshUntil: fresh ? new Date(now + inMs).toISOString() : null,
		maxAgeSeconds: 300,
		methods: ["password", "passkey", "sign_in"],
		twoFactor: true,
		emailCodeTo: null,
	});
	assert.equal(staleSessionChallenge(status(true, 4 * 60_000), now), null, "fresh for minutes: post right away");
	assert.deepEqual(
		staleSessionChallenge(status(false), now),
		{ methods: ["password", "passkey", "sign_in"], twoFactor: true, emailCodeTo: null },
		"stale: prompt with the account's methods",
	);
	assert.ok(staleSessionChallenge(status(true, 10_000), now), "about to go stale: prompt rather than race the post");
	assert.deepEqual(staleSessionChallenge({}, now)?.methods, ["sign_in"], "unknown shape: prompt, sign-in fallback");
}

console.log("web-reauth: ok");
