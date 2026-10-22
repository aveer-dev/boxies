/**
 * AVE-95: every move into or out of Spam teaches the sender, whichever client
 * path made it (Not spam / Report spam, move menu, swipe, multi-select all hit
 * POST /emails/:id/move), with or without `setSenderPreference`. Agent/MCP
 * `move_email` stays neutral; agents use `allow_sender` / `block_sender`,
 * which are scope-checked like every MCP tool (AVE-69).
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/spam-move-lessons.test.mjs
 */

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EmailMCP } from "../mcp/index.ts";
import { MCP_TOOL_SCOPES, scopeDeniedMessage } from "../mcp/scopes.ts";
import { allowSenderForAgent, blockSenderForAgent } from "../lib/sender-verdicts.ts";
import { toolMoveEmail } from "../lib/tools.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const MAILBOX = "ada@inboxies.email";

/** A mailbox DO double that keeps emails, sender_triage and sender_preferences in memory. */
function fakeMailbox() {
	const state = { emails: new Map(), triage: new Map(), prefs: new Map(), writes: [] };
	const stub = {
		getEmail: async (id) => {
			const email = state.emails.get(id);
			return email ? { ...email } : null; // a snapshot, like the DO
		},
		moveEmail: async (id, folderId) => {
			const email = state.emails.get(id);
			if (!email) return false;
			email.folder_id = folderId;
			return true;
		},
		getSenderTriage: async (sender) => state.triage.get(sender) ?? null,
		upsertSenderTriage: async (row) => {
			state.writes.push(["triage", row.sender, row.status]);
			const saved = {
				sender: row.sender,
				status: row.status,
				destination_folder_id: row.status === "allowed" ? row.destination_folder_id ?? null : null,
				display_name: row.display_name ?? null,
			};
			state.triage.set(row.sender, saved);
			return saved;
		},
		getSenderPreference: async (address) => state.prefs.get(address) ?? null,
		upsertSenderPreference: async (input) => {
			state.writes.push(["pref", input.address, input.folderId]);
			const preference = { address: input.address, folderId: input.folderId, source: input.source ?? "user" };
			state.prefs.set(input.address, preference);
			return { preference, refiledCount: 0 };
		},
		deleteSenderPreference: async (address) => {
			state.writes.push(["pref-delete", address]);
			return state.prefs.delete(address);
		},
	};
	const put = (id, folder_id, sender) =>
		state.emails.set(id, { id, folder_id, sender, sender_name: null });
	return { state, stub, put };
}

const mailbox = fakeMailbox();
const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mockMailboxNamespace(mailbox.stub) });
const ada = await addUser(db, { id: "ada", email: MAILBOX });
await addMailbox(db, bucket, MAILBOX, { owners: ["ada"] });
const asAda = principalFor(ada);

const move = (id, folderId, extra = {}) =>
	request(env, {
		method: "POST",
		path: `/api/v1/mailboxes/${MAILBOX}/emails/${id}/move`,
		principal: asAda,
		body: { folderId, ...extra },
	});

