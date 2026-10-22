/**
 * Connected apps in Settings → Sessions (AVE-70): GET /api/v1/me/mcp-grants
 * lists the signed-in user's MCP OAuth grants, DELETE /api/v1/me/mcp-grants/:id
 * revokes one, and a revoked grant's access and refresh tokens stop working
 * at once. Real @cloudflare/workers-oauth-provider over an in-memory KV, real
 * AUTH_DB and Better Auth sessions; grants are created through the library's
 * helpers (the consent page has its own tests in mcp-oauth.test.mjs).
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mcp-grants.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { sessionMiddleware } from "../auth/middleware.ts";
import { createMcpOAuth, mcpOAuthApi, registerMcpOAuthRoutes, registerMcpRoutes } from "../mcp/oauth.ts";
import { addUser, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

function memoryKV() {
	const store = new Map();
	const live = (key) => {
		const entry = store.get(key);
		if (!entry) return null;
		if (entry.expiration && entry.expiration <= Date.now() / 1000) {
			store.delete(key);
			return null;
		}
		return entry;
	};
	const decode = (value, type) => ((typeof type === "string" ? type : type?.type) === "json" ? JSON.parse(value) : value);
	return {
		store,
		async get(key, type) {
			const entry = live(key);
			return entry ? decode(entry.value, type) : null;
		},
		async getWithMetadata(key, type) {
			const entry = live(key);
			return entry ? { value: decode(entry.value, type), metadata: entry.metadata ?? null } : { value: null, metadata: null };
		},
		async put(key, value, opts = {}) {
			const expiration = opts.expiration ?? (opts.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined);
			store.set(key, { value: typeof value === "string" ? value : JSON.stringify(value), metadata: opts.metadata, expiration });
		},
		async delete(key) {
			store.delete(key);
		},
		async list({ prefix = "", limit = 1000, cursor } = {}) {
			const names = [...store.keys()].filter((k) => k.startsWith(prefix) && live(k)).sort();
			const start = cursor ? Number(cursor) : 0;
			const page = names.slice(start, start + limit);
			const done = start + limit >= names.length;
			return {
				keys: page.map((name) => ({ name, metadata: store.get(name).metadata, expiration: store.get(name).expiration })),
				list_complete: done,
				...(done ? {} : { cursor: String(start + limit) }),
			};
		},
	};
}

const echoMcp = {
	async fetch(_request, _env, ctx) {
		return Response.json({ props: ctx.props ?? null });
	},
};

const app = new Hono();
// The second argument is ignored today; AVE-68 makes the consent renderer required.
const mcpOAuth = createMcpOAuth(echoMcp, { renderConsent: () => new Response("") });
registerMcpOAuthRoutes(app, mcpOAuth);
app.use("*", sessionMiddleware);
registerMcpRoutes(app, mcpOAuth, echoMcp);
app.route("/", apiApp);

const ctx = () => ({ waitUntil() {}, passThroughOnException() {}, props: {} });
async function call(env, url, { method = "GET", headers = {}, form } = {}) {
	const h = new Headers(headers);
	let body;
	if (form) {
		h.set("content-type", "application/x-www-form-urlencoded");
		body = new URLSearchParams(form).toString();
	}
	const res = await app.fetch(new Request(url, { method, headers: h, body }), env, ctx());
	const text = await res.text();
	return { status: res.status, data: text && (res.headers.get("content-type") ?? "").includes("json") ? JSON.parse(text) : null };
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });

const ISSUER = "https://inboxies.test";
const REDIRECT = "http://127.0.0.1:33418/callback";
const VERIFIER = "verifier-0123456789-0123456789-0123456789-abcdefgh";
const CHALLENGE = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER))).toString("base64url");

const { env, db } = createAuthTestEnv({ OAUTH_KV: memoryKV() });
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email" });
const adaSession = await signIn(env, ada);
const bobSession = await signIn(env, bob);
const adaAliasSession = await signIn(env, ada, { scope: "aliases" });

const api = mcpOAuthApi(env, new URL(ISSUER));
assert.ok(api, "OAuth helpers available with OAUTH_KV");

/** Register an app and approve it for `userId`; returns its tokens and client id. */
async function connect(userId, { clientName, scope = ["read", "draft", "send", "manage"], metadata = {} } = {}) {
	const client = await api.createClient({
		redirectUris: [REDIRECT],
		clientName,
		tokenEndpointAuthMethod: "none",
	});
	const params = new URLSearchParams({
		response_type: "code",
		client_id: client.clientId,
		redirect_uri: REDIRECT,
		state: "s",
		code_challenge: CHALLENGE,
		code_challenge_method: "S256",
		resource: `${ISSUER}/mcp`,
		scope: scope.join(" "),
	});
	const authRequest = await api.parseAuthRequest(new Request(`${ISSUER}/authorize?${params}`));
	const { redirectTo } = await api.completeAuthorization({
		request: authRequest,
		userId,
		metadata,
		scope,
		props: { v: 1, userId, mailboxIds: metadata.mailboxIds ?? null },
	});
	const code = new URL(redirectTo).searchParams.get("code");
	const token = await call(env, `${ISSUER}/token`, {
		method: "POST",
		form: { grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: client.clientId },
	});
	assert.equal(token.status, 200, JSON.stringify(token.data));
	return { clientId: client.clientId, access: token.data.access_token, refresh: token.data.refresh_token };
}
const mcp = (token) => call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(token) });
const list = (session) => call(env, `${ISSUER}/api/v1/me/mcp-grants`, { headers: bearer(session.token) });
const revoke = (session, id) => call(env, `${ISSUER}/api/v1/me/mcp-grants/${encodeURIComponent(id)}`, { method: "DELETE", headers: bearer(session.token) });

