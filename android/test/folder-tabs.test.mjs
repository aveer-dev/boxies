/**
 * Android swipe tabs must expose Screener, Promotions, Updates, and Spam
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
	"SCREENER",
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
	["SCREENER", "Screener"],
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


const mainActivity = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/MainActivity.kt"),
	"utf8",
);
const appModel = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/services/AppModel.kt"),
	"utf8",
);
const pushManager = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/services/PushNotificationManager.kt"),
	"utf8",
);
const rootView = readFileSync(
	join(root, "app/src/main/java/co/inboxies/app/ui/RootView.kt"),
	"utf8",
);
const manifest = readFileSync(
	join(root, "app/src/main/AndroidManifest.xml"),
	"utf8",
);

assert.match(fcm, /BigTextStyle/);
assert.match(mainActivity, /handlePushIntent/);
assert.match(mainActivity, /onNewIntent/);
assert.match(mainActivity, /setPendingDeepLink/);
assert.match(manifest, /android:launchMode="singleTop"/);
assert.match(pushManager, /fun setPendingDeepLink/);
assert.match(pushManager, /pendingDeepLink/);
assert.match(appModel, /openEmailFromNotification/);
assert.match(rootView, /pendingDeepLink/);
assert.match(rootView, /openEmailFromNotification/);

const iosRoot = join(root, "..", "ios", "AgenticInbox", "Inboxies");
const iosAppDelegate = readFileSync(join(iosRoot, "AppDelegate.swift"), "utf8");
const iosPush = readFileSync(join(iosRoot, "Services/PushNotificationManager.swift"), "utf8");
const iosAppModel = readFileSync(join(iosRoot, "Services/AppModel.swift"), "utf8");
const iosRootView = readFileSync(join(iosRoot, "Views/RootView.swift"), "utf8");

assert.match(iosAppDelegate, /handleNotificationTap/);
assert.match(iosPush, /pendingDeepLink/);
assert.match(iosPush, /handleNotificationTap/);
assert.match(iosAppModel, /openEmailFromNotification/);
assert.match(iosRootView, /consumePendingDeepLinkIfReady/);
assert.match(iosRootView, /pendingDeepLink/);

console.log("android folder-tabs tests passed");
