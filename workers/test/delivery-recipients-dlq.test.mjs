// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * AVE-41: per-recipient delivery status (`35_delivery_recipients`, filled from
 * Email Sending events) and the `email-sending-events-dlq` dead-letter store
 * with its /ops list / replay / discard routes.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/delivery-recipients-dlq.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	listDeliveryRecipients,
	normalizeRecipientAddress,
	shouldReplaceRecipientStatus,
	upsertDeliveryRecipient,
} from "../lib/delivery-recipients.ts";
import {
	applyEmailSendingEvent,
	mapRecipientDeliveryEvent,
	RECIPIENT_ONLY_EVENT_MAX_ATTEMPTS,
} from "../lib/email-sending-events.ts";
import {
	deadLetterKey,
	discardDeadLetter,
	EMAIL_SENDING_DLQ_PREFIX,
	handleEmailSendingDeadLetterBatch,
	listDeadLetters,
	replayDeadLetters,
	storeDeadLetter,
} from "../lib/email-sending-dlq.ts";
import { authedRequest, createAuthTestEnv, mockBucket } from "./auth-fixtures.mjs";

const MIGRATION = "35_delivery_recipients";

/** `ctx.storage.sql` stand-in: multi-statement scripts via exec, else one prepared statement. */
function sqlStorage(db) {
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			const statement = db.prepare(query);
			return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(query) || /\bRETURNING\b/i.test(query)
				? statement.all(...bindings)
				: (statement.run(...bindings), []);
		},
	};
}

