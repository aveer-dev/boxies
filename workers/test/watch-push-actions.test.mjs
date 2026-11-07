/**
 * Watch phase 1a (AVE-140): actionable push payloads and the quick-reply route.
 * - APNs body: `aps.category = "INBOXIES_MAIL"`, `aps["thread-id"]` and a
 *   top-level `threadId` when set; unchanged shape otherwise (old clients).
 * - FCM data: `threadId` and `category` strings when set; absent otherwise.
 * - `POST /api/v1/mailboxes/:mailboxId/emails/:id/quick-reply { text }`:
 *   Re: subject and To from the original, the sender `/reply` would use (the
 *   thread's private email when bound to one), quoted original,
 *   Idempotency-Key, validation, 404, send rate limit and mailbox access.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/watch-push-actions.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { buildAPNsBody, MAIL_NOTIFICATION_CATEGORY } from "../lib/apns.ts";
import { buildFcmMessage } from "../lib/fcm.ts";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { findEmailIdByIdempotencyKey, insertOrReplay } from "../lib/outbound-idempotency.ts";
import { outboundPayloadKey } from "../lib/outbound-send-queue.ts";
import { QUICK_REPLY_MAX_LENGTH } from "../routes/reply-forward.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	flushWaitUntil,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

// ── Push payload shape ───────────────────────────────────────────
assert.equal(MAIL_NOTIFICATION_CATEGORY, "INBOXIES_MAIL");
const base = { title: "Pat", body: "Lunch?", mailboxId: "ada@inboxies.email", emailId: "e1" };
{
	const legacy = buildAPNsBody(base);
	assert.deepEqual(legacy, {
		aps: { alert: { title: "Pat", body: "Lunch?" }, sound: "default", badge: undefined, "content-available": 1 },
		mailboxId: "ada@inboxies.email",
		emailId: "e1",
		folderId: "inbox",
	}, "without thread/category the payload is unchanged");

	const actionable = buildAPNsBody({
		...base,
		subtitle: "Plans",
		folderId: "inbox",
		threadId: "thread-1@example.com",
		category: MAIL_NOTIFICATION_CATEGORY,
	});
	assert.equal(actionable.aps.category, "INBOXIES_MAIL");
	assert.equal(actionable.aps["thread-id"], "thread-1@example.com");
	assert.equal(actionable.aps.alert.subtitle, "Plans");
	assert.equal(actionable.aps["content-available"], 1);
	assert.equal(actionable.threadId, "thread-1@example.com");
	assert.equal(actionable.emailId, "e1");
	assert.equal(actionable.mailboxId, "ada@inboxies.email");

	const fcmLegacy = buildFcmMessage("tok", base);
	assert.equal("threadId" in fcmLegacy.data, false);
	assert.equal("category" in fcmLegacy.data, false);
	const fcm = buildFcmMessage("tok", { ...base, threadId: "thread-1@example.com", category: MAIL_NOTIFICATION_CATEGORY });
	assert.equal(fcm.data.threadId, "thread-1@example.com");
	assert.equal(fcm.data.category, "INBOXIES_MAIL");
	assert.equal(fcm.data.emailId, "e1");
	assert.equal(fcm.data.mailboxId, "ada@inboxies.email");
	for (const value of Object.values(fcm.data)) assert.equal(typeof value, "string", "FCM data values are strings");
}

// ── HTTP: quick-reply ────────────────────────────────────────────
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
const ALIAS = { id: "al-1", alias_email: "shop.k3x@private.inboxies.email", is_active: 1, expires_at: null };
const db = new DatabaseSync(":memory:");
const sql = sqlStorage(db);
applyMigrations(sql, mailboxMigrations);
const seed = (id, folder, subject, sender, recipient, aliasId = null) =>
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, message_id, thread_id, alias_id)
		 VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00Z', ?, ?, ?)`,
		id, folder, subject, sender, recipient, `${id}@example.com`, `thread-${id}`, aliasId,
	);
seed("plain", "inbox", "Plans", "pat@example.com", MAILBOX);
seed("viaAlias", "inbox", "Order shipped", "store@shop.example", ALIAS.alias_email, ALIAS.id);
seed("mine", "sent", "Re: Plans", MAILBOX, "pat@example.com");

let rateLimited = false;
const created = [];
const stubExtras = {
	getEmail: async (id) => sql.exec(`SELECT * FROM emails WHERE id = ?`, id)[0] ?? null,
	findEmailIdByIdempotencyKey: async (key) => findEmailIdByIdempotencyKey(sql, key),
	checkSendRateLimit: async () => (rateLimited ? "Send rate limit reached" : null),
	releaseSendSlot: async () => {},
	getAlias: async (idOrEmail) => (idOrEmail === ALIAS.id || idOrEmail === ALIAS.alias_email ? ALIAS : null),
	getThreadAliasId: async () => null,
	createEmail: async (folder, email) => {
		const result = insertOrReplay(sql, email.idempotency_key ?? null, email.id, () =>
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id, idempotency_key)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				email.id, folder, email.subject, email.sender, email.recipient, email.date,
				email.thread_id ?? null, email.idempotency_key ?? null,
			),
		);
		if (!result.replayed) created.push({ folder, ...email });
		return result;
	},
};
const outboundSend = { sent: [], send: async (body) => outboundSend.sent.push(body) };
const { env, db: authDb, bucket } = createAuthTestEnv({
	MAILBOX: mockMailboxNamespace(stubExtras),
	OUTBOUND_SEND: outboundSend,
	DOMAINS: "inboxies.email",
});
const ada = await addUser(authDb, { id: "ada", email: MAILBOX });
const eve = await addUser(authDb, { id: "eve", email: "eve@inboxies.email" });
await addMailbox(authDb, bucket, MAILBOX, { owners: ["ada"], settings: { fromName: "Ada Lovelace" } });

async function quickReply(id, body, { key, as = ada } = {}) {
	const res = await request(env, {
		method: "POST",
		path: `/api/v1/mailboxes/${MAILBOX}/emails/${id}/quick-reply`,
		principal: principalFor(as),
		body,
		headers: key ? { "Idempotency-Key": key } : {},
	});
	await flushWaitUntil();
	return res;
}
const queued = async (emailId) => (await bucket.get(outboundPayloadKey(emailId))).json();

// Plain reply: Re: subject, To the sender, From the mailbox with its name, quote appended.
{
	const res = await quickReply("plain", { text: "Thanks! <3" });
	assert.equal(res.status, 202, JSON.stringify(res.payload));
	assert.deepEqual(Object.keys(res.payload).sort(), ["id", "status"]);
	assert.equal(res.payload.status, "sent");
	const row = created.at(-1);
	assert.equal(row.folder, "sent");
	assert.equal(row.subject, "Re: Plans");
	assert.equal(row.recipient, "pat@example.com");
	assert.equal(row.sender, MAILBOX);
	assert.equal(row.thread_id, "thread-plain", "joins the original's thread");
	assert.equal(row.in_reply_to, "plain@example.com");
	const { params } = await queued(res.payload.id);
	assert.equal(params.to, "pat@example.com");
	assert.deepEqual(params.from, { email: MAILBOX, name: "Ada Lovelace" });
	assert.equal(params.subject, "Re: Plans");
	assert.match(params.html, /^<p>Thanks! &lt;3<\/p>/, "text is escaped into HTML");
	assert.match(params.text, /^Thanks! <3/);
	assert.ok(params.html.length > "<p>Thanks! &lt;3</p>".length, "original is quoted");
	assert.equal(params.headers["In-Reply-To"] ?? params.headers["in-reply-to"], "<plain@example.com>");
}

// Mail that arrived on a private email is answered from it, with no real name.
{
	const res = await quickReply("viaAlias", { text: "Got it" });
	assert.equal(res.status, 202, JSON.stringify(res.payload));
	const { params } = await queued(res.payload.id);
	assert.equal(params.from, ALIAS.alias_email);
	assert.equal(params.to, "store@shop.example");
	assert.equal(created.at(-1).alias_id, ALIAS.id);
	// A paused private email refuses, like /reply.
	ALIAS.is_active = 0;
	const paused = await quickReply("viaAlias", { text: "Got it" });
	assert.equal(paused.status, 409);
	assert.equal(paused.payload.code, "alias_inactive");
	ALIAS.is_active = 1;
}

// Replying to your own Sent copy goes to the original recipient.
{
	const res = await quickReply("mine", { text: "Following up" });
	assert.equal(res.status, 202, JSON.stringify(res.payload));
	assert.equal(created.at(-1).recipient, "pat@example.com");
	assert.equal(created.at(-1).subject, "Re: Plans", "no double Re:");
}

// Idempotency-Key: a retried action sends once and returns the original row.
{
	const before = outboundSend.sent.length;
	const first = await quickReply("plain", { text: "Once" }, { key: "watch-reply-1" });
	const replay = await quickReply("plain", { text: "Once" }, { key: "watch-reply-1" });
	assert.equal(first.status, 202);
	assert.equal(replay.status, 202);
	assert.deepEqual(replay.payload, first.payload);
	assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
	assert.equal(outboundSend.sent.length, before + 1, "sent once");
}

// Validation, missing original, rate limit and access: nothing is sent.
{
	const before = outboundSend.sent.length;
	for (const body of [{}, { text: "" }, { text: "   " }, { text: 42 }, { text: "x".repeat(QUICK_REPLY_MAX_LENGTH + 1) }]) {
		const res = await quickReply("plain", body);
		assert.equal(res.status, 400, `rejects ${JSON.stringify(body).slice(0, 40)}`);
	}
	assert.equal((await quickReply("nope", { text: "Hi" })).status, 404);
	rateLimited = true;
	const limited = await quickReply("plain", { text: "Hi" });
	assert.equal(limited.status, 429);
	rateLimited = false;
	const stranger = await quickReply("plain", { text: "Hi" }, { as: eve });
	assert.ok(stranger.status === 403 || stranger.status === 404, `non-member gets ${stranger.status}`);
	assert.equal(outboundSend.sent.length, before);
}

console.log("watch-push-actions: ok");
