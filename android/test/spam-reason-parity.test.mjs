/**
 * Spam reason copy (AVE-94) is one table in three places: web
 * `shared/spam-reason.ts`, iOS `SpamReason` (Models.swift) and Android
 * `SpamReason.kt`. Native builds can't import the TS, so lock the strings.
 * Run: node android/test/spam-reason-parity.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const shared = read("shared/spam-reason.ts");
const ios = read("ios/AgenticInbox/Inboxies/Models/Models.swift");
const android = read("android/app/src/main/java/co/inboxies/app/models/SpamReason.kt");

const pairs = [
	["auth-failed", "Failed sender authentication"],
	["spam-headers", "Flagged by spam filter"],
	["ai-spam", "Marked as spam by AI check"],
	["sender-rejected", "You blocked this sender"],
];

for (const [code, copy] of pairs) {
	assert.ok(shared.includes(`"${copy}"`), `web has "${copy}"`);
	assert.ok(shared.includes(`"${code}"`), `web has code ${code}`);
	assert.match(ios, new RegExp(`case "${code}": return "${copy}"`), `iOS maps ${code}`);
	assert.match(android, new RegExp(`"${code}" -> "${copy}"`), `Android maps ${code}`);
}

for (const text of [
	"Unverified sender",
	"We couldn’t confirm who sent this message.",
	"We couldn’t confirm this message really came from",
]) {
	assert.ok(shared.includes(text), `web has "${text}"`);
	assert.ok(ios.includes(text), `iOS has "${text}"`);
	assert.ok(android.includes(text), `Android has "${text}"`);
}

// Only Spam / Screened out get a reason line, on every client.
for (const [name, src] of [["web", shared], ["iOS", ios], ["Android", android]]) {
	assert.ok(src.includes("screened_out") || src.includes("SCREENED_OUT"), `${name} gates on Screened out`);
}

// The unverified banner keys off the stored tier, with the auth snapshot as fallback.
assert.match(ios, /authTier \?\? auth\?\.authTier/);
assert.match(read("android/app/src/main/java/co/inboxies/app/models/Models.kt"), /authTier \?: auth\?\.authTier/);

console.log("spam-reason parity tests passed");
