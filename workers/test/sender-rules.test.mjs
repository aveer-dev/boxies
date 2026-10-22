/**
 * Sender rules (AVE-96, docs/spam-management-plan.md §5, §7): the
 * `38_sender_rules` migration and its `sender_triage.rejected` backfill,
 * Public Suffix List normalization and the public-suffix / free-mail
 * refusals, matching precedence (address beats domain, a domain allow needs
 * `verified`, `failed` matches nothing), the GET/PUT/DELETE routes with
 * mailbox access checks, and the inbound path end to end via receiveEmail.
 * Runs the real MailboxDO migrations on node:sqlite.
 * Run: pnpm test:unit sender-rules
 */

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, mailboxMigrations } from "../durableObject/migrations.ts";
import {
	checkRegistrableDomain,
	decidingSenderRuleId,
	deleteSenderRule,
	isFreeMailDomain,
	listSenderRules,
	matchSenderRule,
	normalizeSenderRuleInput,
	pickSenderRule,
	senderRegistrableDomain,
	triageWithSenderRule,
	upsertSenderRule,
} from "../lib/sender-rules.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { receiveEmail } from "../index.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const MIGRATION = "38_sender_rules";
const MAILBOX = "ada@example.com";

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

function mailboxDb(migrations = mailboxMigrations) {
	const db = new DatabaseSync(":memory:");
	const sql = sqlStorage(db);
	applyMigrations(sql, migrations);
	return { db, sql };
}

const count = (sql, query, ...b) => Number(Object.values(sql.exec(query, ...b)[0])[0]);

function insertTriage(sql, sender, status, at = "2026-01-01T00:00:00.000Z") {
	sql.exec(
		`INSERT INTO sender_triage (sender, status, destination_folder_id, display_name, decided_at, updated_at)
		 VALUES (?, ?, NULL, NULL, ?, ?)`,
		sender,
		status,
		at,
		at,
	);
}

// ── Migration and backfill ───────────────────────────────────────
{
	const names = mailboxMigrations.map((m) => m.name);
	assert.equal(names.at(-1), MIGRATION, "appended last");
	assert.ok(names.indexOf(MIGRATION) > names.indexOf("37_email_classification"));
	assert.equal(names.filter((n) => n === MIGRATION).length, 1);

	// An existing mailbox with Screener decisions from before this migration.
	const before = mailboxMigrations.filter((m) => m.name !== MIGRATION);
	const { sql } = mailboxDb(before);
	insertTriage(sql, "spammer@junk.example", "rejected", "2025-05-01T00:00:00.000Z");
	insertTriage(sql, "reported@shop.example", "rejected");
	insertTriage(sql, "friend@pals.example", "allowed");
	insertTriage(sql, "not-an-address", "rejected");
	assert.equal(count(sql, `SELECT COUNT(*) FROM sqlite_master WHERE name = 'sender_rules'`), 0);

	applyMigrations(sql, mailboxMigrations);
	assert.equal(count(sql, `SELECT COUNT(*) FROM d1_migrations WHERE name = ?`, MIGRATION), 1);
	const rules = listSenderRules(sql);
	assert.deepEqual(
		rules.map((r) => [r.kind, r.value, r.verdict, r.source]).sort(),
		[
			["address", "reported@shop.example", "block", "screener"],
			["address", "spammer@junk.example", "block", "screener"],
		],
		"rejected senders become address block rules; allowed senders and junk rows don't",
	);
	const spammer = rules.find((r) => r.value === "spammer@junk.example");
	assert.equal(spammer.createdAt, "2025-05-01T00:00:00.000Z", "keeps when the sender was rejected");
	assert.equal(spammer.matchCount, 0);
	assert.equal(spammer.lastMatchedAt, null);
	assert.match(spammer.id, /^[0-9a-f]{32}$/);
	assert.equal(count(sql, `SELECT COUNT(*) FROM sender_triage`), 4, "sender_triage is untouched");

	// Replaying the SQL is a no-op: no duplicates, ids and edits kept.
	upsertSenderRule(sql, { kind: "address", value: "reported@shop.example", verdict: "allow", source: "settings" });
	sql.exec(mailboxMigrations.find((m) => m.name === MIGRATION).sql);
	applyMigrations(sql, mailboxMigrations);
	assert.equal(count(sql, `SELECT COUNT(*) FROM sender_rules`), 2);
	assert.equal(listSenderRules(sql).find((r) => r.value === "reported@shop.example").verdict, "allow");
	assert.equal(listSenderRules(sql).find((r) => r.value === "spammer@junk.example").id, spammer.id);

	// A fresh mailbox gets an empty table.
	const fresh = mailboxDb();
	assert.equal(count(fresh.sql, `SELECT COUNT(*) FROM sender_rules`), 0);

	// The table enforces kind / verdict and one rule per value.
	assert.throws(() =>
		sql.exec(
			`INSERT INTO sender_rules (id, kind, value, verdict, source, created_at, updated_at)
			 VALUES ('x', 'regex', 'a', 'allow', 's', 'n', 'n')`,
		),
	);
	assert.throws(() =>
		sql.exec(
			`INSERT INTO sender_rules (id, kind, value, verdict, source, created_at, updated_at)
			 VALUES ('y', 'domain', 'acme.com', 'maybe', 's', 'n', 'n')`,
		),
	);
	assert.throws(() =>
		sql.exec(
			`INSERT INTO sender_rules (id, kind, value, verdict, source, created_at, updated_at)
			 VALUES ('z', 'address', 'spammer@junk.example', 'allow', 's', 'n', 'n')`,
		),
		/UNIQUE/,
	);
}

