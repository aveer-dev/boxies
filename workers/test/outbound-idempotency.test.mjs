/**
 * Idempotency-Key on send / reply / forward (AVE-63): header validation, the
 * `33_email_idempotency_key` migration (nullable column + partial UNIQUE
 * index), the atomic insert-or-return-existing step `createEmail` uses, and
 * the HTTP routes: a replay sends once and returns the original row, two
 * concurrent requests with one key send once (one outbound-send queue
 * message), and requests without a key
 * behave as before. Runs the real MailboxDO migrations on node:sqlite; the
 * HTTP part wires a mock mailbox stub (yielding at every await, like the DO
 * does at its R2 write) to that same database.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/outbound-idempotency.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	IDEMPOTENCY_KEY_MAX_LENGTH,
	findEmailIdByIdempotencyKey,
	insertOrReplay,
	parseIdempotencyKey,
} from "../lib/outbound-idempotency.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	flushWaitUntil,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const MIGRATION = "33_email_idempotency_key";

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

function insertRow(sql, id, key = null, folder = "sent") {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, idempotency_key)
		 VALUES (?, ?, 's', 'ada@inboxies.email', 'pat@example.com', ?, ?)`,
		id,
		folder,
		new Date().toISOString(),
		key,
	);
}

const count = (sql, query, ...b) => Number(Object.values(sql.exec(query, ...b)[0])[0]);

// ── Header validation ────────────────────────────────────────────
{
	assert.deepEqual(parseIdempotencyKey(undefined), { ok: true, key: null }, "absent: no key");
	assert.deepEqual(parseIdempotencyKey(null), { ok: true, key: null });
	assert.deepEqual(parseIdempotencyKey("abc-123"), { ok: true, key: "abc-123" });
	assert.deepEqual(parseIdempotencyKey("  k 1  "), { ok: true, key: "k 1" }, "trimmed, inner space ok");
	assert.equal(parseIdempotencyKey("x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH)).ok, true);
	for (const bad of ["", "   ", "x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1), "café", "a\tb", "a\u0000b"]) {
		assert.equal(parseIdempotencyKey(bad).ok, false, `rejects ${JSON.stringify(bad).slice(0, 20)}`);
	}
}

// ── Migration ────────────────────────────────────────────────────
{
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	// Existing deployment: everything before 33 applied, with mail stored.
	applyMigrations(sql, mailboxMigrations.filter((m) => m.name !== MIGRATION));
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, date) VALUES ('old', 'sent', 's', '2026-01-01')`,
	);
	applyMigrations(sql, mailboxMigrations);
	assert.equal(count(sql, `SELECT COUNT(*) FROM d1_migrations WHERE name = ?`, MIGRATION), 1);
	assert.equal(sql.exec(`SELECT idempotency_key FROM emails WHERE id = 'old'`)[0].idempotency_key, null);

	// Many rows without a key never collide; a key is unique.
	insertRow(sql, "n1");
	insertRow(sql, "n2");
	insertRow(sql, "k1", "key-1");
	assert.throws(() => insertRow(sql, "k2", "key-1"), /UNIQUE constraint failed: emails\.idempotency_key/);
	assert.equal(findEmailIdByIdempotencyKey(sql, "key-1"), "k1");
	assert.equal(findEmailIdByIdempotencyKey(sql, "nope"), null);
	const plan = sql.exec(`EXPLAIN QUERY PLAN SELECT id FROM emails WHERE idempotency_key = 'x'`);
	assert.ok(plan.some((r) => String(r.detail).includes("idx_emails_idempotency_key")), "lookup uses the index");
}

// ── insertOrReplay (the atomic step of createEmail) ──────────────
{
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, mailboxMigrations);

	assert.deepEqual(insertOrReplay(sql, "a", "e1", () => insertRow(sql, "e1", "a")), { id: "e1", replayed: false });
	let inserted = false;
	assert.deepEqual(
		insertOrReplay(sql, "a", "e2", () => { inserted = true; }),
		{ id: "e1", replayed: true },
		"a stored key returns the original row",
	);
	assert.equal(inserted, false, "and inserts nothing");

	// No key: always inserts, as before.
	assert.deepEqual(insertOrReplay(sql, null, "e3", () => insertRow(sql, "e3")), { id: "e3", replayed: false });

	// Index backstop: a duplicate the check missed resolves to the winner.
	assert.deepEqual(
		insertOrReplay(sql, "b", "e5", () => {
			insertRow(sql, "e4", "b"); // the winner lands first
			insertRow(sql, "e5", "b");
		}),
		{ id: "e4", replayed: true },
	);
	// Other insert errors still surface.
	assert.throws(() => insertOrReplay(sql, "c", "e1", () => insertRow(sql, "e1", "c")), /UNIQUE constraint failed: emails\.id/);
}

// ── HTTP: send / reply / forward ─────────────────────────────────
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const MAILBOX = "ada@inboxies.email";

const db = new DatabaseSync(":memory:");
const sql = sqlStorage(db);
applyMigrations(sql, mailboxMigrations);
sql.exec(
	`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, message_id, thread_id)
	 VALUES ('orig', 'inbox', 'Hi', 'pat@example.com', ?, '2026-01-01T00:00:00Z', 'orig@example.com', 'orig@example.com')`,
	MAILBOX,
);

let slots = 0;
let lateReplays = 0; // replays resolved by createEmail's atomic step, not an earlier check
/** Yield before and after, like a DO RPC: lets concurrent requests interleave. */
const rpc = (fn) => async (...args) => {
	await tick();
	const result = fn(...args);
	await tick();
	return result;
};
const stubExtras = {
	getEmail: rpc((id) => sql.exec(`SELECT * FROM emails WHERE id = ?`, id)[0] ?? null),
	findEmailIdByIdempotencyKey: rpc((key) => findEmailIdByIdempotencyKey(sql, key)),
	checkSendRateLimit: rpc(() => (slots++, null)),
	releaseSendSlot: rpc(() => { slots--; }),
	// Mirrors MailboxDO.createEmail: early check, await (R2 body write), then
	// the synchronous check + insert.
	createEmail: async (folder, email) => {
		await tick();
		const key = email.idempotency_key ?? null;
		const early = key ? findEmailIdByIdempotencyKey(sql, key) : null;
		if (early) return { id: early, replayed: true };
		await tick(); // storeEmailContent
		await tick();
		const result = insertOrReplay(sql, key, email.id, () =>
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id, delivery_status, idempotency_key)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				email.id, folder, email.subject, email.sender, email.recipient, email.date,
				email.thread_id ?? null, email.delivery_status ?? null, key,
			),
		);
		if (result.replayed) lateReplays++;
		return result;
	},
};

