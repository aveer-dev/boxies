// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useRef } from "react";
import { Link } from "react-router";
import { useMailboxId, useMailboxRef } from "~/hooks/useCurrentMailbox";
import { FOLDER_DISPLAY_NAMES, SYSTEM_FOLDER_IDS } from "shared/folders";
import EmailPanel from "~/components/EmailPanel";
import { folderHref as folderHrefFor, pilePath, useMailNavigation } from "~/hooks/useMailNavigation";
import { useListFolderId } from "~/hooks/useListFolder";
import { customPileOf, isSetAside } from "~/lib/piles";
import { useEmail } from "~/queries/emails";
import { useFolders, useWorkflowPiles } from "~/queries/folders";
import type { Email } from "~/types";
import ColumnPane from "./ColumnPane";
import QuickReplyBar from "./QuickReplyBar";
import { ThreadChip } from "./ThreadRow";

/**
 * Column 4 — the reading room for `:emailId`. Wraps the full `EmailPanel`
 * (toolbar, thread, attachments, triage) and docks the quick reply under it.
 * Also used for a message opened in its own column (`columnId` + `onClose`).
 */
export default function ReaderColumn({
	emailId,
	columnId = "reader",
	onClose,
}: {
	emailId: string;
	columnId?: string;
	/** Closes this column; defaults to closing the route's reader. */
	onClose?: () => void;
}) {
	const folder = useListFolderId() ?? undefined;
	const mailboxId = useMailboxId();
	const mailboxRef = useMailboxRef();
	const { closeEmail } = useMailNavigation();
	const close = onClose ?? closeEmail;
	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: piles = [] } = useWorkflowPiles(mailboxId);
	const ownPile = email ? customPileOf(email, piles) : null;
	// The subject on screen, kept while the column stays open, so moving to
	// another message morphs the title from it instead of re-revealing the reader.
	const shownSubject = useRef<string | null>(null);

	const folderId = email?.folder_id ?? folder;
	const isCustomFolder = Boolean(folderId && !(SYSTEM_FOLDER_IDS as readonly string[]).includes(folderId));
	const folderName = folderId
		? isCustomFolder
			? (folders.find((f) => f.id === folderId)?.name ?? folderId).replace(/^#/, "")
			: (FOLDER_DISPLAY_NAMES[folderId] ?? folderId)
		: null;

	const folderHref = folderId
		? folderHrefFor(
				mailboxRef,
				folderId,
				folders.map((f) => f.id),
			)
		: null;

	const chips = (
		<>
			{folderName && folderId && (
				folderHref ? (
					<Link to={folderHref} className="no-underline">
						<ThreadChip>{folderName}</ThreadChip>
					</Link>
				) : (
					<ThreadChip>{folderName}</ThreadChip>
				)
			)}
			{email?.starred && <ThreadChip>Starred</ThreadChip>}
			{email?.reply_later && <ThreadChip>Reply later</ThreadChip>}
			{email && isSetAside(email) && <ThreadChip>Set aside</ThreadChip>}
			{ownPile && (
				<Link to={pilePath(mailboxRef, ownPile.id)} className="no-underline">
					<ThreadChip>{ownPile.name ?? "Pile"}</ThreadChip>
				</Link>
			)}
		</>
	);

	return (
		<ColumnPane
			id={columnId}
			sizeId="reader"
			title={email?.subject || "Message"}
			revealKey={emailId}
			hideHeader
			scrollBody={false}
		>
			<EmailPanel
				key={emailId}
				emailId={emailId}
				mailboxId={mailboxId}
				folder={onClose ? folderId : folder}
				onClose={close}
				previousSubject={shownSubject.current}
				onSubjectShown={(subject) => {
					shownSubject.current = subject;
				}}
				chips={chips}
				renderFooter={(replyTarget) => (
					<QuickReplyBar mailboxId={mailboxId} replyTarget={replyTarget} />
				)}
			/>
		</ColumnPane>
	);
}