// ── Domain normalization (Public Suffix List) ────────────────────
{
	assert.deepEqual(checkRegistrableDomain("co.uk"), { ok: false, reason: "public_suffix" });
	assert.deepEqual(checkRegistrableDomain("com"), { ok: false, reason: "public_suffix" });
	assert.deepEqual(checkRegistrableDomain("github.io"), { ok: false, reason: "public_suffix" }, "private PSL section");
	assert.deepEqual(checkRegistrableDomain("acme.co.uk"), { ok: true, domain: "acme.co.uk" });
	assert.deepEqual(checkRegistrableDomain("Mail.ACME.co.uk."), { ok: true, domain: "acme.co.uk" });
	assert.deepEqual(checkRegistrableDomain("ada.github.io"), { ok: true, domain: "ada.github.io" });
	assert.deepEqual(checkRegistrableDomain("bücher.de"), { ok: true, domain: "xn--bcher-kva.de" }, "IDN to punycode");
	assert.deepEqual(checkRegistrableDomain("xn--bcher-kva.de"), { ok: true, domain: "xn--bcher-kva.de" });
	assert.deepEqual(checkRegistrableDomain("news.acme.newtld"), { ok: true, domain: "acme.newtld" }, "PSL default rule");
	for (const bad of ["", "acme", "1.2.3.4", "[::1]", "acme..com", "acme.com/x", "a b.com"]) {
		assert.equal(checkRegistrableDomain(bad).ok, false, bad);
	}
	assert.equal(senderRegistrableDomain("Ada <ada@news.mail.acme.co.uk>"), "acme.co.uk");
	assert.equal(senderRegistrableDomain("nobody"), null);

	for (const free of ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "yahoo.com", "yahoo.co.jp", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.de", "gmx.net", "mail.com", "zoho.com", "yandex.ru", "inboxies.email"]) {
		assert.equal(isFreeMailDomain(free), true, free);
	}
	for (const company of ["acme.com", "acme.co.uk", "google.com", "microsoft.com", "mailchimp.com"]) {
		assert.equal(isFreeMailDomain(company), false, company);
	}
}