// Fresh sends go through the outbound-send queue (AVE-65): count enqueued
// messages; the EMAIL binding must never be called inline.
const outboundSend = {
	sent: [],
	send: async (body) => {
		outboundSend.sent.push(body);
	},
};
const { env, db: authDb, bucket, email: emailBinding } = createAuthTestEnv({
	MAILBOX: mockMailboxNamespace(stubExtras),
	OUTBOUND_SEND: outboundSend,
	DOMAINS: "inboxies.email",
});
const ada = await addUser(authDb, { id: "ada", email: MAILBOX });
await addMailbox(authDb, bucket, MAILBOX, { owners: ["ada"] });
const asAda = principalFor(ada);

const sentRows = () => count(sql, `SELECT COUNT(*) FROM emails WHERE folder_id = 'sent'`);
const message = (subject) => ({ to: "pat@example.com", from: MAILBOX, subject, text: "Hello" });

async function post(path, body, key) {
	return request(env, {
		method: "POST",
		path: `/api/v1/mailboxes/${MAILBOX}${path}`,
		principal: asAda,
		body,
		headers: key === undefined ? {} : { "Idempotency-Key": key },
	});
}

async function settle() {
	await flushWaitUntil();
	await tick();
}

// No key: every request sends, exactly as before.
{
	const rowsBefore = sentRows();
	const a = await post("/emails", message("No key"));
	const b = await post("/emails", message("No key"));
	await settle();
	assert.equal(a.status, 202);
	assert.equal(b.status, 202);
	assert.deepEqual(Object.keys(a.payload).sort(), ["id", "status"]);
	assert.equal(a.payload.status, "sent");
	assert.notEqual(a.payload.id, b.payload.id, "two sends, two rows");
	assert.equal(a.headers.get("Idempotent-Replayed"), null);
	assert.equal(sentRows(), rowsBefore + 2);
	assert.equal(outboundSend.sent.length, 2);
	assert.equal(slots, 2);
	assert.equal(count(sql, `SELECT COUNT(*) FROM emails WHERE idempotency_key IS NOT NULL`), 0, "no key stored");
}

