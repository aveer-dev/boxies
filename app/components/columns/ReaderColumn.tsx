// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Link, useParams } from "react-router";
import { FOLDER_DISPLAY_NAMES, SYSTEM_FOLDER_IDS } from "shared/folders";
import EmailPanel from "~/components/EmailPanel";
import { folderPath, useMailNavigation } from "~/hooks/useMailNavigation";
import { useEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import type { Email } from "~/types";
import ColumnPane from "./ColumnPane";
import QuickReplyBar from "./QuickReplyBar";
import { ThreadChip } from "./ThreadRow";

/**
 * Column 4 — the reading room for `:emailId`. Wraps the full `EmailPanel`
 * (toolbar, thread, attachments, triage) and docks the quick reply under it.
 */
export default function ReaderColumn({ emailId }: { emailId: string }) {
	const { mailboxId = "", folder } = useParams<{ mailboxId: string; folder?: string }>();
	const { closeEmail } = useMailNavigation();
	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };
	const { data: folders = [] } = useFolders(mailboxId);

	const folderId = email?.folder_id ?? folder;
	const isTag = Boolean(folderId && !(SYSTEM_FOLDER_IDS as readonly string[]).includes(folderId));
	const folderName = folderId
		? isTag
			? `#${(folders.find((f) => f.id === folderId)?.name ?? folderId).replace(/^#/, "")}`
			: (FOLDER_DISPLAY_NAMES[folderId] ?? folderId)
		: null;

	const chips = (
		<>
			{folderName && folderId && (
				<Link to={folderPath(mailboxId, folderId)} className="no-underline">
					<ThreadChip>{folderName}</ThreadChip>
				</Link>
			)}
			{email?.starred && <ThreadChip>Starred</ThreadChip>}
			{email?.reply_later && <ThreadChip>Reply later</ThreadChip>}
		</>
	);

	return (
		<ColumnPane
			id="reader"
			title={email?.subject || "Message"}
			hideHeader
			scrollBody={false}
			widthClassName="md:w-auto md:flex-1 md:min-w-[848px]"
		>
			<EmailPanel
				key={emailId}
				emailId={emailId}
				mailboxId={mailboxId}
				folder={folder}
				onClose={closeEmail}
				chips={chips}
				renderFooter={(replyTarget) => (
					<QuickReplyBar mailboxId={mailboxId} replyTarget={replyTarget} />
				)}
			/>
		</ColumnPane>
	);
}