// ── PUT body validation ──────────────────────────────────────────
{
	const opts = { mailboxId: MAILBOX };
	const code = (body) => {
		const r = normalizeSenderRuleInput(body, opts);
		return r.ok ? "ok" : r.code;
	};
	assert.equal(code({ kind: "domain", value: "@co.uk", verdict: "allow" }), "public_suffix");
	assert.equal(code({ kind: "domain", value: "co.uk", verdict: "block" }), "public_suffix");
	assert.equal(code({ kind: "domain", value: "@gmail.com", verdict: "allow" }), "free_mail_provider");
	assert.equal(code({ kind: "domain", value: "gmail.com", verdict: "block" }), "free_mail_provider", "blocks too");
	assert.equal(code({ kind: "domain", value: "mail.google.com", verdict: "allow" }), "ok", "Google the company is fine");
	assert.equal(code({ kind: "domain", value: "@hotmail.co.uk", verdict: "allow" }), "free_mail_provider");
	assert.equal(code({ kind: "domain", value: "acme", verdict: "allow" }), "invalid_domain");
	assert.equal(code({ kind: "domain", value: "", verdict: "allow" }), "invalid_domain");
	assert.equal(code({ kind: "address", value: "nope", verdict: "allow" }), "invalid_address");
	assert.equal(code({ kind: "address", value: "x@co", verdict: "allow" }), "invalid_address");
	assert.equal(code({ kind: "address", value: "ADA+news@example.com", verdict: "block" }), "own_address");
	assert.equal(code({ kind: "regex", value: "acme.com", verdict: "allow" }), "invalid_kind");
	assert.equal(code({ kind: "domain", value: "acme.com", verdict: "maybe" }), "invalid_verdict");
	assert.equal(code({ kind: "domain", value: "acme.com", verdict: "allow", source: "hacker" }), "invalid_source");
	assert.equal(code(null), "invalid_kind");

	assert.deepEqual(normalizeSenderRuleInput({ kind: "domain", value: "@News.Acme.co.uk", verdict: "allow" }, opts), {
		ok: true,
		rule: { kind: "domain", value: "acme.co.uk", verdict: "allow", source: "settings" },
	});
	assert.deepEqual(
		normalizeSenderRuleInput({ kind: "address", value: "Ada <Ada@Gmail.com>", verdict: "allow", source: "not_spam" }, opts),
		{ ok: true, rule: { kind: "address", value: "ada@gmail.com", verdict: "allow", source: "not_spam" } },
		"a free-mail *address* is fine",
	);
}

