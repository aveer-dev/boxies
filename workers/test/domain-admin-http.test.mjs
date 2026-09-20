/**
 * HTTP E2E for Domain Admin + invites + password accept.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-admin-http.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { principalFromClaims } from "../lib/mailbox-acl.ts";
import { verifyMobileSessionToken } from "../lib/apple-auth.ts";

const admin = principalFromClaims({
	email: "admin@example.com",
	sub: "admin-sub",
});
const eve = principalFromClaims({ email: "eve@example.com", sub: "eve-sub" });

function mockBucket(initial = {}) {
	const store = new Map(
		Object.entries(initial).map(([key, value]) => [
			key,
			typeof value === "string" ? value : JSON.stringify(value),
		]),
	);
	return {
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
		async list({ prefix = "" } = {}) {
			return {
				objects: [...store.keys()]
					.filter((key) => key.startsWith(prefix))
					.map((key) => ({ key })),
			};
		},
		async delete(key) {
			store.delete(key);
		},
	};
}

function mockEnv(bucket, extras = {}) {
	return {
		BUCKET: bucket,
		EMAIL_ADDRESSES: [],
		DOMAINS: "inboxies.email",
		DOMAIN_ADMINS: "admin@example.com",
		MAILBOX_CREATE_POLICY: "admin_only",
		MOBILE_JWT_SECRET: "test-mobile-jwt-secret-xx",
		APP_BASE_URL: "https://inboxies.email",
		EMAIL: {
			send: async () => ({ messageId: "msg-1" }),
		},
		MAILBOX: {
			idFromName(name) {
				return name;
			},
			get(id) {
				return {
					id,
					reviveMailbox: async () => {},
					getFolders: async () => [],
					getEmails: async () => [],
					countEmails: async () => 0,
					purgeMailbox: async () => ({ conversationIds: [] }),
				};
			},
		},
		EMAIL_AGENT: {
			idFromName(name) {
				return name;
			},
			get() {
				return { purge: async () => {} };
			},
		},
		...extras,
	};
}

function mountedApp(principal) {
	const parent = new Hono();
	parent.use("*", async (c, next) => {
		if (principal) c.set("principal", principal);
		await next();
	});
	parent.route("/", apiApp);
	return parent;
}

async function jsonRequest(app, env, { method = "GET", path, principal, body } = {}) {
	const parent = mountedApp(principal);
	const res = await parent.request(path, {
		method,
		headers: body ? { "content-type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	}, env);
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	return { status: res.status, json, headers: res.headers };
}

// ── /me isAdmin ───────────────────────────────────────────────────

{
	const bucket = mockBucket();
	const env = mockEnv(bucket);
	const adminMe = await jsonRequest(apiApp, env, {
		path: "/api/v1/me",
		principal: admin,
	});
	assert.equal(adminMe.status, 200);
	assert.equal(adminMe.json.isAdmin, true);

	const eveMe = await jsonRequest(apiApp, env, {
		path: "/api/v1/me",
		principal: eve,
	});
	assert.equal(eveMe.status, 200);
	assert.equal(eveMe.json.isAdmin, false);
}

// ── Non-admin cannot create when admin_only ───────────────────────

{
	const bucket = mockBucket();
	const env = mockEnv(bucket);
	const res = await jsonRequest(apiApp, env, {
		method: "POST",
		path: "/api/v1/mailboxes",
		principal: eve,
		body: { email: "eve@inboxies.email", name: "Eve" },
	});
	assert.equal(res.status, 403);
	assert.match(res.json.error, /admin/i);
}

// ── Admin list/create/assign-self ─────────────────────────────────

{
	const bucket = mockBucket({
		[mailboxMetadataKey("existing@inboxies.email")]: {
			fromName: "Existing",
			acl: { owners: ["email:someone@else.com"], members: [] },
		},
	});
	const env = mockEnv(bucket);

	const forbidden = await jsonRequest(apiApp, env, {
		path: "/api/v1/admin/mailboxes",
		principal: eve,
	});
	assert.equal(forbidden.status, 403);

	const list = await jsonRequest(apiApp, env, {
		path: "/api/v1/admin/mailboxes",
		principal: admin,
	});
	assert.equal(list.status, 200);
	assert.equal(list.json.length, 1);
	assert.equal(list.json[0].email, "existing@inboxies.email");

	const created = await jsonRequest(apiApp, env, {
		method: "POST",
		path: "/api/v1/admin/mailboxes",
		principal: admin,
		body: {
			email: "adminbox@inboxies.email",
			name: "Admin Box",
			assignTo: "self",
		},
	});
	assert.equal(created.status, 201);
	assert.equal(created.json.email, "adminbox@inboxies.email");
	assert.ok(created.json.settings.acl.owners.includes("email:admin@example.com"));

	const userList = await jsonRequest(apiApp, env, {
		path: "/api/v1/mailboxes",
		principal: admin,
	});
	assert.equal(userList.status, 200);
	assert.ok(userList.json.some((m) => m.id === "adminbox@inboxies.email"));
}

// ── Admin invite + accept password ────────────────────────────────

{
	const bucket = mockBucket();
	const env = mockEnv(bucket);

	const created = await jsonRequest(apiApp, env, {
		method: "POST",
		path: "/api/v1/admin/mailboxes",
		principal: admin,
		body: {
			email: "alex@inboxies.email",
			name: "Alex",
			assignTo: {
				inviteEmail: "alex.person@gmail.com",
				inviteeName: "Alex",
			},
		},
	});
	assert.equal(created.status, 201);
	assert.ok(created.json.invite?.token);
	assert.equal(created.json.invite.emailSent, true);
	assert.ok(created.json.invite.inviteUrl.includes("/invite/"));

	const token = created.json.invite.token;

	const pub = await jsonRequest(apiApp, env, {
		path: `/api/v1/invites/${token}`,
	});
	assert.equal(pub.status, 200);
	assert.equal(pub.json.mailboxId, "alex@inboxies.email");
	assert.equal(pub.json.status, "pending");

	const accept = await jsonRequest(apiApp, env, {
		method: "POST",
		path: `/api/v1/invites/${token}/accept`,
		body: { password: "secure-password-1", displayName: "Alex P" },
	});
	assert.equal(accept.status, 200);
	assert.equal(accept.json.mailboxId, "alex@inboxies.email");
	assert.ok(accept.json.token);
	assert.ok(accept.json.principal.keys.some((k) => k.startsWith("user:")));

	const sessionClaims = await verifyMobileSessionToken(
		accept.json.token,
		env.MOBILE_JWT_SECRET,
	);
	assert.equal(sessionClaims.auth, "password");

	const inviteePrincipal = principalFromClaims(sessionClaims);
	const mailboxes = await jsonRequest(apiApp, env, {
		path: "/api/v1/mailboxes",
		principal: inviteePrincipal,
	});
	assert.equal(mailboxes.status, 200);
	assert.equal(mailboxes.json.length, 1);
	assert.equal(mailboxes.json[0].id, "alex@inboxies.email");

	const eveList = await jsonRequest(apiApp, env, {
		path: "/api/v1/mailboxes",
		principal: eve,
	});
	assert.equal(eveList.json.length, 0);

	const login = await jsonRequest(apiApp, env, {
		method: "POST",
		path: "/api/v1/auth/password",
		body: { email: "alex@inboxies.email", password: "secure-password-1" },
	});
	assert.equal(login.status, 200);
	assert.ok(login.json.token);

	const badLogin = await jsonRequest(apiApp, env, {
		method: "POST",
		path: "/api/v1/auth/password",
		body: { email: "alex@inboxies.email", password: "nope-nope-no" },
	});
	assert.equal(badLogin.status, 401);
}

// ── Admin transfer ACL ────────────────────────────────────────────

{
	const bucket = mockBucket({
		[mailboxMetadataKey("xfer@inboxies.email")]: {
			fromName: "X",
			acl: { owners: ["email:old@example.com"], members: [] },
		},
	});
	const env = mockEnv(bucket);
	const res = await jsonRequest(apiApp, env, {
		method: "PUT",
		path: "/api/v1/admin/mailboxes/xfer@inboxies.email/acl",
		principal: admin,
		body: { owners: ["email:admin@example.com"], members: [] },
	});
	assert.equal(res.status, 200);
	assert.deepEqual(res.json.settings.acl.owners, ["email:admin@example.com"]);
}

console.log("domain-admin-http: ok");
