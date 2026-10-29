/**
 * MCP OAuth 2.1 (AVE-67, AVE-68 consent; workers/mcp/oauth.ts) end to end, with the real
 * @cloudflare/workers-oauth-provider over an in-memory KV, a real AUTH_DB and
 * real Better Auth sessions: discovery metadata, dynamic client registration,
 * /authorize (sign-in redirect, consent, CSRF binding, PKCE), token exchange,
 * /mcp with OAuth tokens and with legacy session tokens, and unrelated routes.
 * The MCP Durable Object is replaced by a handler that echoes its props, and
 * the React consent page by a renderer that returns the view it was given.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mcp-oauth.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { sessionMiddleware, EXPIRED_SESSION_ERROR } from "../auth/middleware.ts";
import { handleBetterAuthRequest } from "../routes/better-auth.ts";
import {
	createMcpOAuth,
	mcpOAuthConfig,
	registerMcpOAuthRoutes,
	registerMcpRoutes,
	MCP_OAUTH_SCOPES,
	grantCoversMailbox,
} from "../mcp/oauth.ts";
import { initialConsentScopes, validateConsentSelection } from "../../shared/mcp-consent.ts";
import { isOAuthAccessTokenShape, isOAuthMcpRequest, bearerTokenFromHeaders } from "../lib/mcp-oauth-token.ts";
import { isWorkerPagePath } from "../../app/lib/safe-redirect.ts";
import * as schema from "../auth/schema.ts";
import { and, eq } from "drizzle-orm";
import { addMailbox, addUser, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

// ── In-memory KV with the subset of the API the provider uses ─────────
function memoryKV() {
	const store = new Map(); // key → { value, metadata, expiration }
	const live = (key) => {
		const entry = store.get(key);
		if (!entry) return null;
		if (entry.expiration && entry.expiration <= Date.now() / 1000) {
			store.delete(key);
			return null;
		}
		return entry;
	};
	const decode = (value, type) => {
		const t = typeof type === "string" ? type : type?.type;
		return t === "json" ? JSON.parse(value) : value;
	};
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

// ── The same stack as workers/app.ts, minus agents and React Router ───
const echoMcp = {
	async fetch(request, _env, ctx) {
		return Response.json({ path: new URL(request.url).pathname, props: ctx.props ?? null });
	},
};

/** Stands in for the React Router render of app/routes/authorize.tsx. */
const renderConsent = (_request, _env, _ctx, view) =>
	new Response(JSON.stringify({ consentView: view }), {
		status: 200,
		// Like React Router's response: the Worker must add its own headers on top.
		headers: {
			"Content-Type": "application/json",
			"X-Frame-Options": "SAMEORIGIN",
			// The app's own policy (AVE-148) once enforced.
			"Content-Security-Policy": "script-src 'nonce-test'",
		},
	});

function buildApp() {
	const app = new Hono();
	app.on(["GET", "POST"], "/api/auth/*", (c) => handleBetterAuthRequest(c.env, c.req.raw));
	const mcpOAuth = createMcpOAuth(echoMcp, { renderConsent });
	registerMcpOAuthRoutes(app, mcpOAuth);
	app.use("*", sessionMiddleware);
	registerMcpRoutes(app, mcpOAuth, echoMcp);
	app.route("/", apiApp);
	return app;
}

const app = buildApp();
const ctx = () => ({ waitUntil() {}, passThroughOnException() {}, props: {} });

async function call(env, url, { method = "GET", headers = {}, body, form, json } = {}) {
	const h = new Headers(headers);
	let payload = body;
	if (form) {
		// An object, or [name, value] pairs for repeated fields (scope, mailbox).
		h.set("content-type", "application/x-www-form-urlencoded");
		payload = new URLSearchParams(form).toString();
	} else if (json) {
		h.set("content-type", "application/json");
		payload = JSON.stringify(json);
	}
	const res = await app.fetch(new Request(url, { method, headers: h, body: payload, redirect: "manual" }), env, ctx());
	const type = res.headers.get("content-type") ?? "";
	const text = res.status === 204 || res.status === 302 || res.status === 301 ? "" : await res.text();
	let data = null;
	if (type.includes("json") && text) data = JSON.parse(text);
	return { status: res.status, headers: res.headers, text, data };
}