// ── Matching precedence ──────────────────────────────────────────
{
	const addrAllow = { kind: "address", verdict: "allow" };
	const addrBlock = { kind: "address", verdict: "block" };
	const domAllow = { kind: "domain", verdict: "allow" };
	const domBlock = { kind: "domain", verdict: "block" };
	const pick = (addressRule, domainRule, authTier) => pickSenderRule({ addressRule, domainRule, authTier });

	// An unverified message never matches a domain allow.
	assert.equal(pick(null, domAllow, "verified"), domAllow);
	for (const tier of ["unverified", null, undefined, "failed"]) {
		assert.equal(pick(null, domAllow, tier), null, `domain allow, ${tier}`);
	}
	// Domain blocks apply whatever the tier (bar failed, which is Spam anyway).
	assert.equal(pick(null, domBlock, "unverified"), domBlock);
	assert.equal(pick(null, domBlock, "verified"), domBlock);
	// Address rules beat domain rules, and an address allow works unverified.
	assert.equal(pick(addrAllow, domBlock, "unverified"), addrAllow);
	assert.equal(pick(addrBlock, domAllow, "verified"), addrBlock);
	// Failed auth matches nothing: no allow overrides it.
	assert.equal(pick(addrAllow, null, "failed"), null);
	assert.equal(pick(null, null, "verified"), null);

	// Against the table: subdomains match, stats are bumped on a match only.
	const { sql } = mailboxDb();
	const dom = upsertSenderRule(sql, { kind: "domain", value: "acme.co.uk", verdict: "allow", source: "settings" }, { id: "dom", now: "t0" });
	assert.equal(dom.created, true);
	upsertSenderRule(sql, { kind: "address", value: "spoofy@acme.co.uk", verdict: "block", source: "settings" }, { id: "addr" });
	assert.equal(matchSenderRule(sql, "Ann <ann@news.acme.co.uk>", "verified", "t1")?.id, "dom");
	assert.equal(matchSenderRule(sql, "ann@acme.co.uk", "unverified", "t2"), null, "unverified never matches a domain allow");
	assert.equal(matchSenderRule(sql, "ann@acme.co.uk", "failed", "t2"), null);
	assert.equal(matchSenderRule(sql, "spoofy@acme.co.uk", "verified", "t3")?.id, "addr", "address beats domain");
	assert.equal(matchSenderRule(sql, "ann@notacme.co.uk", "verified"), null);
	assert.equal(matchSenderRule(sql, "ann@co.uk", "verified"), null);
	const after = listSenderRules(sql);
	assert.equal(after.find((r) => r.id === "dom").matchCount, 1);
	assert.equal(after.find((r) => r.id === "dom").lastMatchedAt, "t1");
	assert.equal(after.find((r) => r.id === "addr").matchCount, 1);

	// Upsert on the same value flips the verdict in place.
	const flipped = upsertSenderRule(sql, { kind: "domain", value: "acme.co.uk", verdict: "block", source: "settings" }, { now: "t9" });
	assert.equal(flipped.created, false);
	assert.equal(flipped.rule.id, "dom");
	assert.equal(flipped.rule.verdict, "block");
	assert.equal(flipped.rule.matchCount, 1, "stats survive an edit");
	assert.equal(matchSenderRule(sql, "ann@acme.co.uk", "unverified")?.id, "dom", "domain block applies unverified");

	// Filters and search.
	upsertSenderRule(sql, { kind: "address", value: "pal@friends.example", verdict: "allow", source: "not_spam" });
	assert.deepEqual(listSenderRules(sql, { verdict: "allow" }).map((r) => r.value), ["pal@friends.example"]);
	assert.deepEqual(listSenderRules(sql, { verdict: "block", kind: "domain" }).map((r) => r.value), ["acme.co.uk"]);
	assert.deepEqual(listSenderRules(sql, { q: "@ACME" }).map((r) => r.value).sort(), ["acme.co.uk", "spoofy@acme.co.uk"]);
	assert.deepEqual(listSenderRules(sql, { q: "%" }), [], "LIKE wildcards are literal");
	assert.equal(listSenderRules(sql, { limit: 1 }).length, 1);
	assert.equal(listSenderRules(sql, { verdict: "bogus" }).length, 3, "unknown filter is ignored");

	// Inbound helpers.
	const triage = { sender: "x@y.example", status: "allowed", destination_folder_id: "updates", decided_at: "a", updated_at: "a" };
	assert.equal(triageWithSenderRule(triage, null, "x@y.example"), triage);
	assert.equal(triageWithSenderRule(triage, { verdict: "allow" }, "x@y.example"), triage, "keeps the purpose box");
	assert.equal(triageWithSenderRule(triage, { verdict: "block" }, "x@y.example").status, "rejected");
	assert.equal(triageWithSenderRule(null, { verdict: "allow" }, "x@y.example").status, "allowed");
	assert.equal(triageWithSenderRule({ ...triage, status: "rejected" }, { verdict: "allow" }, "x@y.example").status, "allowed");
	assert.equal(decidingSenderRuleId({ id: "r", verdict: "block" }, { triageAction: "rejected" }), "r");
	assert.equal(decidingSenderRuleId({ id: "r", verdict: "block" }, { triageAction: "spam" }), null);
	assert.equal(decidingSenderRuleId({ id: "r", verdict: "allow" }, { triageAction: "allowed" }), "r");
	assert.equal(decidingSenderRuleId({ id: "r", verdict: "allow" }, { triageAction: "spam" }), null);
	assert.equal(decidingSenderRuleId(null, { triageAction: "allowed" }), null);

	// Deleting an address block also un-rejects the Screener row (and only that).
	insertTriage(sql, "spoofy@acme.co.uk", "rejected");
	insertTriage(sql, "pal@friends.example", "allowed");
	assert.equal(deleteSenderRule(sql, "addr")?.value, "spoofy@acme.co.uk");
	assert.equal(count(sql, `SELECT COUNT(*) FROM sender_triage WHERE sender = 'spoofy@acme.co.uk'`), 0);
	const palRule = listSenderRules(sql, { verdict: "allow" })[0];
	deleteSenderRule(sql, palRule.id);
	assert.equal(count(sql, `SELECT COUNT(*) FROM sender_triage WHERE sender = 'pal@friends.example'`), 1, "allowed row kept");
	assert.equal(deleteSenderRule(sql, "addr"), null);
}

