/**
 * Deleting an Ask AI conversation wipes its EmailAgent chat, and mailbox
 * purge still finds conversations whose agent purge failed (tombstones).
 * Runs the real MailboxDO migrations and tombstone SQL on node:sqlite, then
 * the DELETE route and mailbox purge against mock DO namespaces.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/agent-conversation-purge.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	agentConversationIdsToPurge,
	clearAgentConversationTombstone,
	tombstoneAgentConversation,
} from "../lib/agent-conversation-tombstones.ts";
import { purgeMailboxAndAgents } from "../index.ts";
import { addMailbox, addUser, createAuthTestEnv, mockMailboxNamespace, principalFor, request } from "./auth-fixtures.mjs";

/** `ctx.storage.sql` stand-in: multi-statement scripts via exec, else one prepared statement. */
function sqlStorage(db) {
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			return db.prepare(query).all(...bindings);
		},
	};
}

const MAILBOX = "ada@inboxies.email";
const db = new DatabaseSync(":memory:");
const sql = sqlStorage(db);
applyMigrations(
	sql,
	mailboxMigrations.filter((m) => ["9_add_agent_conversations", "28_agent_conversation_tombstones"].includes(m.name)),
);
const now = new Date().toISOString();
for (const id of ["auto", "c1", "c2", "c3"]) {
	sql.exec(
		`INSERT INTO agent_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		id,
		id,
		now,
		now,
	);
}
const sorted = (ids) => [...ids].sort();

// ── Tombstones: deleted conversations stay findable until wiped ──
{
	tombstoneAgentConversation(sql, "c1");
	tombstoneAgentConversation(sql, "c1"); // a retried delete is harmless
	const registry = sql.exec(`SELECT id FROM agent_conversations`).map((r) => r.id);
	assert.deepEqual(sorted(registry), ["auto", "c2", "c3"], "registry row is gone");
	assert.deepEqual(sorted(agentConversationIdsToPurge(sql)), ["auto", "c1", "c2", "c3"], "purge still sees c1");

	tombstoneAgentConversation(sql, "c2");
	clearAgentConversationTombstone(sql, "c2"); // agent purge succeeded
	assert.deepEqual(sorted(agentConversationIdsToPurge(sql)), ["auto", "c1", "c3"]);
}

// ── DELETE route purges the conversation's EmailAgent ───────────
const purged = [];
const failing = new Set();
const emailAgent = {
	idFromName: (name) => name,
	get: (name) => ({
		purge: async () => {
			if (failing.has(name)) throw new Error("agent unavailable");
			purged.push(name);
			return { status: "purged" };
		},
	}),
};
const mailboxes = mockMailboxNamespace({
	getAgentConversation: async (id) => (agentConversationIdsToPurge(sql).includes(id) ? { id } : null),
	deleteAgentConversation: async (id) => {
		const live = sql.exec(`SELECT id FROM agent_conversations WHERE id = ?`, id);
		if (!live.length) return false;
		tombstoneAgentConversation(sql, id);
		return true;
	},
	clearAgentConversationTombstone: async (id) => clearAgentConversationTombstone(sql, id),
	purgeMailbox: async () => ({ conversationIds: agentConversationIdsToPurge(sql) }),
});
const { env, db: authDb, bucket } = createAuthTestEnv({ MAILBOX: mailboxes, EMAIL_AGENT: emailAgent });
const ada = await addUser(authDb, { id: "ada", email: MAILBOX });
await addMailbox(authDb, bucket, MAILBOX, { owners: ["ada"] });
const del = (id) =>
	request(env, {
		method: "DELETE",
		path: `/api/v1/mailboxes/${MAILBOX}/agent/conversations/${id}`,
		principal: principalFor(ada),
	});

{
	const res = await del("c3");
	assert.equal(res.status, 204);
	assert.deepEqual(purged, [`${MAILBOX}::c3`], "the conversation's own agent is wiped");
	assert.ok(!agentConversationIdsToPurge(sql).includes("c3"), "tombstone cleared after a successful purge");

	assert.equal((await del("c3")).status, 404, "already deleted");
	assert.equal((await del("auto")).status, 400, "auto-drafts conversation is protected");
	assert.equal(purged.length, 1, "no purge for rejected deletes");
}

// A failed agent purge still deletes the conversation but keeps the tombstone…
{
	sql.exec(`INSERT INTO agent_conversations (id, title, created_at, updated_at) VALUES ('c4', 'c4', ?, ?)`, now, now);
	failing.add(`${MAILBOX}::c4`);
	const res = await del("c4");
	assert.equal(res.status, 204);
	assert.ok(agentConversationIdsToPurge(sql).includes("c4"), "tombstone kept for retry");
	failing.clear();
}

// …so mailbox purge wipes every agent that may still hold chat.
{
	purged.length = 0;
	await purgeMailboxAndAgents(env, MAILBOX);
	assert.deepEqual(
		sorted(purged),
		sorted([MAILBOX, `${MAILBOX}::auto`, `${MAILBOX}::c1`, `${MAILBOX}::c4`]),
		"legacy single chat, live conversations and tombstoned ones",
	);
}

console.log("agent-conversation-purge: ok");
