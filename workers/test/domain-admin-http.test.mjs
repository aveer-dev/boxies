/**
 * Domain Admin and invites over HTTP after the auth cutover: admins are
 * AUTH_DB domain owner/admin rows and only act on their own domains; invites
 * are hashed rows; accepting creates a new user (or, signed in with the
 * emailed code, joins the current one) and never takes over an existing login.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-admin-http.test.mjs
 */

import assert from "node:assert/strict";
import { mailboxRole } from "../auth/authz.ts";
import { sha256Hex } from "../auth/otp.ts";
import {
	addDomain,
	addMailbox,
	addUser,
	authedRequest,
	createAuthTestEnv,
	lastCodeSentTo,
	principalFor,
	request,
	signIn,
} from "./auth-fixtures.mjs";

const { env, d1, db, bucket, mailboxes, email } = createAuthTestEnv();
const admin = await addUser(db, { id: "admin", email: "admin@acme.com" });
const helper = await addUser(db, { id: "helper", email: "helper@gmail.com" });
const rival = await addUser(db, { id: "rival", email: "rival@other.com" });
const nobody = await addUser(db, { id: "nobody", email: "nobody@gmail.com" });
const [asAdmin, asHelper, asRival, asNobody] = [admin, helper, rival, nobody].map((u) => principalFor(u));

await addDomain(db, bucket, { domain: "acme.com", ownerUserId: "admin", admins: ["helper"] });
await addDomain(db, bucket, { domain: "other.com", ownerUserId: "rival" });
await addDomain(db, bucket, { domain: "gone.com", ownerUserId: "admin", status: "decommissioned" });
await addMailbox(db, bucket, "existing@acme.com", { owners: ["admin"] });
await addMailbox(db, bucket, "secret@other.com", { owners: ["rival"] });

// ── /me reports admin status from rows ─────────────────────────
{
	const me = await request(env, { path: "/api/v1/me", principal: asHelper });
	assert.equal(me.payload.isAdmin, true);
	assert.deepEqual(me.payload.administeredDomains, ["acme.com"]);
	const plain = await request(env, { path: "/api/v1/me", principal: asNobody });
	assert.equal(plain.payload.isAdmin, false);
	assert.deepEqual(plain.payload.administeredDomains, []);
}

// ── List: only the admin's own domains ─────────────────────────
{
	const list = await request(env, { path: "/api/v1/admin/mailboxes", principal: asHelper });
	assert.equal(list.status, 200);
	assert.deepEqual(list.payload.map((m) => m.id), ["existing@acme.com"]);
	assert.deepEqual(list.payload[0].acl, { owners: ["email:admin@acme.com"], members: [] });
	assert.equal(list.payload[0].claimed, true);
	assert.equal((await request(env, { path: "/api/v1/admin/mailboxes", principal: asNobody })).status, 403);
}

