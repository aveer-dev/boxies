// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { newMailboxRequest } from "../../app/lib/new-mailbox.ts";

assert.deepEqual(newMailboxRequest("Ada.Lovelace", "Ada", "Inboxies.Email"), {
	ok: true,
	email: "ada.lovelace@inboxies.email",
	name: "Ada",
});
// Pasting a full address keeps only the local part; the domain is fixed.
assert.deepEqual(newMailboxRequest(" ada@gmail.com ", "", "inboxies.email"), {
	ok: true,
	email: "ada@inboxies.email",
	name: "ada",
});
assert.equal(newMailboxRequest("", "Ada", "inboxies.email").ok, false);
assert.equal(newMailboxRequest("   ", "Ada", "inboxies.email").ok, false);
assert.equal(newMailboxRequest("ada", "Ada", "").ok, false);
for (const bad of ["ada lovelace", ".ada", "ada.", "a..b", "ada<x>", "ada%40"]) {
	assert.equal(newMailboxRequest(bad, "", "inboxies.email").ok, false, bad);
}

console.log("new-mailbox-request ok");
