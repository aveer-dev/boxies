/**
 * Tags (custom folders) are named in web app URLs by their index, never the
 * name the user chose (AVE-126): `/mailbox/0/tags/1`. Old `/emails/<tag-id>`
 * links are rewritten, by the Worker before the page loads or by the app.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/web-tag-url.test.mjs
 */

import assert from "node:assert/strict";
import {
	folderListSegment,
	isSystemFolderId,
	legacyTagRedirect,
	legacyTagSegmentOf,
	orderTagIds,
	reconcileListFolder,
	resolveLegacyTagSegment,
	tagRefFor,
	withListSegment,
} from "../../shared/tag-url.ts";
import { isLegacyMailboxPage, legacyAppPageResponse } from "../lib/legacy-app-urls.ts";
import { isWorkerPagePath } from "../../app/lib/safe-redirect.ts";

// A mailbox's folders as GET /folders returns them: built-ins plus tags, any order.
const folderIds = ["inbox", "zeta-project", "sent", "acme-invoices", "trash", "2024", "spam"];

assert.equal(isSystemFolderId("inbox"), true);
assert.equal(isSystemFolderId("screened_out"), true);
assert.equal(isSystemFolderId("acme-invoices"), false);

// Tags only, sorted by id (ids don't change on rename, so neither do indexes).
assert.deepEqual(orderTagIds(folderIds), ["2024", "acme-invoices", "zeta-project"]);
assert.equal(tagRefFor("acme-invoices", folderIds), "1");
assert.equal(tagRefFor("inbox", folderIds), null, "built-ins aren't tags");
assert.equal(tagRefFor("gone", folderIds), null);

// Links: built-ins by name, tags by index.
assert.equal(folderListSegment("inbox", folderIds), "emails/inbox");
assert.equal(folderListSegment("zeta-project", folderIds), "tags/2");
assert.equal(folderListSegment("gone", folderIds), null);
for (const id of orderTagIds(folderIds)) {
	assert.ok(!folderListSegment(id, folderIds).includes(id), `no tag name in the path: ${id}`);
}

// Old `/emails/<tag-id>` segments: by id, raw or %-encoded, any case.
assert.deepEqual(resolveLegacyTagSegment("acme-invoices", folderIds), { tagId: "acme-invoices", index: 1 });
assert.deepEqual(resolveLegacyTagSegment("ACME-Invoices", folderIds), { tagId: "acme-invoices", index: 1 });
assert.deepEqual(resolveLegacyTagSegment("2024", folderIds), { tagId: "2024", index: 0 }, "a numeric tag name is a name, not an index");
assert.equal(resolveLegacyTagSegment("inbox", folderIds), null);
assert.equal(resolveLegacyTagSegment("%E0%A4%A", folderIds), null, "malformed escapes don't throw");

assert.equal(legacyTagSegmentOf("/mailbox/0/emails/acme-invoices/abc"), "acme-invoices");
assert.equal(legacyTagSegmentOf("/mailbox/0/emails/inbox/abc"), null);
assert.equal(legacyTagSegmentOf("/mailbox/0/tags/1"), null);
assert.equal(legacyTagSegmentOf("/mailbox/0/search"), null);
assert.equal(legacyTagSegmentOf("/login"), null);

assert.equal(withListSegment("/mailbox/0/emails/acme-invoices/abc", "tags/1"), "/mailbox/0/tags/1/abc");
assert.equal(withListSegment("/mailbox/0/tags/7/abc", "emails/inbox", false), "/mailbox/0/emails/inbox");
assert.equal(withListSegment("/mailbox/0/search", "tags/1"), "/mailbox/0/search");

assert.equal(legacyTagRedirect("/mailbox/0/emails/acme-invoices/abc-123", folderIds), "/mailbox/0/tags/1/abc-123");
assert.equal(legacyTagRedirect("/mailbox/0/emails/old-tag/abc-123", folderIds), "/mailbox/0/emails/inbox", "unknown tag → Inbox");
assert.equal(legacyTagRedirect("/mailbox/0/emails/inbox/abc-123", folderIds), null);