// ── Create / assign / delete stay inside the admin's domains ───
{
	const created = await request(env, {
		method: "POST",
		path: "/api/v1/admin/mailboxes",
		principal: asHelper,
		body: { email: "Sales@Acme.com", name: "Sales" },
	});
	assert.equal(created.status, 201);
	assert.equal(created.payload.email, "sales@acme.com");
	assert.equal(await mailboxRole(db, "helper", "sales@acme.com"), "owner");

	for (const target of ["ceo@other.com", "x@gone.com", "x@inboxies.email"]) {
		const res = await request(env, { method: "POST", path: "/api/v1/admin/mailboxes", principal: asHelper, body: { email: target } });
		assert.equal(res.status, 403, `can't create ${target}`);
	}

	// Assign-to-me on the admin's own domain: becomes an owner, answers with the Mailbox shape.
	const assign = await request(env, {
		method: "POST",
		path: "/api/v1/admin/mailboxes/existing@acme.com/assign",
		principal: asHelper,
		body: { assignTo: "self" },
	});
	assert.equal(assign.status, 200);
	assert.equal(assign.payload.id, "existing@acme.com");
	assert.equal(assign.payload.email, "existing@acme.com");
	assert.ok(assign.payload.name);
	assert.equal(await mailboxRole(db, "helper", "existing@acme.com"), "owner");

	assert.equal(
		(await request(env, { method: "POST", path: "/api/v1/admin/mailboxes/secret@other.com/assign", principal: asHelper, body: { assignTo: "self" } })).status,
		403,
	);
	assert.equal(
		(await request(env, { method: "DELETE", path: "/api/v1/admin/mailboxes/secret@other.com", principal: asHelper })).status,
		403,
	);
	assert.equal(
		(await request(env, { method: "PUT", path: "/api/v1/admin/mailboxes/existing@acme.com/acl", principal: asAdmin, body: { owners: ["email:x@y.com"] } })).status,
		410,
		"raw ACL writes are gone",
	);
	const del = await request(env, { method: "DELETE", path: "/api/v1/admin/mailboxes/sales@acme.com", principal: asAdmin });
	assert.equal(del.status, 204);
	assert.ok(mailboxes.calls.some(([id, m]) => id === "sales@acme.com" && m === "purgeMailbox"));
	assert.equal(await mailboxRole(db, "helper", "sales@acme.com"), null);
}

// ── Invites: hashed at rest, escaped in mail, throttled ───────
let ownerInviteToken;
{
	const created = await request(env, {
		method: "POST",
		path: "/api/v1/admin/mailboxes",
		principal: asAdmin,
		body: {
			email: "alex@acme.com",
			name: "Alex",
			assignTo: { inviteEmail: "Alex@Gmail.com", inviteeName: '<a href="https://evil.example">click</a>', role: "owner" },
		},
	});
	assert.equal(created.status, 201);
	const invite = created.payload.invite;
	ownerInviteToken = invite.token;
	assert.match(invite.inviteUrl, /\/invite\?token=[0-9a-f]{48}$/, "invite links keep the token out of the path (AVE-126)");
	assert.equal(invite.emailSent, true);
	const stored = await d1.prepare("select token_hash, invitee_email from invite").all();
	assert.equal(stored.results.length, 1);
	assert.equal(stored.results[0].token_hash, await sha256Hex(invite.token), "only the token hash is stored");
	assert.equal(stored.results[0].invitee_email, "alex@gmail.com");

	const mail = email.sent.at(-1);
	assert.equal(mail.to, "alex@gmail.com");
	assert.equal(mail.html.includes('<a href="https://evil.example">'), false, "inviter-supplied name is escaped");
	assert.ok(mail.html.includes("&lt;a href="));

	// Revoke/resend by someone else's admin: 403. Resend right away: throttled.
	assert.equal((await request(env, { method: "POST", path: `/api/v1/admin/invites/${invite.token}/revoke`, principal: asRival })).status, 403);
	const resend = await request(env, { method: "POST", path: `/api/v1/admin/invites/${invite.token}/resend`, principal: asAdmin });
	assert.equal(resend.status, 429);

	const pub = await request(env, { path: `/api/v1/invites/${invite.token}` });
	assert.equal(pub.status, 200);
	assert.equal(pub.payload.mailboxId, "alex@acme.com");
	assert.equal(pub.payload.status, "pending");
	assert.equal((await request(env, { path: `/api/v1/invites/${"0".repeat(48)}` })).status, 404);

	// Admin list shows invites by id (hash), never the token.
	const list = await request(env, { path: "/api/v1/admin/mailboxes/alex@acme.com/invites", principal: asAdmin });
	assert.equal(list.payload.length, 1);
	assert.equal(list.payload[0].token, undefined);
}

