/**
 * Inbound mail must not use up the outbound send quota: the auto-reply
 * claims its once-per-sender window before reserving a send slot.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/send-slots.test.mjs
 */

import assert from "node:assert/strict";
import { sendInboundAutoReply } from "../index.ts";

function stubWith({ claim }) {
	const calls = [];
	return {
		calls,
		stub: {
			claimAutoReply: async () => (calls.push("claim"), claim),
			releaseAutoReply: async () => calls.push("releaseAutoReply"),
			checkSendRateLimit: async () => (calls.push("reserve"), null),
			releaseSendSlot: async () => calls.push("releaseSendSlot"),
			createEmail: async () => calls.push("createEmail"),
		},
	};
}

const base = {
	env: { EMAIL: { send: async () => ({ messageId: "m-1" }) } },
	mailboxId: "ada@inboxies.email",
	sender: "pat@example.com",
	subject: "Hello",
	originalMessageId: "orig@example.com",
	threadId: "t1",
	settings: { autoReply: { enabled: true, subject: "Away", message: "Back Monday." } },
	classification: { class: "ham", folderId: "inbox" },
	headers: [],
};

{
	// Already replied to this sender today: no reply, and no slot spent.
	const { stub, calls } = stubWith({ claim: false });
	await sendInboundAutoReply({ ...base, stub });
	assert.deepEqual(calls, ["claim"], "no send slot reserved for mail that gets no reply");
}

{
	const { stub, calls } = stubWith({ claim: true });
	await sendInboundAutoReply({ ...base, stub });
	assert.equal(calls[0], "claim");
	assert.equal(calls[1], "reserve", "the slot is reserved only once a reply is actually due");
}

console.log("send-slots: ok");
