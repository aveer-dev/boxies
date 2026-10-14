// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { useCallback, useRef, useState } from "react";
import FloatingPanel from "~/components/FloatingPanel";
import { IconButton } from "~/components/IconButton";
import { keysFor } from "~/lib/shortcuts";
import {
	ArchiveIcon,
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	ArrowsOutSimpleIcon,
	ChatCircleIcon,
	ClockCounterClockwiseIcon,
	CodeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	ShieldCheckIcon,
	StarIcon,
	TrashIcon,
	WarningIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { Folder, Email } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	lastReceivedMessage?: Email;
	onBack: () => void;
	onSendDraft: () => void;
	onEditDraft: () => void;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	onToggleStar: () => void;
	onToggleReplyLater: () => void;
	onToggleRead: () => void;
	/** Absent when the message is already archived. */
	onArchive?: () => void;
	/** Pops the message out of its column (absent once it's popped out). */
	onPopOut?: () => void;
	inPopOut?: boolean;
	onMove: (folderId: string) => void;
	/** "report" outside Spam, "not-spam" inside it; null hides the button. */
	spamAction?: "report" | "not-spam" | null;
	onSpamAction?: () => void;
	onViewSource: () => void;
	onDelete: () => void;
}

export default function EmailPanelToolbar({
	email,
	isDraftFolder,
	isSending,
	moveToFolders,
	onBack,
	onSendDraft,
	onEditDraft,
	onReply,
	onReplyAll,
	onForward,
	onToggleStar,
	onToggleReplyLater,
	onToggleRead,
	onArchive,
	onPopOut,
	inPopOut = false,
	onMove,
	spamAction,
	onSpamAction,
	onViewSource,
	onDelete,
}: EmailPanelToolbarProps) {
	// Icons pop when switched on (not when a starred message first renders).
	const [starPops, setStarPops] = useState(0);
	const [laterPops, setLaterPops] = useState(0);
	return (
		<div className="flex items-center gap-0.5 h-12 px-2 border-b border-kumo-line shrink-0 md:px-3">
			{!inPopOut && (
				<IconButton label="Back to list" icon={ArrowLeftIcon} size="md" onClick={onBack} className="md:hidden" />
			)}

			{isDraftFolder ? (
				<div className="flex items-center gap-1.5 mr-1">
					<Button
						variant="primary"
						size="sm"
						icon={<PaperPlaneTiltIcon size={14} />}
						onClick={onSendDraft}
						loading={isSending}
					>
						{isSending ? "Sending..." : "Send"}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						icon={<PencilSimpleIcon size={14} />}
						onClick={onEditDraft}
					>
						Edit
					</Button>
				</div>
			) : (
				<>
					<IconButton label="Reply" shortcut={keysFor("reply")} icon={ArrowBendUpLeftIcon} size="md" onClick={onReply} />
					<IconButton label="Reply all" shortcut={keysFor("replyAll")} icon={ChatCircleIcon} size="md" onClick={onReplyAll} />
					<IconButton label="Forward" shortcut={keysFor("forward")} icon={ArrowBendUpRightIcon} size="md" onClick={onForward} />
				</>
			)}

			<div className="h-5 w-px bg-kumo-line mx-1" />

			<IconButton
				label={email.starred ? "Unstar" : "Star"}
				shortcut={keysFor("star")}
				icon={StarIcon}
				size="md"
				weight={email.starred ? "fill" : "regular"}
				iconKey={starPops}
				iconClassName={`${email.starred ? "text-kumo-default" : ""} ${starPops ? "animate-pop" : ""}`}
				aria-pressed={email.starred}
				onClick={() => {
					if (!email.starred) setStarPops((n) => n + 1);
					onToggleStar();
				}}
			/>
			<IconButton
				label={email.reply_later ? "Remove from Reply Later" : "Reply later"}
				shortcut={keysFor("replyLater")}
				icon={ClockCounterClockwiseIcon}
				size="md"
				weight={email.reply_later ? "fill" : "regular"}
				iconKey={laterPops}
				iconClassName={`${email.reply_later ? "text-kumo-default" : ""} ${laterPops ? "animate-pop" : ""}`}
				aria-pressed={email.reply_later}
				onClick={() => {
					if (!email.reply_later) setLaterPops((n) => n + 1);
					onToggleReplyLater();
				}}
			/>
			<IconButton
				label={email.read ? "Mark as unread" : "Mark as read"}
				shortcut={keysFor("toggleRead")}
				icon={email.read ? EnvelopeSimpleIcon : EnvelopeOpenIcon}
				size="md"
				onClick={onToggleRead}
			/>
			{onArchive && (
				<IconButton label="Archive" shortcut={keysFor("archive")} icon={ArchiveIcon} size="md" onClick={onArchive} />
			)}
			<MoveToFolderMenu folders={moveToFolders} onMove={onMove} />

			{spamAction && onSpamAction && (
				<Tooltip content={spamAction === "report" ? "Report spam" : "Not spam"} side="bottom" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={spamAction === "report" ? <WarningIcon size={18} /> : <ShieldCheckIcon size={18} />}
						onClick={onSpamAction}
						aria-label={spamAction === "report" ? "Report spam" : "Not spam"}
					/>
				</Tooltip>
			)}

			<div className="ml-auto flex items-center gap-0.5">
				{onPopOut && (
					<IconButton
						label="Pop out"
						shortcut={keysFor("popOut")}
						icon={ArrowsOutSimpleIcon}
						size="md"
						onClick={onPopOut}
						className="hidden md:inline-flex"
					/>
				)}
				<IconButton label="View source" icon={CodeIcon} size="md" onClick={onViewSource} />
				<IconButton label="Delete" shortcut={keysFor("delete")} icon={TrashIcon} size="md" onClick={onDelete} />
				<IconButton
					label={inPopOut ? "Back to column" : "Close"}
					shortcut="Esc"
					icon={XIcon}
					size="md"
					close
					onClick={onBack}
					className={inPopOut ? "" : "hidden md:inline-flex"}
				/>
			</div>
		</div>
	);
}

function MoveToFolderMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const close = useCallback(() => setOpen(false), []);

	return (
		<>
			<IconButton
				ref={triggerRef}
				label="Move to folder"
				icon={FolderSimpleIcon}
				size="md"
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="menu"
				aria-expanded={open}
			/>
			<FloatingPanel
				anchorRef={triggerRef}
				open={open}
				onClose={close}
				align="left"
				role="menu"
				aria-label="Move to"
				className="min-w-[200px]"
			>
				<div className="px-2.5 py-1.5 text-xs font-medium text-kumo-subtle">Move to</div>
				<div className="h-px bg-kumo-line my-1 -mx-1" />
				{folders.map((f) => (
					<button
						key={f.id}
						type="button"
						role="menuitem"
						className="w-full text-left px-2.5 py-2 rounded-lg text-sm text-kumo-default hover:bg-kumo-overlay focus-visible:bg-kumo-overlay focus-visible:outline-none transition-colors duration-100"
						onClick={() => {
							onMove(f.id);
							setOpen(false);
						}}
					>
						{f.name}
					</button>
				))}
			</FloatingPanel>
		</>
	);
}
