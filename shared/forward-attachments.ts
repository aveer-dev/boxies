// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Which of an original's files a forward carries (AVE-181).
 *
 * The forward composer shows an "Include N attachments" switch (on by default)
 * when the original has at least one real attachment. Inline `cid:` images
 * that are part of the body are not attachments: they are left out of the
 * count and never sent as files. iOS (`ForwardAttachments`) and Android
 * (`ForwardAttachments`) apply the same rule, checked against the shared
 * `forward-attachments.fixtures.json`.
 */

import { inlineImageMimeType, referencesContentId } from "./inline-images.ts";

export interface ForwardSourceAttachment {
	id: string;
	filename?: string | null;
	mimetype?: string | null;
	content_id?: string | null;
	disposition?: string | null;
}

/**
 * An inline part rather than a file: `Content-Disposition: inline` (the
 * readers hide these from the attachment list too), or an image the body
 * shows through `cid:`.
 */
export function isInlineBodyPart(attachment: ForwardSourceAttachment, body: string | null | undefined): boolean {
	if ((attachment.disposition ?? "").trim().toLowerCase() === "inline") return true;
	return Boolean(inlineImageMimeType(attachment.mimetype)) && referencesContentId(body ?? "", attachment.content_id);
}

/** The original's real attachments, in order: what "Include N attachments" counts and sends. */
export function forwardableAttachments<T extends ForwardSourceAttachment>(
	attachments: readonly T[] | null | undefined,
	body: string | null | undefined,
): T[] {
	return (attachments ?? []).filter((attachment) => !isInlineBodyPart(attachment, body));
}

/** "Include 1 attachment" / "Include 3 attachments". */
export function includeAttachmentsLabel(count: number): string {
	return `Include ${count} ${count === 1 ? "attachment" : "attachments"}`;
}
