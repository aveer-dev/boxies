// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import {
	FALLBACK_MAIL_DOMAIN,
	mailDomainConfig,
	parseDomainsList,
	resolveConfiguredDomains,
	resolveMailDomain,
} from "../lib/mail-domain.ts";

assert.equal(FALLBACK_MAIL_DOMAIN, "inboxies.email");

assert.deepEqual(parseDomainsList(""), []);
assert.deepEqual(parseDomainsList("  Mail.Example.COM , other.com, mail.example.com "), [
	"mail.example.com",
	"other.com",
]);

assert.equal(resolveMailDomain({}), FALLBACK_MAIL_DOMAIN);
assert.equal(resolveMailDomain({ DOMAINS: "" }), FALLBACK_MAIL_DOMAIN);
assert.equal(resolveMailDomain({ DOMAINS: "mail.example.com, other.com" }), "mail.example.com");
assert.equal(
	resolveMailDomain({ MAIL_DOMAIN: "primary.example", DOMAINS: "mail.example.com" }),
	"primary.example",
);
assert.equal(resolveMailDomain({ MAIL_DOMAIN: "  Primary.Example  " }), "primary.example");

assert.deepEqual(resolveConfiguredDomains({}), [FALLBACK_MAIL_DOMAIN]);
assert.deepEqual(resolveConfiguredDomains({ DOMAINS: "a.example, b.example" }), [
	"a.example",
	"b.example",
]);
assert.deepEqual(
	resolveConfiguredDomains({ MAIL_DOMAIN: "primary.example", DOMAINS: "a.example, primary.example" }),
	["primary.example", "a.example"],
);

assert.deepEqual(mailDomainConfig({}), {
	mailDomain: FALLBACK_MAIL_DOMAIN,
	domains: [FALLBACK_MAIL_DOMAIN],
});
assert.deepEqual(mailDomainConfig({ MAIL_DOMAIN: "oss.example" }), {
	mailDomain: "oss.example",
	domains: ["oss.example"],
});

console.log("mail-domain: ok");
