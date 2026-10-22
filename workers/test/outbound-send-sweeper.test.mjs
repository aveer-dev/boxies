// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Stuck-send sweeper (AVE-66): the `34_outbound_send_sweeper` migration, the
 * per-row decision, and full sweeps over real MailboxDO tables on node:sqlite
 * (re-enqueue after 10 minutes, failed after 3 re-enqueues, rows mid-delivery
 * left alone, and no double send when a re-enqueued message meets the
 * consumer).
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/outbound-send-sweeper.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { decideOutboundSendClaim } from "../lib/outbound-send-claim.ts";
import {
	enqueueOutboundSend,
	OUTBOUND_SEND_CLAIM_LEASE_MS,
	OUTBOUND_SEND_FAILED_ERROR,
	outboundPayloadKey,
	processOutboundSend,
} from "../lib/outbound-send-queue.ts";
import {
	countQueuedSends,
	decideStuckSend,
	listQueuedSends,
	markOutboundSendQueued,
	STUCK_SEND_MAX_REENQUEUES,
	STUCK_SEND_THRESHOLD_MS,
	stuckSendAlarmDelayMs,
	sweepStuckSends,
} from "../lib/outbound-send-sweeper.ts";

const MIGRATION = "34_outbound_send_sweeper";
const MAILBOX = "ada@inboxies.email";
const MIN = 60 * 1000;
const PARAMS = { to: "pat@example.com", from: MAILBOX, subject: "Hi", text: "Hi Pat" };

/** `ctx.storage.sql` stand-in: multi-statement scripts via exec, else one prepared statement. */
function sqlStorage(db) {
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			const stmt = db.prepare(query);
			return /^\s*(SELECT|WITH)/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
		},
	};
}

function insertSent(sql, id, status = "queued") {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, delivery_status)
		 VALUES (?, 'sent', 's', ?, 'pat@example.com', ?, ?)`,
		id,
		MAILBOX,
		new Date().toISOString(),
		status,
	);
}

const statusOf = (sql, id) => ({ ...sql.exec(`SELECT delivery_status, delivery_error FROM emails WHERE id = ?`, id)[0] });

/**
 * A mailbox DO in miniature: real migrated tables, the DO's claim logic,
 * setDeliveryState, an R2 bucket and a queue, all sharing one clock.
 */
function harness() {
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, mailboxMigrations);
	const clock = { now: 1_000_000 };
	const claims = new Map();
	const objects = new Map();
	const queued = [];
	const sends = [];
	let queueDown = false;
	const states = [];

	const stub = {
		async claimOutboundSend(id, leaseMs) {
			const row = sql.exec(`SELECT delivery_status FROM emails WHERE id = ?`, id)[0];
			const claim = decideOutboundSendClaim(row ? row.delivery_status : undefined, claims.get(id), clock.now);
			if (claim === "claimed") claims.set(id, clock.now + leaseMs);
			else if (claim !== "in_flight") claims.delete(id);
			return claim;
		},
		async releaseOutboundSendClaim(id) {
			claims.delete(id);
		},
		async setDeliveryState(id, state) {
			states.push({ id, ...state });
			sql.exec(
				`UPDATE emails SET delivery_status = ?, delivery_error = ? WHERE id = ?`,
				state.status,
				state.error ?? null,
				id,
			);
			if (state.status !== "queued") claims.delete(id);
		},
		async noteOutboundSendQueued(id) {
			markOutboundSendQueued(sql, id, clock.now);
		},
	};
	const bucket = {
		async get(key) {
			return objects.has(key) ? { text: async () => objects.get(key) } : null;
		},
		async put(key, value) {
			objects.set(key, value);
		},
		async delete(key) {
			objects.delete(key);
		},
	};
	const queue = {
		async send(body) {
			if (queueDown) throw new Error("queue down");
			queued.push(body);
		},
	};
	const email = {
		async send(message) {
			sends.push(message);
			return { messageId: `prov-${sends.length}` };
		},
	};

	return {
		sql,
		clock,
		claims,
		objects,
		queued,
		sends,
		states,
		stub,
		bucket,
		queue,
		setQueueDown(v) {
			queueDown = v;
		},
		sweep({ mailboxId = MAILBOX } = {}) {
			return sweepStuckSends({
				sql,
				now: () => clock.now,
				mailboxId,
				getClaimExpiry: async (id) => claims.get(id),
				claim: (id, ms) => stub.claimOutboundSend(id, ms),
				releaseClaim: (id) => stub.releaseOutboundSendClaim(id),
				setDeliveryState: (id, s) => stub.setDeliveryState(id, s),
				bucket,
				queue,
			});
		},
		/** Producer path: row written queued, payload staged, message sent. */
		async enqueue(id) {
			insertSent(sql, id);
			await enqueueOutboundSend({ bucket, queue, stub }, MAILBOX, id, PARAMS);
		},
		consume(body, attempts = 1) {
			return processOutboundSend({ bucket, email, stubFor: () => stub }, body, attempts);
		},
	};
}

describe("34_outbound_send_sweeper migration", () => {
	it("adds the columns to an existing mailbox without touching its rows", () => {
		const db = new DatabaseSync(":memory:");
		const sql = sqlStorage(db);
		applyMigrations(sql, mailboxMigrations.filter((m) => m.name !== MIGRATION));
		insertSent(sql, "old");
		applyMigrations(sql, mailboxMigrations);
		assert.deepEqual(listQueuedSends(sql), [{ id: "old", sendAttempts: 0, sendQueuedAt: null }]);
		const indexes = sql.exec(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'emails'`);
		assert.ok(indexes.some((r) => r.name === "idx_emails_queued_sends"));
		// Re-running is a no-op.
		applyMigrations(sql, mailboxMigrations);
		assert.equal(countQueuedSends(sql), 1);
	});
});

