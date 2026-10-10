// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	generateRandomAliasToken,
	buildMaskedAddress,
	isAliasExpired,
	normalizePausedAction,
	aliasMetadataKey, resolveAliasFrom } from "../lib/alias-utils.ts";
import { validateSender, SenderValidationError } from "../lib/email-helpers.ts";

test("generateRandomAliasToken generates valid lowercase alphanumeric strings", () => {
	const token1 = generateRandomAliasToken(8);
	const token2 = generateRandomAliasToken(8);

	assert.equal(token1.length, 8);
	assert.equal(token2.length, 8);
	assert.notEqual(token1, token2);
	assert.match(token1, /^[a-z2-9]+$/);
});

test("buildMaskedAddress prefixes private. subdomain correctly", () => {
	const res1 = buildMaskedAddress("k8m2p9v4", "acme.com");
	assert.equal(res1.aliasEmail, "k8m2p9v4@private.acme.com");
	assert.equal(res1.domain, "private.acme.com");
	assert.equal(res1.baseDomain, "acme.com");
	assert.equal(res1.local, "k8m2p9v4");

	// Does not duplicate private. if already present
	const res2 = buildMaskedAddress("a1b2c3d4", "private.acme.com");
	assert.equal(res2.aliasEmail, "a1b2c3d4@private.acme.com");
	assert.equal(res2.domain, "private.acme.com");
	assert.equal(res2.baseDomain, "acme.com");

	// Strips trailing and leading dots
	const res3 = buildMaskedAddress("test1234", ".my-store.co.uk.");
	assert.equal(res3.aliasEmail, "test1234@private.my-store.co.uk");
	assert.equal(res3.domain, "private.my-store.co.uk");
	assert.equal(res3.baseDomain, "my-store.co.uk");
});

test("isAliasExpired accurately detects expired timestamps", () => {
	assert.equal(isAliasExpired(null), false);
	assert.equal(isAliasExpired(undefined), false);

	const futureIso = new Date(Date.now() + 1000 * 3600 * 24).toISOString();
	assert.equal(isAliasExpired(futureIso), false);

	const pastIso = new Date(Date.now() - 1000 * 60).toISOString();
	assert.equal(isAliasExpired(pastIso), true);
});

test("normalizePausedAction defaults to drop unless reject is explicitly specified", () => {
	assert.equal(normalizePausedAction("drop"), "drop");
	assert.equal(normalizePausedAction("reject"), "reject");
	assert.equal(normalizePausedAction("anything_else"), "drop");
	assert.equal(normalizePausedAction(undefined), "drop");
});

test("aliasMetadataKey formats canonical R2 storage key", () => {
	assert.equal(
		aliasMetadataKey("x7k2m9@private.example.com"),
		"platform/aliases/x7k2m9@private.example.com.json",
	);
});

test("validateSender allows sender matching active alias", () => {
	const mailboxId = "alex@example.com";
	const activeAlias = "b4k8z9w1@private.example.com";

	// 1. Primary address matches
	const primary = validateSender("dest@target.com", "alex@example.com", mailboxId);
	assert.equal(primary.fromEmail, "alex@example.com");
	assert.equal(primary.fromDomain, "example.com");

	// 2. Active alias matches when passed in allowedSenders
	const aliasSender = validateSender(
		"dest@target.com",
		activeAlias,
		mailboxId,
		[activeAlias],
	);
	assert.equal(aliasSender.fromEmail, activeAlias);
	assert.equal(aliasSender.fromDomain, "private.example.com");

	// 3. Rejects alias that is not in allowedSenders
	assert.throws(
		() => validateSender("dest@target.com", "hacker@private.example.com", mailboxId, [activeAlias]),
		SenderValidationError,
	);
});

