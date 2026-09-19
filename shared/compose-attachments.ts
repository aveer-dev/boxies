// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound compose attachment helpers: MIME classification, JPEG policy,
 * and send-payload shape. Image *pixels* are compressed on each client;
 * this module stays free of canvas / Bitmap APIs so Node tests can load it.
 */

import {
	MAX_OUTBOUND_MESSAGE_BYTES,
	OUTBOUND_SIZE_ERROR,
	remainingOutboundBudget,
	type OutboundSizeInput,
} from "./outbound-limits.ts";

export { MAX_OUTBOUND_MESSAGE_BYTES, OUTBOUND_SIZE_ERROR, remainingOutboundBudget };

/** Longest edge after downscale. Camera originals are much larger. */
export const MAX_IMAGE_EDGE_PX = 1600;

/** Try these JPEG qualities in order until the file fits remaining budget. */
export const JPEG_QUALITY_LADDER = [0.72, 0.55, 0.4];

export const VIDEO_REJECT_MESSAGE =
	"Videos aren't supported (5 MiB send limit)";

export type OutboundAttachmentPayload = {
	content: string;
	filename: string;
	type: string;
	disposition: "attachment" | "inline";
	contentId?: string;
};

const IMAGE_EXTENSIONS = new Set([
	"png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif",
]);
const VIDEO_EXTENSIONS = new Set([
	"mp4", "mov", "m4v", "avi", "mkv", "webm", "mpeg", "mpg",
]);
const PHOTO_JPEG_EXTENSIONS = new Set(["jpg", "jpeg", "heic", "heif", "png", "bmp", "tiff", "tif", "webp"]);

function extensionOf(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot < 0) return "";
	return filename.slice(dot + 1).toLowerCase();
}

export function isImageMime(mime: string, filename = ""): boolean {
	const type = mime.toLowerCase();
	if (type.startsWith("image/")) return true;
	return IMAGE_EXTENSIONS.has(extensionOf(filename));
}

export function isVideoMime(mime: string, filename = ""): boolean {
	const type = mime.toLowerCase();
	if (type.startsWith("video/")) return true;
	return VIDEO_EXTENSIONS.has(extensionOf(filename));
}

/**
 * Photos (HEIC/PNG/JPEG/WebP camera output) should become JPEG.
 * Tiny PNGs that already fit (screenshots, glyphs) can stay PNG.
 */
export function shouldReencodeAsJpeg(mime: string, filename: string, byteLength: number, budget: number): boolean {
	if (!isImageMime(mime, filename)) return false;
	const type = mime.toLowerCase();
	if (type === "image/gif") return false;
	if (type === "image/svg+xml" || extensionOf(filename) === "svg") return false;
	if (type === "image/png" && byteLength <= budget && byteLength <= 256 * 1024) {
		return false;
	}
	return PHOTO_JPEG_EXTENSIONS.has(extensionOf(filename)) || type.startsWith("image/");
}

export function jpegFilename(filename: string): string {
	const base = filename.replace(/\.[^.]+$/, "") || "image";
	return `${base}.jpg`;
}

export function attachmentFitsBudget(byteLength: number, budget: number): boolean {
	return byteLength > 0 && byteLength <= budget;
}

export function composeSizeInput(
	html: string,
	text: string,
	attachments: { content: string }[],
): OutboundSizeInput {
	return { html, text, attachments };
}

export function bytesToBase64(bytes: Uint8Array): string {
	const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const maybeBuffer = (globalThis as {
		Buffer?: { from(data: Uint8Array): { toString(enc: string): string } };
	}).Buffer;
	if (maybeBuffer) {
		return maybeBuffer.from(buf).toString("base64");
	}
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < buf.length; i += chunk) {
		binary += String.fromCharCode(...buf.subarray(i, i + chunk));
	}
	return btoa(binary);
}

export function formatByteSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) {
		const kb = bytes / 1024;
		return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
	}
	const mb = bytes / (1024 * 1024);
	return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

export function nextDownscaleEdge(currentEdge: number): number {
	return Math.max(320, Math.floor(currentEdge * 0.75));
}