describe("decideStuckSend", () => {
	const now = 10 * MIN;
	it("stamps rows it has not seen yet", () => {
		assert.deepEqual(decideStuckSend({ id: "a", sendAttempts: 0, sendQueuedAt: null }, undefined, now), {
			kind: "stamp",
		});
	});
	it("waits until the row has been queued for the threshold", () => {
		const row = { id: "a", sendAttempts: 0, sendQueuedAt: now - STUCK_SEND_THRESHOLD_MS + 1 };
		assert.deepEqual(decideStuckSend(row, undefined, now), { kind: "wait", dueAt: now + 1 });
		assert.deepEqual(decideStuckSend({ ...row, sendQueuedAt: now - STUCK_SEND_THRESHOLD_MS }, undefined, now), {
			kind: "reenqueue",
		});
	});
	it("leaves rows a consumer is delivering", () => {
		const row = { id: "a", sendAttempts: 0, sendQueuedAt: 0 };
		assert.deepEqual(decideStuckSend(row, now + 5, now), { kind: "in_flight", dueAt: now + 5 });
		// An expired claim (crashed consumer) does not block.
		assert.deepEqual(decideStuckSend(row, now - 1, now), { kind: "reenqueue" });
	});
	it("fails after the last re-enqueue", () => {
		const row = { id: "a", sendAttempts: STUCK_SEND_MAX_REENQUEUES - 1, sendQueuedAt: 0 };
		assert.equal(decideStuckSend(row, undefined, now).kind, "reenqueue");
		assert.equal(decideStuckSend({ ...row, sendAttempts: STUCK_SEND_MAX_REENQUEUES }, undefined, now).kind, "fail");
	});
	it("uses the approved defaults", () => {
		assert.equal(STUCK_SEND_THRESHOLD_MS, 10 * MIN);
		assert.equal(STUCK_SEND_MAX_REENQUEUES, 3);
	});
});

