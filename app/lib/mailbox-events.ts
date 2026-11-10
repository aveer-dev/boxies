// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { queryKeys } from "../queries/keys";

/**
 * Groups of web queries a live mailbox event can make stale.
 * - `emails`: every email list/detail/thread plus folder counts and workflow piles
 *   (the Screener is a folder, so its list lives here too).
 */
export type MailboxEventTarget =
	| "emails"
	| "summaries"
	| "aliases"
	| "senderPreferences"
	| "senderRules"
	| "inboxDigest";

const SENDER_TARGETS = ["emails", "senderPreferences", "senderRules"] as const;

/**
 * Every named SSE event the MailboxDO broadcasts (`broadcastEvent` in
 * workers/durableObject/index.ts), mapped to the queries it makes stale.
 * workers/test/web-mailbox-events.test.mjs fails when the DO gains an event
 * that is missing here (AVE-226).
 */
export const MAILBOX_EVENT_TARGETS: Readonly<Record<string, readonly MailboxEventTarget[]>> = {
	new_email: ["emails", "summaries"],
	email_updated: ["emails"],
	email_moved: ["emails", "summaries"],
	emails_refiled: ["emails", "summaries"],
	email_deleted: ["emails", "summaries"],
	thread_read: ["emails"],
	// A stored thread summary was regenerated elsewhere.
	summary_updated: ["summaries"],
	sender_preference_updated: SENDER_TARGETS,
	sender_preference_deleted: SENDER_TARGETS,
	// Screener decisions and sender rules move mail and change sender lists.
	sender_triage_updated: SENDER_TARGETS,
	sender_triage_deleted: SENDER_TARGETS,
	sender_rule_updated: SENDER_TARGETS,
	sender_rule_deleted: SENDER_TARGETS,
	sender_rules_changed: SENDER_TARGETS,
	digest_todo_completed: ["emails", "inboxDigest"],
	digest_topic_read: ["emails", "inboxDigest"],
	alias_created: ["aliases"],
	alias_updated: ["aliases"],
	alias_deleted: ["aliases"],
};

/** Stream bookkeeping, not data changes. */
const IGNORED_EVENTS = new Set(["connected", "ping"]);

/**
 * Everything a data change can touch, for events this build does not know
 * yet (a newer Worker) — the same "resync on anything" fallback iOS and
 * Android use.
 */
export const FALLBACK_TARGETS: readonly MailboxEventTarget[] = [
	"emails",
	"summaries",
	"senderPreferences",
	"senderRules",
	"inboxDigest",
];

export function mailboxEventTargets(event: string): readonly MailboxEventTarget[] {
	if (IGNORED_EVENTS.has(event)) return [];
	return MAILBOX_EVENT_TARGETS[event] ?? FALLBACK_TARGETS;
}

/** Query-key prefixes to invalidate for a set of targets, without duplicates. */
export function queryKeysForTargets(
	mailboxId: string,
	targets: Iterable<MailboxEventTarget>,
): readonly (readonly unknown[])[] {
	const keys: (readonly unknown[])[] = [];
	for (const target of new Set(targets)) {
		switch (target) {
			case "emails":
				keys.push(
					["emails", mailboxId],
					queryKeys.folders.list(mailboxId),
					queryKeys.workflowPiles.list(mailboxId),
				);
				break;
			case "summaries":
				keys.push(queryKeys.summaries.all(mailboxId));
				break;
			case "aliases":
				keys.push(["aliases", mailboxId]);
				break;
			case "senderPreferences":
				keys.push(["sender-preferences", mailboxId]);
				break;
			case "senderRules":
				keys.push(["sender-rules", mailboxId]);
				break;
			case "inboxDigest":
				keys.push(queryKeys.inboxDigest.detail(mailboxId));
				break;
		}
	}
	return keys;
}