// Invalid key: 400, nothing sent or reserved.
{
	const before = [sentRows(), outboundSend.sent.length, slots];
	const res = await post("/emails", message("Bad key"), "café");
	assert.equal(res.status, 400);
	assert.match(res.payload.error, /Idempotency-Key/);
	const longKey = await post("/emails", message("Bad key"), "x".repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1));
	assert.equal(longKey.status, 400);
	await settle();
	assert.deepEqual([sentRows(), outboundSend.sent.length, slots], before);
}

// Replayed send: one row, one send, the original row back.
{
	const before = [sentRows(), outboundSend.sent.length, slots];
	const first = await post("/emails", message("Once"), "send-key-1");
	await settle();
	const replay = await post("/emails", message("Once"), "send-key-1");
	await settle();
	assert.equal(first.status, 202);
	assert.equal(replay.status, 202, "same status as the original");
	assert.deepEqual(replay.payload, first.payload, "same body: the original row");
	assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
	assert.equal(first.headers.get("Idempotent-Replayed"), null);
	assert.equal(sentRows(), before[0] + 1, "one Sent row");
	assert.equal(outboundSend.sent.length, before[1] + 1, "sent once");
	assert.equal(slots, before[2] + 1, "one send slot");
	assert.equal(findEmailIdByIdempotencyKey(sql, "send-key-1"), first.payload.id);
}

// Two concurrent requests with one key: one send, both get the same row.
{
	const before = [sentRows(), outboundSend.sent.length, slots];
	const [a, b] = await Promise.all([
		post("/emails", message("Race"), "race-key"),
		post("/emails", message("Race"), "race-key"),
	]);
	await settle();
	assert.equal(a.status, 202);
	assert.equal(b.status, 202);
	assert.equal(a.payload.id, b.payload.id, "both point at the winner's row");
	assert.equal(sentRows(), before[0] + 1, "one Sent row");
	assert.equal(outboundSend.sent.length, before[1] + 1, "sent once");
	assert.equal(slots, before[2] + 1, "the loser gave its send slot back");
	assert.equal(
		[a, b].filter((r) => r.headers.get("Idempotent-Replayed") === "true").length,
		1,
		"exactly one is the replay",
	);
	assert.equal(lateReplays, 1, "both got past the early checks; the atomic step decided");
}

// Reply and forward: replay sends once and returns the original row.
for (const route of ["reply", "forward"]) {
	const before = [sentRows(), outboundSend.sent.length];
	const key = `${route}-key`;
	const first = await post(`/emails/orig/${route}`, message(`Re: ${route}`), key);
	await settle();
	const replay = await post(`/emails/orig/${route}`, message(`Re: ${route}`), key);
	await settle();
	assert.equal(first.status, 202, `${route}: ${JSON.stringify(first.payload)}`);
	assert.equal(replay.status, 202);
	assert.deepEqual(replay.payload, first.payload, `${route}: replay returns the original row`);
	assert.equal(replay.headers.get("Idempotent-Replayed"), "true");
	assert.equal(sentRows(), before[0] + 1, `${route}: one Sent row`);
	assert.equal(outboundSend.sent.length, before[1] + 1, `${route}: sent once`);

	// Without a key, reply/forward send every time as before.
	const plain1 = await post(`/emails/orig/${route}`, message(`Re: ${route}`));
	const plain2 = await post(`/emails/orig/${route}`, message(`Re: ${route}`));
	await settle();
	assert.notEqual(plain1.payload.id, plain2.payload.id);
	assert.equal(outboundSend.sent.length, before[1] + 3);
}

// The key is per mailbox, not per route: reusing a send's key on a forward
// returns the send's row and sends nothing.
{
	const before = outboundSend.sent.length;
	const res = await post("/emails/orig/forward", message("Fwd"), "send-key-1");
	await settle();
	assert.equal(res.status, 202);
	assert.equal(res.payload.id, findEmailIdByIdempotencyKey(sql, "send-key-1"));
	assert.equal(outboundSend.sent.length, before);
}

assert.equal(emailBinding.sent.length, 0, "no inline sends: everything went through the queue");

console.log("outbound-idempotency: ok");
