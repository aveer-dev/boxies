/**
 * AVE-213: MCP OAuth grants don't outlive a reset of the account's sign-ins,
 * and connecting an app needs a fresh session.
 *
 * - Approving on the consent page needs a session that signed in or
 *   re-authenticated in the last 5 minutes (`reauthGate`); denying doesn't.
 *   The handle survives the refusal, so approving after re-auth works.
 * - A connected app records an `app_connected` security event and mails a
 *   "new app connected" notice.
 * - Password reset, password change (ours and Better Auth's), "sign out
 *   everywhere" (ours and Better Auth's) and account deletion revoke every
 *   grant: the refresh token stops working and so does the access token.
 *
 * Real @cloudflare/workers-oauth-provider over an in-memory KV, real AUTH_DB
 * and Better Auth sessions; the MCP Durable Object is an echo handler.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/mcp-grant-revocation.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { app as apiApp } from "../index.ts";
import { sessionMiddleware } from "../auth/middleware.ts";
import { handleBetterAuthRequest } from "../routes/better-auth.ts";
import { createMcpOAuth, mcpOAuthApi, registerMcpOAuthRoutes, registerMcpRoutes } from "../mcp/oauth.ts";
import { revokeAllMcpGrants } from "../mcp/grants.ts";
import { issueLinkToken } from "../auth/otp.ts";
import { recordReauth } from "../auth/reauth.ts";
import { describeChange } from "../auth/security-notice.ts";
import * as schema from "../auth/schema.ts";
import { addMailbox, addUser, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";
import { memoryKV } from "./memory-kv.mjs";

const echoMcp = {
	async fetch(request, _env, ctx) {
		return Response.json({ path: new URL(request.url).pathname, props: ctx.props ?? null });
	},
};
const renderConsent = (_request, _env, _ctx, view) =>
	new Response(JSON.stringify({ consentView: view }), { status: 200, headers: { "Content-Type": "application/json" } });

const app = new Hono();
app.on(["GET", "POST"], "/api/auth/*", (c) => handleBetterAuthRequest(c.env, c.req.raw, c.executionCtx));
const mcpOAuth = createMcpOAuth(echoMcp, { renderConsent });
registerMcpOAuthRoutes(app, mcpOAuth);
app.use("*", sessionMiddleware);
registerMcpRoutes(app, mcpOAuth, echoMcp);
app.route("/", apiApp);

const pending = [];
const ctx = () => ({ waitUntil: (p) => pending.push(Promise.resolve(p)), passThroughOnException() {}, props: {} });
async function flush() {
	while (pending.length) await pending.shift();
}

const ISSUER = "https://inboxies.test";
async function call(env, path, { method = "GET", headers = {}, form, json } = {}) {
	const h = new Headers(headers);
	let body;
	if (form) {
		h.set("content-type", "application/x-www-form-urlencoded");
		body = new URLSearchParams(form).toString();
	} else if (json) {
		h.set("content-type", "application/json");
		body = JSON.stringify(json);
	}
	const res = await app.fetch(new Request(`${ISSUER}${path}`, { method, headers: h, body, redirect: "manual" }), env, ctx());
	const text = res.status === 302 ? "" : await res.text();
	const data = (res.headers.get("content-type") ?? "").includes("json") && text ? JSON.parse(text) : null;
	await flush();
	return { status: res.status, headers: res.headers, text, data };
}
const bearer = (token) => ({ authorization: `Bearer ${token}` });

const { env, d1, db, bucket, email } = createAuthTestEnv({ OAUTH_KV: memoryKV() });
const PASSWORD = "ada password 123";
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email", password: PASSWORD });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });

const MIN = 60 * 1000;
const age = (sessionId, ms) =>
	d1.prepare("update session set created_at = ? where id = ?").bind(Date.now() - ms, sessionId).run();
async function staleSession(user) {
	const s = await signIn(env, user);
	await age(s.sessionId, 10 * MIN);
	return s;
}

// ── A registered app and the consent round trip ──────────────────
const REDIRECT = "http://127.0.0.1:33418/callback";
const VERIFIER = "verifier-0123456789-0123456789-0123456789-abcdefgh";
const CHALLENGE = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(VERIFIER))).toString("base64url");
const registered = await call(env, "/register", {
	method: "POST",
	json: { redirect_uris: [REDIRECT], client_name: "Claude Desktop", token_endpoint_auth_method: "none" },
});
assert.equal(registered.status, 201, registered.text);
const clientId = registered.data.client_id;
const authorizeUrl = `/authorize?${new URLSearchParams({
	response_type: "code",
	client_id: clientId,
	redirect_uri: REDIRECT,
	state: "st",
	code_challenge: CHALLENGE,
	code_challenge_method: "S256",
	resource: `${ISSUER}/mcp`,
})}`;

async function openConsent(session) {
	const res = await call(env, authorizeUrl, { headers: bearer(session.token) });
	assert.equal(res.status, 200, res.text);
	const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
	return { handle: res.data.consentView.handle, cookie };
}
function submit(session, { handle, cookie }, decision) {
	return call(env, "/authorize", {
		method: "POST",
		headers: { ...bearer(session.token), cookie, origin: ISSUER },
		form: [
			["handle", handle],
			["account", "ada"],
			["decision", decision],
			["scope", "read"],
			["scope", "send"],
			["mailbox", "ada@inboxies.email"],
		],
	});
}
async function exchange(approved) {
	assert.equal(approved.status, 302, approved.text);
	const code = new URL(approved.headers.get("location")).searchParams.get("code");
	assert.ok(code);
	const res = await call(env, "/token", {
		method: "POST",
		form: { client_id: clientId, grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER },
	});
	assert.equal(res.status, 200, res.text);
	return res.data;
}
/** Connect the app from a fresh session; returns its token pair. */
async function connect() {
	const session = await signIn(env, ada);
	return exchange(await submit(session, await openConsent(session), "approve"));
}
const refresh = (tokens) =>
	call(env, "/token", { method: "POST", form: { client_id: clientId, grant_type: "refresh_token", refresh_token: tokens.refresh_token } });
