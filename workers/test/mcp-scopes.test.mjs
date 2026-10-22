/**
 * MCP per-tool OAuth scopes (AVE-69; table in workers/mcp/scopes.ts). The real
 * EmailMCP tool registrations run against a real AUTH_DB and are driven over
 * an in-memory MCP transport by the SDK's own client, as an OAuth grant with
 * various scopes and as a legacy session-token request.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mcp-scopes.test.mjs
 */

import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EmailMCP } from "../mcp/index.ts";
import { MCP_TOOL_SCOPES, requiredScopeForTool, scopeDeniedMessage, toolAllowed } from "../mcp/scopes.ts";
import { MCP_OAUTH_SCOPES } from "../../shared/mcp-consent.ts";
import { addMailbox, addUser, createAuthTestEnv, principalFor } from "./auth-fixtures.mjs";

const { env, db, bucket } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "bob@inboxies.email", { owners: ["bob"] });

const ALL_TOOLS = Object.keys(MCP_TOOL_SCOPES).sort();
const toolsFor = (scope) => ALL_TOOLS.filter((name) => MCP_TOOL_SCOPES[name] === scope);
const SEND_TOOLS = toolsFor("send");

const legacyProps = () => ({ principal: principalFor(ada) });
const oauthProps = (scopes, mailboxIds = ["ada@inboxies.email"]) => ({
	principal: { ...principalFor(ada, { sessionId: "oauth:grant1" }) },
	oauth: { clientId: "client1", scopes, mailboxIds },
});

/** An EmailMCP session with `props`, connected to an SDK client. Records every name handed to server.tool. */
async function connect(props) {
	const agent = new EmailMCP({}, env);
	agent.props = props;
	const registered = [];
	const original = agent.server.tool.bind(agent.server);
	agent.server.tool = (name, ...rest) => {
		registered.push(name);
		return original(name, ...rest);
	};
	await agent.init();
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await agent.server.connect(serverTransport);
	const client = new Client({ name: "scope-test", version: "1.0.0" });
	await client.connect(clientTransport);
	const listed = (await client.listTools()).tools.map((t) => t.name).sort();
	return { agent, client, registered, listed };
}

/** A tool call's outcome as { isError, text }, whether the SDK returned an error result or threw. */
async function callTool(client, name, args) {
	try {
		const res = await client.callTool({ name, arguments: args });
		return { isError: Boolean(res.isError), text: res.content.map((c) => c.text ?? "").join("\n") };
	} catch (error) {
		return { isError: true, text: String(error?.message ?? error) };
	}
}

const sendArgs = (mailboxId) => ({ mailboxId, to: "someone@example.com", subject: "Hi", bodyHtml: "<p>Hi</p>" });
const replyArgs = (mailboxId) => ({ ...sendArgs(mailboxId), originalEmailId: "e1" });

// ── The table itself ──────────────────────────────────────────────────
{
	for (const [tool, scope] of Object.entries(MCP_TOOL_SCOPES)) {
		assert.ok(MCP_OAUTH_SCOPES.includes(scope), `${tool} maps to a scope the consent page grants`);
	}
	assert.deepEqual(SEND_TOOLS, ["send_email", "send_reply"]);
	assert.deepEqual(toolsFor("draft"), ["create_draft", "draft_reply", "update_draft"]);
	assert.deepEqual(toolsFor("manage"), ["delete_email", "mark_email_read", "move_email"]);

	// Unmapped tools fail closed for everyone, including legacy sessions and full grants.
	assert.equal(requiredScopeForTool("purge_everything"), null);
	assert.equal(requiredScopeForTool("toString"), null, "prototype keys are not tools");
	assert.equal(toolAllowed(undefined, "purge_everything"), false);
	assert.equal(toolAllowed({ clientId: "c", scopes: [...MCP_OAUTH_SCOPES], mailboxIds: null }, "purge_everything"), false);

	assert.equal(toolAllowed(undefined, "send_email"), true, "legacy session keeps send");
	assert.equal(toolAllowed({ clientId: "c", scopes: ["read"], mailboxIds: null }, "send_email"), false);
	assert.equal(toolAllowed({ clientId: "c", scopes: ["read", "send"], mailboxIds: null }, "send_email"), true);
	assert.match(scopeDeniedMessage("send_email"), /"send"/);
	console.log("✓ scope table");
}

