// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	generateRandomAliasToken,
	buildPrivateAddress,
	isAliasExpired,
	isAliasUsable,
	isPrivateAliasMeta,
	autoReplySender,
	normalizePausedAction,
	aliasMetadataKey,
	MAX_ALIASES_PER_MAILBOX,
} from "../lib/alias-utils.ts";
import {
	ALIAS_INACTIVE_ERROR,
	findThreadAliasId,
	resolveOutboundSender,
} from "../lib/alias-sender.ts";
import { isAddressTaken, mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import {
	AddressInUseError,
	deleteEmailAlias,
	domainR2Key,
	saveEmailAlias,
} from "../lib/domain-registry.ts";
import { validateSender, SenderValidationError } from "../lib/email-helpers.ts";

function createBucket() {
	const store = new Map();
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { json: async () => JSON.parse(text), text: async () => text };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async delete(key) {
			for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
		},
	};
}

function aliasRow(overrides = {}) {
	return {
		id: "alias-1",
		alias_email: "k8m2p9v4@example.com",
		domain: "example.com",
		base_domain: "example.com",
		label: null,
		is_active: 1,
		paused_action: "drop",
		expires_at: null,
		created_at: new Date().toISOString(),
		stats_received: 0,
		stats_blocked: 0,
		...overrides,
	};
}

function senderStub(rows, threadAliases = {}) {
	return {
		async getAlias(idOrEmail) {
			const key = idOrEmail.toLowerCase();
			return rows.find((r) => r.id === key || r.alias_email === key) ?? null;
		},
		async getThreadAliasId(threadId) {
			return threadAliases[threadId] ?? null;
		},
	};
}

test("generateRandomAliasToken generates valid lowercase alphanumeric strings", () => {
	const token1 = generateRandomAliasToken(8);
	const token2 = generateRandomAliasToken(8);

	assert.equal(token1.length, 8);
	assert.equal(token2.length, 8);
	assert.notEqual(token1, token2);
	assert.match(token1, /^[a-z2-9]+$/);
});

test("buildPrivateAddress puts aliases on the apex of the mailbox domain", () => {
	const res1 = buildPrivateAddress("k8m2p9v4", "acme.com");
	assert.equal(res1.aliasEmail, "k8m2p9v4@acme.com");
	assert.equal(res1.domain, "acme.com");
	assert.equal(res1.local, "k8m2p9v4");

	// Normalizes case, stray characters and dots
	const res2 = buildPrivateAddress(" Test-1234 ", ".My-Store.co.uk.");
	assert.equal(res2.aliasEmail, "test1234@my-store.co.uk");
});

test("isAliasExpired accurately detects expired timestamps", () => {
	assert.equal(isAliasExpired(null), false);
	assert.equal(isAliasExpired(undefined), false);

	const futureIso = new Date(Date.now() + 1000 * 3600 * 24).toISOString();
	assert.equal(isAliasExpired(futureIso), false);

	const pastIso = new Date(Date.now() - 1000 * 60).toISOString();
	assert.equal(isAliasExpired(pastIso), true);
});

test("isAliasUsable requires active and unexpired", () => {
	assert.equal(isAliasUsable(aliasRow()), true);
	assert.equal(isAliasUsable(aliasRow({ is_active: 0 })), false);
	assert.equal(
		isAliasUsable(aliasRow({ expires_at: new Date(Date.now() - 1000).toISOString() })),
		false,
	);
	assert.equal(isAliasUsable(null), false);
});

test("normalizePausedAction defaults to drop unless reject is explicitly specified", () => {
	assert.equal(normalizePausedAction("drop"), "drop");
	assert.equal(normalizePausedAction("reject"), "reject");
	assert.equal(normalizePausedAction("anything_else"), "drop");
	assert.equal(normalizePausedAction(undefined), "drop");
});

test("aliasMetadataKey formats canonical R2 storage key", () => {
	assert.equal(
		aliasMetadataKey("x7k2m9@example.com"),
		"platform/aliases/x7k2m9@example.com.json",
	);
});

test("isPrivateAliasMeta tells private emails from admin domain aliases", () => {
	assert.equal(isPrivateAliasMeta({ kind: "private", aliasEmail: "a@x.com", targetMailboxId: "m@x.com" }), true);
	// Records written before `kind` existed carry aliasId
	assert.equal(isPrivateAliasMeta({ aliasId: "id", aliasEmail: "a@x.com", targetMailboxId: "m@x.com" }), true);
	assert.equal(isPrivateAliasMeta({ aliasEmail: "sales@x.com", targetMailboxId: "m@x.com", domain: "x.com" }), false);
	assert.equal(isPrivateAliasMeta(null), false);
});

