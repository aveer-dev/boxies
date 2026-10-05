// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useColumnStack } from "~/hooks/useColumnStack";
import { useEmail } from "~/queries/emails";
import type { Email } from "~/types";
import EmailPanel from "~/components/EmailPanel";
import ColumnPane from "./ColumnPane";
import QuickReplyBar from "./QuickReplyBar";

interface ReadingRoomColumnProps {
	emailId?: string;
	mailboxId?: string;
	folderId?: string;
}

export default function ReadingRoomColumn({
	emailId: propEmailId,
	mailboxId: propMailboxId,
	folderId: propFolderId,
}: ReadingRoomColumnProps) {
	const {
		selectedEmailId,
		selectedMailboxId,
		selectedFolderId,
		openPlatformColumn,
	} = useColumnStack();

	const emailId = propEmailId || selectedEmailId;
	const mailboxId = propMailboxId || selectedMailboxId || undefined;
	const folder = propFolderId || selectedFolderId || "inbox";

	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };

	if (!emailId) {
		return null;
	}

	const handlePopOut = (draftText: string) => {
		openPlatformColumn("compose", {
			originalEmail: email,
			mode: "reply",
			initialBody: draftText,
		});
	};

	return (
		<ColumnPane
			id="reader"
			width="min-w-[700px] w-[848px] shrink-0"
			closable={true}
			title={
				<div className="flex items-center gap-2 max-w-[500px]">
					<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-kumo-fill text-kumo-default border border-kumo-line">
						{folder}
					</span>
					{email?.category && (
						<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-kumo-recessed text-kumo-strong border border-kumo-line">
							#{email.category}
						</span>
					)}
					{email?.priority === "high" && (
						<span className="px-2 py-0.5 rounded text-[10px] font-medium bg-kumo-warning-muted text-kumo-warning border border-kumo-warning/30">
							High priority
						</span>
					)}
				</div>
			}
			contentClassName="flex flex-col h-full overflow-hidden"
		>
			<div className="flex-1 overflow-y-auto">
				<EmailPanel emailId={emailId} mailboxId={mailboxId} folder={folder} />
			</div>

			{email && mailboxId && (
				<QuickReplyBar
					email={email}
					mailboxId={mailboxId}
					onPopOut={handlePopOut}
				/>
			)}
		</ColumnPane>
	);
}
