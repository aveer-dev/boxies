/**
 * Inbound dedup is atomic: a delivery claims its Message-ID inside the
 * MailboxDO before any R2 write or AI call, so concurrent deliveries of the
 * same message store one row and one set of blobs. Runs the real MailboxDO
 * migrations and claim SQL on node:sqlite, then drives `receiveEmail` twice
 * at once against a fake DO and R2 bucket that yield at every await.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/inbound-dedup.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	abandonInboundDelivery,
	claimInboundMessage,
	completeInboundMessageClaim,
	INBOUND_CLAIM_RETENTION_MS,
	INBOUND_CLAIM_STALE_MS,
} from "../lib/inbound-claims.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { receiveEmail } from "../index.ts";

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

function mailboxDb() {
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, mailboxMigrations);
	return { db, sql };
}

function insertEmail(sql, id, messageId) {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, message_id)
		 VALUES (?, 'inbox', 's', 'a@example.com', 'b@example.com', ?, ?)`,
		id,
		new Date().toISOString(),
		messageId,
	);
}

const count = (sql, query, ...b) => Number(Object.values(sql.exec(query, ...b)[0])[0]);

// ── Claim SQL ────────────────────────────────────────────────────
{
	const { sql } = mailboxDb();
	const t0 = 1_000_000_000_000;

	assert.equal(claimInboundMessage(sql, "<m1@example.com>", "e1", t0), true, "first delivery claims");
	assert.equal(claimInboundMessage(sql, "m1@example.com", "e2", t0 + 1), false, "second delivery loses");
	assert.equal(claimInboundMessage(sql, "", "e3", t0), true, "no Message-ID: nothing to dedup");

	// The loser can't release or complete the winner's claim.
	assert.equal(abandonInboundDelivery(sql, "e2", "m1@example.com"), "not_stored");
	assert.equal(claimInboundMessage(sql, "m1@example.com", "e4", t0 + 2), false, "winner's claim survives");

	// Winner fails before storing: claim released, retry can redeliver.
	assert.equal(abandonInboundDelivery(sql, "e1", "m1@example.com"), "not_stored");
	assert.equal(claimInboundMessage(sql, "m1@example.com", "e5", t0 + 3), true, "retry reclaims");

	// Stored mail is a duplicate, whether or not the claim was completed.
	insertEmail(sql, "e5", "m1@example.com");
	assert.equal(claimInboundMessage(sql, "m1@example.com", "e6", t0 + 4), false);
	completeInboundMessageClaim(sql, "m1@example.com", "e5");
	assert.equal(
		sql.exec(`SELECT email_id FROM inbound_message_claims WHERE message_id = 'm1@example.com'`)[0].email_id,
		"e5",
	);
	// Pre-existing mail (stored before claims existed) also dedups.
	insertEmail(sql, "legacy", "old@example.com");
	assert.equal(claimInboundMessage(sql, "<old@example.com>", "e7", t0), false);

	// A row stored before the failure surfaced: keep the claim and blobs.
	assert.equal(claimInboundMessage(sql, "m2@example.com", "e8", t0), true);
	insertEmail(sql, "e8", "m2@example.com");
	assert.equal(abandonInboundDelivery(sql, "e8", "m2@example.com"), "stored");
	assert.equal(claimInboundMessage(sql, "m2@example.com", "e9", t0 + 5), false);

	// A crashed isolate's claim goes stale and can be taken over.
	assert.equal(claimInboundMessage(sql, "m3@example.com", "e10", t0), true);
	assert.equal(claimInboundMessage(sql, "m3@example.com", "e11", t0 + INBOUND_CLAIM_STALE_MS - 1), false);
	assert.equal(claimInboundMessage(sql, "m3@example.com", "e12", t0 + INBOUND_CLAIM_STALE_MS), true);
	// The original holder waking up late can't release the new claim.
	assert.equal(abandonInboundDelivery(sql, "e10", "m3@example.com"), "not_stored");
	assert.equal(claimInboundMessage(sql, "m3@example.com", "e13", t0 + INBOUND_CLAIM_STALE_MS + 1), false);

	// Mail the user deleted may be delivered again, as before claims existed.
	sql.exec(`DELETE FROM emails WHERE id = 'e5'`);
	assert.equal(claimInboundMessage(sql, "m1@example.com", "e14", t0 + 6), true);

	// Old claims are pruned; stored mail still dedups through `emails`.
	const later = t0 + INBOUND_CLAIM_STALE_MS + INBOUND_CLAIM_RETENTION_MS + 10;
	assert.equal(claimInboundMessage(sql, "m4@example.com", "e15", later), true);
	assert.deepEqual(
		sql.exec(`SELECT message_id FROM inbound_message_claims`).map((r) => r.message_id),
		["m4@example.com"],
	);
	assert.equal(claimInboundMessage(sql, "m2@example.com", "e16", later), false, "m2 is still in emails");

	// The migration added a table and left existing `emails` rows alone.
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 2);
}

// ── receiveEmail end to end ──────────────────────────────────────
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const MAILBOX = "ada@example.com";

function createBucket() {
	const store = new Map();
	return {
		store,
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
			for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
		},
	};
}

/** A MailboxDO stand-in: real claim SQL, and an await (RPC hop) on every call. */
function fakeMailbox(sql, { failCreate = 0 } = {}) {
	let failures = failCreate;
	const rpc = (fn) => async (...args) => {
		await tick();
		return fn(...args);
	};
	return {
		isWritable: rpc(() => true),
		claimInboundMessageId: rpc((messageId, claimId) => claimInboundMessage(sql, messageId, claimId)),
		completeInboundMessageClaim: rpc((messageId, emailId) =>
			completeInboundMessageClaim(sql, messageId, emailId),
		),
		abandonInboundDelivery: rpc((emailId, messageId) => abandonInboundDelivery(sql, emailId, messageId)),
		findThreadIdByReferences: rpc(() => null),
		findThreadBySubject: rpc(() => null),
		getThreadAliasId: rpc(() => null),
		bootstrapSenderTriage: rpc(() => {}),
		getSenderTriage: rpc(() => null),
		getSenderPreference: rpc(() => null),
		getDeviceTokens: rpc(() => []),
		ensureAutoAgentConversation: rpc(() => {}),
		createEmail: rpc((folder, email, attachments) => {
			if (failures > 0) {
				failures -= 1;
				throw new Error("storage hiccup");
			}
			insertEmail(sql, email.id, email.message_id);
			for (const att of attachments) {
				sql.exec(
					`INSERT INTO attachments (id, email_id, filename, mimetype, size) VALUES (?, ?, ?, ?, ?)`,
					att.id,
					att.email_id,
					att.filename,
					att.mimetype,
					att.size,
				);
			}
		}),
	};
}

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

