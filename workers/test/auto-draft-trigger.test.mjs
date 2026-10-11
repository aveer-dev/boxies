// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Inbound auto-draft → EmailAgent `/onNewEmail`.
 *
 * Runs against the real partyserver `Server` and `getServerByName` (what the
 * Agents SDK's `Agent` and `getAgentByName` delegate to), with
 * `cloudflare:workers` stubbed and an in-memory Durable Object namespace.
 *
 * Run: node --experimental-strip-types workers/test/auto-draft-trigger.test.mjs
 */

import assert from "node:assert/strict";
import { createRequire, register } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { NEW_EMAIL_PATH, triggerAutoDraft } from "../lib/auto-draft.ts";
import {
	AUTO_CONVERSATION_ID,
	agentInstanceName,
} from "../../shared/agent-conversations.ts";

register(new URL("./cloudflare-workers-hooks.mjs", import.meta.url));

// partyserver is a dependency of `agents`, not of the app; resolve it from
// there so this works under pnpm's strict node_modules layout.
const partyserverEntry = createRequire(import.meta.resolve("agents")).resolve(
	"partyserver",
);
const { Server, getServerByName } = await import(
	pathToFileURL(partyserverEntry).href
);

const AGENT_NAME = agentInstanceName("ada@example.com", AUTO_CONVERSATION_ID);

function newEmailPayload(emailId) {
	return {
		mailboxId: "ada@example.com",
		emailId,
		sender: "grace@example.com",
		subject: "Lunch on Friday?",
		threadId: "thread-1",
	};
}

/** Mirrors EmailAgent.onRequest's `/onNewEmail` route on the real base class. */
class FakeEmailAgent extends Server {
	newEmails = [];

	async onRequest(request) {
		const url = new URL(request.url);
		if (url.pathname === NEW_EMAIL_PATH && request.method === "POST") {
			this.newEmails.push({ name: this.name, payload: await request.json() });
			return Response.json({ status: "drafted" });
		}
		return new Response("Not found", { status: 404 });
	}
}

/**
 * Minimal DurableObjectNamespace: one instance per id, created on first
 * fetch. Like the platform, the instance never learns its name from the id.
 */
function createAgentNamespace(AgentClass) {
	const instances = new Map();
	return {
		instances,
		idFromName(name) {
			return { toString: () => `id:${name}` };
		},
		get(id) {
			const key = id.toString();
			return {
				async fetch(input, init) {
					if (!instances.has(key)) {
						instances.set(key, new AgentClass(createDurableObjectState(), {}));
					}
					const request = input instanceof Request ? input : new Request(input, init);
					return instances.get(key).fetch(request);
				},
			};
		},
	};
}

function createDurableObjectState() {
	const data = new Map();
	return {
		storage: {
			async get(key) {
				return data.get(key);
			},
			async put(key, value) {
				data.set(key, value);
			},
		},
		async blockConcurrencyWhile(fn) {
			return fn();
		},
	};
}

/** The pre-fix call site: a raw stub with no instance name. */
async function rawStub(namespace, name) {
	return namespace.get(namespace.idFromName(name));
}

async function captureConsoleError(fn) {
	const original = console.error;
	const lines = [];
	console.error = (...args) => {
		lines.push(args.map(String).join(" "));
	};
	try {
		return { result: await fn(), lines };
	} finally {
		console.error = original;
	}
}

function onlyInstance(namespace) {
	assert.equal(namespace.instances.size, 1);
	return [...namespace.instances.values()][0];
}

test("a raw idFromName stub reaches a fresh agent unnamed and onNewEmail never runs", async () => {
	const namespace = createAgentNamespace(FakeEmailAgent);
	const stub = await rawStub(namespace, AGENT_NAME);

	const { result: response, lines } = await captureConsoleError(() =>
		stub.fetch(
			new Request(`https://agents${NEW_EMAIL_PATH}`, {
				method: "POST",
				body: JSON.stringify(newEmailPayload("email-1")),
			}),
		),
	);

	assert.equal(response.status, 500);
	assert.match(await response.text(), /Missing namespace or room headers/);
	// Same signature as the production log line.
	assert.ok(lines.some((line) => line.startsWith("Error in FakeEmailAgent:<unnamed> fetch:")));
	assert.deepEqual(onlyInstance(namespace).newEmails, []);
});

test("triggerAutoDraft names the auto conversation agent and delivers the email", async () => {
	const namespace = createAgentNamespace(FakeEmailAgent);

	await triggerAutoDraft(namespace, AGENT_NAME, newEmailPayload("email-1"), getServerByName);
	// A warm, already-named instance keeps accepting new mail.
	await triggerAutoDraft(namespace, AGENT_NAME, newEmailPayload("email-2"), getServerByName);

	assert.deepEqual(onlyInstance(namespace).newEmails, [
		{ name: AGENT_NAME, payload: newEmailPayload("email-1") },
		{ name: AGENT_NAME, payload: newEmailPayload("email-2") },
	]);
});

test("triggerAutoDraft rejects when the agent answers with an error", async () => {
	const namespace = createAgentNamespace(FakeEmailAgent);

	const { lines } = await captureConsoleError(() =>
		assert.rejects(
			triggerAutoDraft(namespace, AGENT_NAME, newEmailPayload("email-1"), rawStub),
			/EmailAgent \/onNewEmail returned 500: .*Missing namespace or room headers/s,
		),
	);

	assert.ok(lines.length > 0);
	assert.deepEqual(onlyInstance(namespace).newEmails, []);
});