// ── Nothing connected yet ────────────────────────────────────────────
{
	const res = await list(adaSession);
	assert.equal(res.status, 200);
	assert.deepEqual(res.data, []);
}

const claude = await connect("ada", { clientName: "Claude Desktop" });
const cursor = await connect("ada", { clientName: "  ", scope: ["read"], metadata: { mailboxIds: ["ada@inboxies.email"] } });
const bobApp = await connect("bob", { clientName: "Bob's agent" });
for (const app of [claude, cursor, bobApp]) assert.equal((await mcp(app.access)).status, 200);

// ── Listing: own grants only, newest first, names and limits shown ───
let claudeGrantId;
{
	const res = await list(adaSession);
	assert.equal(res.status, 200);
	assert.equal(res.data.length, 2);
	const byClient = new Map(res.data.map((grant) => [grant.clientId, grant]));
	const c = byClient.get(claude.clientId);
	assert.equal(c.clientName, "Claude Desktop");
	assert.deepEqual(c.scopes.sort(), ["draft", "manage", "read", "send"]);
	assert.equal(c.mailboxIds, null, "no mailbox limit recorded means every mailbox");
	assert.ok(!Number.isNaN(Date.parse(c.createdAt)));
	assert.equal(typeof c.id, "string");
	claudeGrantId = c.id;

	const k = byClient.get(cursor.clientId);
	assert.equal(k.clientName, null, "blank registered names show as unnamed");
	assert.deepEqual(k.scopes, ["read"]);
	assert.deepEqual(k.mailboxIds, ["ada@inboxies.email"]);

	assert.ok(!res.data.some((grant) => grant.clientId === bobApp.clientId), "bob's grant is not listed for ada");
	for (const grant of res.data) {
		assert.equal(grant.userId, undefined);
		assert.equal(Object.keys(grant).some((key) => /secret|token|props/i.test(key)), false, "no secrets in the listing");
	}

	const bobs = await list(bobSession);
	assert.deepEqual(bobs.data.map((grant) => grant.clientId), [bobApp.clientId]);
}

// ── Auth: signed out, scoped sessions and OAuth tokens can't use it ──
{
	assert.equal((await call(env, `${ISSUER}/api/v1/me/mcp-grants`)).status, 401);
	assert.equal((await list(adaAliasSession)).status, 403, "extension/AutoFill sessions can't see connected apps");
	assert.equal((await revoke(adaAliasSession, claudeGrantId)).status, 403);
	assert.equal((await call(env, `${ISSUER}/api/v1/me/mcp-grants`, { headers: bearer(claude.access) })).status, 401, "OAuth tokens are /mcp only");
}

// ── Revoking someone else's grant (or junk) is a 404 and changes nothing ──
{
	const bobGrantId = (await list(bobSession)).data[0].id;
	assert.equal((await revoke(adaSession, bobGrantId)).status, 404);
	assert.equal((await mcp(bobApp.access)).status, 200, "bob's app still works");
	for (const junk of ["nope", "a:b", "..", `${bobGrantId}:x`]) {
		assert.equal((await revoke(adaSession, junk)).status, 404, junk);
	}
	assert.equal((await list(adaSession)).data.length, 2);
}

// ── Revoke kills access immediately: access token, refresh token, listing ──
{
	const res = await revoke(adaSession, claudeGrantId);
	assert.equal(res.status, 200);
	assert.deepEqual(res.data, { ok: true });

	assert.equal((await mcp(claude.access)).status, 401, "the next /mcp call fails");
	const refreshed = await call(env, `${ISSUER}/token`, {
		method: "POST",
		form: { grant_type: "refresh_token", refresh_token: claude.refresh, client_id: claude.clientId },
	});
	assert.equal(refreshed.status, 400, "and it can't refresh its way back");
	assert.equal(refreshed.data.error, "invalid_grant");

	const after = await list(adaSession);
	assert.deepEqual(after.data.map((grant) => grant.clientId), [cursor.clientId]);
	assert.equal((await mcp(cursor.access)).status, 200, "other apps keep working");
	assert.equal((await mcp(bobApp.access)).status, 200);

	assert.equal((await revoke(adaSession, claudeGrantId)).status, 404, "already revoked");
}

// ── Without OAUTH_KV the section is just empty ────────────────────────
{
	const { env: plain, db: plainDb } = createAuthTestEnv();
	const carol = await addUser(plainDb, { id: "carol", email: "carol@inboxies.email" });
	const session = await signIn(plain, carol);
	assert.equal(mcpOAuthApi(plain, new URL(ISSUER)), null);
	const res = await call(plain, `${ISSUER}/api/v1/me/mcp-grants`, { headers: bearer(session.token) });
	assert.equal(res.status, 200);
	assert.deepEqual(res.data, []);
	const del = await call(plain, `${ISSUER}/api/v1/me/mcp-grants/abc`, { method: "DELETE", headers: bearer(session.token) });
	assert.equal(del.status, 404);
}

console.log("mcp-grants: ok");
