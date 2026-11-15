/**
 * Watch sessions (AVE-143): minted from a full phone session, limited to the
 * watch allowlist (deny by default), alive exactly as long as the phone
 * session, unable to mint sessions, and revocable on their own.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-watch-session.test.mjs
 */

import assert from "node:assert/strict";
import { EXPIRED_SESSION_ERROR } from "../auth/middleware.ts";
import { isPathAllowedForTokenScope, moveAllowedForWatch } from "../lib/auth-paths.ts";
import { addMailbox, addUser, authedRequest, createAuthTestEnv, signIn } from "./auth-fixtures.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

const { env, d1, db, bucket } = createAuthTestEnv();
const ada = await addUser(db, { id: "ada", email: "ada@inboxies.email", password: "ada password 123" });
const bob = await addUser(db, { id: "bob", email: "bob@inboxies.email", password: "bob password 123" });
await addMailbox(db, bucket, "ada@inboxies.email", { owners: ["ada"] });
await addMailbox(db, bucket, "bob@inboxies.email", { owners: ["bob"] });

const MB = "/api/v1/mailboxes/ada%40inboxies.email";

const mintWatch = (token, client = "watchos") =>
	authedRequest(env, { method: "POST", path: "/api/v1/me/extension-session", token, body: { client } });
const sessionRow = (id) => d1.prepare("select * from session where id = ?").bind(id).first();
const setExpiry = (id, ms) => d1.prepare("update session set expires_at = ? where id = ?").bind(ms, id).run();
const status = async (token, method, path, body) =>
	(await authedRequest(env, { method, path, token, body: method === "GET" ? undefined : (body ?? {}) })).status;

// ── Allowlist (pure) ────────────────────────────────────────────
{
	const allowed = [
		["GET", "/api/v1/me"],
		["GET", "/api/v1/config"],
		["GET", "/api/v1/mailboxes"],
		["GET", `${MB}/folders`],
		["GET", `${MB}/emails`],
		["GET", `${MB}/emails/e1`],
		["PUT", `${MB}/emails/e1`],
		["POST", `${MB}/emails/e1/move`],
		["POST", `${MB}/emails/e1/quick-reply`],
		["GET", `${MB}/threads/t1`],
		["POST", `${MB}/threads/t1/read`],
		["POST", "/api/v1/auth/logout"],
	];
	for (const [method, path] of allowed) {
		assert.equal(isPathAllowedForTokenScope("watch", method, path), true, `watch may ${method} ${path}`);
	}
	const denied = [
		["POST", `${MB}/emails`], // compose
		["POST", `${MB}/drafts`],
		["POST", `${MB}/emails/e1/reply`], // full reply picks its own From
		["POST", `${MB}/emails/e1/forward`],
		["DELETE", `${MB}/emails/e1`],
		["GET", `${MB}/emails/e1/attachments/a1`],
		["GET", `${MB}/emails/e1/summary`],
		["POST", `${MB}/emails/e1/move/extra`],
		["GET", `${MB}/emails/e1/`],
		["HEAD", `${MB}/emails`],
		["PATCH", `${MB}/emails/e1`],
		["GET", `${MB}/aliases`],
		["POST", `${MB}/aliases`],
		["GET", `${MB}`],
		["PUT", `${MB}`],
		["DELETE", `${MB}`],
		["GET", `${MB}/members`],
		["POST", `${MB}/invites`],
		["POST", `${MB}/folders`],
		["POST", `${MB}/folders/trash/empty`],
		["POST", `${MB}/device-token`],
		["POST", `${MB}/test-push`],
		["GET", `${MB}/agent/conversations`],
		["GET", `${MB}/search`],
		["PUT", `${MB}/sender-rules`],
		["POST", `${MB}/export`],
		["POST", "/api/v1/mailboxes"],
		["POST", "/api/v1/me/extension-session"],
		["GET", "/api/v1/me/sessions"],
		["DELETE", "/api/v1/me/sessions/s1"],
		["POST", "/api/v1/me/sessions/revoke-others"],
		["DELETE", "/api/v1/me"],
		["GET", "/api/v1/me/mcp-grants"],
		["POST", "/api/v1/me/recovery-email"],
		["GET", "/api/v1/admin/domains"],
		["POST", "/api/v1/billing/create-domain-checkout"],
		["POST", "/mcp"],
		["GET", "/agents/email-agent/x"],
		["GET", "/settings"],
	];
	for (const [method, path] of denied) {
		assert.equal(isPathAllowedForTokenScope("watch", method, path), false, `watch may not ${method} ${path}`);
	}
	// The two scopes don't leak into each other; unknown scopes get nothing.
	assert.equal(isPathAllowedForTokenScope("aliases", "GET", `${MB}/emails`), false);
	assert.equal(isPathAllowedForTokenScope("watch", "GET", `${MB}/aliases`), false);
	assert.equal(isPathAllowedForTokenScope("admin", "GET", "/api/v1/me"), false);

	assert.equal(moveAllowedForWatch({ folderId: "archive" }), true);
	assert.equal(moveAllowedForWatch({ folderId: "spam", setSenderPreference: true }), true);
	assert.equal(moveAllowedForWatch({ folderId: "inbox" }), true);
	for (const body of [{ folderId: "trash" }, { folderId: "sent" }, { folderId: "custom-1" }, {}, { folderId: "spam", unsubscribe: true }]) {
		assert.equal(moveAllowedForWatch(body), false, JSON.stringify(body));
	}
}