// ── Codeless accept is off unless LEGACY_INVITE_ACCEPT is "true" ──
// An invite link alone (no emailed code) must not create a login — for an
// owner invite that login would be the mailbox address itself.
for (const value of [undefined, "false", "", "yes", "1"]) {
	const target = value === undefined ? env : { ...env, LEGACY_INVITE_ACCEPT: value };
	const denied = await request(target, {
		method: "POST",
		path: `/api/v1/invites/${ownerInviteToken}/accept`,
		body: { password: "alex password 123", displayName: "Alex" },
	});
	assert.equal(denied.status, 400, `codeless accept rejected (LEGACY_INVITE_ACCEPT=${value})`);
	assert.equal(denied.payload.codeRequired, true);
	assert.equal(denied.headers.get("set-cookie"), null, "no session");
	assert.equal(await d1.prepare("select count(*) as n from user where email = 'alex@acme.com'").first("n"), 0, "no user created");
	assert.equal((await request(env, { path: `/api/v1/invites/${ownerInviteToken}` })).payload.status, "pending", "the invite is still pending");
}

const legacy = { ...env, LEGACY_INVITE_ACCEPT: "true" };

// ── Accept (signed out, LEGACY_INVITE_ACCEPT="true"): new user, owner login ──
{
	const accept = await request(legacy, {
		method: "POST",
		path: `/api/v1/invites/${ownerInviteToken}/accept`,
		body: { password: "alex password 123", displayName: "Alex" },
	});
	assert.equal(accept.status, 200);
	assert.equal(accept.payload.mailboxId, "alex@acme.com");
	assert.equal(accept.payload.email, "alex@acme.com", "an owner signs in as the mailbox, as before");
	assert.ok(accept.payload.token);
	assert.ok(accept.headers.get("set-cookie")?.includes("better-auth.session_token="));
	assert.equal(await mailboxRole(db, accept.payload.userId, "alex@acme.com"), "owner");

	// The session works through the real middleware.
	const list = await authedRequest(env, { path: "/api/v1/mailboxes", token: accept.payload.token });
	assert.deepEqual(list.payload.map((m) => m.id), ["alex@acme.com"]);

	// Single use.
	const again = await request(legacy, { method: "POST", path: `/api/v1/invites/${ownerInviteToken}/accept`, body: { password: "another password 1" } });
	assert.equal(again.status, 410);
}

// ── Member invite (legacy, no code): login is the invitee address, unverified ──
{
	const inv = await request(env, {
		method: "POST",
		path: "/api/v1/mailboxes/existing@acme.com/invites",
		principal: asAdmin,
		body: { inviteEmail: "member@gmail.com", role: "member" },
	});
	assert.equal(inv.status, 201);
	const accept = await request(legacy, { method: "POST", path: `/api/v1/invites/${inv.payload.token}/accept`, body: { password: "member password 1" } });
	assert.equal(accept.status, 200);
	assert.equal(accept.payload.email, "member@gmail.com");
	const row = await d1.prepare("select email_verified from user where id = ?").bind(accept.payload.userId).first("email_verified");
	assert.equal(row, 0, "codeless accept leaves the address unverified");
	assert.equal(await d1.prepare("select count(*) as n from recovery_email where user_id = ?").bind(accept.payload.userId).first("n"), 0);
	assert.equal(await mailboxRole(db, accept.payload.userId, "existing@acme.com"), "member");

	// An invite to an address that already has an account can't create a
	// second login for it, and leaves the existing user alone.
	const inv2 = await request(env, { method: "POST", path: "/api/v1/mailboxes/existing@acme.com/invites", principal: asAdmin, body: { inviteEmail: "nobody@gmail.com", role: "member" } });
	const clash = await request(env, { method: "POST", path: `/api/v1/invites/${inv2.payload.token}/accept`, body: { password: "attacker password 1" } });
	assert.equal(clash.status, 409);
	assert.equal(await mailboxRole(db, "nobody", "existing@acme.com"), null);
	assert.equal(await d1.prepare("select count(*) as n from account where user_id = 'nobody'").first("n"), 0, "no password was added to nobody");
	assert.equal((await request(env, { path: `/api/v1/invites/${inv2.payload.token}` })).status, 200, "the invite is still pending");
}