const ISSUER = "https://inboxies.test";
const ALT = "https://mail.inboxies.test";
const { env, db, bucket } = createAuthTestEnv({ OAUTH_KV: memoryKV(), WEB_REDIRECT_HOSTS: "mail.inboxies.test" });
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "team@inboxies.email", { owners: ["bob"], members: ["ada"] });
await addMailbox(db, bucket, "bob@inboxies.email", { owners: ["bob"] });
const adaSession = await signIn(env, ada);
const bobSession = await signIn(env, bob);
const adaAliasSession = await signIn(env, ada, { scope: "aliases" });

// ── Token-shape glue ──────────────────────────────────────────────────
assert.equal(isOAuthAccessTokenShape("ada:grant:secret"), true);
assert.equal(isOAuthAccessTokenShape(adaSession.token), false, "Better Auth session tokens never look like OAuth tokens");
assert.equal(isOAuthAccessTokenShape("a::b"), false);
assert.equal(isOAuthAccessTokenShape("a:b:c:d"), false);
assert.equal(isOAuthMcpRequest("/mcp", new Headers({ authorization: "Bearer a:b:c" })), true);
assert.equal(isOAuthMcpRequest("/mcp/x", new Headers({ authorization: "bearer a:b:c" })), true);
assert.equal(isOAuthMcpRequest("/mcpx", new Headers({ authorization: "Bearer a:b:c" })), false);
assert.equal(isOAuthMcpRequest("/api/v1/mailboxes", new Headers({ authorization: "Bearer a:b:c" })), false);
assert.equal(isOAuthMcpRequest("/mcp", new Headers({ authorization: `Bearer ${adaSession.token}` })), false);
assert.equal(bearerTokenFromHeaders(new Headers({ authorization: "Bearer a b" })), null);
assert.equal(isWorkerPagePath("/authorize?client_id=x"), true);
assert.equal(isWorkerPagePath("/authorized"), false);
assert.equal(isWorkerPagePath("/mailbox/x"), false);

// Config: issuer is APP_BASE_URL; resources are /mcp there and on WEB_REDIRECT_HOSTS.
assert.deepEqual(mcpOAuthConfig(env, new URL("https://inboxies.test/x")), {
	issuer: ISSUER,
	resources: [`${ISSUER}/mcp`, `${ALT}/mcp`],
	defaultResource: `${ISSUER}/mcp`,
});
assert.equal(mcpOAuthConfig({ ...env, APP_BASE_URL: "http://evil.example" }, new URL(ISSUER)), null, "remote http issuer refused");
assert.equal(mcpOAuthConfig({ ...env, APP_BASE_URL: "" }, new URL("http://localhost:5173/mcp")).issuer, "http://localhost:5173");

// ── Discovery ─────────────────────────────────────────────────────────
{
	const res = await call(env, `${ISSUER}/.well-known/oauth-authorization-server`);
	assert.equal(res.status, 200);
	assert.equal(res.data.issuer, ISSUER);
	assert.equal(res.data.authorization_endpoint, `${ISSUER}/authorize`);
	assert.equal(res.data.token_endpoint, `${ISSUER}/token`);
	assert.equal(res.data.registration_endpoint, `${ISSUER}/register`);
	assert.deepEqual(res.data.code_challenge_methods_supported, ["S256"], "plain PKCE is not offered");
	assert.deepEqual(res.data.scopes_supported, [...MCP_OAUTH_SCOPES]);
	assert.ok(!res.data.grant_types_supported.includes("implicit"));

	const prm = await call(env, `${ISSUER}/.well-known/oauth-protected-resource/mcp`);
	assert.equal(prm.status, 200);
	assert.equal(prm.data.resource, `${ISSUER}/mcp`);
	assert.deepEqual(prm.data.authorization_servers, [ISSUER]);

	const altPrm = await call(env, `${ALT}/.well-known/oauth-protected-resource/mcp`);
	assert.equal(altPrm.data.resource, `${ALT}/mcp`);
	assert.deepEqual(altPrm.data.authorization_servers, [ISSUER]);

	// The AS endpoints live on the issuer origin only; elsewhere the app answers as before.
	const altAs = await call(env, `${ALT}/.well-known/oauth-authorization-server`);
	assert.equal(altAs.status, 401);
	assert.deepEqual(altAs.data, { error: "Unauthorized" });
}