test("autoReplySender: private emails never reply, domain aliases reply as themselves", () => {
	const mailbox = "alex@example.com";
	assert.deepEqual(autoReplySender(null, mailbox), { skip: false, from: mailbox, fallback: null });
	assert.deepEqual(
		autoReplySender({ kind: "private", aliasId: "a", aliasEmail: "k8m2p9v4@example.com", targetMailboxId: mailbox }, mailbox),
		{ skip: true },
	);
	assert.deepEqual(
		autoReplySender({ aliasEmail: "Sales@Example.com", targetMailboxId: mailbox }, mailbox),
		{ skip: false, from: "sales@example.com", fallback: mailbox },
	);
});

test("isAddressTaken covers mailboxes and aliases", async () => {
	const bucket = createBucket();
	await bucket.put(mailboxMetadataKey("alex@example.com"), "{}");
	await bucket.put(aliasMetadataKey("k8m2p9v4@example.com"), "{}");

	assert.equal(await isAddressTaken(bucket, "alex@example.com"), true);
	assert.equal(await isAddressTaken(bucket, "Alex+news@Example.com"), true);
	assert.equal(await isAddressTaken(bucket, "k8m2p9v4@example.com"), true);
	assert.equal(await isAddressTaken(bucket, "free@example.com"), false);
});

test("validateSender allows sender matching active alias", () => {
	const mailboxId = "alex@example.com";
	const activeAlias = "b4k8z9w1@example.com";

	const primary = validateSender("dest@target.com", "alex@example.com", mailboxId);
	assert.equal(primary.fromEmail, "alex@example.com");
	assert.equal(primary.fromDomain, "example.com");

	const aliasSender = validateSender("dest@target.com", activeAlias, mailboxId, [activeAlias]);
	assert.equal(aliasSender.fromEmail, activeAlias);

	assert.throws(
		() => validateSender("dest@target.com", "hacker@example.com", mailboxId, [activeAlias]),
		SenderValidationError,
	);
});

test("resolveOutboundSender binds alias conversations to the alias", async () => {
	const mailboxId = "alex@example.com";
	const active = aliasRow();
	const paused = aliasRow({ id: "alias-2", alias_email: "p4u5e6d7@example.com", is_active: 0 });
	const stub = senderStub([active, paused], { "thread-a": "alias-1", "thread-p": "alias-2" });

	// Thread bound to an active alias: From is forced to the alias, display name dropped
	const forced = await resolveOutboundSender({
		stub,
		mailboxId,
		requestedFrom: { email: mailboxId, name: "Alex Real" },
		threadAliasId: await findThreadAliasId(stub, { threadId: "thread-a" }),
	});
	assert.deepEqual(forced, { ok: true, from: active.alias_email, fromEmail: active.alias_email, aliasId: "alias-1" });

	// Thread bound to a paused alias: refuse rather than reveal the mailbox
	const refused = await resolveOutboundSender({
		stub,
		mailboxId,
		requestedFrom: mailboxId,
		threadAliasId: await findThreadAliasId(stub, { threadId: "thread-p" }),
	});
	assert.deepEqual(refused, { ok: false, status: 409, error: ALIAS_INACTIVE_ERROR, code: "alias_inactive" });

	// Thread bound to a deleted alias: same refusal
	const deleted = await resolveOutboundSender({ stub, mailboxId, requestedFrom: mailboxId, threadAliasId: "gone" });
	assert.equal(deleted.ok, false);
	assert.equal(deleted.status, 409);

	// Original message alias wins over thread lookup
	assert.equal(await findThreadAliasId(stub, { aliasId: "alias-2", threadId: "thread-a" }), "alias-2");
	assert.equal(await findThreadAliasId(stub, { threadId: "unbound" }), null);
});

