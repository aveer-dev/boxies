// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Folders } from "./folders";

/**
 * Remote images in a message body (AVE-132). They load by default, except in
 * Spam, where they stay blocked until the reader taps "Load images" for that
 * message (as Gmail does). The message's own folder decides, so a Spam message
 * opened from search or inside a thread is still blocked.
 * iOS (`EmailHTMLSanitizer.blocksRemoteImages`) and Android
 * (`EmailHtmlSanitizer.blocksRemoteImages`) mirror this rule —
 * `android/test/email-html-hardening.test.mjs` keeps them in sync.
 */
export function blocksRemoteImages(folderId: string | null | undefined): boolean {
	return folderId === Folders.SPAM;
}

/**
 * The CSP `img-src` for a message body. `origin` is the app's own origin, so
 * inline (cid) images rewritten to attachment URLs load in local dev.
 */
export function emailImgSrc(options: {
	blockRemoteImages: boolean;
	loadedRemoteImages: boolean;
	origin: string;
}): string {
	const allowRemote = !options.blockRemoteImages || options.loadedRemoteImages;
	return allowRemote ? `data: cid: https: ${options.origin}` : `data: cid: ${options.origin}`;
}