// ── /mcp without credentials: same 401 as before, plus a discovery challenge ──
{
	const res = await call(env, `${ISSUER}/mcp`, { method: "POST", json: {} });
	assert.equal(res.status, 401);
	assert.deepEqual(res.data, { error: "Unauthorized" });
	assert.equal(
		res.headers.get("www-authenticate"),
		`Bearer realm="OAuth", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp"`,
	);
	const bad = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: { authorization: "Bearer not-a-session" } });
	assert.equal(bad.status, 401);
	assert.deepEqual(bad.data, { error: EXPIRED_SESSION_ERROR }, "legacy expired-token body unchanged for shipped clients");
	assert.match(bad.headers.get("www-authenticate"), /error="invalid_token"/);
}

// ── Dynamic client registration ───────────────────────────────────────
const REDIRECT = "http://127.0.0.1:33418/callback";
let clientId;
{
	const res = await call(env, `${ISSUER}/register`, {
		method: "POST",
		json: { redirect_uris: [REDIRECT], client_name: 'Evil <script>alert("x")</script>', token_endpoint_auth_method: "none" },
	});
	assert.equal(res.status, 201, res.text);
	clientId = res.data.client_id;
	assert.ok(clientId);
	assert.equal(res.data.client_secret, undefined, "public client");

	const remoteHttp = await call(env, `${ISSUER}/register`, {
		method: "POST",
		json: { redirect_uris: ["http://evil.example/cb"], token_endpoint_auth_method: "none" },
	});
	assert.equal(remoteHttp.status, 400, "remote http redirect URIs are refused");
	const jsScheme = await call(env, `${ISSUER}/register`, {
		method: "POST",
		json: { redirect_uris: ["javascript:alert(1)"], token_endpoint_auth_method: "none" },
	});
	assert.equal(jsScheme.status, 400);
}

// ── /authorize ────────────────────────────────────────────────────────
const VERIFIER = "verifier-0123456789-0123456789-0123456789-abcdefgh";
async function s256(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Buffer.from(digest).toString("base64url");
}
const CHALLENGE = await s256(VERIFIER);
function authorizeUrl(overrides = {}) {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT,
		state: "st-123",
		code_challenge: CHALLENGE,
		code_challenge_method: "S256",
		resource: `${ISSUER}/mcp`,
		...overrides,
	});
	for (const [k, v] of Object.entries(overrides)) if (v === null) params.delete(k);
	return `${ISSUER}/authorize?${params}`;
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });

/** Open the consent page as `session`; returns the view, the handle and the consent cookie. */
async function openConsent(session, url = authorizeUrl()) {
	const res = await call(env, url, { headers: bearer(session.token) });
	assert.equal(res.status, 200, res.text);
	const view = res.data.consentView;
	const handle = view.handle;
	const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
	assert.ok(handle && cookie.startsWith("__Host-oauth-consent"));
	return { res, view, handle, cookie };
}
/** Everything, in ada's own mailbox: what most tests approve. */
const GRANT_ALL = [...MCP_OAUTH_SCOPES.map((s) => ["scope", s]), ["mailbox", "ada@inboxies.email"]];
function submit(session, { handle, cookie }, form, headers = {}, grant = GRANT_ALL) {
	const fields = [["handle", handle], ["account", "ada"], ...Object.entries(form), ...grant];
	return call(env, `${ISSUER}/authorize`, {
		method: "POST",
		headers: { ...bearer(session.token), cookie, origin: ISSUER, ...headers },
		form: fields,
	});
}