test("resolveOutboundSender for unbound messages", async () => {
	const mailboxId = "alex@example.com";
	const active = aliasRow();
	const paused = aliasRow({ id: "alias-2", alias_email: "p4u5e6d7@example.com", is_active: 0 });
	const stub = senderStub([active, paused]);

	const primary = await resolveOutboundSender({
		stub,
		mailboxId,
		requestedFrom: { email: "Alex@Example.com", name: "Alex" },
	});
	assert.equal(primary.ok, true);
	assert.equal(primary.fromEmail, mailboxId);
	assert.equal(primary.aliasId, null);
	assert.deepEqual(primary.from, { email: "Alex@Example.com", name: "Alex" });

	const viaAlias = await resolveOutboundSender({ stub, mailboxId, requestedFrom: active.alias_email });
	assert.deepEqual(viaAlias, { ok: true, from: active.alias_email, fromEmail: active.alias_email, aliasId: "alias-1" });

	const viaPaused = await resolveOutboundSender({ stub, mailboxId, requestedFrom: paused.alias_email });
	assert.equal(viaPaused.ok, false);
	assert.equal(viaPaused.status, 400);

	const spoofed = await resolveOutboundSender({ stub, mailboxId, requestedFrom: "ceo@othertenant.com" });
	assert.equal(spoofed.ok, false);
	assert.equal(spoofed.status, 400);

	// An alias id is not an address
	const byId = await resolveOutboundSender({ stub, mailboxId, requestedFrom: "alias-1" });
	assert.equal(byId.ok, false);
});

test("domain aliases never overwrite or delete private emails", async () => {
	const bucket = createBucket();
	await bucket.put(domainR2Key("example.com"), JSON.stringify({ domain: "example.com", aliases: [] }));
	await bucket.put(mailboxMetadataKey("alex@example.com"), "{}");
	await bucket.put(
		aliasMetadataKey("k8m2p9v4@example.com"),
		JSON.stringify({ kind: "private", aliasId: "a1", aliasEmail: "k8m2p9v4@example.com", targetMailboxId: "alex@example.com" }),
	);

	await assert.rejects(saveEmailAlias(bucket, "example.com", "k8m2p9v4", "alex@example.com"), AddressInUseError);
	await assert.rejects(saveEmailAlias(bucket, "example.com", "alex", "alex@example.com"), AddressInUseError);

	const created = await saveEmailAlias(bucket, "example.com", "sales", "alex@example.com");
	assert.equal(created.aliasEmail, "sales@example.com");

	// Deleting a "domain alias" with a private email's local part leaves the private record alone
	await deleteEmailAlias(bucket, "example.com", "k8m2p9v4");
	assert.ok(bucket.store.has(aliasMetadataKey("k8m2p9v4@example.com")));
	await deleteEmailAlias(bucket, "example.com", "sales");
	assert.equal(bucket.store.has(aliasMetadataKey("sales@example.com")), false);
});

