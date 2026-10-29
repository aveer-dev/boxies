// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	MAX_INLINE_IMAGE_BYTES,
	MAX_INLINE_IMAGES_TOTAL_BYTES,
	inlineImageMimeType,
	normalizeContentId,
	replaceContentIds,
	selectInlineImages,
} from "shared/inline-images";
import api from "~/services/api";
import type { Attachment } from "~/types";

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

/**
 * The message body with its inline `cid:` images swapped for `data:` URLs
 * (AVE-110). The sandboxed reader iframe has an opaque origin, so it can't
 * load attachment URLs with the session cookie; the app fetches them here
 * instead. See shared/inline-images.ts for which images qualify.
 *
 * Returns `null` while the images load, so the reader doesn't flash broken
 * images and then reload. An image that fails or is too big stays broken.
 */
export function useInlineImages(
	body: string,
	mailboxId: string | undefined,
	emailId: string,
	attachments: Attachment[] | undefined,
): string | null {
	const targets = useMemo(() => selectInlineImages(body, attachments), [body, attachments]);
	const enabled = Boolean(mailboxId) && targets.length > 0;

	const { data, isPending } = useQuery({
		queryKey: ["inline-images", mailboxId, emailId, targets.map((att) => att.id).join(",")],
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 60_000,
		retry: false,
		queryFn: async ({ signal }) => {
			const urls = new Map<string, string>();
			let total = 0;
			const results = await Promise.allSettled(
				targets.map(async (att) => {
					const blob = await api.getAttachment(mailboxId!, emailId, att.id, { signal });
					return { att, blob };
				}),
			);
			for (const result of results) {
				if (result.status !== "fulfilled") continue;
				const { att, blob } = result.value;
				const cid = normalizeContentId(att.content_id);
				const mime = inlineImageMimeType(att.mimetype);
				// The stored size is what the sender claimed; check what arrived.
				if (!cid || !mime || !(blob instanceof Blob)) continue;
				if (blob.size > MAX_INLINE_IMAGE_BYTES || total + blob.size > MAX_INLINE_IMAGES_TOTAL_BYTES) continue;
				total += blob.size;
				urls.set(cid, await blobToDataUrl(new Blob([blob], { type: mime })));
			}
			return urls;
		},
	});

	return useMemo(() => {
		if (!enabled) return body;
		if (isPending) return null;
		return data ? replaceContentIds(body, data) : body;
	}, [enabled, isPending, data, body]);
}
