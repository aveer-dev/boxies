// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emailHasOwnColors } from "../../shared/email-colors";
import { EMAIL_FRAME_SCRIPT } from "../../shared/email-frame-script";
import { emailImgSrc } from "../../shared/remote-images";
import { scrollerFor } from "~/lib/scroll-axis";
import { useTextSize } from "~/lib/text-size";
import { useTheme } from "~/lib/theme";

/** Colours for the iframe document (it can't read the app's CSS variables). */
const PALETTES = {
	light: {
		scheme: "light",
		bg: "#ffffff",
		text: "#1a1a1a",
		link: "#171717",
		linkLine: "rgba(23, 23, 23, 0.35)",
		quoteBorder: "#d1d5db",
		quoteText: "#6b7280",
		pre: "#f3f4f6",
		thumb: "rgba(23, 23, 23, 0.22)",
	},
	// Matches the dark app tokens (--bg, --text-primary, --border-control…).
	dark: {
		scheme: "dark",
		bg: "#111111",
		text: "#e4e4e4",
		link: "#ececec",
		linkLine: "rgba(236, 236, 236, 0.4)",
		quoteBorder: "#363636",
		quoteText: "#969696",
		pre: "#191919",
		thumb: "rgba(236, 236, 236, 0.22)",
	},
} as const;

/** DOMPurify with the email profile: no `<style>`, links open in a new tab. */
function sanitizeEmailBody(body: string): string {
	// Every link opens in a new tab instead of navigating the iframe or the app.
	DOMPurify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "A" && node.getAttribute("href")) {
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer");
		}
	});
	const clean = DOMPurify.sanitize(body, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ["style"],
		ADD_ATTR: ["target"],
		FORCE_BODY: true,
	});
	DOMPurify.removeHook("afterSanitizeAttributes");
	return clean;
}

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
	/**
	 * Keep remote images blocked until the reader taps "Load images". Only
	 * Spam does this (as Gmail does); everywhere else images load by default.
	 */
	blockRemoteImages?: boolean;
}

/**
 * Renders email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - DOMPurify sanitises the HTML before injection.
 * - The iframe sandbox does NOT include `allow-same-origin`, so even if
 *   DOMPurify has a bypass the attacker's code runs in an opaque origin
 *   with no access to the parent page's cookies, DOM, or API.
 * - Because the iframe is cross-origin we cannot read `contentDocument`
 *   for auto-sizing. Instead, the injected HTML includes a tiny inline
 *   script (shared/email-frame-script.ts) that posts its body height to the
 *   parent via `postMessage`. The `srcdoc` frame inherits the app's CSP, which
 *   allows that script by hash (workers/lib/content-security-policy.ts).
 *   The `allow-scripts` flag is required for this, but scripts inside
 *   the opaque-origin sandbox cannot access anything useful.
 * - A strict CSP meta tag blocks external resource loads inside the
 *   iframe as a defense-in-depth layer. Only images are allowed out: remote
 *   https images load by default, except in Spam, where they stay blocked
 *   until the reader opts in. Same-origin inline (cid) images always load.
 * - Links always open in a new tab; the email can't navigate the app away.
 */
