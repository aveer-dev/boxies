// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The one inline script in the web reader's sandboxed mail iframe
 * (app/components/EmailIframe.tsx). It is a fixed string so the app's
 * Content-Security-Policy can allow it by hash (AVE-148): a `srcdoc` frame
 * inherits the page's policy, whose `script-src` has a nonce and so no
 * `'unsafe-inline'`. Per-frame options come from attributes on `<html>`, never
 * from string interpolation, which would change the hash.
 *
 * - `data-autosize="1"`: post the content height to the parent, and hand
 *   mostly-vertical wheels that drift sideways to the parent instead of
 *   scrolling the frame.
 * - Zoom (text size) is posted in from the parent as `{ __emailZoom }`.
 *
 * Changing a single character changes the hash: update
 * `EMAIL_FRAME_SCRIPT_HASH` (workers/test/content-security-policy.test.mjs
 * prints the new value when they disagree).
 */
export const EMAIL_FRAME_SCRIPT = `(function () {
	var root = document.documentElement;
	var autoSize = root.getAttribute("data-autosize") === "1";
	function reportHeight() {
		if (!autoSize) return;
		var h = Math.ceil(root.getBoundingClientRect().height);
		if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
	}
	reportHeight();
	setTimeout(reportHeight, 50);
	setTimeout(reportHeight, 150);
	setTimeout(reportHeight, 400);
	window.addEventListener("message", function (e) {
		if (e.source !== parent || !e.data || typeof e.data.__emailZoom !== "number") return;
		root.style.zoom = e.data.__emailZoom;
		reportHeight();
	});
	document.addEventListener("wheel", function (e) {
		if (e.ctrlKey || !e.deltaX || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
		e.preventDefault();
		var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
		if (autoSize) parent.postMessage({ __emailIframeWheel: true, dy: dy }, "*");
		else window.scrollBy(0, dy);
	}, { passive: false });
})();`;

/** CSP hash-source for `EMAIL_FRAME_SCRIPT` (SHA-256, base64). */
export const EMAIL_FRAME_SCRIPT_HASH = "'sha256-I0XTJe+JLxlbeMo5UQ5Aae1hyMTvwPn2BxNvZU2eyqc='";
