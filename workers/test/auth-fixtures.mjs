/**
 * Shared fixtures for HTTP tests after the auth cutover: a real SQLite
 * AUTH_DB, an in-memory R2 bucket, a recording MAILBOX namespace, and helpers
 * to add users, mailboxes and domains as AUTH_DB rows.
 *
 * Two ways to call the API:
 * - `request(env, { principal })` mounts workers/index.ts under a parent that
 *   sets `principal` directly (like workers/app.ts does after the session
 *   middleware), for route-level tests.
 * - `authedRequest(env, { token })` runs the real session middleware
 *   (workers/auth/middleware.ts) with a Bearer token from `signIn()`, for
 *   tests of authentication itself.
 */

import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { sessionMiddleware, operatorMiddleware } from "../auth/middleware.ts";
import { registerOpsRoutes } from "../routes/ops.ts";
import { handleBetterAuthRequest } from "../routes/better-auth.ts";
import { authDb } from "../auth/authz.ts";
import * as schema from "../auth/schema.ts";
import { createSessionForUser } from "../auth/users.ts";
import { hashPassword } from "../lib/password-auth.ts";
import { mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { domainR2Key } from "../lib/domain-registry.ts";
import { createTestD1 } from "./d1-shim.mjs";

export const TEST_SECRET = "test-better-auth-secret-0123456789abcdef";

export function mockBucket(initial = {}) {
	const store = new Map(
		Object.entries(initial).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
	);
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { key, json: async () => JSON.parse(text), text: async () => text };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async list({ prefix = "" } = {}) {
			return {
				objects: [...store.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
				truncated: false,
			};
		},
		async delete(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
		},
	};
}

/**
 * A MAILBOX namespace whose stubs record calls in `calls` (`[mailboxId, method, ...args]`).
 * `stubExtras` adds or overrides stub methods.
 */
export function mockMailboxNamespace(stubExtras = {}) {
	const calls = [];
	const deviceTokens = new Map(); // mailboxId → Map(token → ownerKeys)
	const tokensFor = (id) => {
		if (!deviceTokens.has(id)) deviceTokens.set(id, new Map());
		return deviceTokens.get(id);
	};
	const namespace = {
		calls,
		deviceTokens,
		idFromName(name) {
			return name;
		},
		get(id) {
			const record = (method, ...args) => calls.push([id, method, ...args]);
			const base = {
				id,
				reviveMailbox: async () => record("reviveMailbox"),
				getFolders: async () => [],
				getEmails: async () => [],
				countEmails: async () => 0,
				purgeMailbox: async (mailboxId) => {
					record("purgeMailbox", mailboxId);
					return { conversationIds: [] };
				},
				registerDeviceToken: async (token, platform, ownerKeys) => {
					record("registerDeviceToken", token, platform, ownerKeys);
					tokensFor(id).set(token, ownerKeys ?? []);
					return { status: "registered" };
				},
				unregisterDeviceToken: async (token) => {
					tokensFor(id).delete(token);
					return { status: "unregistered" };
				},
				getDeviceTokens: async () => [...tokensFor(id).keys()].map((token) => ({ token, platform: "ios" })),
				removeDeviceTokensWithKey: async (key) => {
					record("removeDeviceTokensWithKey", key);
					let n = 0;
					for (const [token, keys] of tokensFor(id)) if (keys.includes(key)) (tokensFor(id).delete(token), n++);
					return n;
				},
				pruneDeviceTokensToMembers: async (userIds) => {
					record("pruneDeviceTokensToMembers", userIds);
					const allowed = new Set(userIds.map((u) => `user:${u}`));
					let n = 0;
					for (const [token, keys] of tokensFor(id)) if (!keys.some((k) => allowed.has(k))) (tokensFor(id).delete(token), n++);
					return n;
				},
				listAliases: async () => [],
				countAliases: async () => 0,
				// Welcome mail seeding: accept and ignore.
				createEmail: async () => {},
				insertEmail: async () => {},
				...stubExtras,
			};
			return new Proxy(base, {
				get(target, prop) {
					if (prop in target) return target[prop];
					if (prop === "then") return undefined;
					// Anything else (welcome seeding helpers etc.) is a recorded no-op.
					return async (...args) => record(String(prop), ...args);
				},
			});
		},
	};
	return namespace;
}

/** An EMAIL binding that records every message in `sent`. */
export function mockEmailBinding() {
	const sent = [];
	return {
		sent,
		async send(message) {
			sent.push(message);
			return { messageId: `msg-${sent.length}` };
		},
	};
}

/** The 6-digit code in the last email sent to `to`. */
export function lastCodeSentTo(emailBinding, to) {
	const msg = [...emailBinding.sent].reverse().find((m) => m.to === to);
	return msg?.text?.match(/\b(\d{6})\b/)?.[1] ?? null;
}

/** A full test env. Pass overrides for extra bindings/vars. */
export function createAuthTestEnv(overrides = {}) {
	const d1 = createTestD1();
	const env = {
		EMAIL: mockEmailBinding(),
		AUTH_DB: d1,
		BETTER_AUTH_SECRET: TEST_SECRET,
		APP_BASE_URL: "https://inboxies.test",
		DOMAINS: "inboxies.email",
		EMAIL_ADDRESSES: [],
		BUCKET: mockBucket(),
		MAILBOX: mockMailboxNamespace(),
		EMAIL_AGENT: {
			idFromName: (name) => name,
			get: () => ({ purge: async () => {} }),
		},
		...overrides,
	};
	return { env, d1, db: authDb(d1), bucket: env.BUCKET, mailboxes: env.MAILBOX, email: env.EMAIL };
}

export async function addUser(db, { id, email, name, password, emailVerified = true } = {}) {
	const userId = id ?? crypto.randomUUID();
	await db.insert(schema.user).values({
		id: userId,
		email: (email ?? `${userId}@example.com`).toLowerCase(),
		name: name ?? userId,
		emailVerified,
	});
	if (password) {
		await db.insert(schema.account).values({
			id: `credential_${userId}`,
			accountId: userId,
			providerId: "credential",
			userId,
			password: await hashPassword(password),
		});
	}
	return { id: userId, email: (email ?? `${userId}@example.com`).toLowerCase() };
}

/** A mailbox row plus memberships, and its R2 settings blob. */
export async function addMailbox(db, bucket, mailboxId, { owners = [], members = [], settings = {} } = {}) {
	await db.insert(schema.mailbox).values({ id: mailboxId, domain: mailboxId.split("@")[1] });
	for (const userId of owners) await db.insert(schema.mailboxMember).values({ mailboxId, userId, role: "owner" });
	for (const userId of members) await db.insert(schema.mailboxMember).values({ mailboxId, userId, role: "member" });
	await bucket.put(mailboxMetadataKey(mailboxId), JSON.stringify({ fromName: mailboxId.split("@")[0], ...settings }));
}

/** A domain row (+ admins) and its R2 metadata. */
export async function addDomain(
	db,
	bucket,
	{ domain, ownerUserId = null, admins = [], status = "active", meta = {} } = {},
) {
	await db.insert(schema.domain).values({ domain, ownerUserId, status });
	for (const userId of admins) await db.insert(schema.domainAdmin).values({ domain, userId });
	await bucket.put(
		domainR2Key(domain),
		JSON.stringify({
			domain,
			zoneId: `zone-${domain}`,
			ownerUserId: ownerUserId ?? "registrar_owner",
			adminUserIds: ownerUserId ? [ownerUserId, ...admins] : admins,
			status: status === "active" ? "active" : status === "decommissioned" ? "offboarding" : "pending_nameservers",
			nameservers: ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"],
			emailRoutingEnabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			...meta,
		}),
	);
}

/** The principal the session middleware would set for `user`. */
export function principalFor(user, { sessionId = `sess-${user.id}`, scope = null } = {}) {
	return { userId: user.id, sessionId, email: user.email, scope };
}

function parentApp(principal) {
	const parent = new Hono();
	parent.use("*", async (c, next) => {
		if (principal) c.set("principal", principal);
		await next();
	});
	parent.route("/", apiApp);
	return parent;
}

/** The same stack as workers/app.ts minus MCP/agents/React Router. */
function fullApp() {
	const app = new Hono();
	app.on(["GET", "POST"], "/api/auth/*", (c) => handleBetterAuthRequest(c.env, c.req.raw));
	app.use("/ops/*", operatorMiddleware);
	registerOpsRoutes(app);
	app.use("*", sessionMiddleware);
	app.route("/", apiApp);
	return app;
}

const waitUntilQueue = [];
const executionCtx = {
	waitUntil: (p) => waitUntilQueue.push(Promise.resolve(p).catch(() => {})),
	passThroughOnException() {},
	props: {},
};

/** Await everything handed to `waitUntil` so far. */
export async function flushWaitUntil() {
	while (waitUntilQueue.length) await waitUntilQueue.shift();
}

async function send(app, env, { method = "GET", path, body, headers = {} }) {
	const h = { ...headers };
	if (body !== undefined) h["content-type"] = "application/json";
	const res = await app.fetch(
		new Request(`https://inboxies.test${path}`, {
			method,
			headers: h,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		}),
		env,
		executionCtx,
	);
	const contentType = res.headers.get("content-type") ?? "";
	let payload = null;
	if (res.status !== 204 && contentType.includes("application/json")) payload = await res.json();
	else if (res.status !== 204) payload = await res.text();
	return { status: res.status, payload, headers: res.headers };
}

/** Route-level request with `principal` injected (or none). */
export function request(env, { principal, ...opts }) {
	return send(parentApp(principal), env, opts);
}

/** Request through the real session middleware; `token` is sent as a Bearer. */
export function authedRequest(env, { token, ...opts }) {
	const headers = { ...(opts.headers ?? {}) };
	if (token) headers.authorization = `Bearer ${token}`;
	return send(fullApp(), env, { ...opts, headers });
}

/** A real session row for `user`; returns its bearer token and id. */
export async function signIn(env, user, opts = {}) {
	const session = await createSessionForUser(env, user.id, opts);
	return { token: session.token, sessionId: session.id };
}