const mcp = (tokens) => call(env, "/mcp", { method: "POST", headers: bearer(tokens.access_token), json: {} });

/** The app works, then `action` runs, then neither its refresh nor access token does. */
async function assertRevokedBy(label, action) {
	const tokens = await connect();
	assert.equal((await mcp(tokens)).status, 200, `${label}: app works before`);
	await action();
	const refreshed = await refresh(tokens);
	assert.equal(refreshed.status, 400, `${label}: refresh fails after (${refreshed.text})`);
	assert.equal(refreshed.data?.error, "invalid_grant", label);
	assert.equal((await mcp(tokens)).status, 401, `${label}: access token fails after`);
	const left = await mcpOAuthApi(env, new URL(ISSUER)).listUserGrants("ada");
	assert.equal(left.items.length, 0, `${label}: no grants left`);
}

// ── Consent approval needs a fresh session ───────────────────────
{
	const stale = await staleSession(ada);
	const opened = await openConsent(stale); // viewing the page is fine
	const before = email.sent.length;
	const refused = await submit(stale, opened, "approve");
	assert.equal(refused.status, 403);
	assert.equal(refused.headers.get("location"), null, "nothing goes back to the app");
	assert.match(refused.text, /Confirm it(&#39;|')s you/);
	assert.equal(email.sent.length, before, "no notice for a refused approval");
	assert.equal((await mcpOAuthApi(env, new URL(ISSUER)).listUserGrants("ada")).items.length, 0, "no grant");

	// Re-authenticating makes the same session fresh; the handle survived.
	await recordReauth(db, { userId: "ada", sessionId: stale.sessionId });
	const tokens = await exchange(await submit(stale, opened, "approve"));
	assert.equal((await mcp(tokens)).status, 200);

	// Denying never needs re-auth.
	const other = await staleSession(ada);
	const denied = await submit(other, await openConsent(other), "deny");
	assert.equal(denied.status, 302);
	assert.equal(new URL(denied.headers.get("location")).searchParams.get("error"), "access_denied");

	// The re-auth status endpoint the web page checks first says the same.
	const status = await call(env, "/api/v1/me/reauth", { headers: bearer(other.token) });
	assert.equal(status.data.fresh, false);
	assert.ok(status.data.methods.includes("password"));
}

// ── Connecting records app_connected and mails a notice ──────────
{
	const before = email.sent.length;
	const eventsBefore = (
		await db.select().from(schema.securityEvent).where(and(eq(schema.securityEvent.userId, "ada"), eq(schema.securityEvent.kind, "app_connected"))).all()
	).length;
	await connect();
	const events = await db
		.select()
		.from(schema.securityEvent)
		.where(and(eq(schema.securityEvent.userId, "ada"), eq(schema.securityEvent.kind, "app_connected")))
		.all();
	assert.equal(events.length, eventsBefore + 1, "one app_connected event");
	assert.deepEqual(JSON.parse(events.at(-1).detail), { app: "Claude Desktop" });

	const mails = email.sent.slice(before).filter((m) => /new app was connected/i.test(m.subject));
	assert.equal(mails.length, 1, JSON.stringify(email.sent.slice(before).map((m) => m.subject)));
	assert.equal(mails[0].to, "ada@inboxies.email");
	assert.match(mails[0].text, /"Claude Desktop" was connected/);
	assert.match(mails[0].text, /read mail, send mail in ada@inboxies\.email/);
	assert.match(mails[0].text, /disconnect the app, then change your password:\nhttps:\/\/inboxies\.test\/settings\/sessions/, "links to where apps are disconnected");
	assert.ok(!/<script/i.test(mails[0].html));

	const activity = await call(env, "/api/v1/me/security-activity", { headers: bearer((await signIn(env, ada)).token) });
	assert.ok(activity.data.events.some((e) => e.kind === "app_connected"), "listed in Recent security activity");

	// An app's self-chosen name is escaped in the HTML mail and capped in the line.
	const { line } = describeChange({ kind: "app_connected", app: "x".repeat(200), scopes: ["read"], mailboxIds: ["a@b.c", "d@e.f"] });
	assert.ok(line.length < 200 + 100 && line.includes("…") && line.includes("2 mailboxes"));
}

// ── Every reset of the account's sign-ins revokes every grant ────
await assertRevokedBy("password reset", async () => {
	const token = await issueLinkToken(db, "password-reset", "ada", 60 * MIN);
	const res = await call(env, "/api/v1/auth/password/reset", { method: "POST", json: { token, newPassword: "ada password 456" } });
	assert.equal(res.status, 200, res.text);
});
let password = "ada password 456";

await assertRevokedBy("password change", async () => {
	const session = await signIn(env, ada);
	const res = await call(env, "/api/v1/me/identities/password", {
		method: "POST",
		headers: bearer(session.token),
		json: { currentPassword: password, newPassword: "ada password 789" },
	});
	assert.equal(res.status, 200, res.text);
	password = "ada password 789";
});

await assertRevokedBy("sign out everywhere else", async () => {
	const session = await signIn(env, ada);
	const res = await call(env, "/api/v1/me/sessions/revoke-others", { method: "POST", headers: bearer(session.token) });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.data.revokedApps, 1);
});

await assertRevokedBy("Better Auth revoke-other-sessions", async () => {
	const session = await signIn(env, ada);
	const res = await call(env, "/api/auth/revoke-other-sessions", { method: "POST", headers: { ...bearer(session.token), origin: ISSUER }, json: {} });
	assert.equal(res.status, 200, res.text);
});

await assertRevokedBy("Better Auth revoke-sessions", async () => {
	const session = await signIn(env, ada);
	const res = await call(env, "/api/auth/revoke-sessions", { method: "POST", headers: { ...bearer(session.token), origin: ISSUER }, json: {} });
	assert.equal(res.status, 200, res.text);
});

await assertRevokedBy("Better Auth change-password", async () => {
	const session = await signIn(env, ada);
	const res = await call(env, "/api/auth/change-password", {
		method: "POST",
		headers: { ...bearer(session.token), origin: ISSUER },
		json: { currentPassword: password, newPassword: "ada password abc" },
	});
	assert.equal(res.status, 200, res.text);
	password = "ada password abc";
});

// A failed change (wrong password) leaves the app connected.
{
	const tokens = await connect();
	const session = await signIn(env, ada);
	const wrong = await call(env, "/api/v1/me/identities/password", {
		method: "POST",
		headers: bearer(session.token),
		json: { currentPassword: "not it", newPassword: "ada password xyz" },
	});
	assert.equal(wrong.status, 403);
	const res = await refresh(tokens);
	assert.equal(res.status, 200, "a refused change revokes nothing");
	await revokeAllMcpGrants(mcpOAuthApi(env, new URL(ISSUER)), "ada");
}

// Revoking all grants removes every one, not just the first.
{
	const api = mcpOAuthApi(env, new URL(ISSUER));
	await connect();
	const second = await call(env, "/register", {
		method: "POST",
		json: { redirect_uris: [REDIRECT], client_name: "Other app", token_endpoint_auth_method: "none" },
	});
	const session = await signIn(env, ada);
	const opened = await call(env, authorizeUrl.replace(clientId, second.data.client_id), { headers: bearer(session.token) });
	assert.equal(opened.status, 200, opened.text);
	const cookie = opened.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
	assert.equal((await submit(session, { handle: opened.data.consentView.handle, cookie }, "approve")).status, 302);
	assert.equal((await api.listUserGrants("ada")).items.length, 2);
	assert.equal(await revokeAllMcpGrants(api, "ada"), 2);
	assert.equal((await api.listUserGrants("ada")).items.length, 0);
}

// Account deletion: last, the user is gone afterwards.
await assertRevokedBy("account deletion", async () => {
	const session = await signIn(env, ada);
	const res = await call(env, "/api/v1/me", { method: "DELETE", headers: bearer(session.token), json: { confirm: "DELETE" } });
	assert.equal(res.status, 200, res.text);
});

console.log("mcp-grant-revocation: ok");
