/**
 * Web refreshes on every live mailbox event (AVE-226): each event the
 * MailboxDO broadcasts maps to the web queries it makes stale.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/web-mailbox-events.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	FALLBACK_TARGETS,
	MAILBOX_EVENT_TARGETS,
	mailboxEventTargets,
	queryKeysForTargets,
} from "../../app/lib/mailbox-events.ts";

// Every event the DO emits is mapped explicitly, and nothing stale is mapped.
const doSource = readFileSync(new URL("../durableObject/index.ts", import.meta.url), "utf8");
const emitted = new Set([...doSource.matchAll(/broadcastEvent\("([a-z_]+)"/g)].map((m) => m[1]));
assert.ok(emitted.size >= 19, `expected the DO's event list, found ${[...emitted]}`);
for (const name of emitted) {
	assert.ok(name in MAILBOX_EVENT_TARGETS, `web does not handle live event "${name}"`);
	assert.ok(MAILBOX_EVENT_TARGETS[name].length > 0, `"${name}" invalidates nothing`);
}
for (const name of Object.keys(MAILBOX_EVENT_TARGETS)) {
	assert.ok(emitted.has(name), `web maps "${name}", which the DO no longer emits`);
}

// The events the issue called out.
for (const name of ["email_deleted", "thread_read"]) {
	assert.ok(mailboxEventTargets(name).includes("emails"), name);
}
for (const name of [
	"sender_triage_updated",
	"sender_triage_deleted",
	"sender_rule_updated",
	"sender_rule_deleted",
	"sender_rules_changed",
]) {
	const targets = mailboxEventTargets(name);
	for (const t of ["emails", "senderPreferences", "senderRules"]) {
		assert.ok(targets.includes(t), `${name} → ${t}`);
	}
}
assert.deepEqual([...mailboxEventTargets("summary_updated")], ["summaries"]);

// Stream bookkeeping does nothing; unknown events resync everything but aliases.
assert.deepEqual([...mailboxEventTargets("connected")], []);
assert.deepEqual([...mailboxEventTargets("ping")], []);
assert.equal(mailboxEventTargets("some_future_event"), FALLBACK_TARGETS);
assert.equal(mailboxEventTargets("message"), FALLBACK_TARGETS);

// Query keys: prefixes scoped to the mailbox, deduplicated across a burst.
const mb = "ada@inboxies.email";
assert.deepEqual(queryKeysForTargets(mb, ["emails", "emails"]), [
	["emails", mb],
	["folders", mb],
	["workflow-piles", mb],
]);
assert.deepEqual(queryKeysForTargets(mb, ["senderPreferences", "senderRules", "summaries", "aliases", "inboxDigest"]), [
	["sender-preferences", mb],
	["sender-rules", mb],
	["summaries", mb],
	["aliases", mb],
	["inbox-digest", mb],
]);
assert.deepEqual(queryKeysForTargets(mb, []), []);

console.log("web-mailbox-events: ok");