// ── Every registered tool is mapped, and every mapped tool is registered ──
{
	const { registered, listed } = await connect(legacyProps());
	for (const name of registered) {
		assert.ok(requiredScopeForTool(name), `registered tool ${name} has an explicit scope in MCP_TOOL_SCOPES`);
	}
	assert.deepEqual([...registered].sort(), ALL_TOOLS, "EmailMCP registers exactly the tools in the table");
	assert.deepEqual(listed, ALL_TOOLS, "legacy session tokens see every tool");
	console.log("✓ all registered tools are mapped");
}

// ── Read-only grant: read tools only; send tools hidden and refused ────
{
	const { client, listed } = await connect(oauthProps(["read"]));
	assert.deepEqual(listed, toolsFor("read"));
	for (const name of SEND_TOOLS) assert.ok(!listed.includes(name), `${name} hidden from a read-only grant`);

	const send = await callTool(client, "send_email", sendArgs("ada@inboxies.email"));
	assert.equal(send.isError, true);
	assert.match(send.text, /send_email/);
	const reply = await callTool(client, "send_reply", replyArgs("ada@inboxies.email"));
	assert.equal(reply.isError, true);
	for (const name of ["create_draft", "delete_email", "move_email", "mark_email_read"]) {
		const res = await callTool(client, name, {});
		assert.equal(res.isError, true, `${name} refused for a read-only grant`);
	}

	// Read tools still work, limited to the grant's mailboxes.
	const mailboxes = await callTool(client, "list_mailboxes", {});
	assert.equal(mailboxes.isError, false);
	assert.deepEqual(JSON.parse(mailboxes.text).map((m) => m.id), ["ada@inboxies.email"]);
	console.log("✓ read-only grant cannot send");
}

// ── Send grant: send tools listed and pass the scope gate ──────────────
{
	const { client, listed } = await connect(oauthProps(["read", "send"]));
	assert.deepEqual(listed, [...toolsFor("read"), ...SEND_TOOLS].sort());
	assert.ok(!listed.includes("create_draft"), "send does not imply draft");
	assert.ok(!listed.includes("delete_email"), "send does not imply manage");

	// Past the scope gate, the mailbox check runs: bob's mailbox is refused as a mailbox, not as a scope.
	const send = await callTool(client, "send_email", sendArgs("bob@inboxies.email"));
	assert.equal(send.isError, true);
	assert.match(send.text, /Not allowed to access mailbox/);
	assert.doesNotMatch(send.text, /permission|not found/i);
	console.log("✓ send grant can call send tools");
}

// ── Defense in depth: a registered tool re-checks scopes on every call ──
{
	const session = await connect(oauthProps(["read", "send"]));
	session.agent.props = oauthProps(["read"]); // props replaced after init
	const send = await callTool(session.client, "send_email", sendArgs("ada@inboxies.email"));
	assert.equal(send.isError, true);
	assert.equal(JSON.parse(send.text).error, scopeDeniedMessage("send_email"));
	console.log("✓ calls re-check the current grant");
}

// ── Full grant and legacy bearer path ─────────────────────────────────
{
	const full = await connect(oauthProps([...MCP_OAUTH_SCOPES]));
	assert.deepEqual(full.listed, ALL_TOOLS);

	const legacy = await connect(legacyProps());
	const send = await callTool(legacy.client, "send_email", sendArgs("bob@inboxies.email"));
	assert.match(send.text, /Not allowed to access mailbox/, "legacy sessions reach the mailbox check");
	const mailboxes = await callTool(legacy.client, "list_mailboxes", {});
	assert.deepEqual(JSON.parse(mailboxes.text).map((m) => m.id), ["ada@inboxies.email"]);
	console.log("✓ legacy session tokens keep full access");
}

console.log("mcp-scopes: all passed");
