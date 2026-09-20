/**
 * Sender purpose-box preferences: routing + validation.
 * Run: node --experimental-strip-types workers/test/sender-preferences.test.mjs
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	normalizeSenderPreferenceAddress,
	resolveInboundFolder,
	senderPreferenceUpsertError,
} from "../lib/sender-preferences.ts";

assert.equal(
	normalizeSenderPreferenceAddress("Alice <alice@Example.com>"),
	"alice@example.com",
);
assert.equal(normalizeSenderPreferenceAddress("not-an-email"), null);

assert.equal(
	resolveInboundFolder({
		classificationFolderId: Folders.SPAM,
		filterFolderId: Folders.INBOX,
		preferenceFolderId: Folders.PROMOTIONS,
	}),
	Folders.SPAM,
	"spam always wins",
);

assert.equal(
	resolveInboundFolder({
		classificationFolderId: Folders.INBOX,
		filterFolderId: Folders.ARCHIVE,
		preferenceFolderId: Folders.PROMOTIONS,
	}),
	Folders.ARCHIVE,
	"filter folder beats preference",
);

assert.equal(
	resolveInboundFolder({
		classificationFolderId: Folders.UPDATES,
		preferenceFolderId: Folders.INBOX,
	}),
	Folders.INBOX,
	"preference beats classify suggestion",
);

assert.equal(
	resolveInboundFolder({
		classificationFolderId: Folders.PROMOTIONS,
	}),
	Folders.PROMOTIONS,
	"classify is fallback",
);

assert.equal(
	resolveInboundFolder({
		classificationFolderId: Folders.INBOX,
		filterFolderId: "",
		preferenceFolderId: Folders.UPDATES,
	}),
	Folders.UPDATES,
	"empty filter folder ignored",
);

assert.equal(
	senderPreferenceUpsertError({
		address: "bob@example.com",
		folderId: Folders.PROMOTIONS,
	}),
	null,
);
assert.match(
	senderPreferenceUpsertError({
		address: "bob@example.com",
		folderId: Folders.SPAM,
	}) ?? "",
	/Destination must be/,
);
assert.match(
	senderPreferenceUpsertError({
		address: "bob@example.com",
		folderId: Folders.ARCHIVE,
	}) ?? "",
	/Destination must be/,
);
assert.match(
	senderPreferenceUpsertError({
		address: "nope",
		folderId: Folders.INBOX,
	}) ?? "",
	/valid sender/,
);

console.log("sender-preferences: ok");