test("aliases HTTP endpoints CRUD operations", async () => {
	const { app } = await import("../index.ts");
	const mailboxId = "alex@example.com";
	const bucket = createBucket();

	await bucket.put(mailboxMetadataKey(mailboxId), {
		fromName: "Alex",
		acl: { owners: ["email:alex@example.com"], members: [] },
	});

	const aliasList = [];
	let aliasCountOverride = null;
	const mockStub = {
		async listAliases() {
			return [...aliasList];
		},
		async countAliases() {
			return aliasCountOverride ?? aliasList.length;
		},
		async getAlias(idOrEmail) {
			return aliasList.find((a) => a.id === idOrEmail || a.alias_email === idOrEmail) || null;
		},
		async createAlias(alias) {
			const row = { ...alias };
			aliasList.push(row);
			return row;
		},
		async updateAlias(id, updates) {
			const item = aliasList.find((a) => a.id === id);
			if (!item) return null;
			for (const [key, value] of Object.entries(updates)) {
				if (value !== undefined) item[key] = value;
			}
			return item;
		},
		async deleteAlias(id) {
			const idx = aliasList.findIndex((a) => a.id === id);
			if (idx === -1) return false;
			aliasList.splice(idx, 1);
			return true;
		},
	};

	const env = {
		BUCKET: bucket,
		MAILBOX: {
			get() {
				return mockStub;
			},
			idFromName() {
				return {};
			},
		},
		DOMAINS: "example.com",
		MOBILE_JWT_SECRET: "test-secret",
	};

	const { Hono } = await import("hono");
	const principal = {
		email: "alex@example.com",
		sub: "alex-sub",
		ownerKeys: ["email:alex@example.com"],
	};
	const testApp = new Hono();
	testApp.use("*", async (c, next) => {
		c.set("principal", principal);
		await next();
	});
	testApp.route("/", app);

	const headers = { "Content-Type": "application/json" };
	const base = `http://localhost/api/v1/mailboxes/${mailboxId}/aliases`;

	// 1. Initial list -> empty
	const res1 = await testApp.request(base, { method: "GET", headers }, env);
	assert.equal(res1.status, 200);
	assert.deepEqual((await res1.json()).aliases, []);

	// 2. Create alias — caller-supplied baseDomain is ignored
	const res2 = await testApp.request(
		base,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ label: "Shopping", pausedAction: "drop", baseDomain: "othertenant.com" }),
		},
		env,
	);
	assert.equal(res2.status, 201);
	const { alias } = await res2.json();
	assert.ok(alias.id);
	assert.match(alias.alias_email, /^[a-z2-9]{8}@example\.com$/);
	assert.equal(alias.domain, "example.com");
	assert.equal(alias.label, "Shopping");

	const r2Data = await (await bucket.get(aliasMetadataKey(alias.alias_email))).json();
	assert.equal(r2Data.kind, "private");
	assert.equal(r2Data.aliasId, alias.id);
	assert.equal(r2Data.targetMailboxId, mailboxId);
	assert.equal(r2Data.isActive, true);

	// 3. Patch alias (pause, set expiry, clear label)
	const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
	const res3 = await testApp.request(
		`${base}/${alias.id}`,
		{
			method: "PATCH",
			headers,
			body: JSON.stringify({ isActive: false, pausedAction: "reject", expiresAt, label: null }),
		},
		env,
	);
	assert.equal(res3.status, 200);
	const updated = (await res3.json()).alias;
	assert.equal(updated.is_active, 0);
	assert.equal(updated.paused_action, "reject");
	assert.equal(updated.expires_at, expiresAt);
	assert.equal(updated.label, null);

	const r2Updated = await (await bucket.get(aliasMetadataKey(alias.alias_email))).json();
	assert.equal(r2Updated.kind, "private");
	assert.equal(r2Updated.isActive, false);
	assert.equal(r2Updated.pausedAction, "reject");
	assert.equal(r2Updated.expiresAt, expiresAt);

	// 4. Cap
	aliasCountOverride = MAX_ALIASES_PER_MAILBOX;
	const capped = await testApp.request(base, { method: "POST", headers, body: "{}" }, env);
	assert.equal(capped.status, 409);
	aliasCountOverride = null;

	// 5. Create rolls back the routing record if the Durable Object insert fails
	const realCreate = mockStub.createAlias;
	mockStub.createAlias = async () => {
		throw new Error("DO unavailable");
	};
	const keysBefore = [...bucket.store.keys()].filter((k) => k.startsWith("platform/aliases/")).length;
	const failed = await testApp.request(base, { method: "POST", headers, body: "{}" }, env);
	assert.equal(failed.status, 500);
	const keysAfter = [...bucket.store.keys()].filter((k) => k.startsWith("platform/aliases/")).length;
	assert.equal(keysAfter, keysBefore);
	mockStub.createAlias = realCreate;

	// 6. Delete alias
	const res4 = await testApp.request(`${base}/${alias.id}`, { method: "DELETE", headers }, env);
	assert.equal(res4.status, 204);
	assert.equal(await bucket.get(aliasMetadataKey(alias.alias_email)), null);
	assert.equal(aliasList.length, 0);
});