// ── HTTP move: out of Spam allows, into Spam blocks, no flag needed ──────
{
	// Move menu / swipe / multi-select send no setSenderPreference.
	mailbox.put("m1", "spam", "News <News@Shop.example>");
	const res = await move("m1", "promotions");
	assert.equal(res.status, 200);
	assert.equal(res.payload.senderStatus, "allowed", "leaving Spam is the signal");
	assert.equal(mailbox.state.triage.get("news@shop.example").status, "allowed");
	assert.equal(mailbox.state.prefs.get("news@shop.example").folderId, "promotions");
	assert.equal(mailbox.state.prefs.get("news@shop.example").source, "user", "explicit allow");
}
{
	// Swipe-archive out of Spam allows the sender without a default box.
	mailbox.put("m2", "spam", "ada.friend@example.com");
	const res = await move("m2", "archive");
	assert.equal(res.payload.senderStatus, "allowed");
	assert.equal(mailbox.state.triage.get("ada.friend@example.com").status, "allowed");
	assert.equal(mailbox.state.prefs.has("ada.friend@example.com"), false);
}
{
	// Moving into Spam from the move menu is Report spam.
	mailbox.put("m3", "inbox", "news@shop.example");
	const res = await move("m3", "spam");
	assert.equal(res.payload.senderStatus, "rejected");
	assert.equal(mailbox.state.triage.get("news@shop.example").status, "rejected");
	assert.equal(mailbox.state.prefs.has("news@shop.example"), false, "drops the purpose box");
}
{
	// Not spam (the button) still works the same with the flag.
	mailbox.put("m4", "spam", "news@shop.example");
	const res = await move("m4", "inbox", { setSenderPreference: true });
	assert.equal(res.payload.senderStatus, "allowed");
	assert.equal(mailbox.state.prefs.get("news@shop.example").folderId, "inbox");
}
{
	// Deleting spam or screening it out isn't a vote.
	for (const [id, to] of [["m5", "trash"], ["m6", "screened_out"]]) {
		mailbox.put(id, "spam", "junk@bad.example");
		const res = await move(id, to, { setSenderPreference: true });
		assert.equal(res.payload.status, "moved");
		assert.equal(res.payload.senderStatus, undefined);
	}
	assert.equal(mailbox.state.triage.has("junk@bad.example"), false);
}
{
	// Ordinary moves teach nothing without "remember".
	mailbox.put("m7", "inbox", "boss@work.example");
	const before = mailbox.state.writes.length;
	const res = await move("m7", "updates");
	assert.deepEqual(res.payload, { status: "moved" });
	assert.equal(mailbox.state.writes.length, before);
}
{
	// Your own address is never judged.
	mailbox.put("m8", "inbox", MAILBOX);
	const res = await move("m8", "spam");
	assert.deepEqual(res.payload, { status: "moved" });
	assert.equal(mailbox.state.triage.has(MAILBOX), false);
}
console.log("✓ every client move across Spam teaches the sender");

// ── toolMoveEmail (agent + MCP move_email) writes no rule ────────────────
{
	mailbox.put("t1", "spam", "agent-moved@example.com");
	mailbox.put("t2", "inbox", "agent-moved2@example.com");
	const before = mailbox.state.writes.length;
	assert.equal((await toolMoveEmail(env, MAILBOX, "t1", "inbox")).status, "moved");
	assert.equal((await toolMoveEmail(env, MAILBOX, "t2", "spam")).status, "moved");
	assert.equal(mailbox.state.emails.get("t1").folder_id, "inbox");
	assert.equal(mailbox.state.writes.length, before, "move_email writes no triage or preference");
	console.log("✓ toolMoveEmail is neutral");
}

// ── allow / block helpers ────────────────────────────────────────────────
{
	const box = fakeMailbox();
	assert.deepEqual(await allowSenderForAgent(box.stub, MAILBOX, { sender: "Bob <BOB@x.example>" }), {
		status: "allowed",
		sender: "bob@x.example",
		folder: "inbox",
	});
	assert.equal(box.state.triage.get("bob@x.example").status, "allowed");
	assert.equal(box.state.prefs.get("bob@x.example").source, "user");

	// Keeps the sender's current box when no folder is given.
	box.state.prefs.set("news@x.example", { address: "news@x.example", folderId: "promotions", source: "screener" });
	assert.equal((await allowSenderForAgent(box.stub, MAILBOX, { sender: "news@x.example" })).folder, "promotions");
	assert.equal((await allowSenderForAgent(box.stub, MAILBOX, { sender: "c@x.example", folderId: "updates" })).folder, "updates");

	assert.match((await allowSenderForAgent(box.stub, MAILBOX, { sender: "c@x.example", folderId: "archive" })).error, /inbox, promotions, or updates/);
	assert.match((await allowSenderForAgent(box.stub, MAILBOX, { sender: "not an address" })).error, /Invalid sender/);
	assert.match((await allowSenderForAgent(box.stub, MAILBOX, { sender: "Ada@Inboxies.Email" })).error, /own address/);
	assert.match((await blockSenderForAgent(box.stub, MAILBOX, { sender: "ada+x@inboxies.email" })).error, /own address/);

	assert.deepEqual(await blockSenderForAgent(box.stub, MAILBOX, { sender: "news@x.example" }), {
		status: "blocked",
		sender: "news@x.example",
	});
	assert.equal(box.state.triage.get("news@x.example").status, "rejected");
	assert.equal(box.state.prefs.has("news@x.example"), false);

	// Allowing again clears the block.
	await allowSenderForAgent(box.stub, MAILBOX, { sender: "news@x.example" });
	assert.equal(box.state.triage.get("news@x.example").status, "allowed");
	console.log("✓ allow_sender / block_sender write what Not spam / Report spam write");
}

