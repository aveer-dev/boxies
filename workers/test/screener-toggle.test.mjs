/**
 * AVE-104: a per-mailbox Screener switch (`settings.screener.enabled`).
 * Off: unknown senders file like everyone else (Inbox, or the classifier's
 * purpose box) while spam and blocked senders still land in Spam. Turning it
 * off moves mail waiting in Screener to Inbox (real MailboxDO on node:sqlite,
 * and the PUT /mailboxes route). Default stays on.
 * Run: pnpm test:unit screener-toggle
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MailboxDO } from "../durableObject/index.ts";
import { defaultMailboxSettings } from "../auth/mailboxes.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { parseScreenerEnabled, resolveInboundFolder } from "../lib/sender-triage.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const ham = { class: "ham", folderId: "inbox", reason: "ai-ham" };
const spam = { class: "spam", folderId: "spam", reason: "spam-headers" };
const rejected = {
	sender: "nope@example.com",
	status: "rejected",
	destination_folder_id: null,
	decided_at: "t",
	updated_at: "t",
};

// ── Routing ──────────────────────────────────────────────────────
{
	// Default (no setting, and new mailboxes) is on: unknown → Screener.
	assert.equal(parseScreenerEnabled({}), true);
	assert.equal(parseScreenerEnabled(defaultMailboxSettings("Ada")), true);
	const on = resolveInboundFolder({ classification: ham, triage: null, filterHit: null });
	assert.equal(on.folderId, "screener");
	assert.equal(on.triageAction, "unknown");

	// Off: unknown → Inbox, and it notifies like normal mail.
	const off = resolveInboundFolder({ classification: ham, triage: null, filterHit: null, screenerEnabled: false });
	assert.equal(off.folderId, "inbox");
	assert.equal(off.skipPush, false);
	assert.equal(off.triageAction, "disabled");

	// Off: spam checks still run.
	const offSpam = resolveInboundFolder({ classification: spam, triage: null, filterHit: null, screenerEnabled: false });
	assert.equal(offSpam.folderId, "spam");

	// Off: a blocked sender still stays out (Spam, since Screened out is a Screener box).
	const offRejected = resolveInboundFolder({ classification: ham, triage: rejected, filterHit: null, screenerEnabled: false });
	assert.equal(offRejected.folderId, "spam");
}

// ── MailboxDO.releaseScreenerToInbox ─────────────────────────────
{
	const db = new DatabaseSync(":memory:");
	const sql = {
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
	const storage = {
		sql,
		getAlarm: async () => null,
		setAlarm: async () => {},
		transactionSync: (fn) => fn(),
		get: async () => undefined,
		put: async () => {},
	};
	const mailbox = new MailboxDO({ storage, id: { toString: () => "test" } }, {});
	const events = [];
	mailbox.broadcastEvent = (event, data) => events.push([event, data]);

	const insert = db.prepare(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id, read)
		 VALUES (?, ?, 'Hi', 'a@example.com', 'b@example.com', '2026-01-01T00:00:00Z', ?, 0)`,
	);
	insert.run("s1", "screener", "t1");
	insert.run("s2", "screener", "t2");
	insert.run("i1", "inbox", "t3");
	insert.run("x1", "screened_out", "t4");

	const result = await mailbox.releaseScreenerToInbox();
	assert.equal(result.moved, 2);
	assert.deepEqual([...result.ids].sort(), ["s1", "s2"]);
	const folderOf = (id) => db.prepare(`SELECT folder_id FROM emails WHERE id = ?`).get(id).folder_id;
	assert.equal(folderOf("s1"), "inbox");
	assert.equal(folderOf("s2"), "inbox");
	assert.equal(folderOf("i1"), "inbox");
	assert.equal(folderOf("x1"), "screened_out", "declined senders' mail is left alone");
	assert.deepEqual(
		events.map(([e, d]) => [e, d.folder_id]),
		[
			["email_moved", "inbox"],
			["email_moved", "inbox"],
		],
	);

	// Nothing waiting: a no-op.
	assert.deepEqual(await mailbox.releaseScreenerToInbox(), { moved: 0, ids: [] });
}

// ── PUT /mailboxes: only an on → off change releases Screener ────
{
	const released = [];
	const mailboxes = mockMailboxNamespace({
		releaseScreenerToInbox: async () => {
			released.push(Date.now());
			return { moved: 3, ids: ["a", "b", "c"] };
		},
	});
	const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mailboxes });
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
	const bob = await addUser(db, { id: "bob", email: "bob@gmail.com" });
	await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"], members: ["bob"] });
	const put = (principal, settings) =>
		request(env, { method: "PUT", path: "/api/v1/mailboxes/ada@inboxies.email", principal, body: { settings } });
	const stored = () => JSON.parse(bucket.store.get(mailboxMetadataKey("ada@inboxies.email")));

	// Saving something else leaves Screener on and releases nothing.
	assert.equal((await put(principalFor(ada), { fromName: "Ada" })).status, 200);
	assert.equal(released.length, 0);
	assert.equal(parseScreenerEnabled(stored()), true);

	// Bad value refused.
	assert.equal((await put(principalFor(ada), { screener: { enabled: "no" } })).status, 400);

	// Off (members may change it too): saved and the queue is released.
	const off = await put(principalFor(bob), { screener: { enabled: false } });
	assert.equal(off.status, 200);
	assert.equal(off.payload.settings.screener.enabled, false);
	assert.equal(stored().screener.enabled, false);
	assert.equal(released.length, 1);

	// A later save that omits `screener` keeps it off and releases nothing again.
	assert.equal((await put(principalFor(ada), { fromName: "Ada L" })).status, 200);
	assert.equal(stored().screener.enabled, false);
	assert.equal(released.length, 1);

	// Back on: only new mail is screened; nothing moves.
	assert.equal((await put(principalFor(ada), { screener: { enabled: true } })).status, 200);
	assert.equal(stored().screener.enabled, true);
	assert.equal(released.length, 1);
}

console.log("screener-toggle tests passed");
