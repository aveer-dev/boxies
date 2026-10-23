/**
 * Mailbox purge / email delete ordering: tombstone first, then rows (queueing
 * their blobs), then blobs, swept until R2 confirms. Runs the real MailboxDO
 * migrations and purge steps on node:sqlite against a fake R2 bucket, and
 * drives `receiveEmail` into a mailbox mid-purge.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mailbox-purge-ordering.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { attachmentKey } from "../lib/attachments.ts";
import { emailBodyKey, emailContentKeys, emailRawKey } from "../lib/email-content.ts";
import { aliasMetadataKey, mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { runMailboxPurge } from "../lib/mailbox-purge.ts";
import {
	BLOB_DELETE_RETRY_BASE_MS,
	BLOB_DELETE_RETRY_MAX_MS,
	blobDeleteRetryDelayMs,
	countPendingBlobDeletes,
	drainPendingBlobDeletes,
	enqueueBlobDeletes,
	forgetPendingBlobDeletes,
} from "../lib/pending-blob-deletes.ts";
import {
	abandonInboundDelivery,
	claimInboundMessage,
	completeInboundMessageClaim,
} from "../lib/inbound-claims.ts";
import { receiveEmail } from "../index.ts";

const MAILBOX = "ada@example.com";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

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

function mailboxDb() {
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, mailboxMigrations);
	const transactionSync = (fn) => {
		db.exec("BEGIN");
		try {
			const result = fn();
			db.exec("COMMIT");
			return result;
		} catch (e) {
			db.exec("ROLLBACK");
			throw e;
		}
	};
	return { db, sql, transactionSync };
}

const count = (sql, query, ...b) => Number(Object.values(sql.exec(query, ...b)[0])[0]);

/** R2 stand-in. `failDeletes(n)` fails the next n delete calls; `holdDeletes()` parks them. */
function createBucket() {
	const store = new Map();
	let failures = 0;
	let gate = null;
	return {
		store,
		failDeletes(n) {
			failures = n;
		},
		holdDeletes() {
			let release;
			const held = new Promise((resolve) => (release = resolve));
			gate = held;
			return () => {
				gate = null;
				release();
			};
		},
		async get(key) {
			await tick();
			if (!store.has(key)) return null;
			const value = store.get(key);
			return { json: async () => JSON.parse(value), text: async () => value };
		},
		async put(key, value) {
			await tick();
			store.set(key, typeof value === "string" ? value : String(value?.byteLength ?? value));
		},
		async head(key) {
			await tick();
			return store.has(key) ? { key } : null;
		},
		async delete(keys) {
			await tick();
			if (gate) await gate;
			if (failures > 0) {
				failures -= 1;
				throw new Error("R2 unavailable");
			}
			for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
		},
	};
}

const SYSTEM_FOLDERS = [
	{ id: "inbox", name: "Inbox" },
	{ id: "sent", name: "Sent" },
	{ id: "draft", name: "Drafts" },
	{ id: "trash", name: "Trash" },
];

/** A mailbox with two emails, one attachment, a private email and an agent conversation. */
async function seedMailbox() {
	const { sql, transactionSync } = mailboxDb();
	const bucket = createBucket();
	for (const f of SYSTEM_FOLDERS) {
		sql.exec(`INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES (?, ?, 0)`, f.id, f.name);
	}
	for (const id of ["mail-a", "mail-b"]) {
		sql.exec(
			`INSERT INTO emails (id, folder_id, subject, sender, recipient, date) VALUES (?, 'inbox', 's', 'x@example.com', ?, ?)`,
			id,
			MAILBOX,
			new Date().toISOString(),
		);
		await bucket.put(emailBodyKey(id), "<p>hi</p>");
		await bucket.put(emailRawKey(id), "raw");
	}
	sql.exec(
		`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES ('att-1', 'mail-a', 'q3.csv', 'text/csv', 3)`,
	);
	await bucket.put(attachmentKey("mail-a", "att-1", "q3.csv"), "csv");
	const alias = "k8m2p9v4@private.example.com";
	sql.exec(
		`INSERT INTO aliases (id, alias_email, domain, base_domain, created_at) VALUES ('al-1', ?, 'private.example.com', 'example.com', ?)`,
		alias,
		new Date().toISOString(),
	);
	await bucket.put(aliasMetadataKey(alias), "{}");
	sql.exec(
		`INSERT INTO agent_conversations (id, title, created_at, updated_at) VALUES ('conv-1', 't', ?, ?)`,
		new Date().toISOString(),
		new Date().toISOString(),
	);
	await bucket.put(mailboxMetadataKey(MAILBOX), JSON.stringify({ screenerEnabled: false }));
	const blobKeys = () => [...bucket.store.keys()].filter((k) => k !== mailboxMetadataKey(MAILBOX));
	return { sql, transactionSync, bucket, blobKeys, alias };
}