function message(raw = MIME) {
	const bytes = new TextEncoder().encode(raw);
	return {
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
		setReject(reason) {
			throw new Error(`unexpected reject: ${reason}`);
		},
	};
}

async function setup(options) {
	const { sql } = mailboxDb();
	const bucket = createBucket();
	await bucket.put(mailboxMetadataKey(MAILBOX), JSON.stringify({ screenerEnabled: false }));
	const stub = fakeMailbox(sql, options);
	const env = {
		BUCKET: bucket,
		MAILBOX: { idFromName: (name) => name, get: () => stub },
	};
	const pending = [];
	const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
	const blobKeys = () => [...bucket.store.keys()].filter((k) => k !== mailboxMetadataKey(MAILBOX));
	return { sql, bucket, env, ctx, pending, blobKeys };
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

{
	// Two concurrent deliveries of the same Message-ID (an Email Routing retry,
	// or hello@ + hello+tag@): one row, one set of blobs.
	const { sql, env, ctx, pending, blobKeys } = await setup();
	await quiet(async () => {
		await Promise.all([receiveEmail(message(), env, ctx), receiveEmail(message(), env, ctx)]);
		await Promise.all(pending);
	});

	const rows = sql.exec(`SELECT id FROM emails WHERE message_id = 'q3-numbers@sender.example'`);
	assert.equal(rows.length, 1, "one row");
	const emailId = rows[0].id;
	const keys = blobKeys();
	assert.ok(keys.length >= 2, `body + attachment blobs written: ${keys.join(", ")}`);
	assert.ok(
		keys.every((k) => k.includes(emailId)),
		`every blob belongs to the stored row: ${keys.join(", ")}`,
	);
	assert.equal(count(sql, `SELECT COUNT(*) FROM attachments`), 1, "one attachment row");
	const claim = sql.exec(`SELECT email_id FROM inbound_message_claims`)[0];
	assert.equal(claim.email_id, emailId, "claim records the stored row");

	// A later retry is still a duplicate and writes nothing.
	await quiet(() => receiveEmail(message(), env, ctx));
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 1);
	assert.deepEqual(blobKeys().sort(), keys.sort());
}

{
	// The winning delivery fails before its row is stored: its blobs are
	// deleted and the claim released, so the Email Routing retry delivers.
	const { sql, env, ctx, pending, blobKeys } = await setup({ failCreate: 1 });
	await quiet(async () => {
		await assert.rejects(receiveEmail(message(), env, ctx), /storage hiccup/);
	});
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 0);
	assert.deepEqual(blobKeys(), [], "orphaned blobs deleted");
	assert.equal(count(sql, `SELECT COUNT(*) FROM inbound_message_claims`), 0, "claim released");

	await quiet(async () => {
		await receiveEmail(message(), env, ctx);
		await Promise.all(pending);
	});
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 1, "retry stores the message");
	const emailId = sql.exec(`SELECT id FROM emails`)[0].id;
	assert.ok(blobKeys().length >= 2 && blobKeys().every((k) => k.includes(emailId)));
}

{
	// No Message-ID: no dedup, as before.
	const { sql, env, ctx, pending } = await setup();
	const raw = MIME.replace("Message-ID: <q3-numbers@sender.example>\r\n", "");
	await quiet(async () => {
		await Promise.all([receiveEmail(message(raw), env, ctx), receiveEmail(message(raw), env, ctx)]);
		await Promise.all(pending);
	});
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails`), 2);
	assert.equal(count(sql, `SELECT COUNT(*) FROM inbound_message_claims`), 0);
}

console.log("inbound-dedup: ok");