test("aliases HTTP endpoints CRUD operations", async () => {
	const { app } = await import("../index.ts");
	const mailboxId = "alex@example.com";
	const store = new Map();

	const bucket = {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { json: async () => JSON.parse(text) };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async delete(key) {
			store.delete(key);
		},
	};

	// Mock mailbox metadata in R2
	await bucket.put(`mailboxes/${mailboxId}.json`, {
		fromName: "Alex",
		acl: { owners: ["email:alex@example.com"], members: [] },
	});

	// In-memory mock DO stub
	const aliasList = [];
	const mockStub = {
		async listAliases() {
			return [...aliasList];
		},
		async getAlias(idOrEmail) {
			return (
				aliasList.find((a) => a.id === idOrEmail || a.alias_email === idOrEmail) ||
				null
			);
		},
		async createAlias(alias) {
			aliasList.push(alias);
			return alias;
		},
		async updateAlias(id, updates) {
			const item = aliasList.find((a) => a.id === id);
			if (!item) return null;
			Object.assign(item, updates);
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

	const headers = {
		"Content-Type": "application/json",
	};

	// 1. Initial list -> empty
	const res1 = await testApp.request(
		`http://localhost/api/v1/mailboxes/${mailboxId}/aliases`,
		{ method: "GET", headers },
		env,
	);
	assert.equal(res1.status, 200);
	const data1 = await res1.json();
	assert.deepEqual(data1.aliases, []);

	// 2. Create alias
	const res2 = await testApp.request(
		`http://localhost/api/v1/mailboxes/${mailboxId}/aliases`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({ label: "Shopping", pausedAction: "drop" }),
		},
		env,
	);
	assert.equal(res2.status, 201);
	const data2 = await res2.json();
	assert.ok(data2.alias.id);
	assert.ok(data2.alias.alias_email.endsWith("@private.example.com"));
	assert.equal(data2.alias.base_domain, "example.com");
	assert.equal(data2.alias.label, "Shopping");

	// Verify R2 O(1) index was created
	const r2Meta = await bucket.get(aliasMetadataKey(data2.alias.alias_email));
	assert.ok(r2Meta);
	const r2Data = await r2Meta.json();
	assert.equal(r2Data.targetMailboxId, mailboxId);
	assert.equal(r2Data.isActive, true);

	// 3. Patch alias (pause)
	const res3 = await testApp.request(
		`http://localhost/api/v1/mailboxes/${mailboxId}/aliases/${data2.alias.id}`,
		{
			method: "PATCH",
			headers,
			body: JSON.stringify({ isActive: false, pausedAction: "reject" }),
		},
		env,
	);
	assert.equal(res3.status, 200);
	const data3 = await res3.json();
	assert.equal(data3.alias.is_active, false);
	assert.equal(data3.alias.mailbox_id, mailboxId);
	assert.equal(data3.alias.paused_action, "reject");

	// Verify R2 updated
	const r2Updated = await (await bucket.get(aliasMetadataKey(data2.alias.alias_email))).json();
	assert.equal(r2Updated.isActive, false);
	assert.equal(r2Updated.pausedAction, "reject");

	// 3b. Shipped iOS / Android builds send snake_case; it must not be dropped.
	const res3b = await testApp.request(
		`http://localhost/api/v1/mailboxes/${mailboxId}/aliases/${data2.alias.id}`,
		{
			method: "PATCH",
			headers,
			body: JSON.stringify({ is_active: true, paused_action: "drop", expires_in_seconds: 3600 }),
		},
		env,
	);
	assert.equal(res3b.status, 200);
	const data3b = await res3b.json();
	assert.equal(data3b.alias.is_active, true);
	assert.equal(data3b.alias.paused_action, "drop");
	assert.ok(data3b.alias.expires_at, "expires_in_seconds becomes an expiry");
	const r2Resumed = await (await bucket.get(aliasMetadataKey(data2.alias.alias_email))).json();
	assert.equal(r2Resumed.isActive, true);

	// A base domain that isn't the mailbox's (or a service domain) is refused.
	const resForeign = await testApp.request(
		`http://localhost/api/v1/mailboxes/${mailboxId}/aliases`,
		{ method: "POST", headers, body: JSON.stringify({ baseDomain: "someone-else.com" }) },
		env,
	);
	assert.equal(resForeign.status, 403);

	// 4. Delete alias
	const res4 = await testApp.request(
		`http://localhost/api/v1/mailboxes/${mailboxId}/aliases/${data2.alias.id}`,
		{ method: "DELETE", headers },
		env,
	);
	assert.equal(res4.status, 204);

	// Verify deleted in R2 and DO
	const r2Deleted = await bucket.get(aliasMetadataKey(data2.alias.alias_email));
	assert.equal(r2Deleted, null);
	assert.equal(aliasList.length, 0);
});

test("resolveAliasFrom never reveals the primary address on alias threads", async () => {
	const aliases = {
		"a1": { alias_email: "abc@private.example.com", is_active: 1, expires_at: null },
		"abc@private.example.com": { alias_email: "abc@private.example.com", is_active: 1, expires_at: null },
		"old": { alias_email: "old@private.example.com", is_active: 1, expires_at: "2000-01-01T00:00:00Z" },
	};
	const stub = { getAlias: async (key) => aliases[key] ?? null };
	const mailboxId = "me@example.com";

	// Reply to alias mail while the client asked for the primary: forced to the alias.
	const forced = await resolveAliasFrom(stub, {
		mailboxId,
		requestedFrom: { email: mailboxId, name: "Me" },
		originalAliasId: "a1",
	});
	assert.deepEqual(forced.from, { email: "abc@private.example.com", name: "Me" });
	assert.deepEqual(forced.allowedSenders, ["abc@private.example.com"]);

	// Explicit alias request is allowed; an unknown address is not added.
	const explicit = await resolveAliasFrom(stub, { mailboxId, requestedFrom: "abc@private.example.com" });
	assert.deepEqual(explicit.allowedSenders, ["abc@private.example.com"]);
	const stranger = await resolveAliasFrom(stub, { mailboxId, requestedFrom: "x@evil.com" });
	assert.deepEqual(stranger.allowedSenders, []);

	// Expired aliases are not used.
	const expired = await resolveAliasFrom(stub, { mailboxId, originalAliasId: "old" });
	assert.equal(expired.from, mailboxId);
});
