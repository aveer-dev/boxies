// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Web Admin → Aliases helpers (AVE-239): same rules and copy as the native
// DomainAliases helpers (AVE-219).
import assert from "node:assert/strict";
import {
	DOMAIN_ALIAS_COPY,
	aliasAddErrorMessage,
	aliasConflict,
	aliasDeleteConfirmMessage,
	aliasDeleteErrorMessage,
	aliasDeliversToFooter,
	aliasTargets,
	isValidAliasLocal,
	normalizedAliasLocal,
	sortedAliases,
} from "../../app/lib/domain-aliases.ts";

// Normalising matches what the Worker stores.
assert.equal(normalizedAliasLocal("  Sales "), "sales");
assert.equal(normalizedAliasLocal("@@Help"), "help");
assert.equal(normalizedAliasLocal("support@other.com"), "support");
assert.equal(normalizedAliasLocal(""), "");

// The Worker's ^[a-zA-Z0-9._-]+$ rule.
for (const ok of ["sales", "a.b", "first_last", "x-1"]) assert.equal(isValidAliasLocal(ok), true, ok);
for (const bad of ["", "sales team", "a+b", "ü", "a/b"]) assert.equal(isValidAliasLocal(bad), false, bad);

// Targets: the domain's own mailboxes, else every listed one.
const rows = [
	{ id: "ada@acme.dev", email: "ada@acme.dev", name: "Ada" },
	{ id: "bob@other.dev", email: "bob@other.dev", name: "Bob" },
	{ id: "cy@ACME.dev", email: "cy@ACME.dev", name: "Cy" },
];
assert.deepEqual(aliasTargets(rows, "Acme.dev").map((r) => r.id), ["ada@acme.dev", "cy@ACME.dev"]);
assert.deepEqual(aliasTargets(rows, "none.dev"), rows);

const aliases = [
	{ aliasLocal: "sales", aliasEmail: "sales@acme.dev", targetMailboxId: "ada@acme.dev" },
	{ aliasLocal: "help", aliasEmail: "help@acme.dev", targetMailboxId: "cy@acme.dev" },
];
assert.deepEqual(sortedAliases(aliases).map((a) => a.aliasLocal), ["help", "sales"]);
assert.equal(aliases[0].aliasLocal, "sales", "sortedAliases does not mutate");

// Conflicts caught before the request.
assert.equal(aliasConflict("sales", "acme.dev", aliases, rows), "sales@acme.dev is already an alias");
assert.equal(aliasConflict("ada", "acme.dev", aliases, rows), "ada@acme.dev is already a mailbox");
assert.equal(aliasConflict("billing", "acme.dev", aliases, rows), null);

// Worker 400 / 403 / 409 → toast copy.
assert.equal(aliasAddErrorMessage(400, "Invalid alias local part"), DOMAIN_ALIAS_COPY.invalidLocal);
assert.equal(aliasAddErrorMessage(400, undefined), DOMAIN_ALIAS_COPY.invalidLocal);
assert.equal(aliasAddErrorMessage(400, "Target mailbox is required"), "Target mailbox is required");
assert.equal(aliasAddErrorMessage(403, ""), DOMAIN_ALIAS_COPY.forbiddenTarget);
assert.equal(aliasAddErrorMessage(403, "Forbidden: nope"), "Forbidden: nope");
assert.equal(
	aliasAddErrorMessage(409, "ada@acme.dev is already a mailbox"),
	"ada@acme.dev is already a mailbox",
);
assert.equal(aliasAddErrorMessage(409, undefined), DOMAIN_ALIAS_COPY.addFailed);
assert.equal(aliasAddErrorMessage(undefined, undefined), DOMAIN_ALIAS_COPY.addFailed);

assert.equal(aliasDeleteErrorMessage("  "), DOMAIN_ALIAS_COPY.deleteFailed);
assert.equal(aliasDeleteErrorMessage("Domain is frozen"), "Domain is frozen");

assert.equal(
	aliasDeleteConfirmMessage(aliases[0]),
	"Mail sent to sales@acme.dev will stop reaching ada@acme.dev.",
);
assert.equal(aliasDeliversToFooter("", "acme.dev"), "Mail sent to the alias is delivered to this mailbox.");
assert.equal(aliasDeliversToFooter("sales", "acme.dev"), "Mail sent to sales@acme.dev is delivered to this mailbox.");

console.log("domain-aliases-web ok");
