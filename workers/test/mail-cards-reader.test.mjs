/**
 * Reader cards on the real MailboxDO (AVE-175): migration 46 adds
 * `otp_code` / `calendar_invite`, and thread reads return them as `otp` /
 * `invite`, except in Spam or when the sender failed authentication.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mail-cards-reader.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MailboxDO } from "../durableObject/index.ts";

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
const bucket = { get: async () => null, head: async () => null, put: async () => {}, delete: async () => {} };
const mailbox = new MailboxDO({ storage, id: { toString: () => "test" } }, { BUCKET: bucket });

const invite = {
	method: "REQUEST",
	status: null,
	cancelled: false,
	uid: "design-review@example.com",
	sequence: null,
	title: "Design review",
	start: "2026-11-05T15:00:00.000Z",
	end: "2026-11-05T16:00:00.000Z",
	allDay: false,
	timezone: "America/New_York",
	location: null,
	organizer: { email: "pat@sender.example", name: "Pat" },
	meetingUrl: "https://meet.google.com/abc-defg-hij",
	recurrence: null,
	description: null,
};

const insert = db.prepare(
	`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, thread_id, read, snippet, auth_tier, otp_code, calendar_invite)
	 VALUES (?, ?, ?, 'pat@sender.example', 'ada@example.com', ?, 't1', 0, '', ?, ?, ?)`,
);
insert.run("code", "inbox", "Your code", "2026-11-01T10:00:00Z", "verified", "482913", null);
insert.run("invite", "inbox", "Invitation", "2026-11-01T11:00:00Z", "unverified", null, JSON.stringify(invite));
insert.run("plain", "inbox", "Hi", "2026-11-01T12:00:00Z", "verified", null, null);
insert.run("corrupt", "inbox", "Hi", "2026-11-01T13:00:00Z", "verified", null, "{not json");

const byId = async () => Object.fromEntries((await mailbox.getThreadEmails("t1")).map((e) => [e.id, e]));

{
	const rows = await byId();
	assert.deepEqual(rows.code.otp, { code: "482913" });
	assert.equal(rows.code.invite, null);
	// Organizer is the From itself (AVE-220).
	assert.deepEqual(rows.invite.invite, { ...invite, organizerMatchesSender: true });
	assert.equal(rows.invite.otp, null);
	assert.equal(rows.plain.otp, null);
	assert.equal(rows.plain.invite, null);
	assert.equal(rows.corrupt.invite, null);
	// The raw columns stay internal.
	assert.equal("otp_code" in rows.code, false);
	assert.equal("calendar_invite" in rows.invite, false);
}

// AVE-220: an unverified stranger naming someone else as organizer.
insert.run(
	"stranger", "inbox", "Invitation", "2026-11-01T14:00:00Z", "unverified", null,
	JSON.stringify({ ...invite, organizer: { email: "ceo@example.com", name: "CEO" } }),
);
{
	const rows = await byId();
	assert.equal(rows.stranger.invite.organizerMatchesSender, false);
	assert.deepEqual(rows.stranger.invite.organizer, { email: "ceo@example.com", name: "CEO" });
}
db.exec(`DELETE FROM emails WHERE id = 'stranger'`);

// Moved to Spam: no cards. Back out: they return.
db.exec(`UPDATE emails SET folder_id = 'spam' WHERE id IN ('code', 'invite')`);
{
	const rows = await byId();
	assert.equal(rows.code.otp, null);
	assert.equal(rows.invite.invite, null);
}
db.exec(`UPDATE emails SET folder_id = 'inbox' WHERE id IN ('code', 'invite')`);
assert.deepEqual((await byId()).code.otp, { code: "482913" });

// Failed sender authentication: no cards wherever it is filed.
db.exec(`UPDATE emails SET auth_tier = 'failed' WHERE id IN ('code', 'invite')`);
{
	const rows = await byId();
	assert.equal(rows.code.otp, null);
	assert.equal(rows.invite.invite, null);
}

console.log("mail-cards-reader: ok");
