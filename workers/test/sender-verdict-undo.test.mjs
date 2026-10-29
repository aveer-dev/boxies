/**
 * AVE-98: retroactive rescue and refile, with Undo
 * (docs/spam-management-plan.md §5 "What the actions write", §7, §10
 * decision 2). Not spam rescues the sender's other Spam from the last 30
 * days to their classified folder; Report spam moves their Inbox /
 * Promotions / Updates mail to Spam (unless `refileSender: false`); the move
 * response carries `rescuedCount` + `undoToken`; `POST sender-rules/undo`
 * restores the rule, triage, preference and folders.
 * Runs the real MailboxDO migrations on node:sqlite.
 * Run: pnpm test:unit sender-verdict-undo
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import { MAILBOX_PURGE_TABLES } from "../lib/mailbox-purge.ts";
import { clearAddressBlockRule, setAddressSenderRule } from "../lib/sender-rules.ts";
import {
	RESCUE_WINDOW_DAYS,
	UNDO_TTL_MS,
	captureSenderVerdictState,
	finishSenderVerdict,
	planSpamRefile,
	planSpamRescue,
	rescueFolderFor,
	undoSenderVerdict,
} from "../lib/sender-verdict-undo.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const MAILBOX = "ada@inboxies.email";
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

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
	return sql;
}

function putEmail(sql, { id, folder, sender, date = daysAgo(1), headers = null, authTier = "verified", reason = null, replyLater = 0 }) {
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, raw_headers, auth_tier, classification_reason, reply_later, reply_later_at)
		 VALUES (?, ?, 'Hi', ?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		folder,
		sender,
		MAILBOX,
		date,
		headers ? JSON.stringify(headers) : null,
		authTier,
		reason,
		replyLater,
		replyLater ? "2026-11-01T09:00:00.000Z" : null,
	);
}

const folderOf = (sql, id) => sql.exec(`SELECT folder_id FROM emails WHERE id = ?`, id)[0]?.folder_id;
const replyLaterOf = (sql, id) => Number(sql.exec(`SELECT reply_later FROM emails WHERE id = ?`, id)[0]?.reply_later);
const plain = (row) => (row ? { ...row } : null);
const ruleOf = (sql, value) => plain(
	sql.exec(`SELECT verdict, source FROM sender_rules WHERE kind = 'address' AND value = ?`, value)[0]);
const triageOf = (sql, sender) => sql.exec(`SELECT * FROM sender_triage WHERE sender = ?`, sender)[0] ?? null;
const prefOf = (sql, address) => sql.exec(`SELECT * FROM sender_preferences WHERE address = ?`, address)[0] ?? null;

// ── Migration ────────────────────────────────────────────────────
{
	const names = mailboxMigrations.map((m) => m.name);
	assert.ok(names.includes("40_sender_verdict_undo"));
	assert.ok(names.indexOf("40_sender_verdict_undo") > names.indexOf("39_email_summaries"));
	assert.ok(MAILBOX_PURGE_TABLES.includes("sender_verdict_undo"), "a mailbox purge empties undo records");
}

// ── rescueFolderFor: preference, then Screener destination, then headers, then Inbox ──
{
	assert.equal(rescueFolderFor({ preferenceFolderId: "updates", triageDestination: "promotions" }), "updates");
	assert.equal(rescueFolderFor({ triageDestination: "promotions" }), "promotions");
	assert.equal(
		rescueFolderFor({ rawHeaders: JSON.stringify([{ key: "List-Unsubscribe", value: "<https://x.example/u>" }]), subject: "Sale" }),
		"promotions",
		"bulk mail goes back to its bulk box",
	);
	assert.equal(
		rescueFolderFor({
			rawHeaders: JSON.stringify([
				{ key: "X-Spam-Flag", value: "YES" },
				{ key: "Auto-Submitted", value: "auto-generated" },
			]),
		}),
		"updates",
		"spam headers are ignored when finding the classified folder",
	);
	assert.equal(rescueFolderFor({ rawHeaders: null }), "inbox");
	assert.equal(rescueFolderFor({ preferenceFolderId: "archive" }), "inbox", "only purpose boxes count");
}

// ── Not spam: rescue the sender's recent Spam, then Undo ─────────
{
	const sql = mailboxDb();
	const sender = "news@shop.example";
	putEmail(sql, { id: "primary", folder: "spam", sender });
	putEmail(sql, { id: "recent", folder: "spam", sender: `Shop News <News@Shop.example>`, date: daysAgo(3) });
	putEmail(sql, { id: "old", folder: "spam", sender, date: daysAgo(RESCUE_WINDOW_DAYS + 2) });
	putEmail(sql, { id: "spoofed", folder: "spam", sender, authTier: "failed", reason: "auth-failed" });
	putEmail(sql, { id: "other-sender", folder: "spam", sender: "someone@else.example" });
	putEmail(sql, { id: "lookalike", folder: "spam", sender: "newsXshop.example@evil.example" });
	putEmail(sql, { id: "already-inbox", folder: "inbox", sender });
	// Before: the sender was rejected with a block rule.
	sql.exec(
		`INSERT INTO sender_triage (sender, status, destination_folder_id, display_name, decided_at, updated_at)
		 VALUES (?, 'rejected', NULL, 'Shop', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
		sender,
	);
	setAddressSenderRule(sql, sender, "block", "report_spam", "2026-01-02T00:00:00.000Z");
	const blockRuleId = sql.exec(`SELECT id FROM sender_rules WHERE value = ?`, sender)[0].id;

	const state = captureSenderVerdictState(sql, "Shop <NEWS@shop.example>");
	assert.equal(state.sender, sender);
	assert.equal(state.triage.status, "rejected");
	assert.equal(state.addressRule.verdict, "block");
	assert.equal(state.preference, null);

	// The verdict (recordSenderAllow into Inbox), as the DO would write it.
	sql.exec(`UPDATE emails SET folder_id = 'inbox' WHERE id = 'primary'`);
	sql.exec(
		`UPDATE sender_triage SET status = 'allowed', destination_folder_id = 'inbox', updated_at = ? WHERE sender = ?`,
		daysAgo(0),
		sender,
	);
	sql.exec(
		`INSERT INTO sender_preferences (address, folder_id, display_name, source, updated_at) VALUES (?, 'inbox', NULL, 'user', ?)`,
		sender,
		daysAgo(0),
	);
	setAddressSenderRule(sql, sender, "allow", "not_spam");

	assert.deepEqual(
		planSpamRescue(sql, sender, { excludeId: "primary", now: NOW }).map((m) => m.id),
		["recent"],
		"only this sender's Spam from the last 30 days that passed auth",
	);

	const { rescued, undoToken } = finishSenderVerdict(
		sql,
		{ kind: "allow", state, primary: { id: "primary", from: "spam", to: "inbox" }, refile: true },
		{ now: NOW },
	);
	assert.equal(rescued.length, 1);
	assert.ok(undoToken);
	assert.equal(folderOf(sql, "recent"), "inbox", "rescued to the sender's box");
	assert.equal(folderOf(sql, "old"), "spam", "older than 30 days stays");
	assert.equal(folderOf(sql, "spoofed"), "spam", "auth-failed mail stays in Spam");
	assert.equal(folderOf(sql, "other-sender"), "spam");
	assert.equal(folderOf(sql, "lookalike"), "spam");

	const undone = undoSenderVerdict(sql, undoToken, { now: NOW + 5_000 });
	assert.equal(undone.sender, sender);
	assert.equal(undone.reverted.length, 2, "the primary and the rescued message");
	assert.equal(folderOf(sql, "primary"), "spam");
	assert.equal(folderOf(sql, "recent"), "spam");
	assert.equal(folderOf(sql, "already-inbox"), "inbox", "mail the verdict didn't move stays put");
	assert.deepEqual(ruleOf(sql, sender), { verdict: "block", source: "report_spam" }, "the old block is back");
	assert.equal(sql.exec(`SELECT id FROM sender_rules WHERE value = ?`, sender)[0].id, blockRuleId);
	const triage = triageOf(sql, sender);
	assert.equal(triage.status, "rejected");
	assert.equal(triage.destination_folder_id, null);
	assert.equal(triage.updated_at, "2026-01-02T00:00:00.000Z");
	assert.equal(prefOf(sql, sender), null, "the purpose box Not spam added is gone");

	assert.equal(undoSenderVerdict(sql, undoToken, { now: NOW + 6_000 }), null, "a token works once");
}

// ── Not spam for a sender with no history: Undo deletes the new rule ──
{
	const sql = mailboxDb();
	const sender = "new@acme.example";
	putEmail(sql, { id: "a", folder: "spam", sender });
	putEmail(sql, {
		id: "b",
		folder: "spam",
		sender,
		headers: [{ key: "List-Unsubscribe", value: "<https://acme.example/u>" }],
	});
	const state = captureSenderVerdictState(sql, sender);
	assert.deepEqual(state, { sender, triage: null, preference: null, addressRule: null });
	// Not spam into Archive: implicit trust, no purpose box.
	sql.exec(`UPDATE emails SET folder_id = 'archive' WHERE id = 'a'`);
	sql.exec(
		`INSERT INTO sender_triage (sender, status, destination_folder_id, display_name, decided_at, updated_at)
		 VALUES (?, 'allowed', NULL, NULL, ?, ?)`,
		sender,
		daysAgo(0),
		daysAgo(0),
	);
	const { rescued, undoToken } = finishSenderVerdict(
		sql,
		{ kind: "allow", state, primary: { id: "a", from: "spam", to: "archive" }, refile: true },
		{ now: NOW },
	);
	assert.deepEqual(rescued.map((m) => [m.id, m.to]), [["b", "promotions"]], "no box: the headers decide");
	// The user moves the rescued message again before undoing: that move wins.
	sql.exec(`UPDATE emails SET folder_id = 'archive' WHERE id = 'b'`);
	setAddressSenderRule(sql, sender, "allow", "not_spam");
	const undone = undoSenderVerdict(sql, undoToken, { now: NOW });
	assert.deepEqual(undone.reverted.map((m) => m.id), ["a"]);
	assert.equal(folderOf(sql, "a"), "spam");
	assert.equal(folderOf(sql, "b"), "archive");
	assert.equal(triageOf(sql, sender), null, "no triage row before, none after");
	assert.equal(ruleOf(sql, sender), null, "no rule before, none after");
}

// ── Report spam: refile the sender's purpose-box mail, then Undo ──
{
	const sql = mailboxDb();
	const sender = "promo@deals.example";
	putEmail(sql, { id: "r1", folder: "inbox", sender, replyLater: 1 });
	putEmail(sql, { id: "r2", folder: "inbox", sender, replyLater: 1 });
	putEmail(sql, { id: "r3", folder: "promotions", sender, date: daysAgo(400) });
	putEmail(sql, { id: "r4", folder: "updates", sender });
	putEmail(sql, { id: "r5", folder: "archive", sender });
	putEmail(sql, { id: "r6", folder: "inbox", sender: "friend@deals.example" });
	sql.exec(
		`INSERT INTO sender_preferences (address, folder_id, display_name, source, updated_at) VALUES (?, 'promotions', 'Deals', 'user', '2026-02-01T00:00:00.000Z')`,
		sender,
	);
	const state = captureSenderVerdictState(sql, sender);
	assert.equal(state.preference.folder_id, "promotions");
	assert.deepEqual(
		planSpamRefile(sql, sender, { excludeId: "r1" }).map((m) => m.id).sort(),
		["r2", "r3", "r4"],
		"Inbox / Promotions / Updates, any age; not Archive, not other senders",
	);

	// The verdict (recordSenderBlock), as the DO would write it.
	sql.exec(`UPDATE emails SET folder_id = 'spam', reply_later = 0, reply_later_at = NULL WHERE id = 'r1'`);
	sql.exec(
		`INSERT INTO sender_triage (sender, status, destination_folder_id, display_name, decided_at, updated_at)
		 VALUES (?, 'rejected', NULL, NULL, ?, ?)`,
		sender,
		daysAgo(0),
		daysAgo(0),
	);
	sql.exec(`DELETE FROM sender_preferences WHERE address = ?`, sender);
	setAddressSenderRule(sql, sender, "block", "report_spam");

	const { rescued, undoToken } = finishSenderVerdict(
		sql,
		{
			kind: "block",
			state,
			primary: { id: "r1", from: "inbox", to: "spam", replyLater: true, replyLaterAt: "2026-11-01T09:00:00.000Z" },
			refile: true,
		},
		{ now: NOW },
	);
	assert.equal(rescued.length, 3);
	for (const id of ["r1", "r2", "r3", "r4"]) assert.equal(folderOf(sql, id), "spam", id);
	assert.equal(folderOf(sql, "r5"), "archive");
	assert.equal(folderOf(sql, "r6"), "inbox");
	assert.equal(replyLaterOf(sql, "r2"), 0, "into Spam clears Reply later");
	const retention = sql.exec(`SELECT retention_since FROM emails WHERE id = 'r2'`)[0].retention_since;
	assert.ok(retention, "the retention clock starts for refiled mail");

	undoSenderVerdict(sql, undoToken, { now: NOW });
	assert.equal(folderOf(sql, "r1"), "inbox");
	assert.equal(folderOf(sql, "r2"), "inbox");
	assert.equal(folderOf(sql, "r3"), "promotions");
	assert.equal(folderOf(sql, "r4"), "updates");
	assert.equal(replyLaterOf(sql, "r1"), 1, "Reply later is back on the primary");
	assert.equal(replyLaterOf(sql, "r2"), 1, "and on refiled mail");
	assert.equal(sql.exec(`SELECT retention_since FROM emails WHERE id = 'r2'`)[0].retention_since, null);
	assert.equal(triageOf(sql, sender), null);
	assert.equal(ruleOf(sql, sender), null);
	assert.equal(prefOf(sql, sender).folder_id, "promotions", "the purpose box is back");
}

// ── Report spam with the checkbox unticked: nothing else moves ──
{
	const sql = mailboxDb();
	const sender = "x@y.example";
	putEmail(sql, { id: "p", folder: "spam", sender });
	putEmail(sql, { id: "q", folder: "inbox", sender });
	const state = captureSenderVerdictState(sql, sender);
	const { rescued, undoToken } = finishSenderVerdict(
		sql,
		{ kind: "block", state, primary: { id: "p", from: "inbox", to: "spam" }, refile: false },
		{ now: NOW },
	);
	assert.equal(rescued.length, 0);
	assert.equal(folderOf(sql, "q"), "inbox");
	assert.ok(undoToken, "Undo still covers the rule and the message itself");
}

// ── Tokens expire, and only the newest verdict per sender can be undone ──
{
	const sql = mailboxDb();
	const sender = "z@y.example";
	putEmail(sql, { id: "e", folder: "inbox", sender });
	const first = finishSenderVerdict(
		sql,
		{ kind: "allow", state: captureSenderVerdictState(sql, sender), primary: { id: "e", from: "spam", to: "inbox" }, refile: true },
		{ now: NOW },
	);
	const second = finishSenderVerdict(
		sql,
		{ kind: "block", state: captureSenderVerdictState(sql, sender), primary: { id: "e", from: "inbox", to: "spam" }, refile: false },
		{ now: NOW + 1_000 },
	);
	assert.equal(undoSenderVerdict(sql, first.undoToken, { now: NOW + 2_000 }), null, "superseded");
	assert.equal(undoSenderVerdict(sql, second.undoToken, { now: NOW + 1_000 + UNDO_TTL_MS }), null, "expired");
	assert.equal(Number(sql.exec(`SELECT COUNT(*) AS n FROM sender_verdict_undo`)[0].n), 0, "expired rows are swept");
}

// ── HTTP: the move response and POST sender-rules/undo ───────────

/** A mailbox DO double backed by the real schema on node:sqlite. */
function sqliteMailbox() {
	const sql = mailboxDb();
	const triage = (sender) => triageOf(sql, sender.trim().toLowerCase());
	const finishCalls = [];
	const stub = {
		getEmail: async (id) => {
			const row = sql.exec(`SELECT * FROM emails WHERE id = ?`, id)[0];
			return row ? { ...row, reply_later: Boolean(row.reply_later), sender_name: null } : null;
		},
		moveEmail: async (id, folderId) => {
			const updated = sql.exec(
				folderId === "spam"
					? `UPDATE emails SET folder_id = ?, reply_later = 0, reply_later_at = NULL WHERE id = ? RETURNING id`
					: `UPDATE emails SET folder_id = ? WHERE id = ? RETURNING id`,
				folderId,
				id,
			);
			return updated.length > 0;
		},
		getSenderTriage: async (sender) => triage(sender),
		upsertSenderTriage: async (row) => {
			const now = new Date().toISOString();
			sql.exec(
				`INSERT INTO sender_triage (sender, status, destination_folder_id, display_name, decided_at, updated_at)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
				 ON CONFLICT(sender) DO UPDATE SET status = ?2, destination_folder_id = ?3, updated_at = ?5`,
				row.sender,
				row.status,
				row.status === "allowed" ? row.destination_folder_id ?? null : null,
				row.display_name ?? null,
				now,
			);
			return triage(row.sender);
		},
		getSenderPreference: async (address) => {
			const row = prefOf(sql, address);
			return row ? { address: row.address, folderId: row.folder_id, source: row.source } : null;
		},
		upsertSenderPreference: async (input) => {
			sql.exec(
				`INSERT OR REPLACE INTO sender_preferences (address, folder_id, display_name, source, updated_at) VALUES (?, ?, NULL, ?, ?)`,
				input.address,
				input.folderId,
				input.source ?? "user",
				new Date().toISOString(),
			);
			return { preference: { address: input.address, folderId: input.folderId }, refiledCount: 0 };
		},
		deleteSenderPreference: async (address) =>
			sql.exec(`DELETE FROM sender_preferences WHERE address = ? RETURNING address`, address).length > 0,
		setAddressSenderRule: async (sender, verdict, source) => setAddressSenderRule(sql, sender, verdict, source)?.rule ?? null,
		clearAddressBlockRule: async (sender) => clearAddressBlockRule(sql, sender) !== null,
		captureSenderVerdictState: async (sender) => captureSenderVerdictState(sql, sender),
		finishSenderVerdict: async (input) => {
			finishCalls.push(input);
			const { rescued, undoToken } = finishSenderVerdict(sql, input);
			return { rescuedCount: rescued.length, undoToken };
		},
		undoSenderVerdict: async (token) => {
			const result = undoSenderVerdict(sql, token);
			return result ? { sender: result.sender, kind: result.kind, restoredCount: result.reverted.length } : null;
		},
	};
	return { sql, stub, finishCalls };
}

