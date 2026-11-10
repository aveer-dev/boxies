/**
 * Inbound mail → push dispatch, end to end through `receiveEmail` (AVE-103):
 * a vouched sender's mail reaches APNs with the deep-link fields, a
 * stranger's mail (Screener) and a duplicate delivery don't push, and a
 * failed private-email counter no longer loses the push.
 * Run: pnpm test:unit inbound-push
 */

import assert from "node:assert/strict";
import { exportPKCS8, generateKeyPair } from "jose";
import { aliasMetadataKey, mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { receiveEmail } from "../index.ts";

const MAILBOX = "ada@example.com";
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const APNS = {
	APNS_KEY_ID: "KEY1234567",
	APNS_TEAM_ID: "TEAM123456",
	APNS_PRIVATE_KEY: await exportPKCS8(privateKey),
	APNS_SANDBOX: "false",
	APNS_TOPIC: "co.inboxies.app",
};

const apnsCalls = [];
globalThis.fetch = async (url, init) => {
	apnsCalls.push({ url: String(url), body: JSON.parse(init.body) });
	return new Response("", { status: 200 });
};

function createBucket() {
	const store = new Map();
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const value = store.get(key);
			return { json: async () => JSON.parse(value), text: async () => value };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : "blob");
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async delete() {},
	};
}

function fakeMailbox({ triage = null, aliasFails = false } = {}) {
	const claimed = new Set();
	const stored = [];
	return {
		stored,
		isWritable: async () => true,
		claimInboundMessageId: async (messageId) => {
			if (claimed.has(messageId)) return false;
			claimed.add(messageId);
			return true;
		},
		completeInboundMessageClaim: async () => {},
		abandonInboundDelivery: async () => "not_stored",
		findThreadIdByReferences: async () => null,
		findThreadBySubject: async () => null,
		getThreadAliasId: async () => null,
		bootstrapSenderTriage: async () => {},
		getSenderTriage: async () => triage,
		getSenderPreference: async () => null,
		ensureAutoAgentConversation: async () => {},
		getDeviceTokens: async () => [{ token: "ios-token-1", platform: "ios" }],
		unregisterDeviceToken: async () => {},
		recordAliasInbound: async () => {
			if (aliasFails) throw new Error("alias counter unavailable");
		},
		createEmail: async (folder, email) => {
			stored.push({ folder, id: email.id, email });
		},
	};
}

function message(to, messageId, { subject = "Quarterly numbers", mime, envelopeHeaders } = {}) {
	const raw = [
		"From: Pat <pat@sender.example>",
		`To: ${to}`,
		`Subject: ${subject}`,
		`Message-ID: <${messageId}>`,
		"MIME-Version: 1.0",
		...(mime ?? ["Content-Type: text/plain; charset=utf-8", "", "The numbers look good.", ""]),
	].join("\r\n");
	const bytes = new TextEncoder().encode(raw);
	return {
		to,
		from: "pat@sender.example",
		headers: new Headers(envelopeHeaders ?? {}),
		raw: new ReadableStream({
			start(c) {
				c.enqueue(bytes);
				c.close();
			},
		}),
		rawSize: bytes.byteLength,
		setReject(reason) {
			throw new Error(`unexpected reject: ${reason}`);
		},
	};
}

async function deliver(stub, to, messageId, bucket = createBucket(), options) {
	await bucket.put(mailboxMetadataKey(MAILBOX), "{}");
	const env = { ...APNS, BUCKET: bucket, MAILBOX: { idFromName: (n) => n, get: () => stub } };
	const pending = [];
	const ctx = { waitUntil: (p) => pending.push(p) };
	const { log, error, warn } = console;
	console.log = console.error = console.warn = () => {};
	try {
		await receiveEmail(message(to, messageId, options), env, ctx);
		await Promise.all(pending);
	} finally {
		Object.assign(console, { log, error, warn });
	}
}

const allowed = {
	sender: "pat@sender.example",
	status: "allowed",
	destination_folder_id: null,
	decided_at: "",
	updated_at: "",
};

{
	// Allowed sender: stored in Inbox and pushed with the deep-link fields.
	apnsCalls.length = 0;
	const stub = fakeMailbox({ triage: allowed });
	await deliver(stub, MAILBOX, "m1@sender.example");
	assert.deepEqual(stub.stored.map((s) => s.folder), ["inbox"]);
	assert.equal(apnsCalls.length, 1);
	assert.equal(apnsCalls[0].url, "https://api.push.apple.com/3/device/ios-token-1");
	assert.equal(apnsCalls[0].body.emailId, stub.stored[0].id);
	assert.equal(apnsCalls[0].body.mailboxId, MAILBOX);
	assert.equal(apnsCalls[0].body.folderId, "inbox");
	assert.equal(apnsCalls[0].body.aps.alert.title, "Pat");

	// The same Message-ID again (Email Routing retry): no second row or push.
	await deliver(stub, MAILBOX, "m1@sender.example");
	assert.equal(stub.stored.length, 1);
	assert.equal(apnsCalls.length, 1);
}

