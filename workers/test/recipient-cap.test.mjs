/**
 * AVE-125: at most 50 recipients per message (To + Cc + Bcc combined), and the
 * send quota counts recipients, not messages. The quota half runs the real
 * MailboxDO.checkSendRateLimit on node:sqlite with every mailbox migration.
 * Run: pnpm test:unit recipient-cap
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { SendEmailRequestSchema } from "../lib/schemas.ts";
import {
	MAX_RECIPIENTS_PER_MESSAGE,
	SEND_QUOTA_RECIPIENTS_PER_DAY,
	SEND_QUOTA_RECIPIENTS_PER_HOUR,
	TOO_MANY_RECIPIENTS_ERROR,
	countRecipients,
	recipientCapError,
	sendQuotaError,
} from "../lib/send-quota.ts";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { MailboxDO } from "../durableObject/index.ts";

const addresses = (n, prefix = "r") => Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);

// ── Constants ─────────────────────────────────────────────────────
assert.equal(MAX_RECIPIENTS_PER_MESSAGE, 50);
assert.equal(TOO_MANY_RECIPIENTS_ERROR, "Too many recipients (max 50)");
// One full-size message must always fit an empty hour.
assert.ok(SEND_QUOTA_RECIPIENTS_PER_HOUR >= MAX_RECIPIENTS_PER_MESSAGE);
assert.ok(SEND_QUOTA_RECIPIENTS_PER_DAY >= SEND_QUOTA_RECIPIENTS_PER_HOUR);

// ── Counting ──────────────────────────────────────────────────────
assert.equal(countRecipients("a@x.com"), 1);
assert.equal(countRecipients(["a@x.com", "b@x.com"], undefined, null), 2);
assert.equal(countRecipients("a@x.com, b@x.com,", ["c@x.com"], "d@x.com"), 4, "comma lists count each part");
assert.equal(countRecipients(["a@x.com", "a@x.com"]), 2, "duplicates are still recipients");
assert.equal(recipientCapError(addresses(50)), null);
assert.equal(recipientCapError(addresses(20, "t"), addresses(20, "c"), addresses(11, "b")), TOO_MANY_RECIPIENTS_ERROR);

// ── Schema: /emails, /reply and /forward bodies ───────────────────
const body = (fields) => ({ from: "ada@inboxies.email", subject: "Hi", text: "Hello", ...fields });
const parseError = (fields) => {
	try {
		SendEmailRequestSchema.parse(body(fields));
		return null;
	} catch (e) {
		assert.ok(e instanceof z.ZodError);
		return e.issues[0];
	}
};

// 50 accepted, however they are split.
assert.equal(parseError({ to: addresses(50) }), null, "50 in To");
assert.equal(parseError({ to: addresses(30, "t"), cc: addresses(10, "c"), bcc: addresses(10, "b") }), null, "50 across To/Cc/Bcc");
assert.equal(parseError({ to: "t@example.com", bcc: addresses(49, "b") }), null, "1 To + 49 Bcc");

// 51 refused, whichever field tips it over, with the sentence alone (no path).
for (const fields of [
	{ to: addresses(51) },
	{ to: addresses(50, "t"), cc: "one-more@example.com" },
	{ to: addresses(25, "t"), cc: addresses(25, "c"), bcc: addresses(1, "b") },
	{ to: "t@example.com", bcc: addresses(50, "b") },
	{ to: addresses(1000, "t") },
]) {
	const issue = parseError(fields);
	assert.ok(issue, "over 50 is refused");
	assert.equal(issue.message, TOO_MANY_RECIPIENTS_ERROR);
	assert.deepEqual(issue.path, [], "app.onError prints it without a field prefix");
}

// ── Quota decision: recipients, not messages ─────────────────────
assert.equal(sendQuotaError({ recipients: 50, usedLastHour: 0, usedLastDay: 0 }), null);
assert.equal(sendQuotaError({ recipients: 50, usedLastHour: 50, usedLastDay: 50 }), null, "two full messages an hour");
assert.match(
	sendQuotaError({ recipients: 1, usedLastHour: 100, usedLastDay: 100 }),
	/max 100 recipients per hour/,
);
assert.match(
	sendQuotaError({ recipients: 50, usedLastHour: 70, usedLastDay: 70 }),
	/max 100 recipients per hour per mailbox \(this message has 50, 30 left\)/,
	"says why a message is refused while some quota is left",
);
assert.match(
	sendQuotaError({ recipients: 1, usedLastHour: 0, usedLastDay: 300 }),
	/max 300 recipients per day/,
);

// ── MailboxDO.checkSendRateLimit on real migrations ──────────────
function sqlStorage(db) {
	return {
		exec(query, ...bindings) {
			if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
				db.exec(query);
				return [];
			}
			const statement = db.prepare(query);
			if (/^\s*(SELECT|WITH|PRAGMA)/i.test(query) || /RETURNING/i.test(query)) {
				return statement.all(...bindings);
			}
			statement.run(...bindings);
			return [];
		},
		get databaseSize() {
			return 0;
		},
	};
}

function newMailbox(db = new DatabaseSync(":memory:")) {
	const storage = {
		sql: sqlStorage(db),
		getAlarm: async () => null,
		setAlarm: async () => {},
		transactionSync: (fn) => fn(),
		get: async () => undefined,
		put: async () => {},
	};
	return { db, mailbox: new MailboxDO({ storage, id: { toString: () => "test" } }, {}) };
}

{
	// The issue's repro: one message to 1,000 people no longer costs one slot.
	// (The schema refuses it first; the quota would too.)
	const { mailbox } = newMailbox();
	assert.match(await mailbox.checkSendRateLimit(1000), /max 100 recipients per hour/);
}

{
	const { db, mailbox } = newMailbox();
	const used = () => Number(db.prepare(`SELECT COALESCE(SUM(recipients), 0) AS n FROM send_log`).get().n);

	assert.equal(await mailbox.checkSendRateLimit(50), null, "a full-size message fits an empty hour");
	assert.equal(used(), 50, "it reserves 50 units, not 1");
	assert.equal(await mailbox.checkSendRateLimit(30), null);
	assert.equal(used(), 80);
	assert.match(await mailbox.checkSendRateLimit(21), /this message has 21, 20 left/, "21 more would pass 100");
	assert.equal(used(), 80, "a refused message reserves nothing");
	assert.equal(await mailbox.checkSendRateLimit(20), null, "exactly the rest fits");
	assert.match(await mailbox.checkSendRateLimit(), /max 100 recipients per hour/, "default is one recipient");

	// releaseSendSlot gives back the whole message's recipients.
	await mailbox.releaseSendSlot();
	assert.equal(used(), 80);
}

{
	// Single-recipient sends: 100 an hour.
	const { mailbox } = newMailbox();
	for (let i = 0; i < 100; i++) assert.equal(await mailbox.checkSendRateLimit(1), null);
	assert.match(await mailbox.checkSendRateLimit(1), /per hour/);
}

{
	// Daily window: earlier hours still count against the day.
	const { db, mailbox } = newMailbox();
	const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
	db.prepare(`INSERT INTO send_log (sent_at, recipients) VALUES (?, ?)`).run(twoHoursAgo, 260);
	assert.equal(await mailbox.checkSendRateLimit(40), null, "260 + 40 = 300 fits");
	assert.match(await mailbox.checkSendRateLimit(1), /max 300 recipients per day/);
}

{
	// 44_send_log_recipients: rows logged before it were one message each and count as 1.
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	const index = mailboxMigrations.findIndex((m) => m.name === "44_send_log_recipients");
	assert.ok(index > 0, "migration is registered");
	assert.equal(mailboxMigrations.filter((m) => m.name === "44_send_log_recipients").length, 1);
	applyMigrations(sql, mailboxMigrations.slice(0, index));
	const now = new Date().toISOString();
	for (let i = 0; i < 3; i++) db.prepare(`INSERT INTO send_log (sent_at) VALUES (?)`).run(now);
	applyMigrations(sql, mailboxMigrations);
	assert.equal(Number(db.prepare(`SELECT SUM(recipients) AS n FROM send_log`).get().n), 3);
}

console.log("recipient-cap: ok");