describe("sweepStuckSends", () => {
	it("does nothing (and asks for no alarm) when nothing is queued", async () => {
		const h = harness();
		insertSent(h.sql, "done", "accepted");
		const result = await h.sweep();
		assert.deepEqual(result, { stamped: [], reenqueued: [], failed: [], nextDueAt: null });
	});

	it("leaves a fresh send alone and schedules the check for when it is due", async () => {
		const h = harness();
		await h.enqueue("e1");
		assert.equal(h.queued.length, 1, "producer enqueued once");
		h.clock.now += 9 * MIN;
		const result = await h.sweep();
		assert.deepEqual(result.reenqueued, []);
		assert.equal(result.nextDueAt, 1_000_000 + STUCK_SEND_THRESHOLD_MS);
		assert.equal(stuckSendAlarmDelayMs(result.nextDueAt, h.clock.now) > MIN, true);
		assert.equal(h.queued.length, 1);
	});

	it("re-enqueues a send stuck for 10 minutes with the producer's message shape", async () => {
		const h = harness();
		await h.enqueue("e1");
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		const result = await h.sweep();
		assert.deepEqual(result.reenqueued, ["e1"]);
		assert.deepEqual(h.queued, [
			{ v: 1, mailboxId: MAILBOX, emailId: "e1" },
			{ v: 1, mailboxId: MAILBOX, emailId: "e1" },
		]);
		assert.deepEqual(listQueuedSends(h.sql), [{ id: "e1", sendAttempts: 1, sendQueuedAt: h.clock.now }]);
		assert.equal(result.nextDueAt, h.clock.now + STUCK_SEND_THRESHOLD_MS);
		assert.ok(h.objects.has(outboundPayloadKey("e1")), "payload kept for the consumer");
	});

	it("marks the row failed after 3 re-enqueues and cleans up the payload", async () => {
		const h = harness();
		await h.enqueue("e1");
		for (let i = 1; i <= STUCK_SEND_MAX_REENQUEUES; i++) {
			h.clock.now += STUCK_SEND_THRESHOLD_MS;
			assert.deepEqual((await h.sweep()).reenqueued, ["e1"], `re-enqueue ${i}`);
		}
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		const result = await h.sweep();
		assert.deepEqual(result.failed, ["e1"]);
		assert.equal(result.nextDueAt, null);
		assert.deepEqual(statusOf(h.sql, "e1"), {
			delivery_status: "failed",
			delivery_error: OUTBOUND_SEND_FAILED_ERROR,
		});
		assert.equal(h.objects.has(outboundPayloadKey("e1")), false);
		assert.equal(h.queued.length, 1 + STUCK_SEND_MAX_REENQUEUES);
		// The lost messages show up late: nothing is sent for a failed row.
		for (const body of h.queued) assert.deepEqual(await h.consume(body), { action: "ack" });
		assert.equal(h.sends.length, 0);
	});

	it("records accepted instead of failed when the binding took it but recording did not", async () => {
		const h = harness();
		await h.enqueue("e1");
		h.sql.exec(`UPDATE emails SET send_attempts = ? WHERE id = 'e1'`, STUCK_SEND_MAX_REENQUEUES);
		h.objects.set(
			outboundPayloadKey("e1"),
			JSON.stringify({ v: 1, params: PARAMS, acceptedProviderMessageId: "prov-9" }),
		);
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		await h.sweep();
		assert.equal(statusOf(h.sql, "e1").delivery_status, "accepted");
		assert.deepEqual(h.states.at(-1), { id: "e1", status: "accepted", providerMessageId: "prov-9", error: null });
	});

	it("skips rows a consumer is mid-delivering, then handles them once the claim is gone", async () => {
		const h = harness();
		await h.enqueue("e1");
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		h.claims.set("e1", h.clock.now + 30_000);
		let result = await h.sweep();
		assert.deepEqual(result.reenqueued, []);
		assert.equal(result.nextDueAt, h.clock.now + 30_000);
		h.clock.now += 30_000;
		result = await h.sweep();
		assert.deepEqual(result.reenqueued, ["e1"], "expired claim no longer blocks");
	});

	it("never fails a row a consumer claimed between the scan and the settle", async () => {
		const h = harness();
		await h.enqueue("e1");
		h.sql.exec(`UPDATE emails SET send_attempts = ? WHERE id = 'e1'`, STUCK_SEND_MAX_REENQUEUES);
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		// The peek sees no claim; a consumer grabs it before the sweeper's claim.
		const origClaim = h.stub.claimOutboundSend;
		const result = await sweepStuckSends({
			sql: h.sql,
			now: () => h.clock.now,
			mailboxId: MAILBOX,
			getClaimExpiry: async () => undefined,
			claim: async (id, ms) => {
				await origClaim(id, ms); // consumer
				return origClaim(id, ms); // sweeper: in_flight
			},
			releaseClaim: async () => {},
			setDeliveryState: (id, s) => h.stub.setDeliveryState(id, s),
			bucket: h.bucket,
			queue: h.queue,
		});
		assert.deepEqual(result.failed, []);
		assert.equal(statusOf(h.sql, "e1").delivery_status, "queued");
		assert.equal(result.nextDueAt, h.clock.now + OUTBOUND_SEND_CLAIM_LEASE_MS);
	});

	it("does not double send when the original and the re-enqueued message both arrive", async () => {
		const h = harness();
		await h.enqueue("e1");
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		await h.sweep();
		assert.equal(h.queued.length, 2);
		for (const body of h.queued) assert.deepEqual(await h.consume(body), { action: "ack" });
		assert.equal(h.sends.length, 1, "Email binding called once");
		assert.equal(statusOf(h.sql, "e1").delivery_status, "accepted");
		// Settled rows drop out of later sweeps.
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		assert.deepEqual(await h.sweep(), { stamped: [], reenqueued: [], failed: [], nextDueAt: null });
	});

	it("stamps rows it has never seen (lost producer note, pre-queue rows) before counting", async () => {
		const h = harness();
		insertSent(h.sql, "legacy");
		const result = await h.sweep();
		assert.deepEqual(result.stamped, ["legacy"]);
		assert.equal(result.nextDueAt, h.clock.now + STUCK_SEND_THRESHOLD_MS);
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		assert.deepEqual((await h.sweep()).reenqueued, ["legacy"]);
		// No staged payload: the consumer fails the row instead of sending.
		assert.deepEqual(await h.consume(h.queued[0]), { action: "ack" });
		assert.equal(statusOf(h.sql, "legacy").delivery_status, "failed");
		assert.equal(h.sends.length, 0);
	});

	it("still counts attempts when the queue rejects, so the row ends failed", async () => {
		const h = harness();
		await h.enqueue("e1");
		h.setQueueDown(true);
		for (let i = 0; i < STUCK_SEND_MAX_REENQUEUES; i++) {
			h.clock.now += STUCK_SEND_THRESHOLD_MS;
			const result = await h.sweep();
			assert.deepEqual(result.reenqueued, []);
			assert.ok(result.nextDueAt != null);
		}
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		assert.deepEqual((await h.sweep()).failed, ["e1"]);
	});

	it("counts attempts without a mailbox id and fails the row in the end", async () => {
		const h = harness();
		insertSent(h.sql, "e1");
		markOutboundSendQueued(h.sql, "e1", h.clock.now);
		for (let i = 0; i < STUCK_SEND_MAX_REENQUEUES; i++) {
			h.clock.now += STUCK_SEND_THRESHOLD_MS;
			assert.deepEqual((await h.sweep({ mailboxId: null })).reenqueued, []);
		}
		assert.equal(h.queued.length, 0);
		h.clock.now += STUCK_SEND_THRESHOLD_MS;
		assert.deepEqual((await h.sweep({ mailboxId: null })).failed, ["e1"]);
	});
});

describe("producer note", () => {
	it("starts the clock only for rows still queued", async () => {
		const h = harness();
		insertSent(h.sql, "a");
		insertSent(h.sql, "b", "accepted");
		markOutboundSendQueued(h.sql, "a", 42);
		markOutboundSendQueued(h.sql, "b", 42);
		const rows = h.sql.exec(`SELECT id, send_queued_at FROM emails ORDER BY id`);
		assert.deepEqual(rows.map((r) => ({ ...r })), [
			{ id: "a", send_queued_at: 42 },
			{ id: "b", send_queued_at: null },
		]);
	});

	it("enqueue still succeeds when the note fails", async () => {
		const h = harness();
		insertSent(h.sql, "e1");
		await enqueueOutboundSend(
			{
				bucket: h.bucket,
				queue: h.queue,
				stub: { ...h.stub, noteOutboundSendQueued: async () => { throw new Error("DO busy"); } },
			},
			MAILBOX,
			"e1",
			PARAMS,
		);
		assert.equal(h.queued.length, 1);
		assert.equal(statusOf(h.sql, "e1").delivery_status, "queued");
	});
});