function freshMailbox() {
	const db = new DatabaseSync(":memory:");
	// Durable Object SQLite enforces foreign keys; node:sqlite needs asking.
	db.exec("PRAGMA foreign_keys = ON");
	const sql = sqlStorage(db);
	applyMigrations(sql, mailboxMigrations);
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, provider_message_id, delivery_status)
		 VALUES ('sent-1', 'sent', 's', 'ada@inboxies.email', 'pat@example.com, kim@example.com', '2026-10-01', 'prov-1', 'accepted')`,
	);
	return { db, sql };
}

const rowsFor = (sql, id) => listDeliveryRecipients(sql, [id]).get(id) ?? [];

describe("35_delivery_recipients migration", () => {
	it("adds the table to an existing mailbox without touching mail", () => {
		const db = new DatabaseSync(":memory:");
		const sql = sqlStorage(db);
		applyMigrations(sql, mailboxMigrations.filter((m) => m.name !== MIGRATION));
		sql.exec(`INSERT INTO emails (id, folder_id, subject, date) VALUES ('old', 'sent', 's', '2026-01-01')`);
		applyMigrations(sql, mailboxMigrations);
		assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM emails`)[0].n, 1);
		const columns = sql.exec(`PRAGMA table_info(delivery_recipients)`).map((c) => c.name);
		assert.deepEqual(columns, ["email_id", "address", "status", "error", "updated_at"]);
		assert.equal(
			sql.exec(`SELECT COUNT(*) AS n FROM d1_migrations WHERE name = ?`, MIGRATION)[0].n,
			1,
		);
		// Re-running is a no-op.
		applyMigrations(sql, mailboxMigrations);
	});

	it("drops recipient rows with their email", () => {
		const { sql } = freshMailbox();
		upsertDeliveryRecipient(sql, "sent-1", { address: "pat@example.com", status: "delivered" });
		sql.exec(`DELETE FROM emails WHERE id = 'sent-1'`);
		assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM delivery_recipients`)[0].n, 0);
	});
});

describe("per-recipient status", () => {
	it("normalizes addresses", () => {
		assert.equal(normalizeRecipientAddress("  Pat@Example.COM "), "pat@example.com");
		assert.equal(normalizeRecipientAddress(""), null);
		assert.equal(normalizeRecipientAddress("not-an-address"), null);
		assert.equal(normalizeRecipientAddress(undefined), null);
	});

	it("only lets an equal or later status replace the stored one", () => {
		assert.equal(shouldReplaceRecipientStatus(undefined, "deferred"), true);
		assert.equal(shouldReplaceRecipientStatus("deferred", "delivered"), true);
		assert.equal(shouldReplaceRecipientStatus("delivered", "deferred"), false);
		assert.equal(shouldReplaceRecipientStatus("bounced", "delivered"), false);
		assert.equal(shouldReplaceRecipientStatus("delivered", "bounced"), true);
		assert.equal(shouldReplaceRecipientStatus("delivered", "complained"), true);
		assert.equal(shouldReplaceRecipientStatus("complained", "bounced"), false);
		assert.equal(shouldReplaceRecipientStatus("failed", "bounced"), true);
	});

	it("keeps one row per recipient and says which one bounced", () => {
		const { sql } = freshMailbox();
		const at = new Date("2026-10-02T00:00:00Z");
		assert.equal(
			upsertDeliveryRecipient(sql, "sent-1", { address: "Pat@example.com", status: "deferred", error: "421 try later" }, at),
			true,
		);
		assert.equal(upsertDeliveryRecipient(sql, "sent-1", { address: "pat@example.com", status: "delivered" }, at), true);
		assert.equal(
			upsertDeliveryRecipient(sql, "sent-1", { address: "kim@example.com", status: "bounced", error: "550 no such user" }, at),
			true,
		);
		// Late / duplicate events change nothing.
		assert.equal(upsertDeliveryRecipient(sql, "sent-1", { address: "pat@example.com", status: "deferred" }, at), false);
		assert.equal(
			upsertDeliveryRecipient(sql, "sent-1", { address: "kim@example.com", status: "bounced", error: "550 no such user" }, at),
			false,
		);
		assert.equal(upsertDeliveryRecipient(sql, "sent-1", { address: "nope", status: "bounced" }, at), false);

		assert.deepEqual(rowsFor(sql, "sent-1"), [
			{ address: "kim@example.com", status: "bounced", error: "550 no such user", updated_at: at.toISOString() },
			{ address: "pat@example.com", status: "delivered", error: null, updated_at: at.toISOString() },
		]);
		assert.equal(listDeliveryRecipients(sql, []).size, 0);
		assert.equal(listDeliveryRecipients(sql, ["other"]).has("other"), false);
	});
});

describe("mapping Email Sending events per recipient", () => {
	const base = { messageId: "prov-1", sender: "Ada@inboxies.email", recipient: "Kim@Example.com" };

	it("maps every lifecycle event that names a recipient", () => {
		assert.deepEqual(
			mapRecipientDeliveryEvent({ type: "cf.email.sending.message.delivered", payload: base }),
			{ address: "kim@example.com", status: "delivered", error: null, providerMessageId: "prov-1", sender: "ada@inboxies.email" },
		);
		const deferred = mapRecipientDeliveryEvent({
			type: "cf.email.sending.message.deferred",
			payload: { ...base, delivery: { smtpResponse: "421 mailbox busy" } },
		});
		assert.equal(deferred.status, "deferred");
		assert.equal(deferred.error, "421 mailbox busy");
		const bounced = mapRecipientDeliveryEvent({
			type: "cf.email.sending.message.bounced",
			payload: { ...base, bounce: { reason: "550 no such user" } },
		});
		assert.equal(bounced.status, "bounced");
		assert.equal(bounced.error, "550 no such user");
		assert.equal(
			mapRecipientDeliveryEvent({ type: "cf.email.sending.message.complained", payload: base }).status,
			"complained",
		);
		assert.equal(
			mapRecipientDeliveryEvent({ type: "cf.email.sending.message.rejected", payload: base }).status,
			"failed",
		);
	});

	it("ignores events without a recipient, message id or known type", () => {
		const { recipient, ...noRecipient } = base;
		assert.equal(mapRecipientDeliveryEvent({ type: "cf.email.sending.message.delivered", payload: noRecipient }), null);
		assert.equal(
			mapRecipientDeliveryEvent({ type: "cf.email.sending.message.delivered", payload: { ...base, messageId: " " } }),
			null,
		);
		assert.equal(mapRecipientDeliveryEvent({ type: "cf.email.sending.message.opened", payload: base }), null);
	});
});

describe("applyEmailSendingEvent with recipients", () => {
	function stub({ found = true } = {}) {
		const calls = [];
		return {
			calls,
			resolve: () => ({
				findEmailByProviderMessageId: async (id) => (found ? { id: "sent-1", provider: id } : null),
				setDeliveryState: async (id, state) => calls.push(["setDeliveryState", id, state]),
				recordRecipientDelivery: async (id, update) => calls.push(["recordRecipientDelivery", id, update]),
			}),
		};
	}
	const payload = { messageId: "prov-1", sender: "ada@inboxies.email", recipient: "kim@example.com" };

	it("records a delivered recipient without touching the message status", async () => {
		const s = stub();
		assert.equal(await applyEmailSendingEvent({ type: "cf.email.sending.message.delivered", payload }, s.resolve), true);
		assert.deepEqual(s.calls, [
			["recordRecipientDelivery", "sent-1", { address: "kim@example.com", status: "delivered", error: null }],
		]);
	});

	it("records a bounce on the message and on the recipient", async () => {
		const s = stub();
		const ok = await applyEmailSendingEvent(
			{ type: "cf.email.sending.message.bounced", payload: { ...payload, bounce: { reason: "550 no such user" } } },
			s.resolve,
		);
		assert.equal(ok, true);
		assert.deepEqual(
			s.calls.map(([method]) => method),
			["setDeliveryState", "recordRecipientDelivery"],
		);
		assert.equal(s.calls[0][2].status, "bounced");
		assert.deepEqual(s.calls[1][2], { address: "kim@example.com", status: "bounced", error: "550 no such user" });
	});

	it("gives delivered events a few tries when the Sent row is missing, then drops them", async () => {
		const s = stub({ found: false });
		const event = { type: "cf.email.sending.message.delivered", payload };
		assert.equal(await applyEmailSendingEvent(event, s.resolve, 1), false);
		assert.equal(await applyEmailSendingEvent(event, s.resolve, RECIPIENT_ONLY_EVENT_MAX_ATTEMPTS), true);
		assert.equal(s.calls.length, 0);
	});

	it("keeps retrying failure events when the Sent row is missing (they dead-letter)", async () => {
		const s = stub({ found: false });
		const event = { type: "cf.email.sending.message.bounced", payload };
		assert.equal(await applyEmailSendingEvent(event, s.resolve, 99), false);
	});

	it("retries when recording the recipient fails", async () => {
		const ok = await applyEmailSendingEvent({ type: "cf.email.sending.message.delivered", payload }, () => ({
			findEmailByProviderMessageId: async () => ({ id: "sent-1" }),
			setDeliveryState: async () => {},
			recordRecipientDelivery: async () => {
				throw new Error("storage");
			},
		}));
		assert.equal(ok, false);
	});
});

describe("email-sending-events dead letters", () => {
	const event = {
		type: "cf.email.sending.message.bounced",
		payload: { messageId: "prov-9", sender: "ada@inboxies.email", recipient: "kim@example.com" },
	};

	it("stores, lists, replays and discards", async () => {
		const bucket = mockBucket();
		const now = new Date("2026-10-03T00:00:00Z");
		await storeDeadLetter(bucket, { id: "msg-1", body: event, timestamp: new Date("2026-10-02T00:00:00Z") }, now);
		await storeDeadLetter(bucket, { id: "msg-2", body: JSON.stringify(event) }, now);
		assert.ok(bucket.store.has(deadLetterKey("msg-1")));

		const listed = await listDeadLetters(bucket);
		assert.equal(listed.cursor, null);
		assert.deepEqual(listed.deadLetters.find((d) => d.id === "msg-1"), {
			id: "msg-1",
			type: "cf.email.sending.message.bounced",
			providerMessageId: "prov-9",
			sender: "ada@inboxies.email",
			recipient: "kim@example.com",
			enqueuedAt: "2026-10-02T00:00:00.000Z",
			deadLetteredAt: now.toISOString(),
			replayAttempts: 0,
		});
		assert.equal(listed.deadLetters.find((d) => d.id === "msg-2").providerMessageId, "prov-9");

		const seen = [];
		const results = await replayDeadLetters(bucket, ["msg-1", "msg-2", "missing", "../escape"], async (body) => {
			seen.push(body);
			return seen.length === 1; // first handled, second still failing
		});
		assert.deepEqual(results, [
			{ id: "msg-1", outcome: "applied" },
			{ id: "msg-2", outcome: "still_failing" },
			{ id: "missing", outcome: "not_found" },
			{ id: "../escape", outcome: "not_found" },
		]);
		assert.deepEqual(seen[0], event, "replays the original body");
		assert.equal(bucket.store.has(deadLetterKey("msg-1")), false);
		assert.equal(JSON.parse(bucket.store.get(deadLetterKey("msg-2"))).replayAttempts, 1);

		const thrown = await replayDeadLetters(bucket, ["msg-2"], async () => {
			throw new Error("boom");
		});
		assert.deepEqual(thrown, [{ id: "msg-2", outcome: "still_failing", error: "boom" }]);

		assert.equal(await discardDeadLetter(bucket, "msg-2"), true);
		assert.equal(await discardDeadLetter(bucket, "msg-2"), false);
		assert.equal(await discardDeadLetter(bucket, "../x"), false);
		assert.equal([...bucket.store.keys()].filter((k) => k.startsWith(EMAIL_SENDING_DLQ_PREFIX)).length, 0);
	});

	it("DLQ consumer acks once stored and retries when R2 fails", async () => {
		const message = (id) => {
			const m = { id, body: event, timestamp: new Date(), attempts: 1, acked: false, retried: null };
			m.ack = () => (m.acked = true);
			m.retry = (opts) => (m.retried = opts ?? {});
			return m;
		};
		const ok = message("ok-1");
		const bucket = mockBucket();
		await handleEmailSendingDeadLetterBatch({ messages: [ok] }, { BUCKET: bucket });
		assert.equal(ok.acked, true);
		assert.ok(bucket.store.has(deadLetterKey("ok-1")));

		const failing = message("fail-1");
		const broken = {
			...mockBucket(),
			put: async () => {
				throw new Error("R2 down");
			},
		};
		await handleEmailSendingDeadLetterBatch({ messages: [failing] }, { BUCKET: broken });
		assert.equal(failing.acked, false);
		assert.ok(failing.retried);
	});

	it("routes are behind Cloudflare Access like the rest of /ops", async () => {
		const { env } = createAuthTestEnv();
		for (const [method, path] of [
			["GET", "/ops/dead-letters/email-sending-events"],
			["POST", "/ops/dead-letters/email-sending-events/replay"],
			["DELETE", "/ops/dead-letters/email-sending-events/msg-1"],
		]) {
			const res = await authedRequest(env, { method, path, body: method === "POST" ? { ids: ["msg-1"] } : undefined });
			assert.equal(res.status, 403, `${method} ${path} needs Access`);
		}
	});

	it("wrangler.jsonc dead-letters the events queue and consumes the DLQ", () => {
		const config = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
		const block = config.match(/"queue":\s*"email-sending-events",\s*"max_batch_size"[\s\S]*?\}/)?.[0] ?? "";
		assert.match(block, /"dead_letter_queue":\s*"email-sending-events-dlq"/);
		assert.match(config, /"queue":\s*"email-sending-events-dlq",\s*"max_batch_size"/);
		const ensure = readFileSync(new URL("../../scripts/ensure-queues.mjs", import.meta.url), "utf8");
		assert.match(ensure, /"email-sending-events-dlq"/);
	});
});