/** MailboxDO purge wiring with an observable deleted flag and alarm. */
function purgeHarness({ sql, transactionSync, bucket }, overrides = {}) {
	const state = { deleted: false, alarmDelays: [] };
	const purge = () =>
		runMailboxPurge({
			sql,
			transactionSync,
			bucket,
			systemFolders: SYSTEM_FOLDERS,
			metadataKey: mailboxMetadataKey(MAILBOX),
			markDeleted: async () => {
				await tick();
				state.deleted = true;
			},
			afterWipe: async () => {},
			scheduleBlobSweep: async (delayMs) => {
				state.alarmDelays.push(delayMs);
			},
			...overrides,
		});
	return { state, purge };
}

const quiet = async (fn) => {
	const { log, error } = console;
	console.log = () => {};
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.log = log;
		console.error = error;
	}
};

// ── Pending blob delete queue ───────────────────────────────────
{
	const { sql } = mailboxDb();
	const bucket = createBucket();
	await bucket.put("k1", "1");
	await bucket.put("k2", "2");
	await bucket.put("k3", "3");
	enqueueBlobDeletes(sql, ["k1", "k2", "k2"]);
	assert.equal(countPendingBlobDeletes(sql), 2, "duplicate keys queue once");

	// A failed R2 delete keeps the keys queued and backs off.
	bucket.failDeletes(1);
	let result = await drainPendingBlobDeletes(sql, bucket, { keys: ["k1", "k2"] });
	assert.match(result.error?.message ?? "", /R2 unavailable/);
	assert.equal(result.remaining, 2);
	assert.ok(bucket.store.has("k1") && bucket.store.has("k2"));
	assert.equal(blobDeleteRetryDelayMs(sql), BLOB_DELETE_RETRY_BASE_MS * 2);

	// A scoped drain only touches queued keys it was given.
	enqueueBlobDeletes(sql, ["k3"]);
	result = await drainPendingBlobDeletes(sql, bucket, { keys: ["k1", "not-queued"] });
	assert.equal(result.error, null);
	assert.equal(result.deleted, 1);
	assert.equal(bucket.store.has("k1"), false);
	assert.ok(bucket.store.has("k2") && bucket.store.has("k3"));

	// The sweep (alarm) drains the rest, in batches; repeating it is a no-op.
	result = await drainPendingBlobDeletes(sql, bucket, { batchSize: 1 });
	assert.deepEqual([result.deleted, result.remaining, result.error], [2, 0, null]);
	assert.equal(bucket.store.size, 0);
	result = await drainPendingBlobDeletes(sql, bucket);
	assert.deepEqual([result.deleted, result.remaining], [0, 0]);

	// A recreated owner of a key takes it off the queue.
	enqueueBlobDeletes(sql, ["platform/aliases/a@example.com.json"]);
	forgetPendingBlobDeletes(sql, ["platform/aliases/a@example.com.json"]);
	assert.equal(countPendingBlobDeletes(sql), 0);

	// Backoff is capped; the sweep never gives up.
	enqueueBlobDeletes(sql, ["k9"]);
	sql.exec(`UPDATE pending_blob_deletes SET attempts = 50`);
	assert.equal(blobDeleteRetryDelayMs(sql), BLOB_DELETE_RETRY_MAX_MS);
}

// ── Purge: happy path ───────────────────────────────────────────
{
	const seeded = await seedMailbox();
	const { sql, bucket, blobKeys } = seeded;
	const { state, purge } = purgeHarness(seeded);
	const { conversationIds, pendingBlobDeletes } = await purge();
	assert.equal(state.deleted, true);
	assert.deepEqual(conversationIds, ["conv-1"]);
	assert.equal(pendingBlobDeletes, 0);
	assert.deepEqual(blobKeys(), [], "every blob deleted");
	assert.equal(bucket.store.has(mailboxMetadataKey(MAILBOX)), false, "metadata deleted");
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0);
	assert.equal(count(sql, `SELECT COUNT(*) FROM attachments`), 0);
	assert.equal(count(sql, `SELECT COUNT(*) FROM aliases`), 0);
	assert.equal(count(sql, `SELECT COUNT(*) FROM agent_conversations`), 0);
	assert.equal(count(sql, `SELECT COUNT(*) FROM folders`), SYSTEM_FOLDERS.length, "system folders reseeded");
	assert.equal(countPendingBlobDeletes(sql), 0);
	assert.deepEqual(state.alarmDelays, [], "no sweep needed");
}