// ── HTTP routes ──────────────────────────────────────────────────
{
	const { sql } = mailboxDb();
	insertTriage(sql, "blocked@spam.example", "rejected");
	const mailboxNamespace = mockMailboxNamespace({
		listSenderRules: async (options) => listSenderRules(sql, options),
		upsertSenderRule: async (input) => upsertSenderRule(sql, input),
		deleteSenderRule: async (id) => deleteSenderRule(sql, id) !== null,
	});
	const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mailboxNamespace });
	const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
	const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email" });
	const eve = await addUser(db, { id: "eve", email: "eve@inboxies.email" });
	await addMailbox(db, bucket, "shared@inboxies.email", { owners: ["ada"], members: ["bob"] });
	const [asAda, asBob, asEve] = [ada, bob, eve].map((u) => principalFor(u));
	const base = "/api/v1/mailboxes/shared@inboxies.email/sender-rules";

	// PUT creates (201), then updates the same value (200).
	const created = await request(env, { method: "PUT", path: base, principal: asAda, body: { kind: "domain", value: "@news.acme.com", verdict: "allow" } });
	assert.equal(created.status, 201);
	assert.equal(created.payload.rule.kind, "domain");
	assert.equal(created.payload.rule.value, "acme.com");
	assert.equal(created.payload.rule.verdict, "allow");
	assert.equal(created.payload.rule.source, "settings");
	const updated = await request(env, { method: "PUT", path: base, principal: asBob, body: { kind: "domain", value: "acme.com", verdict: "block" } });
	assert.equal(updated.status, 200, "members can edit sender rules too");
	assert.equal(updated.payload.rule.id, created.payload.rule.id);
	assert.equal(updated.payload.rule.verdict, "block");

	// Refusals carry a code for inline errors.
	for (const [body, code] of [
		[{ kind: "domain", value: "@co.uk", verdict: "allow" }, "public_suffix"],
		[{ kind: "domain", value: "@gmail.com", verdict: "allow" }, "free_mail_provider"],
		[{ kind: "domain", value: "gmail.com", verdict: "block" }, "free_mail_provider"],
		[{ kind: "address", value: "shared@inboxies.email", verdict: "block" }, "own_address"],
		[{ kind: "address", value: "nope", verdict: "allow" }, "invalid_address"],
		[{ kind: "domain", value: "acme.com" }, "invalid_verdict"],
	]) {
		const res = await request(env, { method: "PUT", path: base, principal: asAda, body });
		assert.equal(res.status, 400, JSON.stringify(body));
		assert.equal(res.payload.code, code, JSON.stringify(body));
		assert.equal(typeof res.payload.error, "string");
	}
	const badJson = await request(env, { method: "PUT", path: base, principal: asAda, headers: { "content-type": "application/json" } });
	assert.equal(badJson.status, 400);

	const addr = await request(env, { method: "PUT", path: base, principal: asAda, body: { kind: "address", value: "Pal <pal@friends.example>", verdict: "allow" } });
	assert.equal(addr.status, 201);
	assert.equal(addr.payload.rule.value, "pal@friends.example");

	// GET lists with filters.
	const all = await request(env, { path: base, principal: asAda });
	assert.equal(all.status, 200);
	assert.deepEqual(all.payload.rules.map((r) => r.value).sort(), ["acme.com", "pal@friends.example"]);
	const allows = await request(env, { path: `${base}?verdict=allow`, principal: asBob });
	assert.deepEqual(allows.payload.rules.map((r) => r.value), ["pal@friends.example"]);
	const search = await request(env, { path: `${base}?q=acme`, principal: asAda });
	assert.deepEqual(search.payload.rules.map((r) => r.value), ["acme.com"]);
	const rule = all.payload.rules[0];
	for (const key of ["id", "kind", "value", "verdict", "source", "createdAt", "updatedAt", "lastMatchedAt", "matchCount"]) {
		assert.ok(key in rule, key);
	}

	// A non-member, or no session, can't reach the mailbox at all.
	assert.equal((await request(env, { path: base, principal: asEve })).status, 403);
	assert.equal((await request(env, { path: base })).status, 403);
	assert.equal(
		(await request(env, { method: "PUT", path: base, principal: asEve, body: { kind: "domain", value: "evil.com", verdict: "allow" } })).status,
		403,
	);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/${addr.payload.rule.id}`, principal: asEve })).status, 403);
	assert.equal(listSenderRules(sql).length, 2, "nothing written by the outsider");

	// DELETE: 204, then 404.
	assert.equal((await request(env, { method: "DELETE", path: `${base}/${addr.payload.rule.id}`, principal: asBob })).status, 204);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/${addr.payload.rule.id}`, principal: asAda })).status, 404);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/${"x".repeat(200)}`, principal: asAda })).status, 400);

	// Unblocking a blocked address returns it to Screener.
	const blocked = await request(env, { method: "PUT", path: base, principal: asAda, body: { kind: "address", value: "blocked@spam.example", verdict: "block" } });
	assert.equal(blocked.status, 201);
	assert.equal((await request(env, { method: "DELETE", path: `${base}/${blocked.payload.rule.id}`, principal: asAda })).status, 204);
	assert.equal(count(sql, `SELECT COUNT(*) FROM sender_triage WHERE sender = 'blocked@spam.example'`), 0);
}

// ── Inbound, end to end through receiveEmail ─────────────────────
{
	const VERIFIED =
		"mx.cloudflare.net; dkim=pass header.d=acme.com; spf=pass smtp.mailfrom=bounce@acme.com; dmarc=pass header.from=acme.com policy.dmarc=reject";
	// SendGrid-style: passes only for the ESP's domain, no DMARC policy.
	const UNVERIFIED =
		"mx.cloudflare.net; dkim=pass header.d=sendgrid.net; spf=pass smtp.mailfrom=bounces@sendgrid.net; dmarc=none header.from=acme.com";
	const FAILED =
		"mx.cloudflare.net; dkim=pass header.d=evil.example; spf=fail smtp.mailfrom=x@evil.example; dmarc=fail header.from=acme.com policy.dmarc=reject";

	function createBucket() {
		const store = new Map();
		return {
			async get(key) {
				if (!store.has(key)) return null;
				const value = store.get(key);
				return { json: async () => JSON.parse(value), text: async () => value };
			},
			async put(key, value) {
				store.set(key, typeof value === "string" ? value : "blob");
			},
			async head(key) {
				return store.has(key) ? { key } : null;
			},
			async delete() {},
		};
	}

	function fakeMailbox(sql, { triage = null } = {}) {
		const stored = [];
		return {
			stored,
			isWritable: async () => true,
			claimInboundMessageId: async () => true,
			completeInboundMessageClaim: async () => {},
			abandonInboundDelivery: async () => "not_stored",
			findThreadIdByReferences: async () => null,
			findThreadBySubject: async () => null,
			getThreadAliasId: async () => null,
			bootstrapSenderTriage: async () => {},
			getSenderTriage: async () => triage,
			getSenderPreference: async () => null,
			matchSenderRule: async (sender, tier) => matchSenderRule(sql, sender, tier),
			ensureAutoAgentConversation: async () => {},
			getDeviceTokens: async () => [],
			unregisterDeviceToken: async () => {},
			createEmail: async (folder, email) => {
				stored.push({ folder, email });
			},
		};
	}

	let seq = 0;
	async function deliver(stub, { from, authResults, extraHeaders = [] }) {
		const messageId = `m${++seq}@acme.com`;
		const raw = [
			`From: Sender <${from}>`,
			`To: ${MAILBOX}`,
			"Subject: Your order shipped",
			`Message-ID: <${messageId}>`,
			...extraHeaders,
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=utf-8",
			"",
			"Tracking number inside.",
			"",
		].join("\r\n");
		const bytes = new TextEncoder().encode(raw);
		const bucket = createBucket();
		await bucket.put(mailboxMetadataKey(MAILBOX), "{}");
		const env = { BUCKET: bucket, MAILBOX: { idFromName: (n) => n, get: () => stub } };
		const pending = [];
		const message = {
			to: MAILBOX,
			from,
			headers: new Headers([["Authentication-Results", authResults]]),
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
		const { log, error, warn } = console;
		console.log = console.error = console.warn = () => {};
		try {
			await receiveEmail(message, env, { waitUntil: (p) => pending.push(p) });
			await Promise.all(pending);
		} finally {
			Object.assign(console, { log, error, warn });
		}
		return stub.stored.at(-1);
	}

	const { sql } = mailboxDb();
	const domAllow = upsertSenderRule(sql, { kind: "domain", value: "acme.com", verdict: "allow", source: "settings" }).rule;
	const domBlock = upsertSenderRule(sql, { kind: "domain", value: "junk.example", verdict: "block", source: "settings" }).rule;
	const addrAllow = upsertSenderRule(sql, { kind: "address", value: "orders@acme.com", verdict: "allow", source: "not_spam" }).rule;

	// Domain allow + verified: a never-seen address skips Screener.
	{
		const got = await deliver(fakeMailbox(sql), { from: "receipts@mail.acme.com", authResults: VERIFIED });
		assert.equal(got.folder, "inbox");
		assert.equal(got.email.matched_rule_id, domAllow.id);
		assert.equal(got.email.auth_tier, "verified");
	}
	// Domain allow + verified beats upstream spam headers (§5 step 3).
	{
		const got = await deliver(fakeMailbox(sql), { from: "receipts@acme.com", authResults: VERIFIED, extraHeaders: ["X-Spam-Flag: YES"] });
		assert.equal(got.folder, "inbox");
		assert.equal(got.email.matched_rule_id, domAllow.id);
	}
	// Unverified never matches a domain allow: Screener, no rule recorded.
	{
		const before = listSenderRules(sql).find((r) => r.id === domAllow.id).matchCount;
		const got = await deliver(fakeMailbox(sql), { from: "receipts@acme.com", authResults: UNVERIFIED });
		assert.equal(got.email.auth_tier, "unverified");
		assert.equal(got.folder, "screener");
		assert.equal(got.email.matched_rule_id, null);
		assert.equal(listSenderRules(sql).find((r) => r.id === domAllow.id).matchCount, before, "no match counted");
	}
	// …and with spam headers it stays Spam.
	{
		const got = await deliver(fakeMailbox(sql), { from: "receipts@acme.com", authResults: UNVERIFIED, extraHeaders: ["X-Spam-Flag: YES"] });
		assert.equal(got.folder, "spam");
		assert.equal(got.email.matched_rule_id, null);
	}
	// An address allow works unverified, even over an old Screener rejection.
	{
		const rejected = { sender: "orders@acme.com", status: "rejected", destination_folder_id: null, decided_at: "", updated_at: "" };
		const got = await deliver(fakeMailbox(sql, { triage: rejected }), { from: "orders@acme.com", authResults: UNVERIFIED });
		assert.equal(got.folder, "inbox");
		assert.equal(got.email.matched_rule_id, addrAllow.id);
	}
	// Failed auth: Spam, whatever the allow rules say.
	{
		const got = await deliver(fakeMailbox(sql), { from: "orders@acme.com", authResults: FAILED });
		assert.equal(got.folder, "spam");
		assert.equal(got.email.classification_reason, "auth-failed");
		assert.equal(got.email.matched_rule_id, null);
	}
	// Domain block: Screened out even for an allowed sender, and for unverified mail.
	{
		const allowed = { sender: "deals@junk.example", status: "allowed", destination_folder_id: null, decided_at: "", updated_at: "" };
		const got = await deliver(fakeMailbox(sql, { triage: allowed }), {
			from: "deals@news.junk.example",
			authResults: UNVERIFIED.replace("header.from=acme.com", "header.from=news.junk.example"),
		});
		assert.equal(got.email.auth_tier, "unverified");
		assert.equal(got.folder, "screened_out");
		assert.equal(got.email.classification_reason, "sender-rejected");
		assert.equal(got.email.matched_rule_id, domBlock.id);
	}
	// No rule: unchanged behaviour (a stranger goes to Screener), and a stub
	// without matchSenderRule (older DO during deploy) doesn't break delivery.
	{
		const got = await deliver(fakeMailbox(sql), { from: "who@stranger.example", authResults: VERIFIED.replaceAll("acme.com", "stranger.example") });
		assert.equal(got.email.auth_tier, "verified");
		assert.equal(got.folder, "screener");
		assert.equal(got.email.matched_rule_id, null);
		const legacy = fakeMailbox(sql);
		delete legacy.matchSenderRule;
		assert.equal((await deliver(legacy, { from: "receipts@acme.com", authResults: VERIFIED })).folder, "screener");
	}
}

console.log("sender-rules: ok");