// ── Default (codes required): verified address becomes the recovery email ──
{
	const strict = env;
	const inv = await request(strict, { method: "POST", path: "/api/v1/mailboxes/existing@acme.com/invites", principal: asAdmin, body: { inviteEmail: "carol@gmail.com", role: "member" } });
	const token = inv.payload.token;
	const noCode = await request(strict, { method: "POST", path: `/api/v1/invites/${token}/accept`, body: { password: "carol password 1" } });
	assert.equal(noCode.status, 400);
	assert.equal(noCode.payload.codeRequired, true);

	const sent = await request(strict, { method: "POST", path: `/api/v1/invites/${token}/otp` });
	assert.equal(sent.status, 200);
	assert.equal(sent.payload.sentTo, "carol@gmail.com", "the code goes to the invitee address only");
	const code = lastCodeSentTo(email, "carol@gmail.com");
	assert.ok(code);

	const wrong = await request(strict, { method: "POST", path: `/api/v1/invites/${token}/accept`, body: { password: "carol password 1", code: code === "000000" ? "111111" : "000000" } });
	assert.equal(wrong.status, 400);
	const ok = await request(strict, { method: "POST", path: `/api/v1/invites/${token}/accept`, body: { password: "carol password 1", code } });
	assert.equal(ok.status, 200);
	const user = await d1.prepare("select email, email_verified from user where id = ?").bind(ok.payload.userId).first();
	assert.deepEqual({ ...user }, { email: "carol@gmail.com", email_verified: 1 });
	const recovery = await d1.prepare("select email, verified_at from recovery_email where user_id = ?").bind(ok.payload.userId).first();
	assert.equal(recovery.email, "carol@gmail.com");
	assert.ok(recovery.verified_at);
}

// ── Signed in: the code is always required, and the invite joins that user ──
{
	const inv = await request(env, { method: "POST", path: "/api/v1/mailboxes/existing@acme.com/invites", principal: asAdmin, body: { inviteEmail: "nobody@gmail.com", role: "member" } });
	const token = inv.payload.token;
	const session = await signIn(env, nobody);
	const noCode = await authedRequest(env, { method: "POST", path: `/api/v1/invites/${token}/accept`, token: session.token, body: {} });
	assert.equal(noCode.status, 400);
	assert.equal(noCode.payload.codeRequired, true);
	await request(env, { method: "POST", path: `/api/v1/invites/${token}/otp` });
	const code = lastCodeSentTo(email, "nobody@gmail.com");
	// Signed out first: the address has an account, so 409 — and the code is
	// not used up, so it still works once they sign in.
	const signedOut = await request(env, { method: "POST", path: `/api/v1/invites/${token}/accept`, body: { code, password: "another password 1" } });
	assert.equal(signedOut.status, 409);
	const ok = await authedRequest(env, { method: "POST", path: `/api/v1/invites/${token}/accept`, token: session.token, body: { code } });
	assert.equal(ok.status, 200);
	assert.equal(ok.payload.userId, "nobody");
	assert.equal(await mailboxRole(db, "nobody", "existing@acme.com"), "member");
}

// ── Revoked invites can't be accepted ──────────────────────────
{
	const inv = await request(env, { method: "POST", path: "/api/v1/admin/invites", principal: asAdmin, body: { mailboxId: "existing@acme.com", inviteEmail: "late@gmail.com", role: "member" } });
	assert.equal(inv.status, 201);
	const revoke = await request(env, { method: "POST", path: `/api/v1/admin/invites/${inv.payload.token}/revoke`, principal: asAdmin });
	assert.equal(revoke.status, 200);
	assert.equal(revoke.payload.status, "revoked");
	const accept = await request(env, { method: "POST", path: `/api/v1/invites/${inv.payload.token}/accept`, body: { password: "late password 12" } });
	assert.equal(accept.status, 410);
	assert.equal(
		(await request(env, { method: "POST", path: "/api/v1/admin/invites", principal: asAdmin, body: { mailboxId: "secret@other.com", inviteEmail: "x@gmail.com" } })).status,
		403,
		"no invites into another tenant's mailbox",
	);
}

console.log("domain-admin-http: ok");