// ── Purge: tombstone is set before any row or blob is touched ───
{
	const seeded = await seedMailbox();
	const { sql, blobKeys } = seeded;
	const before = blobKeys().length;
	const { purge } = purgeHarness(seeded, {
		markDeleted: async () => {
			assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 2, "rows intact when tombstone is set");
			assert.equal(blobKeys().length, before, "blobs intact when tombstone is set");
			throw new Error("storage put failed");
		},
	});
	await assert.rejects(purge(), /storage put failed/);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 2, "no tombstone, no wipe");
	assert.equal(blobKeys().length, before);
}

// ── Done when: inbound delivery during a purge is rejected ──────
const MIME = [
	"From: Pat <pat@sender.example>",
	`To: ${MAILBOX}`,
	"Subject: Quarterly numbers",
	"Message-ID: <q3-numbers@sender.example>",
	"Date: Wed, 14 Oct 2026 10:00:00 +0000",
	"MIME-Version: 1.0",
	'Content-Type: multipart/mixed; boundary="b1"',
	"",
	"--b1",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"Numbers attached.",
	"--b1",
	'Content-Type: text/csv; name="q3.csv"',
	'Content-Disposition: attachment; filename="q3.csv"',
	"",
	"region,total",
	"emea,42",
	"--b1--",
	"",
].join("\r\n");

function message() {
	const bytes = new TextEncoder().encode(MIME);
	const msg = {
		to: MAILBOX,
		from: "pat@sender.example",
		headers: new Headers(),
		raw: new ReadableStream({
			start(c) {
				c.enqueue(bytes);
				c.close();
			},
		}),
		rawSize: bytes.byteLength,
		rejected: null,
		setReject(reason) {
			msg.rejected = reason;
		},
	};
	return msg;
}

