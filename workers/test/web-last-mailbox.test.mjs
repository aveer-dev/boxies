/**
 * Web "reopen the last mailbox" helpers (AVE-90): which mailbox `/` restores,
 * per-user storage, and the sign-out sweep.
 * Run: pnpm test:unit web-last-mailbox
 */

import assert from "node:assert/strict";
import {
	SHOW_ALL_MAILBOXES_STATE,
	forgetAllLastMailboxes,
	forgetLastMailbox,
	lastMailboxKey,
	pickRememberedMailbox,
	readLastMailbox,
	rememberLastMailbox,
	wantsAllMailboxes,
} from "../../app/lib/last-mailbox.ts";

function memoryStorage(initial = {}) {
	const map = new Map(Object.entries(initial));
	return {
		get length() {
			return map.size;
		},
		key: (i) => [...map.keys()][i] ?? null,
		getItem: (k) => (map.has(k) ? map.get(k) : null),
		setItem: (k, v) => map.set(k, String(v)),
		removeItem: (k) => map.delete(k),
		map,
	};
}

// ── pickRememberedMailbox: only a mailbox the user still has ──
assert.equal(pickRememberedMailbox("b@x.test", ["a@x.test", "b@x.test"]), "b@x.test");
assert.equal(pickRememberedMailbox("gone@x.test", ["a@x.test"]), null);
assert.equal(pickRememberedMailbox(null, ["a@x.test"]), null);
assert.equal(pickRememberedMailbox("", ["a@x.test"]), null);
assert.equal(pickRememberedMailbox("a@x.test", []), null);

// ── "All mailboxes" router state ──
assert.equal(wantsAllMailboxes(SHOW_ALL_MAILBOXES_STATE), true);
assert.equal(wantsAllMailboxes(null), false);
assert.equal(wantsAllMailboxes({ showAllMailboxes: "yes" }), false);

// ── Stored per user ──
{
	const storage = memoryStorage();
	rememberLastMailbox("u1", "b@x.test", storage);
	rememberLastMailbox("u2", "c@x.test", storage);
	assert.equal(readLastMailbox("u1", storage), "b@x.test");
	assert.equal(readLastMailbox("u2", storage), "c@x.test");
	assert.equal(storage.getItem(lastMailboxKey("u1")), "b@x.test");
	// No user yet (me still loading): nothing read or written.
	assert.equal(readLastMailbox(undefined, storage), null);
	rememberLastMailbox(null, "z@x.test", storage);
	assert.equal(storage.map.size, 2);

	forgetLastMailbox("u1", storage);
	assert.equal(readLastMailbox("u1", storage), null);
	assert.equal(readLastMailbox("u2", storage), "c@x.test");
}

// ── Sign-out clears every account's value, leaves other prefs ──
{
	const storage = memoryStorage({ "inboxies-text-size": "110" });
	rememberLastMailbox("u1", "b@x.test", storage);
	rememberLastMailbox("u2", "c@x.test", storage);
	forgetAllLastMailboxes(storage);
	assert.deepEqual([...storage.map.keys()], ["inboxies-text-size"]);
}

// ── Blocked storage never throws ──
{
	const throwing = {
		length: 1,
		key: () => {
			throw new Error("blocked");
		},
		getItem: () => {
			throw new Error("blocked");
		},
		setItem: () => {
			throw new Error("blocked");
		},
		removeItem: () => {
			throw new Error("blocked");
		},
	};
	assert.equal(readLastMailbox("u1", throwing), null);
	rememberLastMailbox("u1", "b@x.test", throwing);
	forgetLastMailbox("u1", throwing);
	forgetAllLastMailboxes(throwing);
	assert.equal(readLastMailbox("u1", null), null);
}

console.log("web-last-mailbox: ok");
