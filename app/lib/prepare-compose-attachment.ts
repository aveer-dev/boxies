// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	JPEG_QUALITY_LADDER,
	MAX_IMAGE_EDGE_PX,
	OUTBOUND_SIZE_ERROR,
	VIDEO_REJECT_MESSAGE,
	attachmentFitsBudget,
	bytesToBase64,
	isImageMime,
	isVideoMime,
	jpegFilename,
	nextDownscaleEdge,
	shouldReencodeAsJpeg,
	type OutboundAttachmentPayload,
} from "shared/compose-attachments";

export type PreparedAttachment = OutboundAttachmentPayload & {
	id: string;
	size: number;
};

export type PrepareAttachmentResult =
	| { ok: true; attachment: PreparedAttachment }
	| { ok: false; error: string };

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
	const buffer = await blob.arrayBuffer();
	return new Uint8Array(buffer);
}

function payloadFromBytes(
	bytes: Uint8Array,
	filename: string,
	type: string,
): PreparedAttachment {
	return {
		id: crypto.randomUUID(),
		content: bytesToBase64(bytes),
		filename,
		type,
		disposition: "attachment",
		size: bytes.byteLength,
	};
}

async function encodeJpeg(
	source: ImageBitmap | HTMLImageElement,
	width: number,
	height: number,
	quality: number,
): Promise<Blob | null> {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(source, 0, 0, width, height);
	return await new Promise((resolve) => {
		canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
	});
}

function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= maxEdge) return { width, height };
	const scale = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

async function compressImage(file: File, budget: number): Promise<PrepareAttachmentResult> {
	let bitmap: ImageBitmap | null = null;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		const bytes = await blobToBytes(file);
		if (!attachmentFitsBudget(bytes.byteLength, budget)) {
			return { ok: false, error: OUTBOUND_SIZE_ERROR };
		}
		return {
			ok: true,
			attachment: payloadFromBytes(bytes, file.name || "image", file.type || "application/octet-stream"),
		};
	}

	try {
		let edge = Math.min(MAX_IMAGE_EDGE_PX, Math.max(bitmap.width, bitmap.height));
		while (edge >= 320) {
			const { width, height } = scaledSize(bitmap.width, bitmap.height, edge);
			for (const quality of JPEG_QUALITY_LADDER) {
				const blob = await encodeJpeg(bitmap, width, height, quality);
				if (!blob) continue;
				if (blob.size <= budget) {
					const bytes = await blobToBytes(blob);
					return {
						ok: true,
						attachment: payloadFromBytes(
							bytes,
							jpegFilename(file.name || "image.jpg"),
							"image/jpeg",
						),
					};
				}
			}
			const next = nextDownscaleEdge(edge);
			if (next >= edge) break;
			edge = next;
		}
		return { ok: false, error: OUTBOUND_SIZE_ERROR };
	} finally {
		bitmap.close();
	}
}

export async function prepareComposeAttachment(
	file: File,
	budget: number,
): Promise<PrepareAttachmentResult> {
	const mime = file.type || "application/octet-stream";
	const filename = file.name || "untitled";

	if (isVideoMime(mime, filename)) {
		return { ok: false, error: VIDEO_REJECT_MESSAGE };
	}

	if (isImageMime(mime, filename) && shouldReencodeAsJpeg(mime, filename, file.size, budget)) {
		return compressImage(file, budget);
	}

	if (!attachmentFitsBudget(file.size, budget)) {
		return { ok: false, error: OUTBOUND_SIZE_ERROR };
	}

	const bytes = await blobToBytes(file);
	return {
		ok: true,
		attachment: payloadFromBytes(bytes, filename, mime),
	};
}
