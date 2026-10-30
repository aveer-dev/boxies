/**
 * Web app URLs carry no account details (AVE-126): mailboxes are named by
 * their index in the user's list, old address-style URLs and `/invite/<token>`
 * links redirect, and invite links put the token in the query string.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/web-mailbox-url.test.mjs
 */

import assert from "node:assert/strict";
import {
	invitePath,
	legacyInviteRedirect,
	legacyMailboxRedirect,
	mailboxHref,
	mailboxRefFor,
	orderMailboxIds,
	parseMailboxIndex,
	reconcileMailboxRef,
	resolveMailboxRef,
	withMailboxRef,
} from "../../shared/mailbox-url.ts";
import { isLegacyMailboxPage, legacyAppPageResponse, legacyInviteResponse } from "../lib/legacy-app-urls.ts";
import { isWorkerPagePath } from "../../app/lib/safe-redirect.ts";

// The server's order (ORDER BY mailbox_id), whatever order the ids arrive in.
const ids = ["zoe@acme.com", "ada@inboxies.email", "bob@acme.com"];
assert.deepEqual(orderMailboxIds(ids), ["ada@inboxies.email", "bob@acme.com", "zoe@acme.com"]);

// Index segments.
assert.equal(parseMailboxIndex("0"), 0);
assert.equal(parseMailboxIndex("12"), 12);
for (const bad of ["", "-1", "01", "1.5", "1e3", "12345", "ada@inboxies.email", " 1", null, undefined]) {
	assert.equal(parseMailboxIndex(bad), null, `not an index: ${bad}`);
}

// Index ↔ mailbox.
assert.equal(mailboxRefFor("bob@acme.com", ids), "1");
assert.equal(mailboxRefFor("nobody@acme.com", ids), null);
assert.equal(mailboxHref("zoe@acme.com", ids), "/mailbox/2");
assert.equal(mailboxHref("nobody@acme.com", ids), null);
assert.deepEqual(resolveMailboxRef("0", ids), { kind: "mailbox", mailboxId: "ada@inboxies.email", index: 0 });
assert.deepEqual(resolveMailboxRef("3", ids), { kind: "unknown" }, "out of range");
assert.deepEqual(resolveMailboxRef("0", []), { kind: "unknown" });
// Old address segments, raw or %-encoded, any case.
assert.deepEqual(resolveMailboxRef("bob@acme.com", ids), { kind: "legacy", mailboxId: "bob@acme.com", index: 1 });
assert.deepEqual(resolveMailboxRef("BOB%40acme.com", ids), { kind: "legacy", mailboxId: "bob@acme.com", index: 1 });
assert.deepEqual(resolveMailboxRef("eve@acme.com", ids), { kind: "unknown" }, "someone else's mailbox");
assert.deepEqual(resolveMailboxRef("%E0%A4%A", ids), { kind: "unknown" }, "malformed escapes don't throw");

assert.equal(withMailboxRef("/mailbox/bob@acme.com/emails/inbox/abc", "1"), "/mailbox/1/emails/inbox/abc");
assert.equal(withMailboxRef("/mailbox/bob@acme.com", "1"), "/mailbox/1");
assert.equal(withMailboxRef("/login", "1"), "/login");

// Legacy mailbox URLs → the same view at the index; unknown → `/`.
assert.equal(
	legacyMailboxRedirect("/mailbox/bob%40acme.com/emails/inbox/abc-123", "?x=1", ids),
	"/mailbox/1/emails/inbox/abc-123?x=1",
);
assert.equal(legacyMailboxRedirect("/mailbox/zoe@acme.com/search", "?q=hi", ids), "/mailbox/2/search?q=hi");
assert.equal(legacyMailboxRedirect("/mailbox/eve@acme.com/emails/inbox", "", ids), "/");
assert.equal(legacyMailboxRedirect("/mailbox/1/emails/inbox", "", ids), null, "index URLs need no redirect");
assert.equal(legacyMailboxRedirect("/login", "", ids), null);