/** MailboxDO stand-in: real claim SQL; writes refused once the purge tombstone is set. */
function fakeMailbox(sql, state, hooks = {}) {
	const rpc = (fn) => async (...args) => {
		await tick();
		return fn(...args);
	};
	return {
		isWritable: rpc(() => !state.deleted),
		claimInboundMessageId: async (messageId, claimId) => {
			await tick();
			const claimed = claimInboundMessage(sql, messageId, claimId);
			await hooks.afterClaim?.();
			return claimed;
		},
		completeInboundMessageClaim: rpc((m, e) => completeInboundMessageClaim(sql, m, e)),
		abandonInboundDelivery: rpc((e, m) => abandonInboundDelivery(sql, e, m)),
		findThreadIdByReferences: rpc(() => null),
		findThreadBySubject: rpc(() => null),
		getThreadAliasId: rpc(() => null),
		bootstrapSenderTriage: rpc(() => {}),
		getSenderTriage: rpc(() => null),
		getSenderPreference: rpc(() => null),
		getDeviceTokens: rpc(() => []),
		ensureAutoAgentConversation: rpc(() => {}),
		recordAliasInbound: rpc(() => {}),
		createEmail: rpc((folder, email) => {
			if (state.deleted) throw new Error("Mailbox has been deleted");
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, message_id) VALUES (?, 'inbox', 's', 'a@example.com', 'b@example.com', ?, ?)`,
				email.id,
				email.date,
				email.message_id,
			);
		}),
	};
}

function inboundEnv(bucket, stub) {
	const pending = [];
	return {
		env: { BUCKET: bucket, MAILBOX: { idFromName: (name) => name, get: () => stub } },
		ctx: { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) },
		pending,
	};
}

{
	// Mail arrives while the purge is sweeping blobs (tombstone set, rows
	// wiped, metadata still routing here): rejected with a 550, nothing stored.
	const seeded = await seedMailbox();
	const { sql, bucket, blobKeys } = seeded;
	const { state, purge } = purgeHarness(seeded);
	const release = bucket.holdDeletes();
	const purging = purge();
	while (!state.deleted || count(sql, `SELECT COUNT(*) FROM emails`) > 0) await tick();
	assert.ok(bucket.store.has(mailboxMetadataKey(MAILBOX)), "metadata still routes inbound here");

	const stub = fakeMailbox(sql, state);
	const { env, ctx } = inboundEnv(bucket, stub);
	const msg = message();
	await quiet(() => receiveEmail(msg, env, ctx));
	assert.match(msg.rejected ?? "", /^550\b/, `rejected with 550, got ${msg.rejected}`);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0, "no row stored mid-purge");

	release();
	await purging;
	assert.deepEqual(blobKeys(), [], "no blobs left behind");
	assert.equal(countPendingBlobDeletes(sql), 0);
}

{
	// Mail passes the preflight, then the purge starts before its row is
	// written: createEmail is refused, the delivery's blobs are deleted and
	// the sender gets a 550.
	const seeded = await seedMailbox();
	const { sql, bucket, blobKeys } = seeded;
	const { state, purge } = purgeHarness(seeded);
	let purging;
	const stub = fakeMailbox(sql, state, {
		afterClaim: async () => {
			purging = purge();
			while (!state.deleted) await tick();
		},
	});
	const { env, ctx } = inboundEnv(bucket, stub);
	const msg = message();
	await quiet(async () => {
		await receiveEmail(msg, env, ctx);
		await purging;
	});
	assert.match(msg.rejected ?? "", /^550\b/, `rejected with 550, got ${msg.rejected}`);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0, "no row stored");
	assert.deepEqual(blobKeys(), [], "inbound blobs deleted with the purge's");
	assert.equal(count(sql, `SELECT COUNT(*) FROM inbound_message_claims`), 0);
}

{
	// After the purge the metadata is gone: still rejected, never stored.
	const seeded = await seedMailbox();
	const { sql, bucket } = seeded;
	const { state, purge } = purgeHarness(seeded);
	await purge();
	const { env, ctx } = inboundEnv(bucket, fakeMailbox(sql, state));
	const msg = message();
	await quiet(() => receiveEmail(msg, env, ctx));
	assert.ok(msg.rejected, "rejected after purge");
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0);
}

// ── Done when: a purge interrupted after the row wipe completes on retry ──
{
	// R2 is down: rows are wiped and their blobs queued, the metadata delete
	// throws, so the purge fails after the row wipe.
	const seeded = await seedMailbox();
	const { sql, bucket, blobKeys } = seeded;
	const { state, purge } = purgeHarness(seeded);
	const blobsBefore = blobKeys().sort();
	bucket.failDeletes(2); // blob sweep + metadata delete
	await quiet(() => assert.rejects(purge(), /R2 unavailable/));
	assert.equal(state.deleted, true, "tombstone set");
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0, "rows wiped");
	assert.equal(count(sql, `SELECT COUNT(*) FROM agent_conversations`), 0);
	assert.deepEqual(blobKeys().sort(), blobsBefore, "blobs not yet deleted");
	const queued = sql.exec(`SELECT key FROM pending_blob_deletes ORDER BY key`).map((r) => r.key);
	assert.deepEqual(queued, blobsBefore.slice().sort(), "every orphaned blob is queued");
	assert.equal(state.alarmDelays.length, 1, "alarm scheduled to retry the sweep");
	assert.ok(bucket.store.has(mailboxMetadataKey(MAILBOX)));

	// The retry finds no rows but still sweeps the queued blobs, deletes the
	// metadata and returns the agent conversations to purge.
	const retried = await purge();
	assert.deepEqual(retried.conversationIds, ["conv-1"], "agent conversations survive the interruption");
	assert.equal(retried.pendingBlobDeletes, 0);
	assert.deepEqual(blobKeys(), [], "blobs deleted on retry");
	assert.equal(countPendingBlobDeletes(sql), 0);
	assert.equal(bucket.store.has(mailboxMetadataKey(MAILBOX)), false, "metadata deleted on retry");
	assert.equal(count(sql, `SELECT COUNT(*) FROM folders`), SYSTEM_FOLDERS.length);
}

{
	// The isolate dies right after the wipe commits (before any blob delete):
	// the retry completes from the queue.
	const seeded = await seedMailbox();
	const { sql, bucket, blobKeys } = seeded;
	let crash = true;
	const { purge } = purgeHarness(seeded, {
		afterWipe: async () => {
			if (crash) {
				crash = false;
				throw new Error("isolate evicted");
			}
		},
	});
	await assert.rejects(purge(), /isolate evicted/);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0);
	assert.ok(countPendingBlobDeletes(sql) > 0);
	assert.ok(blobKeys().length > 0);
	await purge();
	assert.deepEqual(blobKeys(), []);
	assert.equal(countPendingBlobDeletes(sql), 0);
	assert.equal(bucket.store.has(mailboxMetadataKey(MAILBOX)), false);
}

{
	// Only the blob sweep fails: the purge itself succeeds and the alarm
	// sweep (drain with no keys) finishes the job.
	const seeded = await seedMailbox();
	const { sql, bucket, blobKeys } = seeded;
	const { state, purge } = purgeHarness(seeded);
	bucket.failDeletes(1);
	const result = await quiet(() => purge());
	assert.ok(result.pendingBlobDeletes > 0);
	assert.equal(state.alarmDelays.length, 1);
	assert.equal(bucket.store.has(mailboxMetadataKey(MAILBOX)), false, "metadata deleted");
	assert.ok(blobKeys().length > 0);
	const swept = await drainPendingBlobDeletes(sql, bucket);
	assert.equal(swept.remaining, 0);
	assert.deepEqual(blobKeys(), [], "alarm sweep deletes the leftovers");
}

console.log("mailbox-purge-ordering: ok");
