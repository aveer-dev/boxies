/**
 * Settings → Senders Add-field parsing and labels (AVE-97).
 *
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/sender-rules-input.test.mjs
 */
import assert from "node:assert/strict";
import {
	parseSenderRuleInput,
	senderRuleDisplayValue,
	senderRuleSourceLabel,
} from "../../shared/sender-rules.ts";

assert.equal(parseSenderRuleInput("   "), null);
assert.deepEqual(parseSenderRuleInput(" Ada@Acme.com "), { kind: "address", value: "ada@acme.com" });
assert.deepEqual(parseSenderRuleInput("@Acme.com"), { kind: "domain", value: "acme.com" });
assert.deepEqual(parseSenderRuleInput("acme.com"), { kind: "domain", value: "acme.com" });

assert.equal(senderRuleDisplayValue({ kind: "domain", value: "acme.com" }), "@acme.com");
assert.equal(senderRuleDisplayValue({ kind: "address", value: "ada@acme.com" }), "ada@acme.com");

assert.equal(senderRuleSourceLabel("not_spam"), "Not spam");
assert.equal(senderRuleSourceLabel("settings"), "Added in Settings");
assert.equal(senderRuleSourceLabel("mystery"), "Other");

console.log("sender-rules-input tests passed");
