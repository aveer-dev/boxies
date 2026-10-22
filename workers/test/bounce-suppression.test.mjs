/**
 * Bounce suppression list + inbound DSNs (AVE-37).
 *
 * - Email Sending events: hard bounces and complaints suppress the recipient
 *   for the sending domain; soft bounces, failures and deferrals don't.
 * - The `email_suppression` table (migrations/auth on node:sqlite): upsert,
 *   complaint precedence, `private.` folding, fail-open without the table.
 * - HTTP: send / reply / forward to a suppressed recipient is a 409
 *   `recipient_suppressed` with nothing stored or sent; list and un-suppress
 *   are scoped to the mailbox's own rows, or the whole domain for its admins.
 * - Inbound DSNs: parsing, matched reports update the Sent row and are
 *   archived in its thread, unmatched reports file as normal mail.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/bounce-suppression.test.mjs
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	applyEmailSendingEvent,
	isHardBounce,
	suppressionFromEmailSendingEvent,
} from "../lib/email-sending-events.ts";
import {
	checkOutboundSuppression,
	deleteSuppression,
	findSuppressedRecipients,
	isPermanentRecipientStatus,
	recordSuppression,
	suppressionDomainFor,
	RECIPIENT_SUPPRESSED_CODE,
} from "../lib/email-suppression.ts";
import {
	applyInboundDsn,
	dsnRecipientOutcome,
	parseDeliveryStatusReport,
} from "../lib/inbound-dsn.ts";
import {
	abandonInboundDelivery,
	claimInboundMessage,
	completeInboundMessageClaim,
} from "../lib/inbound-claims.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { authDb as makeAuthDb } from "../auth/authz.ts";
import { createTestD1 } from "./d1-shim.mjs";
import {
	addDomain,
	addMailbox,
	addUser,
	createAuthTestEnv,
	flushWaitUntil,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";
import { receiveEmail } from "../index.ts";

const quiet = async (fn) => {
	const { log, error, warn } = console;
	console.log = () => {};
	console.error = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.log = log;
		console.error = error;
		console.warn = warn;
	}
};

// ── Event → suppression mapping ──────────────────────────────────
{
	const bounced = (bounce, delivery = {}) => ({
		type: "cf.email.sending.message.bounced",
		payload: {
			eventId: "evt-1",
			messageId: "prov-1",
			sender: "Ada@Acme.test",
			recipient: "Gone@Example.net",
			delivery,
			bounce,
		},
	});

	const hard = suppressionFromEmailSendingEvent(
		bounced({ type: "hard", classification: "permanent_failure", reason: "550 5.1.1 User unknown" }),
	);
	assert.deepEqual(hard, {
		recipient: "gone@example.net",
		sender: "ada@acme.test",
		eventId: "evt-1",
		providerMessageId: "prov-1",
		reason: "hard_bounce",
		detail: "550 5.1.1 User unknown",
	});

	// Soft bounce (retries exhausted) is ignored, whatever the SMTP code says.
	assert.equal(
		suppressionFromEmailSendingEvent(bounced({ type: "soft", classification: "temporary_failure" }, { smtpEnhancedStatusCode: "5.1.1" })),
		null,
	);
	// No type: fall back to recipient-level permanent codes only.
	assert.equal(suppressionFromEmailSendingEvent(bounced({}, { smtpEnhancedStatusCode: "5.1.1" }))?.reason, "hard_bounce");
	assert.equal(suppressionFromEmailSendingEvent(bounced({ reason: "550 5.7.1 spam" })), null, "policy rejection");
	assert.equal(suppressionFromEmailSendingEvent(bounced({ reason: "552 5.2.2 mailbox full" })), null, "quota");
	assert.equal(suppressionFromEmailSendingEvent(bounced({ reason: "550 user unknown" })), null, "no status code");

	const complaint = suppressionFromEmailSendingEvent({
		type: "cf.email.sending.message.complained",
		payload: { messageId: "prov-2", sender: "ada@acme.test", recipient: "pat@example.net", complaint: { type: "abuse" } },
	});
	assert.equal(complaint?.reason, "complaint");
	assert.equal(complaint?.detail, "abuse");

	for (const type of ["failed", "rejected", "deferred", "delivered"]) {
		assert.equal(
			suppressionFromEmailSendingEvent({
				type: `cf.email.sending.message.${type}`,
				payload: { messageId: "p", sender: "ada@acme.test", recipient: "x@example.net", bounce: { type: "hard" } },
			}),
			null,
			`${type} never suppresses`,
		);
	}
	// Missing recipient: nothing to suppress.
	assert.equal(
		suppressionFromEmailSendingEvent({ type: "cf.email.sending.message.complained", payload: { messageId: "p", sender: "a@b.c" } }),
		null,
	);

	assert.equal(isHardBounce({ bounce: { classification: "permanent_failure" } }), true);
	assert.equal(isPermanentRecipientStatus("5.1.1"), true);
	assert.equal(isPermanentRecipientStatus("5.1.10"), true);
	assert.equal(isPermanentRecipientStatus("5.2.1"), true);
	assert.equal(isPermanentRecipientStatus("5.4.4"), true);
	for (const code of ["4.2.2", "5.2.2", "5.2.3", "5.3.4", "5.6.0", "5.7.1", "", null]) {
		assert.equal(isPermanentRecipientStatus(code), false, `not permanent: ${code}`);
	}
	assert.equal(suppressionDomainFor("Ada <ada@private.acme.test>"), "acme.test");
	assert.equal(suppressionDomainFor("ada@acme.test"), "acme.test");
	assert.equal(suppressionDomainFor("nope"), null);
}

// ── applyEmailSendingEvent records suppressions ──────────────────
{
	const recorded = [];
	const updates = [];
	const stub = {
		findEmailByProviderMessageId: async () => ({ id: "sent-1" }),
		setDeliveryState: async (id, state) => updates.push({ id, state }),
	};
	const event = (type, extra = {}) => ({
		type: `cf.email.sending.message.${type}`,
		payload: { messageId: "prov-9", sender: "ada@acme.test", recipient: "gone@example.net", ...extra },
	});

	assert.equal(
		await applyEmailSendingEvent(event("bounced", { bounce: { type: "hard" } }), () => stub, async (s) => recorded.push(s)),
		true,
	);
	assert.equal(recorded.length, 1);
	assert.equal(recorded[0].reason, "hard_bounce");
	assert.equal(updates.at(-1).state.status, "bounced", "Sent row still stamped");

	await applyEmailSendingEvent(event("complained"), () => stub, async (s) => recorded.push(s));
	assert.equal(recorded.at(-1).reason, "complaint");

	await applyEmailSendingEvent(event("bounced", { bounce: { type: "soft" } }), () => stub, async (s) => recorded.push(s));
	assert.equal(recorded.length, 2, "soft bounce not suppressed");
	assert.equal(updates.at(-1).state.status, "bounced", "but the Sent row is still updated");

	// A failing recorder never blocks the delivery update.
	const before = updates.length;
	const ok = await quiet(() =>
		applyEmailSendingEvent(event("bounced", { bounce: { type: "hard" } }), () => stub, async () => {
			throw new Error("d1 down");
		}),
	);
	assert.equal(ok, true);
	assert.equal(updates.length, before + 1);
}

// ── D1 table ─────────────────────────────────────────────────────
{
	const d1 = createTestD1();
	const db = makeAuthDb(d1);
	await quiet(async () => {
		assert.equal(
			await recordSuppression(db, {
				domain: "private.acme.test",
				recipient: "Gone <GONE@example.net>",
				reason: "hard_bounce",
				source: "email_sending_event",
				sourceMailboxId: "ada@acme.test",
				sourceEventId: "evt-1",
			}),
			true,
		);
		// Complaint upgrades; a later hard bounce doesn't downgrade it.
		await recordSuppression(db, { domain: "acme.test", recipient: "gone@example.net", reason: "complaint", source: "email_sending_event" });
		await recordSuppression(db, { domain: "acme.test", recipient: "gone@example.net", reason: "hard_bounce", source: "inbound_dsn" });
	});
	const rows = await findSuppressedRecipients(db, "acme.test", ["gone@example.net", "fine@example.net"]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].domain, "acme.test", "private. folded into the domain");
	assert.equal(rows[0].recipient, "gone@example.net");
	assert.equal(rows[0].reason, "complaint");
	assert.equal((await findSuppressedRecipients(db, "other.test", ["gone@example.net"])).length, 0, "per domain");

	const blocked = await checkOutboundSuppression(db, {
		fromEmail: "ada@private.acme.test",
		mailboxId: "ada@acme.test",
		to: ["fine@example.net"],
		bcc: "GONE@example.net",
	});
	assert.equal(blocked.code, RECIPIENT_SUPPRESSED_CODE);
	assert.equal(blocked.suppressed[0].address, "gone@example.net");
	assert.equal(blocked.suppressed[0].reason, "complaint");
	assert.match(blocked.error, /gone@example\.net marked earlier mail as spam on \d{4}-\d{2}-\d{2}/);
	assert.equal(await checkOutboundSuppression(db, { fromEmail: "ada@acme.test", mailboxId: "ada@acme.test", to: "fine@example.net" }), null);

	assert.equal(await deleteSuppression(db, "acme.test", "gone@example.net"), true);
	assert.equal(await deleteSuppression(db, "acme.test", "gone@example.net"), false);
	assert.equal((await findSuppressedRecipients(db, "acme.test", ["gone@example.net"])).length, 0);

	// Before the migration is applied: everything fails open.
	d1.sqlite.exec("DROP TABLE email_suppression");
	await quiet(async () => {
		assert.deepEqual(await findSuppressedRecipients(db, "acme.test", ["gone@example.net"]), []);
		assert.equal(
			await recordSuppression(db, { domain: "acme.test", recipient: "gone@example.net", reason: "hard_bounce", source: "inbound_dsn" }),
			false,
		);
		assert.equal(await checkOutboundSuppression(db, { fromEmail: "ada@acme.test", mailboxId: "ada@acme.test", to: "gone@example.net" }), null);
	});
}

// ── HTTP: send blocked, list, un-suppress ────────────────────────
{
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
	const created = [];
	let slots = 0;
	const stubExtras = {
		getEmail: async (id) =>
			id === "orig"
				? {
						id: "orig",
						folder_id: "inbox",
						subject: "Hi",
						sender: "pat@example.net",
						recipient: "bob@acme.test",
						date: "2026-01-01T00:00:00Z",
						message_id: "orig@example.net",
						thread_id: "orig@example.net",
					}
				: null,
		checkSendRateLimit: async () => (slots++, null),
		releaseSendSlot: async () => { slots--; },
		createEmail: async (folder, email) => {
			await tick();
			created.push({ folder, email });
			return { id: email.id, replayed: false };
		},
	};
	// Fresh sends go through the outbound-send queue (AVE-65): count enqueued messages.
	const outboundSend = {
		sent: [],
		send: async (body) => {
			outboundSend.sent.push(body);
		},
	};
	const { env, db, bucket } = createAuthTestEnv({
		MAILBOX: mockMailboxNamespace(stubExtras),
		OUTBOUND_SEND: outboundSend,
		DOMAINS: "inboxies.email",
	});
	const olivia = await addUser(db, { id: "olivia", email: "olivia@example.org" });
	const bob = await addUser(db, { id: "bob", email: "bob@example.org" });
	const carol = await addUser(db, { id: "carol", email: "carol@example.org" });
	const mallory = await addUser(db, { id: "mallory", email: "mallory@example.org" });
	await addDomain(db, bucket, { domain: "acme.test", ownerUserId: "olivia" });
	await addMailbox(db, bucket, "bob@acme.test", { owners: ["bob", "olivia"] });
	await addMailbox(db, bucket, "carol@acme.test", { owners: ["carol"] });
	await addMailbox(db, bucket, "mallory@inboxies.email", { owners: ["mallory"] });

	await recordSuppression(db, {
		domain: "acme.test", recipient: "gone@example.net", reason: "hard_bounce",
		source: "email_sending_event", sourceMailboxId: "bob@acme.test", detail: "550 5.1.1 User unknown",
	});
	await recordSuppression(db, {
		domain: "acme.test", recipient: "spam@example.net", reason: "complaint",
		source: "email_sending_event", sourceMailboxId: "carol@acme.test", detail: "abuse",
	});

	const as = (user) => principalFor(user);
	const call = (user, method, path, body) =>
		quiet(() => request(env, { method, path, principal: as(user), body }));
	const send = (user, mailbox, route, to, extra = {}) =>
		call(user, "POST", `/api/v1/mailboxes/${mailbox}${route}`, { to, from: mailbox, subject: "Hello", text: "Hi", ...extra });

	// Second send to a hard-bounced address: blocked with a reason, nothing stored or sent.
	for (const route of ["/emails", "/emails/orig/reply", "/emails/orig/forward"]) {
		const before = [created.length, outboundSend.sent.length, slots];
		const res = await send(bob, "bob@acme.test", route, ["ok@example.net"], { cc: "Gone@Example.net" });
		await flushWaitUntil();
		assert.equal(res.status, 409, `${route}: ${JSON.stringify(res.payload)}`);
		assert.equal(res.payload.code, "recipient_suppressed");
		assert.match(res.payload.error, /gone@example\.net bounced on \d{4}-\d{2}-\d{2}/);
		assert.deepEqual(Object.keys(res.payload.suppressed[0]).sort(), [
			"address", "canUnsuppress", "detail", "domain", "reason", "source", "suppressedAt",
		]);
		assert.equal(res.payload.suppressed[0].address, "gone@example.net");
		assert.equal(res.payload.suppressed[0].reason, "hard_bounce");
		assert.equal(res.payload.suppressed[0].canUnsuppress, true);
		assert.ok(!Number.isNaN(Date.parse(res.payload.suppressed[0].suppressedAt)));
		assert.deepEqual([created.length, outboundSend.sent.length, slots], before, `${route}: no row, no send, no slot`);
	}

	// The suppression is per domain: carol (same domain) is blocked too, but can't lift bob's row.
	const carolBlocked = await send(carol, "carol@acme.test", "/emails", "gone@example.net");
	assert.equal(carolBlocked.status, 409);
	assert.equal(carolBlocked.payload.suppressed[0].canUnsuppress, false);
	// Other domains are unaffected.
	const otherDomain = await send(mallory, "mallory@inboxies.email", "/emails", "gone@example.net");
	await flushWaitUntil();
	assert.equal(otherDomain.status, 202);

	// Listing: a member sees its own mailbox's rows; the domain owner sees all.
	const bobList = await call(bob, "GET", "/api/v1/mailboxes/bob@acme.test/suppressions");
	assert.equal(bobList.status, 200);
	assert.equal(bobList.payload.scope, "mailbox");
	assert.deepEqual(bobList.payload.suppressions.map((s) => s.address), ["gone@example.net"]);
	const oliviaList = await call(olivia, "GET", "/api/v1/mailboxes/bob@acme.test/suppressions");
	assert.equal(oliviaList.payload.scope, "domain");
	assert.deepEqual(oliviaList.payload.suppressions.map((s) => s.address).sort(), ["gone@example.net", "spam@example.net"]);
	assert.ok(oliviaList.payload.suppressions.every((s) => s.canUnsuppress));
	// Not a member: requireMailbox refuses before anything is read.
	assert.equal((await call(mallory, "GET", "/api/v1/mailboxes/bob@acme.test/suppressions")).status, 403);
	assert.equal((await call(mallory, "DELETE", "/api/v1/mailboxes/bob@acme.test/suppressions/gone%40example.net")).status, 403);

	// Single lookup.
	const one = await call(bob, "GET", "/api/v1/mailboxes/bob@acme.test/suppressions/GONE%40example.net");
	assert.equal(one.status, 200);
	assert.equal(one.payload.suppression.detail, "550 5.1.1 User unknown");
	assert.equal((await call(bob, "GET", "/api/v1/mailboxes/bob@acme.test/suppressions/fine%40example.net")).status, 404);

	// Un-suppress: not another mailbox's row (unless domain admin).
	const denied = await call(bob, "DELETE", "/api/v1/mailboxes/bob@acme.test/suppressions/spam%40example.net");
	assert.equal(denied.status, 403);
	assert.equal(denied.payload.code, "suppression_not_manageable");
	const own = await call(bob, "DELETE", "/api/v1/mailboxes/bob@acme.test/suppressions/gone%40example.net");
	assert.equal(own.status, 200);
	assert.deepEqual(own.payload, { ok: true, address: "gone@example.net", domain: "acme.test" });
	assert.equal((await call(bob, "DELETE", "/api/v1/mailboxes/bob@acme.test/suppressions/gone%40example.net")).status, 404);
	const adminLift = await call(olivia, "DELETE", "/api/v1/mailboxes/bob@acme.test/suppressions/spam%40example.net");
	assert.equal(adminLift.status, 200);

	// After un-suppress the send goes out.
	const sentBefore = outboundSend.sent.length;
	const retry = await send(bob, "bob@acme.test", "/emails", "gone@example.net");
	await flushWaitUntil();
	assert.equal(retry.status, 202);
	assert.equal(outboundSend.sent.length, sentBefore + 1);
}

// ── DSN parsing ──────────────────────────────────────────────────
const SENT_ID = "sent-1";
const SENT_MESSAGE_ID = "3f1c2a@acme.test";
const PROVIDER_ID = "0101018f-provider@email.cloudflare.net";

function dsn({ action = "failed", status = "5.1.1", recipient = "gone@example.net", originalId = SENT_MESSAGE_ID, messageId = "dsn-1@mx.example.net" } = {}) {
	return [
		"From: Mail Delivery System <MAILER-DAEMON@mx.example.net>",
		"To: ada@acme.test",
		"Subject: Undelivered Mail Returned to Sender",
		`Message-ID: <${messageId}>`,
		"MIME-Version: 1.0",
		"Content-Type: multipart/report; report-type=delivery-status;",
		'\tboundary="RPT.b1"',
		"",
		"This is a MIME-encapsulated message.",
		"",
		"--RPT.b1",
		"Content-Type: text/plain; charset=us-ascii",
		"",
		`I'm sorry to have to inform you that your message could not be delivered to ${recipient}.`,
		"",
		"--RPT.b1",
		"Content-Type: message/delivery-status",
		"",
		"Reporting-MTA: dns; mx.example.net",
		"Arrival-Date: Mon, 19 Oct 2026 10:00:00 +0000",
		"",
		`Final-Recipient: rfc822; ${recipient}`,
		`Original-Recipient: rfc822;${recipient}`,
		`Action: ${action}`,
		`Status: ${status}`,
		"Diagnostic-Code: smtp; 550 5.1.1 <gone@example.net>: Recipient address",
		"    rejected: User unknown",
		"",
		"--RPT.b1",
		"Content-Type: text/rfc822-headers",
		"",
		"From: Ada <ada@acme.test>",
		"To: gone@example.net",
		"Subject: Hello",
		`Message-ID: <${originalId}>`,
		"",
		"--RPT.b1--",
		"",
	].join("\r\n");
}

{
	const report = parseDeliveryStatusReport(new TextEncoder().encode(dsn()));
	assert.ok(report);
	assert.deepEqual(report.recipients, [
		{
			recipient: "gone@example.net",
			action: "failed",
			status: "5.1.1",
			diagnostic: "550 5.1.1 <gone@example.net>: Recipient address rejected: User unknown",
		},
	]);
	assert.deepEqual(report.originalMessageIds, [SENT_MESSAGE_ID]);
	assert.deepEqual(dsnRecipientOutcome(report.recipients[0]), { status: "bounced", suppress: true });
	assert.deepEqual(dsnRecipientOutcome({ ...report.recipients[0], status: "5.7.1" }), { status: "bounced", suppress: false });
	assert.deepEqual(dsnRecipientOutcome({ ...report.recipients[0], status: "4.4.7" }), { status: "failed", suppress: false });
	assert.equal(dsnRecipientOutcome({ ...report.recipients[0], action: "delayed", status: "4.4.1" }), null);

	// Not a DSN: other reports, plain mail, missing status part.
	assert.equal(parseDeliveryStatusReport(dsn().replace("report-type=delivery-status", "report-type=feedback-report")), null);
	assert.equal(parseDeliveryStatusReport("From: a@b.c\r\nContent-Type: text/plain\r\n\r\nUser unknown 5.1.1"), null);
	assert.equal(parseDeliveryStatusReport(dsn().replace("Content-Type: message/delivery-status", "Content-Type: text/plain")), null);
	// Quoted report-type and In-Reply-To also link.
	const quoted = parseDeliveryStatusReport(
		dsn({ originalId: "other@x" })
			.replace("report-type=delivery-status", 'report-type="delivery-status"')
			.replace("MIME-Version: 1.0", `In-Reply-To: <${SENT_MESSAGE_ID}>\r\nMIME-Version: 1.0`),
	);
	assert.deepEqual(quoted.originalMessageIds, ["other@x", SENT_MESSAGE_ID]);
}

// ── applyInboundDsn + receiveEmail ───────────────────────────────
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

function mailboxSql() {
	const sql = sqlStorage(new DatabaseSync(":memory:"));
	applyMigrations(sql, mailboxMigrations);
	sql.exec(
		`INSERT INTO emails (id, folder_id, subject, sender, recipient, cc, date, message_id, provider_message_id, thread_id, delivery_status)
		 VALUES (?, 'sent', 'Hello', 'ada@acme.test', 'gone@example.net', 'ok@example.net', '2026-10-19T09:00:00Z', ?, ?, 'thread-1', 'accepted')`,
		SENT_ID,
		SENT_MESSAGE_ID,
		PROVIDER_ID,
	);
	return sql;
}

function fakeMailbox(sql) {
	const row = (where, value) => sql.exec(`SELECT * FROM emails WHERE ${where} = ?`, value)[0] ?? null;
	return {
		isWritable: async () => true,
		claimInboundMessageId: async (messageId, claimId) => claimInboundMessage(sql, messageId, claimId),
		completeInboundMessageClaim: async (messageId, emailId) => completeInboundMessageClaim(sql, messageId, emailId),
		abandonInboundDelivery: async (emailId, messageId) => abandonInboundDelivery(sql, emailId, messageId),
		findThreadIdByReferences: async () => null,
		findThreadBySubject: async () => null,
		getThreadAliasId: async () => null,
		bootstrapSenderTriage: async () => {},
		getSenderTriage: async () => null,
		getSenderPreference: async () => null,
		getDeviceTokens: async () => [],
		ensureAutoAgentConversation: async () => {},
		findEmailByMessageId: async (id) => row("message_id", id.replace(/^<|>$/g, "")),
		findEmailByProviderMessageId: async (id) => row("provider_message_id", id),
		setDeliveryState: async (id, state) =>
			sql.exec(`UPDATE emails SET delivery_status = ?, delivery_error = ? WHERE id = ?`, state.status, state.error ?? null, id),
		createEmail: async (folder, email) => {
			sql.exec(
				`INSERT INTO emails (id, folder_id, subject, sender, recipient, date, message_id, thread_id, read)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				email.id, folder, email.subject, email.sender, email.recipient, email.date,
				email.message_id ?? null, email.thread_id ?? null, email.read ? 1 : 0,
			);
		},
	};
}

{
	// applyInboundDsn: only recipients of the original are acted on.
	const sql = mailboxSql();
	const db = makeAuthDb(createTestD1());
	const forged = parseDeliveryStatusReport(dsn({ recipient: "victim@example.net" }));
	assert.equal(
		await applyInboundDsn({ report: forged, stub: fakeMailbox(sql), db, mailboxId: "ada@acme.test", dsnMessageId: "d" }),
		null,
		"a report for an address the message never went to is not applied",
	);
	assert.equal((await findSuppressedRecipients(db, "acme.test", ["victim@example.net"])).length, 0);

	// Matched by provider message id (the wire Message-ID Email Sending used).
	const byProvider = parseDeliveryStatusReport(dsn({ originalId: PROVIDER_ID }));
	const applied = await quiet(() =>
		applyInboundDsn({ report: byProvider, stub: fakeMailbox(sql), db, mailboxId: "ada@acme.test", dsnMessageId: "d" }),
	);
	assert.equal(applied.originalId, SENT_ID);
	assert.deepEqual(applied.suppressed, ["gone@example.net"]);

	// A delayed notice is not applied.
	const delayed = parseDeliveryStatusReport(dsn({ action: "delayed", status: "4.4.1" }));
	assert.equal(await applyInboundDsn({ report: delayed, stub: fakeMailbox(sql), db, mailboxId: "ada@acme.test", dsnMessageId: "d" }), null);
}

function inboundMessage(raw) {
	const bytes = new TextEncoder().encode(raw);
	return {
		to: "ada@acme.test",
		from: "",
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

async function inboundSetup() {
	const sql = mailboxSql();
	const d1 = createTestD1();
	const { env: base } = createAuthTestEnv();
	const stub = fakeMailbox(sql);
	await base.BUCKET.put(mailboxMetadataKey("ada@acme.test"), JSON.stringify({ screenerEnabled: false }));
	const env = { ...base, AUTH_DB: d1, MAILBOX: { idFromName: (n) => n, get: () => stub } };
	const pending = [];
	const ctx = { waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})) };
	return { sql, env, ctx, pending, db: makeAuthDb(d1) };
}

{
	// Matched DSN: original updated, recipient suppressed, report archived in its thread (not the inbox).
	const { sql, env, ctx, pending, db } = await inboundSetup();
	await quiet(async () => {
		await receiveEmail(inboundMessage(dsn()), env, ctx);
		await Promise.all(pending);
	});
	const original = sql.exec(`SELECT delivery_status, delivery_error FROM emails WHERE id = ?`, SENT_ID)[0];
	assert.equal(original.delivery_status, "bounced");
	assert.match(original.delivery_error, /^Delivery to gone@example\.net failed: 5\.1\.1 550 5\.1\.1/);
	const stored = sql.exec(`SELECT folder_id, thread_id, read FROM emails WHERE message_id = 'dsn-1@mx.example.net'`);
	assert.equal(stored.length, 1, "the report is kept");
	assert.deepEqual({ ...stored[0] }, { folder_id: "archive", thread_id: "thread-1", read: 1 });
	assert.equal(sql.exec(`SELECT COUNT(*) AS n FROM emails WHERE folder_id = 'inbox'`)[0].n, 0, "nothing in the inbox");
	const suppression = await findSuppressedRecipients(db, "acme.test", ["gone@example.net", "ok@example.net"]);
	assert.deepEqual(suppression.map((s) => [s.recipient, s.reason, s.source, s.sourceMailboxId, s.sourceMessageId]), [
		["gone@example.net", "hard_bounce", "inbound_dsn", "ada@acme.test", SENT_ID],
	]);
}

{
	// Unmatched DSN: filed as normal mail, nothing updated or suppressed.
	const { sql, env, ctx, pending, db } = await inboundSetup();
	await quiet(async () => {
		await receiveEmail(inboundMessage(dsn({ originalId: "unknown@elsewhere.example", messageId: "dsn-2@mx.example.net" })), env, ctx);
		await Promise.all(pending);
	});
	assert.equal(sql.exec(`SELECT delivery_status FROM emails WHERE id = ?`, SENT_ID)[0].delivery_status, "accepted");
	const stored = sql.exec(`SELECT folder_id, read FROM emails WHERE message_id = 'dsn-2@mx.example.net'`);
	assert.equal(stored.length, 1);
	assert.notEqual(stored[0].folder_id, "archive");
	assert.equal(stored[0].read, 0);
	assert.equal((await findSuppressedRecipients(db, "acme.test", ["gone@example.net"])).length, 0);
}

{
	// Soft failure DSN (Action: failed, 4.x.x): status "failed", no suppression; never downgrades a bounce.
	const { sql, env, ctx, pending, db } = await inboundSetup();
	await quiet(async () => {
		await receiveEmail(inboundMessage(dsn({ status: "4.4.7", messageId: "dsn-3@mx.example.net" })), env, ctx);
		await Promise.all(pending);
	});
	assert.equal(sql.exec(`SELECT delivery_status FROM emails WHERE id = ?`, SENT_ID)[0].delivery_status, "failed");
	assert.equal((await findSuppressedRecipients(db, "acme.test", ["gone@example.net"])).length, 0);
	sql.exec(`UPDATE emails SET delivery_status = 'bounced' WHERE id = ?`, SENT_ID);
	await quiet(() => receiveEmail(inboundMessage(dsn({ status: "4.4.7", messageId: "dsn-4@mx.example.net" })), env, ctx));
	assert.equal(sql.exec(`SELECT delivery_status FROM emails WHERE id = ?`, SENT_ID)[0].delivery_status, "bounced");
}

console.log("bounce-suppression: ok");
