// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { EyeSlashIcon } from "@phosphor-icons/react";
import { blocksRemoteImages } from "shared/remote-images";
import { trackerNote } from "shared/tracking-pixels";
import EmailIframe from "~/components/EmailIframe";
import { useInlineImages } from "~/hooks/useInlineImages";
import type { Email } from "~/types";

/**
 * A received message's body in the sandboxed reader iframe, with its inline
 * `cid:` images loaded (AVE-110), the Spam remote-image rule (AVE-132), and a
 * note when the server stripped tracking pixels (AVE-195).
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
	const note = trackerNote(email.blocked_trackers);
	const frame = (
		<EmailIframe
			body={body ?? ""}
			autoSize={autoSize}
			blockRemoteImages={blocksRemoteImages(email.folder_id)}
		/>
	);
	if (!note) return frame;
	return (
		<div className={autoSize ? undefined : "flex h-full flex-col"}>
			<TrackerNote text={note} className={autoSize ? "mb-2" : "mx-4 mt-3 mb-1 md:mx-6"} />
			<div className={autoSize ? undefined : "min-h-0 flex-1"}>{frame}</div>
		</div>
	);
}

/** Small muted line above the body: who tried to track this open. */
function TrackerNote({ text, className }: { text: string; className?: string }) {
	return (
		<div
			className={`flex items-center gap-1.5 text-xs text-kumo-subtle ${className ?? ""}`}
			role="status"
			title="Tracking pixels tell a sender when you open their mail. Inboxies removed them; other images still load."
		>
			<EyeSlashIcon size={13} aria-hidden="true" className="shrink-0" />
			<span>{text}</span>
		</div>
	);
}