{
	// Signed out: to the web login, coming back here afterwards.
	const out = await call(env, authorizeUrl(), { headers: { accept: "text/html" } });
	assert.equal(out.status, 302);
	const next = new URL(out.headers.get("location"), ISSUER);
	assert.equal(next.pathname, "/login");
	assert.equal(next.searchParams.get("next"), new URL(authorizeUrl()).pathname + new URL(authorizeUrl()).search);

	// Unregistered redirect URI: rendered here, never redirected.
	const wrongRedirect = await call(env, authorizeUrl({ redirect_uri: "http://127.0.0.1:33418/other" }), { headers: bearer(adaSession.token) });
	assert.equal(wrongRedirect.status, 400);
	assert.equal(wrongRedirect.headers.get("location"), null);
	const unknownClient = await call(env, authorizeUrl({ client_id: "nope" }), { headers: bearer(adaSession.token) });
	assert.equal(unknownClient.status, 400);
	assert.equal(unknownClient.headers.get("location"), null);

	// No PKCE, or plain PKCE: error back to the (validated) client.
	for (const overrides of [{ code_challenge: null, code_challenge_method: null }, { code_challenge: VERIFIER, code_challenge_method: "plain" }]) {
		const res = await call(env, authorizeUrl(overrides), { headers: bearer(adaSession.token) });
		assert.equal(res.status, 302, JSON.stringify(overrides));
		const to = new URL(res.headers.get("location"));
		assert.equal(`${to.origin}${to.pathname}`, REDIRECT);
		assert.equal(to.searchParams.get("error"), "invalid_request");
		assert.equal(to.searchParams.get("code"), null);
	}

	// An extension/AutoFill scoped session can't authorize apps.
	const scoped = await call(env, authorizeUrl(), { headers: bearer(adaAliasSession.token) });
	assert.equal(scoped.status, 403);
}

// Consent page: the view handed to the web page, anti-framing, nothing approved yet.
let code;
{
	const { res, view, handle, cookie } = await openConsent(adaSession);
	// Raw text: the React page escapes it when rendering.
	assert.equal(view.client.name, 'Evil <script>alert("x")</script>');
	assert.equal(view.client.domain, null, "a DCR client's name is unverified");
	assert.equal(view.client.redirectHost, "127.0.0.1", "redirect host shown");
	assert.equal(view.client.redirectIsLoopback, true);
	assert.equal(view.email, "ada@inboxies.email");
	assert.equal(view.account, "ada");
	assert.deepEqual(view.requestedScopes, ["read"], "no scope requested: read only is pre-checked");
	assert.deepEqual(
		view.mailboxes,
		[
			{ id: "ada@inboxies.email", role: "owner" },
			{ id: "team@inboxies.email", role: "member" },
		],
		"only mailboxes ada can open",
	);
	assert.equal(res.headers.get("x-frame-options"), "DENY", "the library's anti-framing header wins");
	assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
	assert.match(res.headers.get("content-security-policy"), /script-src 'nonce-test'/, "the app's CSP is kept alongside");
	assert.equal(res.headers.get("cache-control"), "no-store");
	assert.equal(res.headers.get("referrer-policy"), "same-origin", "no-referrer would make the post's Origin null");

	// CSRF: cross-site post, missing cookie, other browser, switched account.
	assert.equal((await submit(adaSession, { handle, cookie }, { decision: "approve" }, { origin: "https://evil.example" })).status, 403);
	assert.equal((await submit(adaSession, { handle, cookie }, { decision: "approve" }, { "sec-fetch-site": "cross-site" })).status, 403);
	assert.equal((await submit(adaSession, { handle, cookie: "" }, { decision: "approve" })).status, 400);
	assert.equal((await submit(bobSession, { handle, cookie }, { decision: "approve" })).status, 409, "account switched");
	assert.equal((await submit({ token: "nope" }, { handle, cookie }, { decision: "approve" })).status, 401);

	// Approve.
	const ok = await submit(adaSession, { handle, cookie }, { decision: "approve" });
	assert.equal(ok.status, 302, ok.text);
	const to = new URL(ok.headers.get("location"));
	assert.equal(`${to.origin}${to.pathname}`, REDIRECT);
	assert.equal(to.searchParams.get("state"), "st-123");
	assert.equal(to.searchParams.get("iss"), ISSUER);
	code = to.searchParams.get("code");
	assert.ok(code);

	// The handle is single-use.
	assert.equal((await submit(adaSession, { handle, cookie }, { decision: "approve" })).status, 400);
}

// Requested scopes are pre-checked (known ones only), read always.
{
	const { view } = await openConsent(adaSession, authorizeUrl({ scope: "send draft" }));
	assert.deepEqual(view.requestedScopes, ["read", "draft", "send"]);
}