export default function EmailIframe({ body, autoSize, blockRemoteImages = false }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	// Spam only: the reader tapped "Load images" for this message.
	const [loadedRemoteImages, setLoadedRemoteImages] = useState(false);
	/**
	 * The sanitised document, and a version that remounts the iframe for each
	 * new one: re-assigning `srcdoc` on a live sandboxed frame can leave it
	 * stuck on its old (blank) document, while a fresh frame always loads.
	 */
	const [doc, setDoc] = useState<{ html: string; version: number } | null>(null);
	const hasRemoteImages = REMOTE_IMAGE_PATTERN.test(body);
	// Sanitised once per body (browser only: DOMPurify needs a DOM).
	const cleanBody = useMemo(
		() => (body && typeof window !== "undefined" ? sanitizeEmailBody(body) : ""),
		[body],
	);
	const dark = useTheme((s) => s.resolved) === "dark";
	// Dark mode, but the email brings its own colours: show it as designed on a
	// light paper card (Gmail / Apple Mail / Hey). Simple mail takes the dark
	// theme. Same rules as iOS and Android: shared/email-colors.ts.
	const paper = dark && emailHasOwnColors(cleanBody);
	const palette = PALETTES[dark && !paper ? "dark" : "light"];
	// Text size zooms the whole message (its own inline sizes included). Live
	// changes are posted in, so dragging the wheel doesn't reload the frame.
	const zoom = useTextSize((s) => s.percent) / 100;
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	useEffect(() => {
		iframeRef.current?.contentWindow?.postMessage({ __emailZoom: zoom }, "*");
	}, [zoom]);

	// A different Spam message starts blocked again.
	useEffect(() => {
		setLoadedRemoteImages(false);
	}, [body]);

	// Listen for height reports from the sandboxed iframe
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			if (!autoSize) return;
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			// A mostly-vertical wheel that drifted sideways: scroll the reader, not the canvas.
			if (
				event.data &&
				typeof event.data === "object" &&
				event.data.__emailIframeWheel &&
				typeof event.data.dy === "number"
			) {
				const scroller = scrollerFor(iframeRef.current, "y");
				if (scroller) scroller.scrollTop += event.data.dy;
				return;
			}
			if (
				event.data &&
				typeof event.data === "object" &&
				event.data.__emailIframeHeight &&
				typeof event.data.height === "number" &&
				event.data.height > 0
			) {
				setHeight(event.data.height);
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		if (!body) return;

		// Remote https images load unless this is a Spam message the reader
		// hasn't opted in on (same as iOS and Android). The app's own origin is
		// always listed so inline (cid) images load in local dev.
		const imgSrc = emailImgSrc({
			blockRemoteImages,
			loadedRemoteImages,
			origin: window.location.origin,
		});

		const padding = autoSize ? (paper ? "16px" : "0") : "24px";

		// Use srcdoc so the iframe is truly sandboxed (no same-origin access).
		// We can't use doc.write() because that requires allow-same-origin.
		// The frame's one script (height, zoom, wheel) is a fixed string so the
		// app's CSP can allow it by hash; options ride on <html> (AVE-148).
		const html = `<!DOCTYPE html>
<html data-autosize="${autoSize ? "1" : "0"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
html {
	zoom: ${zoomRef.current};
	background: ${palette.bg};
	color-scheme: ${palette.scheme};
	scrollbar-width: thin;
	scrollbar-color: ${palette.thumb} transparent;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: ${palette.thumb}; border-radius: 999px; }
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.6;
	color: ${palette.text};
	background: ${palette.bg};
	padding: ${padding};
	margin: 0;
	word-wrap: break-word;
	overflow-wrap: break-word;
	${autoSize ? "overflow: hidden;" : ""}
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: ${palette.link}; text-decoration: underline; text-underline-offset: 2px; text-decoration-color: ${palette.linkLine}; }
img { max-width: 100%; height: auto; }
blockquote {
	border-left: 3px solid ${palette.quoteBorder};
	padding-left: 1em;
	margin-left: 0;
	color: ${palette.quoteText};
}
pre {
	background: ${palette.pre};
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 13px;
}
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
</style>
</head>
<body>${cleanBody}<script>${EMAIL_FRAME_SCRIPT}<\/script></body>
</html>`;
		setDoc((prev) => ({ html, version: (prev?.version ?? 0) + 1 }));
	}, [body, cleanBody, autoSize, blockRemoteImages, loadedRemoteImages, palette, paper]);

	const iframe = (
		<iframe
			key={doc?.version ?? 0}
			ref={iframeRef}
			srcDoc={doc?.html}
			className={`block w-full border-0 ${paper ? "rounded-xl" : ""}`}
			style={autoSize ? { height: `${height}px` } : { height: "100%" }}
			sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
			title="Email content"
		/>
	);
	// A full-height sheet keeps a margin of the dark reader around it. The
	// wrapper is always there: re-parenting the iframe would blank it.
	const frame = autoSize ? iframe : <div className={`h-full ${paper ? "p-3" : ""}`}>{iframe}</div>;
	if (!blockRemoteImages || loadedRemoteImages || !hasRemoteImages) return frame;
	return (
		<div className={autoSize ? undefined : "flex h-full flex-col"}>
			<div className="flex items-center justify-between gap-3 border-b border-kumo-line bg-kumo-tint px-4 py-2 text-xs text-kumo-subtle">
				<span>Remote images are hidden to protect your privacy.</span>
				<button
					type="button"
					className="font-medium text-kumo-default hover:underline"
					onClick={() => setLoadedRemoteImages(true)}
				>
					Load images
				</button>
			</div>
			<div className={autoSize ? undefined : "min-h-0 flex-1"}>{frame}</div>
		</div>
	);
}

/** Remote images: <img src="http…">, srcset, or CSS url(http…) in inline styles. */
const REMOTE_IMAGE_PATTERN = /<img[^>]+(?:src|srcset)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//i;
