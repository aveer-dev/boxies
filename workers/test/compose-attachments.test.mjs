/**
 * Outbound compose attachment policy (MIME, JPEG re-encode, 5 MiB budget).
 * Run: pnpm test:unit
 */

import assert from "node:assert/strict";
import {
	attachmentFitsBudget,
	isImageMime,
	isVideoMime,
	jpegFilename,
	nextDownscaleEdge,
	shouldReencodeAsJpeg,
	bytesToBase64,
	formatByteSize,
	VIDEO_REJECT_MESSAGE,
	JPEG_QUALITY_LADDER,
	MAX_IMAGE_EDGE_PX,
} from "../../shared/compose-attachments.ts";
import {
	estimateOutboundMessageBytes,
	MAX_OUTBOUND_MESSAGE_BYTES,
	remainingOutboundBudget,
} from "../../shared/outbound-limits.ts";

assert.equal(MAX_IMAGE_EDGE_PX, 1600);
assert.deepEqual(JPEG_QUALITY_LADDER, [0.72, 0.55, 0.4]);
assert.ok(VIDEO_REJECT_MESSAGE.includes("5 MiB"));

assert.equal(isImageMime("image/jpeg", "photo.jpg"), true);
assert.equal(isImageMime("application/octet-stream", "shot.heic"), true);
assert.equal(isImageMime("application/pdf", "doc.pdf"), false);
assert.equal(isVideoMime("video/mp4", "clip.mp4"), true);
assert.equal(isVideoMime("image/jpeg", "photo.jpg"), false);

assert.equal(jpegFilename("IMG_1001.HEIC"), "IMG_1001.jpg");
assert.equal(jpegFilename("photo.png"), "photo.jpg");

assert.equal(shouldReencodeAsJpeg("image/heic", "a.heic", 4_000_000, 5_000_000), true);
assert.equal(shouldReencodeAsJpeg("image/jpeg", "a.jpg", 3_000_000, 5_000_000), true);
assert.equal(shouldReencodeAsJpeg("image/png", "icon.png", 12_000, 5_000_000), false);
assert.equal(shouldReencodeAsJpeg("image/png", "photo.png", 400_000, 5_000_000), true);
assert.equal(shouldReencodeAsJpeg("image/gif", "loop.gif", 80_000, 5_000_000), false);

const helloBytes = new TextEncoder().encode("hello");
assert.equal(bytesToBase64(helloBytes), "aGVsbG8=");
assert.equal(formatByteSize(512), "512 B");
assert.equal(formatByteSize(2048), "2.0 KB");
assert.equal(shouldReencodeAsJpeg("application/pdf", "a.pdf", 80_000, 5_000_000), false);

assert.equal(attachmentFitsBudget(100, 100), true);
assert.equal(attachmentFitsBudget(101, 100), false);
assert.equal(attachmentFitsBudget(0, 100), false);

assert.equal(nextDownscaleEdge(1600), 1200);
assert.equal(nextDownscaleEdge(400), 320);

const helloB64 = "aGVsbG8="; // 5 bytes
const used = estimateOutboundMessageBytes({
	html: "<p>hi</p>",
	text: "hi",
	attachments: [{ content: helloB64 }],
});
assert.equal(used, "<p>hi</p>".length + 2 + 5);
assert.equal(
	remainingOutboundBudget({
		html: "<p>hi</p>",
		text: "hi",
		attachments: [{ content: helloB64 }],
	}),
	MAX_OUTBOUND_MESSAGE_BYTES - used,
);

console.log("compose-attachments tests passed");