// ── Minting ─────────────────────────────────────────────────────
const phone = await signIn(env, ada, { label: undefined });
let watch;
{
	const minted = await mintWatch(phone.token);
	assert.equal(minted.status, 200);
	assert.equal(minted.payload.label, "Apple Watch");
	watch = minted.payload;
	const row = await sessionRow(watch.id);
	assert.equal(row.scope, "watch");
	assert.equal(row.parent_session_id, phone.sessionId);
	const parent = await sessionRow(phone.sessionId);
	assert.equal(row.expires_at, parent.expires_at, "no separate expiry: the watch takes the phone's");
	assert.equal(Date.parse(watch.expiresAt), parent.expires_at);

	const wear = await mintWatch(phone.token, "wearos");
	assert.equal(wear.payload.label, "Wear OS watch");
	await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${wear.payload.id}`, token: phone.token });

	// /me tells the watch what it is.
	const me = await authedRequest(env, { path: "/api/v1/me", token: watch.token });
	assert.equal(me.status, 200);
	assert.equal(me.payload.sessionScope, "watch");
}

// ── Scoped sessions can't mint sessions ─────────────────────────
{
	for (const client of ["watchos", "wearos", "ios-autofill", undefined]) {
		const res = await authedRequest(env, {
			method: "POST",
			path: "/api/v1/me/extension-session",
			token: watch.token,
			body: { client },
		});
		assert.equal(res.status, 403, `a watch token can't mint a ${client} session`);
	}
	const autofill = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/extension-session",
		token: phone.token,
		body: { client: "ios-autofill" },
	});
	assert.equal(autofill.status, 200);
	const fromAutofill = await mintWatch(autofill.payload.token);
	assert.equal(fromAutofill.status, 403, "an AutoFill token can't mint a watch session");
	// Better Auth's own session routes are refused too.
	assert.equal((await authedRequest(env, { path: "/api/auth/list-sessions", token: watch.token })).status, 403);
	await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${autofill.payload.id}`, token: phone.token });
}

// ── Allowed routes work, everything else is 403 ────────────────
{
	assert.equal(await status(watch.token, "GET", "/api/v1/mailboxes"), 200);
	assert.equal(await status(watch.token, "GET", `${MB}/emails`), 200);
	assert.equal(await status(watch.token, "GET", `${MB}/folders`), 200);
	for (const [method, path, body] of [
		["GET", `${MB}/emails/e1`],
		["PUT", `${MB}/emails/e1`, { read: true }],
		["POST", `${MB}/emails/e1/move`, { folderId: "archive" }],
		["POST", `${MB}/threads/t1/read`],
		["GET", `${MB}/threads/t1`],
	]) {
		const s = await status(watch.token, method, path, body);
		assert.notEqual(s, 403, `${method} ${path} is allowed`);
		assert.notEqual(s, 401, `${method} ${path} is signed in`);
	}
	// Still bound by mailbox membership: Bob's mailbox is off limits.
	assert.equal(await status(watch.token, "GET", "/api/v1/mailboxes/bob%40inboxies.email/emails"), 403);

	for (const [method, path, body] of [
		["POST", `${MB}/emails`, { to: "x@example.com", subject: "hi", text: "hi" }],
		["POST", `${MB}/emails/e1/reply`, { to: "x@example.com", from: "ada@inboxies.email", subject: "Re", text: "hi" }],
		["POST", `${MB}/emails/e1/forward`],
		["DELETE", `${MB}/emails/e1`],
		["GET", `${MB}/aliases`],
		["POST", `${MB}/aliases`],
		["PUT", `${MB}`],
		["POST", `${MB}/device-token`, { token: "t", platform: "ios" }],
		["GET", `${MB}/agent/conversations`],
		["GET", "/api/v1/me/sessions"],
		["POST", "/api/v1/me/sessions/revoke-others"],
		["DELETE", "/api/v1/me", { confirm: "DELETE" }],
		["POST", "/mcp"],
	]) {
		assert.equal(await status(watch.token, method, path, body), 403, `${method} ${path} refused for a watch token`);
	}
	// Move: only Archive, Spam and back to Inbox, and no unsubscribe.
	for (const body of [{ folderId: "trash" }, { folderId: "sent" }, { folderId: "spam", unsubscribe: true }]) {
		assert.equal(await status(watch.token, "POST", `${MB}/emails/e1/move`, body), 403, JSON.stringify(body));
	}
	// The phone's full session keeps every move.
	assert.notEqual(await status(phone.token, "POST", `${MB}/emails/e1/move`, { folderId: "trash" }), 403);
}

// ── Devices & sessions: listed, and revocable on its own ────────
{
	const list = await authedRequest(env, { path: "/api/v1/me/sessions", token: phone.token });
	const entry = list.payload.find((s) => s.id === watch.id);
	assert.equal(entry.scope, "watch");
	assert.equal(entry.label, "Apple Watch");
	assert.equal(entry.parentSessionId, phone.sessionId);
	assert.equal(list.payload.some((s) => "token" in s), false);

	const revoke = await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${watch.id}`, token: phone.token });
	assert.equal(revoke.status, 200);
	const after = await authedRequest(env, { path: "/api/v1/mailboxes", token: watch.token });
	assert.equal(after.status, 401);
	assert.equal(after.payload.error, EXPIRED_SESSION_ERROR, "shipped clients treat this as signed out");
	assert.equal(await status(phone.token, "GET", "/api/v1/me"), 200, "revoking the watch leaves the phone signed in");
}