// Approve is re-validated server-side before the handle is spent.
{
	const opened = await openConsent(adaSession);
	const approve = (grant) => submit(adaSession, opened, { decision: "approve" }, {}, grant);
	const rejected = [
		["no read", [["scope", "send"], ["mailbox", "ada@inboxies.email"]]],
		["unknown scope", [["scope", "read"], ["scope", "admin"], ["mailbox", "ada@inboxies.email"]]],
		["someone else's mailbox", [["scope", "read"], ["mailbox", "bob@inboxies.email"]]],
		["mixed with someone else's", [["scope", "read"], ["mailbox", "ada@inboxies.email"], ["mailbox", "bob@inboxies.email"]]],
		["non-canonical id", [["scope", "read"], ["mailbox", "ADA@inboxies.email"]]],
		["unknown mailbox", [["scope", "read"], ["mailbox", "nobody@inboxies.email"]]],
		["no mailbox", [["scope", "read"]]],
	];
	for (const [label, grant] of rejected) {
		const res = await approve(grant);
		assert.equal(res.status, 400, label);
		assert.equal(res.headers.get("location"), null, label);
	}
	// Approval needs a session even with a valid selection.
	assert.equal((await submit({ token: "nope" }, opened, { decision: "approve" }, {}, [["scope", "read"], ["mailbox", "ada@inboxies.email"]])).status, 401);

	// The handle survived the rejected posts; a narrow grant goes through.
	const ok = await approve([["scope", "read"], ["scope", "draft"], ["scope", "draft"], ["mailbox", "team@inboxies.email"]]);
	assert.equal(ok.status, 302, ok.text);
	const narrowCode = new URL(ok.headers.get("location")).searchParams.get("code");
	const res = await call(env, `${ISSUER}/token`, {
		method: "POST",
		form: { client_id: clientId, grant_type: "authorization_code", code: narrowCode, redirect_uri: REDIRECT, code_verifier: VERIFIER },
	});
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.data.scope.split(" "), ["read", "draft"], "granted scopes, deduplicated");
	const mcp = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(res.data.access_token), json: {} });
	assert.equal(mcp.status, 200);
	assert.deepEqual(mcp.data.props.oauth.scopes, ["read", "draft"]);
	assert.deepEqual(mcp.data.props.oauth.mailboxIds, ["team@inboxies.email"]);
}

// A mailbox ada lost access to after the page opened can't be granted.
{
	const opened = await openConsent(adaSession);
	assert.ok(opened.view.mailboxes.some((m) => m.id === "team@inboxies.email"));
	await db
		.delete(schema.mailboxMember)
		.where(and(eq(schema.mailboxMember.mailboxId, "team@inboxies.email"), eq(schema.mailboxMember.userId, "ada")));
	const res = await submit(adaSession, opened, { decision: "approve" }, {}, [["scope", "read"], ["mailbox", "team@inboxies.email"]]);
	assert.equal(res.status, 400);
	await db.insert(schema.mailboxMember).values({ mailboxId: "team@inboxies.email", userId: "ada", role: "member" });
}

// Deny needs no selection at all.
{
	const opened = await openConsent(adaSession);
	const denied = await submit(adaSession, opened, { decision: "deny" }, {}, []);
	assert.equal(denied.status, 302);
	assert.equal(new URL(denied.headers.get("location")).searchParams.get("error"), "access_denied");
}

// Deny goes back with access_denied and no code.
{
	const opened = await openConsent(adaSession);
	const denied = await submit(adaSession, opened, { decision: "deny" });
	assert.equal(denied.status, 302);
	const to = new URL(denied.headers.get("location"));
	assert.equal(to.searchParams.get("error"), "access_denied");
	assert.equal(to.searchParams.get("code"), null);
}

// A new authorization replaces the client's earlier grants (the library's
// default), so the narrow grant above revoked `code`: take a fresh one.
{
	const opened = await openConsent(adaSession);
	const ok = await submit(adaSession, opened, { decision: "approve" });
	code = new URL(ok.headers.get("location")).searchParams.get("code");
	assert.ok(code);
}