test("inbound mail to a paused or expired private email is dropped or bounced", async () => {
	const { receiveEmail } = await import("../index.ts");
	const mailboxId = "alex@example.com";
	const bucket = createBucket();
	await bucket.put(mailboxMetadataKey(mailboxId), "{}");

	const recorded = [];
	const env = {
		BUCKET: bucket,
		MAILBOX: {
			idFromName: () => ({}),
			get: () => ({
				async recordAliasInbound(email, blocked) {
					recorded.push({ email, blocked });
				},
			}),
		},
	};

	async function deliver(to) {
		const rejections = [];
		await receiveEmail(
			{
				to,
				from: "shop@vendor.com",
				headers: new Headers(),
				raw: new ReadableStream({ start: (c) => c.close() }),
				rawSize: 0,
				setReject: (reason) => rejections.push(reason),
			},
			env,
			{ waitUntil() {} },
		);
		return rejections;
	}

	const meta = (overrides) => ({
		kind: "private",
		aliasId: "a1",
		aliasEmail: "k8m2p9v4@example.com",
		targetMailboxId: mailboxId,
		domain: "example.com",
		baseDomain: "example.com",
		label: null,
		isActive: true,
		pausedAction: "drop",
		expiresAt: null,
		createdAt: new Date().toISOString(),
		...overrides,
	});

	await bucket.put(aliasMetadataKey("k8m2p9v4@example.com"), JSON.stringify(meta({ isActive: false })));
	assert.deepEqual(await deliver("k8m2p9v4@example.com"), []);

	await bucket.put(
		aliasMetadataKey("k8m2p9v4@example.com"),
		JSON.stringify(meta({ isActive: false, pausedAction: "reject" })),
	);
	assert.deepEqual(await deliver("K8M2P9V4+tag@example.com"), ["Address paused"]);

	await bucket.put(
		aliasMetadataKey("k8m2p9v4@example.com"),
		JSON.stringify(meta({ pausedAction: "reject", expiresAt: new Date(Date.now() - 1000).toISOString() })),
	);
	assert.deepEqual(await deliver("k8m2p9v4@example.com"), ["Address expired"]);

	assert.deepEqual(recorded, [
		{ email: "k8m2p9v4@example.com", blocked: true },
		{ email: "k8m2p9v4@example.com", blocked: true },
		{ email: "k8m2p9v4@example.com", blocked: true },
	]);

	// Unknown address still bounces as before
	assert.deepEqual(await deliver("nobody@example.com"), ["Mailbox does not exist"]);
});

test("extension tokens are scoped to private emails", async () => {
	const { isPathAllowedForTokenScope } = await import("../lib/auth-paths.ts");
	const { issueMobileSessionToken, verifyMobileSessionToken } = await import("../lib/apple-auth.ts");
	const { SignJWT } = await import("jose");

	assert.equal(isPathAllowedForTokenScope("aliases", "GET", "/api/v1/mailboxes"), true);
	assert.equal(isPathAllowedForTokenScope("aliases", "GET", "/api/v1/me"), true);
	assert.equal(isPathAllowedForTokenScope("aliases", "GET", "/api/v1/mailboxes/alex%40example.com/aliases"), true);
	assert.equal(isPathAllowedForTokenScope("aliases", "POST", "/api/v1/mailboxes/alex@example.com/aliases"), true);
	// Never mail, sends, alias edits/deletes, token minting, agents or MCP
	assert.equal(isPathAllowedForTokenScope("aliases", "GET", "/api/v1/mailboxes/alex@example.com/emails"), false);
	assert.equal(isPathAllowedForTokenScope("aliases", "POST", "/api/v1/mailboxes/alex@example.com/emails"), false);
	assert.equal(isPathAllowedForTokenScope("aliases", "DELETE", "/api/v1/mailboxes/alex@example.com/aliases/a1"), false);
	assert.equal(isPathAllowedForTokenScope("aliases", "PATCH", "/api/v1/mailboxes/alex@example.com/aliases/a1"), false);
	assert.equal(isPathAllowedForTokenScope("aliases", "POST", "/api/v1/me/extension-session"), false);
	assert.equal(isPathAllowedForTokenScope("aliases", "GET", "/agents/email-agent/x"), false);
	assert.equal(isPathAllowedForTokenScope("aliases", "POST", "/mcp"), false);

	const secret = "test-secret";
	const { token } = await issueMobileSessionToken(secret, {
		sub: "alex-sub",
		email: "alex@example.com",
		auth: "extension",
		scope: "aliases",
	});
	const claims = await verifyMobileSessionToken(token, secret);
	assert.equal(claims.auth, "extension");
	assert.equal(claims.scope, "aliases");

	// Regular sessions stay unscoped
	const app = await issueMobileSessionToken(secret, { sub: "alex-sub", auth: "apple" });
	assert.equal((await verifyMobileSessionToken(app.token, secret)).scope, undefined);

	// A hand-made unscoped extension token is refused
	const forged = await new SignJWT({ auth: "extension" })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject("alex-sub")
		.setIssuer("agentic-inbox")
		.setAudience("agentic-inbox-ios")
		.setIssuedAt()
		.setExpirationTime("1h")
		.sign(new TextEncoder().encode(secret));
	await assert.rejects(verifyMobileSessionToken(forged, secret));
});