// ── Minting again replaces the previous watch token ─────────────
{
	const first = (await mintWatch(phone.token)).payload;
	const second = (await mintWatch(phone.token)).payload;
	assert.equal(await status(first.token, "GET", "/api/v1/me"), 401);
	assert.equal(await status(second.token, "GET", "/api/v1/me"), 200);
	watch = second;
}

// ── The watch signs out with the phone ─────────────────────────
// Phone signs out.
{
	assert.equal(await status(phone.token, "POST", "/api/v1/auth/logout"), 200);
	assert.equal(await status(watch.token, "GET", "/api/v1/me"), 401);
	assert.equal(await sessionRow(watch.id), null, "deleting the phone session deletes its watch session");
}
// Phone session revoked from another device.
{
	const phone2 = await signIn(env, ada);
	const laptop = await signIn(env, ada);
	const w = (await mintWatch(phone2.token, "wearos")).payload;
	assert.equal(await status(w.token, "GET", "/api/v1/me"), 200);
	await authedRequest(env, { method: "DELETE", path: `/api/v1/me/sessions/${phone2.sessionId}`, token: laptop.token });
	assert.equal(await status(w.token, "GET", "/api/v1/me"), 401);
	await authedRequest(env, { method: "POST", path: "/api/v1/auth/logout", token: laptop.token });
}
// Phone session expires (even if the row lingers until the nightly sweep).
{
	const phone3 = await signIn(env, ada);
	const w = (await mintWatch(phone3.token)).payload;
	assert.equal(await status(w.token, "GET", "/api/v1/me"), 200);
	await setExpiry(phone3.sessionId, Date.now() - 1000);
	const res = await authedRequest(env, { path: "/api/v1/me", token: w.token });
	assert.equal(res.status, 401);
	assert.equal(res.payload.error, EXPIRED_SESSION_ERROR);
	assert.equal(await sessionRow(w.id), null, "the orphaned watch session is cleaned up");
}
// A watch row whose phone session is gone without the cascade (defense in depth).
{
	const phone4 = await signIn(env, ada);
	const w = (await mintWatch(phone4.token)).payload;
	await d1.prepare("PRAGMA foreign_keys = OFF").run();
	await d1.prepare("delete from session where id = ?").bind(phone4.sessionId).run();
	await d1.prepare("PRAGMA foreign_keys = ON").run();
	assert.ok(await sessionRow(w.id), "row survives without the cascade");
	assert.equal(await status(w.token, "GET", "/api/v1/me"), 401);
}
// A watch row pointing at another user's session, or at a scoped session, is refused.
{
	const bobPhone = await signIn(env, bob);
	const adaPhone = await signIn(env, ada);
	const w = (await mintWatch(adaPhone.token)).payload;
	await d1.prepare("update session set parent_session_id = ? where id = ?").bind(bobPhone.sessionId, w.id).run();
	assert.equal(await status(w.token, "GET", "/api/v1/me"), 401);

	const w2 = (await mintWatch(adaPhone.token, "wearos")).payload;
	const autofill = (
		await authedRequest(env, { method: "POST", path: "/api/v1/me/extension-session", token: adaPhone.token, body: { client: "ios-autofill" } })
	).payload;
	await d1.prepare("update session set parent_session_id = ? where id = ?").bind(autofill.id, w2.id).run();
	assert.equal(await status(w2.token, "GET", "/api/v1/me"), 401);
}