// The folder list route.
assert.deepEqual(reconcileListFolder("emails", "sent", null), { kind: "show", folderId: "sent" }, "built-ins need no folder list");
assert.deepEqual(reconcileListFolder("tags", "0", null), { kind: "wait" });
assert.deepEqual(reconcileListFolder("emails", "acme-invoices", null), { kind: "wait" });
assert.deepEqual(reconcileListFolder("tags", "1", folderIds), { kind: "show", folderId: "acme-invoices" });
const toInbox = { kind: "redirect", list: "emails/inbox", keepRest: false, folderId: null };
assert.deepEqual(reconcileListFolder("tags", "3", folderIds), toInbox, "out of range → Inbox");
assert.deepEqual(reconcileListFolder("tags", "01", folderIds), toInbox, "not an index → Inbox");
assert.deepEqual(reconcileListFolder("tags", "acme-invoices", folderIds), toInbox, "names aren't accepted under tags/");
assert.deepEqual(reconcileListFolder("tags", "0", []), toInbox, "no tags (or the list failed to load)");
assert.deepEqual(reconcileListFolder("emails", "acme-invoices", folderIds), {
	kind: "redirect",
	list: "tags/1",
	keepRest: true,
	folderId: "acme-invoices",
});
assert.deepEqual(reconcileListFolder("emails", "old-tag", folderIds), toInbox);
// A tag created before the open one shifts indexes: the open one keeps its place.
const grown = [...folderIds, "accounts"]; // sorts before acme-invoices
assert.deepEqual(reconcileListFolder("tags", "1", grown, "acme-invoices"), {
	kind: "redirect",
	list: "tags/2",
	keepRest: true,
	folderId: "acme-invoices",
});
assert.deepEqual(reconcileListFolder("tags", "2", grown, "acme-invoices"), { kind: "show", folderId: "acme-invoices" });
// Renamed: the id (and so the index) is unchanged. Deleted: Inbox, not the next tag.
assert.deepEqual(reconcileListFolder("tags", "1", folderIds.filter((id) => id !== "acme-invoices"), "acme-invoices"), toInbox);

// Worker: old tag links redirect before the page (and analytics beacon) loads.
const mailboxIds = ["zoe@acme.com", "ada@inboxies.email", "bob@acme.com"];
const req = (path, method = "GET") => new Request(`https://inboxies.app${path}`, { method });
const loads = [];
const loadFolderIds = async (mailboxId) => {
	loads.push(mailboxId);
	return folderIds;
};
assert.equal(isLegacyMailboxPage(req("/mailbox/1/emails/acme-invoices")), true);
assert.equal(isLegacyMailboxPage(req("/mailbox/1/emails/inbox")), false);
assert.equal(isLegacyMailboxPage(req("/mailbox/1/tags/0")), false);
assert.equal(isLegacyMailboxPage(req("/mailbox/1/emails/acme-invoices", "POST")), false);

let res = await legacyAppPageResponse(req("/mailbox/1/emails/acme-invoices/abc?x=1"), mailboxIds, loadFolderIds);
assert.equal(res?.status, 302);
assert.equal(res?.headers.get("Location"), "/mailbox/1/tags/1/abc?x=1");
assert.deepEqual(loads, ["bob@acme.com"], "reads that mailbox's folders");
// Address and tag name in one old link: one redirect.
res = await legacyAppPageResponse(req("/mailbox/zoe%40acme.com/emails/zeta-project"), mailboxIds, loadFolderIds);
assert.equal(res?.headers.get("Location"), "/mailbox/2/tags/2");
res = await legacyAppPageResponse(req("/mailbox/0/emails/old-tag/abc"), mailboxIds, loadFolderIds);
assert.equal(res?.headers.get("Location"), "/mailbox/0/emails/inbox");
// Not one of the user's mailboxes.
res = await legacyAppPageResponse(req("/mailbox/9/emails/acme-invoices"), mailboxIds, loadFolderIds);
assert.equal(res?.headers.get("Location"), "/");
// Index URLs: nothing to do, and no folder read.
loads.length = 0;
assert.equal(await legacyAppPageResponse(req("/mailbox/1/tags/1"), mailboxIds, loadFolderIds), null);
assert.equal(await legacyAppPageResponse(req("/mailbox/1/emails/inbox"), mailboxIds, loadFolderIds), null);
assert.deepEqual(loads, []);
// The folders can't be read: the mailbox part is still rewritten; the app does the tag.
const failing = async () => {
	throw new Error("DO unavailable");
};
assert.equal(await legacyAppPageResponse(req("/mailbox/1/emails/acme-invoices"), mailboxIds, failing), null);
res = await legacyAppPageResponse(req("/mailbox/bob@acme.com/emails/acme-invoices"), mailboxIds, failing);
assert.equal(res?.headers.get("Location"), "/mailbox/1/emails/acme-invoices");

// After sign-in, old tag links load in full so the Worker rewrites them.
assert.equal(isWorkerPagePath("/mailbox/0/emails/acme-invoices"), true);
assert.equal(isWorkerPagePath("/mailbox/0/emails/inbox"), false);
assert.equal(isWorkerPagePath("/mailbox/0/tags/1?x=1"), false);

console.log("web-tag-url: ok");
