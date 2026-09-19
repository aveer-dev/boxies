// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared attachment storage logic.
 * Eliminates the triplicated atob → Uint8Array → R2.put pattern.
 */
import type { Env } from "../types";

export interface StoredAttachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id: string | null;
	disposition: string;
}

/** R2 delete batch size (platform accepts large arrays; keep chunks modest). */
export const R2_DELETE_CHUNK_SIZE = 200;

/**
 * Sanitize filenames for R2 object keys (blocks path traversal / control chars).
 */
export function sanitizeAttachmentFilename(filename: string | null | undefined): string {
	return (filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
}

/**
 * R2 object key for an attachment blob.
 * Shape: `attachments/{emailId}/{attachmentId}/{safeFilename}`
 */
export function attachmentKey(
	emailId: string,
	attachmentId: string,
	filename: string,
): string {
	return `attachments/${emailId}/${attachmentId}/${sanitizeAttachmentFilename(filename)}`;
}

/**
 * Collect R2 keys for a mailbox purge (email bodies/raw + attachment blobs).
 * Pure helper for tests and MailboxDO.purgeMailbox.
 */
export function collectMailboxPurgeR2Keys(
	emailIds: string[],
	attachments: { email_id: string; id: string; filename: string }[],
	emailContentKeys: (emailId: string) => string[],
): string[] {
	const keys: string[] = [];
	for (const emailId of emailIds) {
		keys.push(...emailContentKeys(emailId));
	}
	for (const att of attachments) {
		keys.push(attachmentKey(att.email_id, att.id, att.filename));
	}
	return keys;
}

/** Delete attachment blobs for one email (best-effort batch). */
export async function deleteEmailAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments: { id: string; filename: string }[],
): Promise<void> {
	if (attachments.length === 0) return;
	const keys = attachments.map((att) =>
		attachmentKey(emailId, att.id, att.filename),
	);
	await deleteR2Keys(bucket, keys);
}

/** Delete R2 objects in chunks. */
export async function deleteR2Keys(
	bucket: Env["BUCKET"],
	keys: string[],
): Promise<void> {
	if (keys.length === 0) return;
	for (let i = 0; i < keys.length; i += R2_DELETE_CHUNK_SIZE) {
		const chunk = keys.slice(i, i + R2_DELETE_CHUNK_SIZE);
		await bucket.delete(chunk);
	}
}

/**
 * Store base64-encoded attachments to R2 and return metadata for the DO.
 */
export async function storeAttachments(
	bucket: Env["BUCKET"],
	emailId: string,
	attachments?: {
		content: string;
		filename: string;
		type: string;
		disposition: string;
		contentId?: string;
	}[],
): Promise<StoredAttachment[]> {
	if (!attachments?.length) return [];

	const results: StoredAttachment[] = [];
	for (const att of attachments) {
		const attachmentId = crypto.randomUUID();
		const safeFilename = sanitizeAttachmentFilename(att.filename);
		const key = attachmentKey(emailId, attachmentId, safeFilename);
		const binaryStr = atob(att.content);
		const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
		await bucket.put(key, bytes);
		results.push({
			id: attachmentId,
			email_id: emailId,
			filename: safeFilename,
			mimetype: att.type,
			size: bytes.byteLength,
			content_id: att.contentId || null,
			disposition: att.disposition,
		});
	}
	return results;
}