// ── Token exchange: PKCE verifier required ────────────────────────────
function tokenRequest(form) {
	return call(env, `${ISSUER}/token`, { method: "POST", form: { client_id: clientId, ...form } });
}
let accessToken;
let refreshToken;
{
	const noVerifier = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT });
	assert.equal(noVerifier.status, 400);
	assert.equal(noVerifier.data.error, "invalid_request");
	const wrongVerifier = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: `${VERIFIER}x` });
	assert.equal(wrongVerifier.status, 400);
	assert.equal(wrongVerifier.data.error, "invalid_grant");
}
/** Consent + approve + exchange: a fresh access/refresh token pair for ada. */
async function issueTokens() {
	const opened = await openConsent(adaSession);
	const ok = await submit(adaSession, opened, { decision: "approve" });
	const fresh = new URL(ok.headers.get("location")).searchParams.get("code");
	const res = await tokenRequest({ grant_type: "authorization_code", code: fresh, redirect_uri: REDIRECT, code_verifier: VERIFIER });
	assert.equal(res.status, 200, res.text);
	return { code: fresh, data: res.data };
}
{
	// A fresh code (the failed attempts may burn the first one).
	const { code: fresh, data } = await issueTokens();
	assert.equal(data.token_type.toLowerCase(), "bearer");
	assert.equal(data.resource, `${ISSUER}/mcp`);
	assert.deepEqual(data.scope.split(" ").sort(), [...MCP_OAUTH_SCOPES].sort());
	assert.ok(isOAuthAccessTokenShape(data.access_token));
	assert.ok(data.refresh_token);
	assert.ok(data.access_token.startsWith("ada:"));
	const before = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(data.access_token), json: {} });
	assert.equal(before.status, 200);

	// Codes are single-use, and replaying one revokes what it issued.
	const replay = await tokenRequest({ grant_type: "authorization_code", code: fresh, redirect_uri: REDIRECT, code_verifier: VERIFIER });
	assert.equal(replay.status, 400);
	const after = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(data.access_token), json: {} });
	assert.equal(after.status, 401, "code replay revokes the grant");

	({ access_token: accessToken, refresh_token: refreshToken } = (await issueTokens()).data);
}

// ── /mcp with the OAuth access token ──────────────────────────────────
{
	const res = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(accessToken), json: {} });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.data.props.principal.userId, "ada");
	assert.equal(res.data.props.principal.email, "ada@inboxies.email");
	assert.equal(res.data.props.principal.scope, null);
	assert.match(res.data.props.principal.sessionId, /^oauth:/);
	assert.equal(res.data.props.oauth.clientId, clientId);
	assert.deepEqual(res.data.props.oauth.scopes.sort(), [...MCP_OAUTH_SCOPES].sort());
	assert.deepEqual(res.data.props.oauth.mailboxIds, ["ada@inboxies.email"]);

	const sub = await call(env, `${ISSUER}/mcp/message`, { method: "POST", headers: bearer(accessToken), json: {} });
	assert.equal(sub.status, 200);

	// Audience-bound: not accepted at the other resource.
	const otherResource = await call(env, `${ALT}/mcp`, { method: "POST", headers: bearer(accessToken), json: {} });
	assert.equal(otherResource.status, 401);
	assert.match(otherResource.headers.get("www-authenticate"), /error="invalid_token"/);

	// Tampered / unknown tokens.
	const [u, g, secret] = accessToken.split(":");
	for (const forged of [`${u}:${g}:${secret}x`, `bob:${g}:${secret}`, "ada:nope:nope"]) {
		const res2 = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(forged), json: {} });
		assert.equal(res2.status, 401, forged);
		assert.match(res2.headers.get("www-authenticate"), /resource_metadata=".*\/\.well-known\/oauth-protected-resource\/mcp"/);
	}

	// OAuth tokens are for /mcp only: the REST API doesn't accept them.
	const api = await call(env, `${ISSUER}/api/v1/mailboxes`, { headers: bearer(accessToken) });
	assert.equal(api.status, 401);
	assert.deepEqual(api.data, { error: EXPIRED_SESSION_ERROR });
}

// Refresh works and yields a working token.
{
	const res = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
	assert.equal(res.status, 200, res.text);
	const mcp = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(res.data.access_token), json: {} });
	assert.equal(mcp.status, 200);
	accessToken = res.data.access_token;
}

// ── /mcp with the legacy session token: unchanged ─────────────────────
{
	const res = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(adaSession.token), json: {} });
	assert.equal(res.status, 200);
	assert.deepEqual(res.data.props, {
		principal: { userId: "ada", sessionId: adaSession.sessionId, email: "ada@inboxies.email", scope: null },
	});
	const scoped = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(adaAliasSession.token), json: {} });
	assert.equal(scoped.status, 403, "scoped sessions still can't reach MCP");
}

