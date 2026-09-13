/**
 * Android swipe tabs must expose Promotions, Updates, and Spam
 * in the same order as iOS HomeShellView.folderTabs.
 * Run: node android/test/folder-tabs.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const models = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/models/Models.kt"),
	"utf8",
);
const shell = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/ui/home/HomeShellView.kt"),
	"utf8",
);
const overlay = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/ui/compose/ComposeActionListOverlay.kt"),
	"utf8",
);
const fcm = readFileSync(
	join(
		root,
		"app/src/main/java/co/inboxies/app/services/InboxiesFirebaseMessagingService.kt",
	),
	"utf8",
);

const expectedSwipe = [
	"INBOX",
	"PROMOTIONS",
	"UPDATES",
	"SENT",
	"DRAFT",
	"ARCHIVE",
	"SPAM",
	"TRASH",
];

const swipeBlock = models.match(
	/val swipeFolderIds: List<String> = listOf\(([\s\S]*?)\)/,
);
assert.ok(swipeBlock, "FolderIds.swipeFolderIds is defined");
const swipeIds = [...swipeBlock[1].matchAll(/\b([A-Z]+)\b/g)].map((m) => m[1]);
assert.deepEqual(swipeIds, expectedSwipe);

assert.match(shell, /FolderIds\.swipeFolderIds\.map \{ HomeTab\.Folder\(it\) \}/);
assert.match(shell, /listOf\(HomeTab\.AiInbox\) \+ FolderIds\.swipeFolderIds/);

for (const [id, title] of [
	["PROMOTIONS", "Promotions"],
	["UPDATES", "Updates"],
	["SPAM", "Spam"],
]) {
	assert.match(
		models,
		new RegExp(`FolderIds\\.${id} -> "${title}"`),
		`${title} title is explicit`,
	);
}

assert.match(
	overlay,
	/enum class ComposeActionItem \{[\s\S]*Settings,[\s\S]*Trash,[\s\S]*Archive,[\s\S]*Drafts,[\s\S]*Sent,[\s\S]*Inbox,[\s\S]*ForYou,[\s\S]*Compose,/,
	"long-press overlay stays at the original 8 actions",
);
assert.doesNotMatch(
	overlay,
	/Promotions|Updates|Spam/,
	"classified folders are swipe tabs, not long-press rows",
);

assert.match(fcm, /putExtra\("folderId", folderId\)/);
assert.match(fcm, /message\.data\["folderId"\] \?: "inbox"/);

console.log("android folder-tabs tests passed");
