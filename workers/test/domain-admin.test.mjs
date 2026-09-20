/**
 * Domain admin + invite + password unit tests.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-admin.test.mjs
 */

import assert from "node:assert/strict";
import {
	parseDomainAdminsEnv,
	parseMailboxCreatePolicy,
	principalIsDomainAdmin,
	canCreateMailbox,
	parsePersistedAdmins,
} from "../lib/domain-admin.ts";
import { principalFromClaims, principalKeys, normalizeAclKey } from "../lib/mailbox-acl.ts";
import {
	hashPassword,
	verifyPassword,
	validatePasswordStrength,
	issuePasswordSessionToken,
	verifyPasswordSessionToken,
} from "../lib/password-auth.ts";
import {
	createInviteRecord,
	inviteIsActive,
	parseInvite,
	publicInvitePayload,
} from "../lib/invites.ts";
import {
	aclKeysForPlatformUser,
	parsePlatformUser,
	principalFromPlatformUser,
} from "../lib/platform-users.ts";

// ── Domain admins ─────────────────────────────────────────────────

assert.deepEqual(parseDomainAdminsEnv(""), []);
assert.deepEqual(parseDomainAdminsEnv("  Ada@Inboxies.Email , sub:abc  "), [
	"email:ada@inboxies.email",
	"sub:abc",
]);

const ada = principalFromClaims({ email: "Ada@Inboxies.Email", sub: "ada-sub" });
const allow = new Set(parseDomainAdminsEnv("ada@inboxies.email"));
assert.equal(principalIsDomainAdmin(ada, allow), true);
assert.equal(
	principalIsDomainAdmin(principalFromClaims({ email: "eve@x.com" }), allow),
	false,
);

assert.equal(parseMailboxCreatePolicy(undefined, false), "open");
assert.equal(parseMailboxCreatePolicy(undefined, true), "admin_only");
assert.equal(parseMailboxCreatePolicy("open", true), "open");
assert.equal(parseMailboxCreatePolicy("admin_only", false), "admin_only");

assert.equal(
	canCreateMailbox(ada, { isAdmin: false, policy: "open" }),
	true,
);
assert.equal(
	canCreateMailbox(ada, { isAdmin: false, policy: "admin_only" }),
	false,
);
assert.equal(
	canCreateMailbox(ada, { isAdmin: true, policy: "admin_only" }),
	true,
);

assert.deepEqual(parsePersistedAdmins({ admins: ["bob@x.com", "sub:z"] }), [
	"email:bob@x.com",
	"sub:z",
]);

assert.equal(normalizeAclKey("user:abc-123"), "user:abc-123");
assert.ok(principalKeys({ sub: "user:abc-123" }).includes("user:abc-123"));
assert.ok(principalKeys({ sub: "user:abc-123" }).includes("sub:user:abc-123"));

// ── Password ──────────────────────────────────────────────────────

assert.equal(validatePasswordStrength("short"), "Password must be at least 10 characters");
assert.equal(validatePasswordStrength("long-enough-password"), null);

const hash = await hashPassword("correct-horse-battery");
assert.equal(await verifyPassword("correct-horse-battery", hash), true);
assert.equal(await verifyPassword("wrong-password", hash), false);

const session = await issuePasswordSessionToken("test-secret-for-jwt!!", {
	userId: "uid-1",
	email: "alex@inboxies.email",
});
const claims = await verifyPasswordSessionToken(session.token, "test-secret-for-jwt!!");
assert.equal(claims.auth, "password");
assert.equal(claims.uid, "uid-1");
assert.equal(claims.sub, "user:uid-1");
assert.equal(claims.email, "alex@inboxies.email");

// ── Invites ───────────────────────────────────────────────────────

const invite = createInviteRecord({
	mailboxId: "Alex@Inboxies.Email",
	inviteeEmail: "Person@Gmail.com",
	createdByKeys: principalKeys(ada),
});
assert.ok(!("error" in invite));
assert.equal(invite.mailboxId, "alex@inboxies.email");
assert.equal(invite.inviteeEmail, "person@gmail.com");
assert.equal(invite.role, "owner");
assert.equal(invite.status, "pending");
assert.equal(inviteIsActive(invite), true);
assert.equal(publicInvitePayload(invite).mailboxId, "alex@inboxies.email");

const parsed = parseInvite(invite);
assert.ok(parsed);
assert.equal(parsed.token, invite.token);

const expired = { ...invite, expiresAt: new Date(Date.now() - 1000).toISOString() };
assert.equal(inviteIsActive(expired), false);

// ── Platform users ────────────────────────────────────────────────

const user = parsePlatformUser({
	id: "u1",
	contactEmail: "person@gmail.com",
	mailboxEmail: "alex@inboxies.email",
	passwordHash: hash,
	linkedSubs: ["apple-sub"],
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});
assert.ok(user);
const keys = aclKeysForPlatformUser(user);
assert.ok(keys.includes("user:u1"));
assert.ok(keys.includes("email:alex@inboxies.email"));
assert.ok(keys.includes("sub:apple-sub"));
const p = principalFromPlatformUser(user);
assert.equal(p.email, "alex@inboxies.email");
assert.equal(p.sub, "user:u1");

console.log("domain-admin + invites + password: ok");