// ── While the phone stays active, so does the watch ─────────────
{
	const phone5 = await signIn(env, ada);
	const w = (await mintWatch(phone5.token)).payload;
	// Ten days left on both: the phone's next request is due a refresh.
	const soon = Date.now() + 10 * DAY_MS;
	await setExpiry(phone5.sessionId, soon);
	await setExpiry(w.id, soon);
	const lastActiveBefore = (await sessionRow(w.id)).updated_at;
	assert.equal(await status(phone5.token, "GET", "/api/v1/me"), 200);
	const parent = await sessionRow(phone5.sessionId);
	assert.ok(parent.expires_at > Date.now() + 29 * DAY_MS, "the phone session was refreshed");
	const child = await sessionRow(w.id);
	assert.equal(child.expires_at, parent.expires_at, "the watch session follows the phone's refresh");
	assert.equal(child.updated_at, lastActiveBefore, "following the phone doesn't mark the watch active");
	assert.equal(await status(w.token, "GET", "/api/v1/me"), 200);

	// Listed with the phone's expiry, and gone from the list with the phone.
	const list = await authedRequest(env, { path: "/api/v1/me/sessions", token: phone5.token });
	const entry = list.payload.find((s) => s.id === w.id);
	assert.equal(Date.parse(entry.expiresAt) <= parent.expires_at, true);
}

// ── Unknown scopes are never read as full sessions ─────────────
{
	const odd = await signIn(env, ada);
	await d1.prepare("update session set scope = 'admin' where id = ?").bind(odd.sessionId).run();
	assert.equal(await status(odd.token, "GET", "/api/v1/me"), 401);
}

console.log("auth watch session ok");