// The route: show, rewrite, or leave.
assert.deepEqual(reconcileMailboxRef("1", ids), { kind: "show", mailboxId: "bob@acme.com" });
assert.deepEqual(reconcileMailboxRef("bob@acme.com", ids), { kind: "redirect", ref: "1", mailboxId: "bob@acme.com" });
// Out of range → the remembered mailbox (AVE-90), else the first, else `/`.
assert.deepEqual(reconcileMailboxRef("9", ids, null, "zoe@acme.com"), { kind: "leave", fallbackRef: "2" });
assert.deepEqual(reconcileMailboxRef("9", ids, null, "gone@acme.com"), { kind: "leave", fallbackRef: "0" });
assert.deepEqual(reconcileMailboxRef("9", ids), { kind: "leave", fallbackRef: "0" });
assert.deepEqual(reconcileMailboxRef("0", []), { kind: "leave", fallbackRef: null });
// A mailbox added before the open one shifts indexes: the open one keeps its place.
const grown = [...ids, "abe@acme.com"]; // sorts first
assert.deepEqual(reconcileMailboxRef("1", grown, "bob@acme.com"), { kind: "redirect", ref: "2", mailboxId: "bob@acme.com" });
assert.deepEqual(reconcileMailboxRef("2", grown, "bob@acme.com"), { kind: "show", mailboxId: "bob@acme.com" });
// The pinned mailbox was removed: resolve the URL as it stands.
assert.deepEqual(reconcileMailboxRef("1", ["ada@inboxies.email", "zoe@acme.com"], "bob@acme.com"), {
	kind: "show",
	mailboxId: "zoe@acme.com",
});

// Invite links: token in the query string.
const token = "a".repeat(48);
assert.equal(invitePath(token), `/invite?token=${token}`);
assert.equal(legacyInviteRedirect(`/invite/${token}`, ""), `/invite?token=${token}`);
assert.equal(legacyInviteRedirect(`/invite/${token}/`, "?code=1"), `/invite?token=${token}&code=1`);
assert.equal(legacyInviteRedirect(`/invite/${token}`, "?token=other"), `/invite?token=${token}`);
assert.equal(legacyInviteRedirect("/invite", `?token=${token}`), null);
assert.equal(legacyInviteRedirect("/invited/x", ""), null);

// Worker: answered with a redirect before any page (or analytics beacon) loads.
const req = (path, method = "GET") => new Request(`https://inboxies.app${path}`, { method });
const inv = legacyInviteResponse(req(`/invite/${token}`));
assert.equal(inv?.status, 302);
assert.equal(inv?.headers.get("Location"), `/invite?token=${token}`);
assert.equal(inv?.headers.get("Cache-Control"), "no-store");
assert.equal(legacyInviteResponse(req(`/invite?token=${token}`)), null);
assert.equal(legacyInviteResponse(req(`/invite/${token}`, "POST")), null);

assert.equal(isLegacyMailboxPage(req("/mailbox/bob@acme.com/emails/inbox")), true);
assert.equal(isLegacyMailboxPage(req("/mailbox/1/emails/inbox")), false);
assert.equal(isLegacyMailboxPage(req("/mailbox/bob@acme.com", "POST")), false);
assert.equal(isLegacyMailboxPage(req("/api/v1/mailboxes/bob@acme.com")), false);
const noFolders = async () => {
	throw new Error("built-in folders need no folder list");
};
const mb = await legacyAppPageResponse(req("/mailbox/bob@acme.com/emails/inbox?x=1"), ids, noFolders);
assert.equal(mb?.status, 302);
assert.equal(mb?.headers.get("Location"), "/mailbox/1/emails/inbox?x=1");
assert.equal((await legacyAppPageResponse(req("/mailbox/eve@acme.com"), ids, noFolders))?.headers.get("Location"), "/");
assert.equal(await legacyAppPageResponse(req("/mailbox/0"), ids, noFolders), null);

// After sign-in, old-style `next` targets load in full so the Worker rewrites them.
assert.equal(isWorkerPagePath("/mailbox/bob@acme.com/emails/inbox"), true);
assert.equal(isWorkerPagePath(`/invite/${token}`), true);
assert.equal(isWorkerPagePath("/mailbox/0/emails/inbox"), false);
assert.equal(isWorkerPagePath(`/invite?token=${token}`), false);

console.log("web-mailbox-url: ok");