{
	const mailbox = sqliteMailbox();
	const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mockMailboxNamespace(mailbox.stub) });
	const ada = await addUser(db, { id: "ada", email: MAILBOX });
	await addMailbox(db, bucket, MAILBOX, { owners: ["ada"] });
	const asAda = principalFor(ada);
	const move = (id, body) =>
		request(env, { method: "POST", path: `/api/v1/mailboxes/${MAILBOX}/emails/${id}/move`, principal: asAda, body });
	const undo = (body) =>
		request(env, { method: "POST", path: `/api/v1/mailboxes/${MAILBOX}/sender-rules/undo`, principal: asAda, body });

	const { sql } = mailbox;
	const sender = "ops@vendor.example";
	const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
	putEmail(sql, { id: "n1", folder: "spam", sender, date: recent });
	putEmail(sql, { id: "n2", folder: "spam", sender, date: recent });
	putEmail(sql, { id: "n3", folder: "spam", sender, date: recent });

	// Not spam on one message rescues the sender's recent Spam.
	const res = await move("n1", { folderId: "inbox", setSenderPreference: true });
	assert.equal(res.status, 200);
	assert.equal(res.payload.senderStatus, "allowed");
	assert.equal(res.payload.rescuedCount, 2, "· 2 more moved");
	assert.equal(typeof res.payload.undoToken, "string");
	for (const id of ["n1", "n2", "n3"]) assert.equal(folderOf(sql, id), "inbox");
	assert.deepEqual(ruleOf(sql, sender), { verdict: "allow", source: "not_spam" });

	// Undo restores both the rule and the folders.
	const undone = await undo({ undoToken: res.payload.undoToken });
	assert.equal(undone.status, 200);
	assert.deepEqual(undone.payload, { status: "undone", restoredCount: 3 });
	for (const id of ["n1", "n2", "n3"]) assert.equal(folderOf(sql, id), "spam");
	assert.equal(ruleOf(sql, sender), null);
	assert.equal(triageOf(sql, sender), null);
	assert.equal(prefOf(sql, sender), null);

	const again = await undo({ undoToken: res.payload.undoToken });
	assert.equal(again.status, 404);
	assert.equal(again.payload.code, "undo_expired");
	assert.equal((await undo({})).status, 400);

	// Report spam: refiles by default, not when the checkbox is unticked.
	putEmail(sql, { id: "s1", folder: "inbox", sender: "spam@junk.example" });
	putEmail(sql, { id: "s2", folder: "updates", sender: "spam@junk.example" });
	const unticked = await move("s1", { folderId: "spam", setSenderPreference: true, refileSender: false });
	assert.equal(unticked.payload.senderStatus, "rejected");
	assert.equal(unticked.payload.rescuedCount, 0);
	assert.equal(folderOf(sql, "s2"), "updates");
	await undo({ undoToken: unticked.payload.undoToken });
	assert.equal(folderOf(sql, "s1"), "inbox");

	const ticked = await move("s1", { folderId: "spam" });
	assert.equal(ticked.payload.rescuedCount, 1, "swipe / move menu into Spam refiles too");
	assert.equal(folderOf(sql, "s2"), "spam");

	// Moves that don't cross Spam stay as they were: no token.
	putEmail(sql, { id: "plain", folder: "inbox", sender: "pal@friends.example" });
	const plain = await move("plain", { folderId: "archive" });
	assert.equal(plain.payload.undoToken, undefined);
	assert.equal(mailbox.finishCalls.length, 3, "one per Spam verdict");
}

console.log("sender-verdict-undo tests passed");
