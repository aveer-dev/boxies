// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import {
	ArrowBendUpLeftIcon,
	PaperclipIcon,
	StarIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { formatListDate } from "shared/dates";
import { isAuthSpoofed } from "~/lib/email-auth";
import { getNonInlineAttachments, hasFileAttachment } from "~/lib/utils";
import type { Email } from "~/types";

export function ThreadChip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center max-w-[160px] truncate rounded border border-kumo-line px-1.5 py-px text-[11px] text-kumo-strong">
			{children}
		</span>
	);
}

/**
 * One row of the thread-list column (Figma "Article"): unread dot, sender
 * and time, subject, snippet, then chips. Hover actions and per-list extras
 * are passed in so folder, Reply Later and search lists share the layout.
 */
export default function ThreadRow({
	email,
	isSelected,
	isUnread,
	onOpen,
	sender,
	subject,
	snippet,
	chips,
	leading,
	onToggleStar,
	hoverActions,
}: {
	email: Email;
	isSelected: boolean;
	isUnread: boolean;
	onOpen: () => void;
	sender: ReactNode;
	subject?: ReactNode;
	snippet?: ReactNode;
	chips?: ReactNode;
	leading?: ReactNode;
	onToggleStar?: () => void;
	hoverActions?: ReactNode;
}) {
	const fileCount = getNonInlineAttachments(email.attachments).length;
	const hasFiles = hasFileAttachment(email);
	const showChips = Boolean(chips) || hasFiles;

	return (
		<div
			role="button"
			tabIndex={0}
			aria-current={isSelected ? "true" : undefined}
			data-email-id={email.id}
			onClick={onOpen}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				}
			}}
			className={`group relative flex gap-2.5 px-3 py-3.5 border-b border-kumo-line cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kumo-brand ${
				isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"
			}`}
		>
			{isSelected && <span className="absolute inset-y-0 left-0 w-0.5 bg-kumo-contrast" />}

			<div className="w-1.5 shrink-0 pt-[7px]">
				{isUnread && <span className="block h-1.5 w-1.5 rounded-full bg-kumo-contrast" />}
			</div>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					{leading}
					<span
						className={`truncate text-sm ${isUnread ? "font-semibold text-kumo-default" : "font-medium text-kumo-strong"}`}
					>
						{sender}
					</span>
					{(email.thread_count ?? 1) > 1 && (
						<span className="shrink-0 rounded-full bg-kumo-fill px-1.5 text-[11px] leading-4 text-kumo-subtle tabular-nums">
							{email.thread_count}
						</span>
					)}
					{email.has_draft && (
						<span className="shrink-0 text-xs font-medium text-kumo-danger">Draft</span>
					)}
					{isAuthSpoofed(email) && (
						<span className="shrink-0 text-xs font-medium text-kumo-danger">Spoofed</span>
					)}
					{email.needs_reply && !email.has_draft && (
						<Tooltip content="Needs reply" asChild>
							<span className="shrink-0 text-kumo-warning">
								<ArrowBendUpLeftIcon size={12} weight="bold" />
							</span>
						</Tooltip>
					)}
					<span className="ml-auto shrink-0 pl-2 text-xs text-kumo-subtle tabular-nums group-hover:hidden group-focus-within:hidden">
						{formatListDate(email.date)}
					</span>
					<span className="ml-auto hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
						{onToggleStar && (
							<StarToggle starred={email.starred} onToggle={onToggleStar} />
						)}
						{hoverActions}
					</span>
					{email.starred && onToggleStar && (
						<span className="shrink-0 -my-1 group-hover:hidden group-focus-within:hidden">
							<StarToggle starred onToggle={onToggleStar} />
						</span>
					)}
				</div>
				<div
					className={`mt-0.5 truncate text-sm ${isUnread ? "font-medium text-kumo-default" : "text-kumo-strong"}`}
				>
					{subject ?? (email.subject || "(no subject)")}
				</div>
				{snippet && (
					<div className="mt-1.5 truncate text-[13px] text-kumo-subtle">{snippet}</div>
				)}
				{showChips && (
					<div className="mt-2 flex items-center gap-2 flex-wrap">
						{chips}
						{hasFiles && (
							<span className="inline-flex items-center gap-1 text-[11px] text-kumo-subtle">
								<PaperclipIcon size={12} aria-label="Has attachment" />
								{fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "Files"}
							</span>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function StarToggle({ starred, onToggle }: { starred: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="p-1 rounded-md hover:bg-kumo-fill"
			onClick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
			aria-label={starred ? "Unstar" : "Star"}
			aria-pressed={starred}
		>
			<StarIcon
				size={14}
				weight={starred ? "fill" : "regular"}
				className={starred ? "text-kumo-warning" : "text-kumo-subtle"}
			/>
		</button>
	);
}

/** Small icon button for a row's hover actions. */
export function RowAction({
	label,
	icon,
	onClick,
}: {
	label: string;
	icon: ReactNode;
	onClick: () => void;
}) {
	return (
		<Tooltip content={label} asChild>
			<button
				type="button"
				className="p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-fill"
				onClick={(e) => {
					e.stopPropagation();
					onClick();
				}}
				aria-label={label}
			>
				{icon}
			</button>
		</Tooltip>
	);
}