// ── Unrelated routes are unaffected ───────────────────────────────────
{
	const list = await call(env, `${ISSUER}/api/v1/mailboxes`, { headers: bearer(adaSession.token) });
	assert.equal(list.status, 200);
	assert.equal(list.data[0].id, "ada@inboxies.email");
	const signedOut = await call(env, `${ISSUER}/api/v1/mailboxes`);
	assert.equal(signedOut.status, 401);
	assert.equal(signedOut.headers.get("www-authenticate"), null, "no OAuth challenge outside /mcp");
	// Non-issuer /token falls through to the app as before.
	const altToken = await call(env, `${ALT}/token`, { method: "POST", form: { grant_type: "x" } });
	assert.equal(altToken.status, 401);
	assert.deepEqual(altToken.data, { error: "Unauthorized" });
}

// ── A deleted user's tokens stop working ──────────────────────────────
{
	await db.delete(schema.user).where(eq(schema.user.id, "ada"));
	const res = await call(env, `${ISSUER}/mcp`, { method: "POST", headers: bearer(accessToken), json: {} });
	assert.equal(res.status, 401);
}

// ── Without OAUTH_KV, OAuth is off and everything else is as before ───
{
	const { env: plain, db: plainDb } = createAuthTestEnv();
	const carol = await addUser(plainDb, { id: "carol", email: "carol@inboxies.email" });
	const session = await signIn(plain, carol);
	const meta = await call(plain, `${ISSUER}/.well-known/oauth-authorization-server`);
	assert.equal(meta.status, 401);
	const noCreds = await call(plain, `${ISSUER}/mcp`, { method: "POST", json: {} });
	assert.equal(noCreds.status, 401);
	assert.equal(noCreds.headers.get("www-authenticate"), null);
	const legacy = await call(plain, `${ISSUER}/mcp`, { method: "POST", headers: bearer(session.token), json: {} });
	assert.equal(legacy.status, 200);
	const oauthShaped = await call(plain, `${ISSUER}/mcp`, { method: "POST", headers: bearer("carol:g:s"), json: {} });
	assert.equal(oauthShaped.status, 401);
}

// ── Pure helpers ──────────────────────────────────────────────────────
{
	assert.deepEqual(initialConsentScopes([]), ["read"]);
	assert.deepEqual(initialConsentScopes(["manage", "openid", "read"]), ["read", "manage"]);
	const mine = ["a@x.test", "b@x.test"];
	assert.deepEqual(validateConsentSelection({ scopes: ["send", "read"], mailboxIds: ["b@x.test", "a@x.test"] }, mine), {
		ok: true,
		scopes: ["read", "send"],
		mailboxIds: ["a@x.test", "b@x.test"],
	});
	assert.equal(validateConsentSelection({ scopes: ["draft"], mailboxIds: ["a@x.test"] }, mine).ok, false);
	assert.equal(validateConsentSelection({ scopes: ["read", "READ"], mailboxIds: ["a@x.test"] }, mine).ok, false);
	assert.equal(validateConsentSelection({ scopes: ["read"], mailboxIds: [] }, mine).ok, false);
	assert.equal(validateConsentSelection({ scopes: ["read"], mailboxIds: ["c@x.test"] }, mine).ok, false);
	assert.equal(validateConsentSelection({ scopes: ["read"], mailboxIds: ["a@x.test"] }, []).ok, false);

	assert.equal(grantCoversMailbox(undefined, "a@x.test"), true, "session-token requests: user access only");
	assert.equal(grantCoversMailbox({ clientId: "c", scopes: ["read"], mailboxIds: null }, "a@x.test"), true, "pre-AVE-68 grants");
	assert.equal(grantCoversMailbox({ clientId: "c", scopes: ["read"], mailboxIds: ["a@x.test"] }, "a@x.test"), true);
	assert.equal(grantCoversMailbox({ clientId: "c", scopes: ["read"], mailboxIds: ["a@x.test"] }, "b@x.test"), false);
	assert.equal(grantCoversMailbox({ clientId: "c", scopes: ["read"], mailboxIds: [] }, "a@x.test"), false);
}

console.log("mcp-oauth: ok");