// ── MCP: scope-checked tools, end to end over an in-memory transport ─────
assert.equal(MCP_TOOL_SCOPES.allow_sender, "manage");
assert.equal(MCP_TOOL_SCOPES.block_sender, "manage");

async function connect(props) {
	const agent = new EmailMCP({}, env);
	agent.props = props;
	await agent.init();
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await agent.server.connect(serverTransport);
	const client = new Client({ name: "spam-test", version: "1.0.0" });
	await client.connect(clientTransport);
	const listed = (await client.listTools()).tools.map((t) => t.name);
	return { agent, client, listed };
}
const oauth = (scopes) => ({
	principal: principalFor(ada, { sessionId: "oauth:grant1" }),
	oauth: { clientId: "client1", scopes, mailboxIds: [MAILBOX] },
});
async function call(client, name, args) {
	try {
		const res = await client.callTool({ name, arguments: args });
		return { isError: Boolean(res.isError), text: res.content.map((c) => c.text ?? "").join("\n") };
	} catch (error) {
		return { isError: true, text: String(error?.message ?? error) };
	}
}

{
	// Without `manage`, the tools are hidden and refused.
	const { client, listed } = await connect(oauth(["read", "draft", "send"]));
	for (const name of ["allow_sender", "block_sender"]) {
		assert.ok(!listed.includes(name), `${name} hidden without manage`);
		const res = await call(client, name, { mailboxId: MAILBOX, sender: "x@y.example" });
		assert.equal(res.isError, true, `${name} refused without manage`);
	}
	assert.equal(mailbox.state.triage.has("x@y.example"), false);
}
{
	// A grant that loses `manage` mid-session is refused on the next call.
	const session = await connect(oauth(["read", "manage"]));
	session.agent.props = oauth(["read"]);
	const res = await call(session.client, "block_sender", { mailboxId: MAILBOX, sender: "x@y.example" });
	assert.equal(res.isError, true);
	assert.equal(JSON.parse(res.text).error, scopeDeniedMessage("block_sender"));
}
{
	const { client, listed } = await connect(oauth(["read", "manage"]));
	assert.ok(listed.includes("allow_sender") && listed.includes("block_sender"));

	const blocked = await call(client, "block_sender", { mailboxId: MAILBOX, sender: "promo@deals.example" });
	assert.equal(blocked.isError, false, blocked.text);
	assert.equal(mailbox.state.triage.get("promo@deals.example").status, "rejected");

	const allowed = await call(client, "allow_sender", { mailboxId: MAILBOX, sender: "promo@deals.example", folderId: "promotions" });
	assert.equal(allowed.isError, false, allowed.text);
	assert.equal(JSON.parse(allowed.text).folder, "promotions");
	assert.equal(mailbox.state.triage.get("promo@deals.example").status, "allowed");

	const self = await call(client, "allow_sender", { mailboxId: MAILBOX, sender: MAILBOX });
	assert.equal(self.isError, true);

	const other = await call(client, "allow_sender", { mailboxId: "bob@inboxies.email", sender: "x@y.example" });
	assert.equal(other.isError, true);
	assert.match(other.text, /Not allowed to access mailbox/);

	// MCP move_email out of Spam still writes no rule.
	mailbox.put("mcp1", "spam", "mcp-moved@example.com");
	const before = mailbox.state.writes.length;
	const moved = await call(client, "move_email", { mailboxId: MAILBOX, emailId: "mcp1", folderId: "inbox" });
	assert.equal(moved.isError, false, moved.text);
	assert.equal(mailbox.state.emails.get("mcp1").folder_id, "inbox");
	assert.equal(mailbox.state.writes.length, before, "MCP move_email writes no rule");
	assert.equal(mailbox.state.triage.has("mcp-moved@example.com"), false);
	console.log("✓ MCP allow_sender / block_sender are scope-checked; move_email is neutral");
}

console.log("spam-move-lessons: all passed");
