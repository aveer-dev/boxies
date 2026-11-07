// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { blocksRemoteImages } from "shared/remote-images";
import EmailIframe from "~/components/EmailIframe";
import { useInlineImages } from "~/hooks/useInlineImages";
import type { Email } from "~/types";

/**
 * A received message's body in the sandboxed reader iframe, with its inline
 * `cid:` images loaded (AVE-110) and the Spam remote-image rule (AVE-132).
 */
export default function MessageBody({
	email,
	mailboxId,
	autoSize,
}: {
	email: Email;
	mailboxId: string | undefined;
	autoSize?: boolean;
}) {
	const body = useInlineImages(email.body || "", mailboxId, email.id, email.attachments);
	return (
		<EmailIframe
			body={body ?? ""}
			autoSize={autoSize}
			blockRemoteImages={blocksRemoteImages(email.folder_id)}
		/>
	);
}
