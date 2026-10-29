/**
 * AVE-132: remote images load by default, except in Spam, where they stay
 * blocked until the reader taps "Load images" (as Gmail does). Web's rule in
 * shared/remote-images.ts; iOS/Android parity is in android/test/email-html-hardening.test.mjs.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/remote-images.test.mjs
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import { blocksRemoteImages, emailImgSrc } from "../../shared/remote-images.ts";

const origin = "https://app.inboxies.test";

// Only Spam blocks remote images.
assert.equal(blocksRemoteImages(Folders.SPAM), true);
for (const folder of Object.values(Folders).filter((id) => id !== Folders.SPAM)) {
	assert.equal(blocksRemoteImages(folder), false, `${folder} loads remote images`);
}
assert.equal(blocksRemoteImages(undefined), false);
assert.equal(blocksRemoteImages(null), false);

// Non-Spam: https images allowed without any opt-in.
assert.equal(
	emailImgSrc({ blockRemoteImages: false, loadedRemoteImages: false, origin }),
	`data: cid: https: ${origin}`,
);

// Spam: blocked (own origin only, for inline cid images) until "Load images".
const blocked = emailImgSrc({ blockRemoteImages: true, loadedRemoteImages: false, origin });
assert.equal(blocked, `data: cid: ${origin}`);
assert.doesNotMatch(blocked, /https:(\s|$)/);
assert.equal(
	emailImgSrc({ blockRemoteImages: true, loadedRemoteImages: true, origin }),
	`data: cid: https: ${origin}`,
);

console.log("remote-images: ok");