{
	// Unknown sender with Screener on (the default): filed to Screener, no push.
	apnsCalls.length = 0;
	const stub = fakeMailbox();
	await deliver(stub, MAILBOX, "m2@sender.example");
	assert.deepEqual(stub.stored.map((s) => s.folder), ["screener"]);
	assert.equal(apnsCalls.length, 0);
}

{
	// Private email whose inbound counter fails: the message is stored, the
	// delivery doesn't throw (which dedup would turn into a lost push), and
	// the push goes out.
	apnsCalls.length = 0;
	const stub = fakeMailbox({ triage: allowed, aliasFails: true });
	const bucket = createBucket();
	await bucket.put(
		aliasMetadataKey("k8m2p9v4@example.com"),
		JSON.stringify({
			kind: "private",
			aliasId: "a1",
			aliasEmail: "k8m2p9v4@example.com",
			targetMailboxId: MAILBOX,
			domain: "example.com",
			baseDomain: "example.com",
			label: null,
			isActive: true,
			pausedAction: "drop",
			expiresAt: null,
			createdAt: new Date().toISOString(),
		}),
	);
	await deliver(stub, "k8m2p9v4@example.com", "m3@sender.example", bucket);
	assert.equal(stub.stored.length, 1);
	assert.equal(apnsCalls.length, 1);
}

{
	// One-time code (AVE-175): stored on the row and leading the push body.
	apnsCalls.length = 0;
	const stub = fakeMailbox({ triage: allowed });
	await deliver(stub, MAILBOX, "m4@sender.example", createBucket(), {
		subject: "Your verification code",
		mime: ["Content-Type: text/plain; charset=utf-8", "", "Your verification code is 482913.", "It expires in 10 minutes.", ""],
	});
	assert.equal(stub.stored[0].email.otp_code, "482913");
	assert.equal(stub.stored[0].email.calendar_invite, null);
	assert.equal(apnsCalls.length, 1);
	assert.match(apnsCalls[0].body.aps.alert.body, /^Code 482913 · /);
}

{
	// Calendar invite (AVE-175) from a text/calendar alternative part.
	apnsCalls.length = 0;
	const stub = fakeMailbox({ triage: allowed });
	await deliver(stub, MAILBOX, "m5@sender.example", createBucket(), {
		subject: "Invitation: Design review @ Thu Nov 5, 2026",
		mime: [
			'Content-Type: multipart/alternative; boundary="b1"',
			"",
			"--b1",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"You have been invited to Design review.",
			"--b1",
			'Content-Type: text/calendar; charset="UTF-8"; method=REQUEST',
			"Content-Transfer-Encoding: 7bit",
			"",
			"BEGIN:VCALENDAR",
			"METHOD:REQUEST",
			"BEGIN:VEVENT",
			"UID:design-review@example.com",
			"SUMMARY:Design review",
			"DTSTART;TZID=America/New_York:20261105T100000",
			"DTEND;TZID=America/New_York:20261105T110000",
			"ORGANIZER;CN=Pat:mailto:pat@sender.example",
			"END:VEVENT",
			"END:VCALENDAR",
			"--b1--",
			"",
		],
	});
	const invite = stub.stored[0].email.calendar_invite;
	assert.equal(invite?.title, "Design review");
	assert.equal(invite?.start, "2026-11-05T15:00:00.000Z");
	assert.equal(invite?.method, "REQUEST");
	assert.equal(stub.stored[0].email.otp_code, null);
}

{
	// Failed sender authentication: no code and no push copy with it.
	apnsCalls.length = 0;
	const stub = fakeMailbox({ triage: allowed });
	await deliver(stub, MAILBOX, "m6@sender.example", createBucket(), {
		subject: "Your verification code",
		mime: ["Content-Type: text/plain; charset=utf-8", "", "Your verification code is 482913.", ""],
		envelopeHeaders: {
			"Authentication-Results":
				"mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=sender.example; dmarc=fail (p=REJECT) header.from=sender.example policy.dmarc=reject",
		},
	});
	assert.equal(stub.stored[0].email.auth_tier, "failed");
	assert.equal(stub.stored[0].email.otp_code, null);
	assert.ok(apnsCalls.every((call) => !/482913/.test(JSON.stringify(call.body))));
}

{
	// Sender accepted into Updates (AVE-192): filed there quietly, no push.
	apnsCalls.length = 0;
	const stub = fakeMailbox({ triage: { ...allowed, destination_folder_id: "updates" } });
	await deliver(stub, MAILBOX, "m7@sender.example", createBucket(), { subject: "Your receipt" });
	assert.deepEqual(stub.stored.map((s) => s.folder), ["updates"]);
	assert.equal(apnsCalls.length, 0);
}

console.log("inbound push tests passed");
