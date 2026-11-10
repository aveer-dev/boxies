// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// AVE-220: an invite's ORGANIZER is shown as who sent it only when it lines
// up with the message's From.
import assert from "node:assert/strict";
import { organizerMatchesSender } from "../lib/calendar-invite.ts";

const org = (email, name = null) => ({ email, name });

// Same address as the From: fine at any tier but failed.
assert.equal(organizerMatchesSender(org("pat@acme.com"), "pat@acme.com", "verified"), true);
assert.equal(organizerMatchesSender(org("pat@acme.com"), "Pat <Pat@Acme.com>", "unverified"), true);
assert.equal(organizerMatchesSender(org("pat@acme.com"), "pat@acme.com", null), true);
assert.equal(organizerMatchesSender(org("pat@acme.com"), "pat@acme.com", "failed"), false);

// Same domain or a subdomain: only for an authenticated From.
assert.equal(organizerMatchesSender(org("boss@acme.com"), "calendar@acme.com", "verified"), true);
assert.equal(organizerMatchesSender(org("boss@acme.com"), "calendar@mail.acme.com", "verified"), true);
assert.equal(organizerMatchesSender(org("boss@team.acme.com"), "calendar@acme.com", "verified"), true);
assert.equal(organizerMatchesSender(org("boss@acme.com"), "calendar@acme.com", "unverified"), false);

// The reported case: a stranger naming someone on your own domain.
assert.equal(organizerMatchesSender(org("ceo@recipient.example", "CEO"), "mallory@stranger.example", "unverified"), false);
assert.equal(organizerMatchesSender(org("ceo@recipient.example", "CEO"), "mallory@stranger.example", "verified"), false);
// Shared free-mail domains: one user can't vouch for another.
assert.equal(organizerMatchesSender(org("boss@gmail.com"), "mallory@gmail.com", "verified"), false);
assert.equal(organizerMatchesSender(org("pat@gmail.com"), "pat@gmail.com", "verified"), true);
// Registrable domain, not a raw suffix: co.uk is a public suffix.
assert.equal(organizerMatchesSender(org("boss@acme.co.uk"), "pat@other.co.uk", "verified"), false);
assert.equal(organizerMatchesSender(org("boss@acme.co.uk"), "cal@mail.acme.co.uk", "verified"), true);
// Lookalike suffix is not a subdomain.
assert.equal(organizerMatchesSender(org("ceo@evilacme.com"), "pat@acme.com", "verified"), false);

// Nothing to check against.
assert.equal(organizerMatchesSender(null, "pat@acme.com", "verified"), false);
assert.equal(organizerMatchesSender(org(null, "CEO"), "pat@acme.com", "verified"), false);
assert.equal(organizerMatchesSender(org("pat@acme.com"), null, "verified"), false);
assert.equal(organizerMatchesSender(org("pat@acme.com"), "", "verified"), false);

console.log("invite-organizer: ok");
