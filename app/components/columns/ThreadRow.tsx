// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import {
	ArrowBendUpLeftIcon,
	PaperclipIcon,
	StarIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { formatListDate } from "shared/dates";
import { isAuthSpoofed } from "~/lib/email-auth";
import { getNonInlineAttachments, hasFileAttachment } from "~/lib/utils";
import type { Email } from "~/types";

export function ThreadChip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center max-w-[160px] truncate rounded-full bg-[var(--bg-badge)] px-2 py-px text-[11px] text-kumo-strong shadow-[inset_0_0_0_1px_var(--border-subtle)] transition-colors hover:bg-[var(--bg-card-hover)]">
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
	index = 0,
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
	/** Position in the list: staggers the entrance of the first rows. */
	index?: number;
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
			style={{ "--i": index } as CSSProperties}
			className={`row-enter group relative flex gap-2.5 px-3 py-3.5 border-b border-kumo-line cursor-pointer transition-colors duration-150 active:bg-kumo-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kumo-brand ${
				isSelected ? "bg-kumo-tint" : "hover:bg-kumo-tint"
			}`}
		>
			{isSelected && (
				<span className="absolute inset-y-0 left-0 w-0.5 bg-kumo-contrast origin-center animate-bar-in" />
			)}

			<div className="w-1.5 shrink-0 pt-[7px]">
				<span
					className={`block h-1.5 w-1.5 rounded-full bg-kumo-contrast transition-[opacity,scale] duration-300 ease-[var(--spring)] ${
						isUnread ? "opacity-100 scale-100" : "opacity-0 scale-0"
					}`}
				/>
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
					{/* Date (and star) crossfade to the row's actions on hover / focus. */}
					<span className="relative ml-auto shrink-0 flex items-center pl-2">
						<span className="flex items-center transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
							<span className="text-xs text-kumo-subtle tabular-nums">
								{formatListDate(email.date)}
							</span>
							{email.starred && onToggleStar && (
								<span className="-my-1">
									<StarToggle starred onToggle={onToggleStar} />
								</span>
							)}
						</span>
						<span
							className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center pl-3 opacity-0 translate-x-1 pointer-events-none transition-[opacity,translate] duration-200 ease-[var(--ease-out)] group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:pointer-events-auto bg-[linear-gradient(to_right,transparent,var(--color-kumo-tint)_12px)]`}
						>
							{onToggleStar && (
								<StarToggle starred={email.starred} onToggle={onToggleStar} />
							)}
							{hoverActions}
						</span>
					</span>
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
	// Pops only when the user stars, not when a starred row first renders.
	const [pops, setPops] = useState(0);
	return (
		<button
			type="button"
			className="p-1 rounded-md hover:bg-kumo-fill"
			onClick={(e) => {
				e.stopPropagation();
				if (!starred) setPops((n) => n + 1);
				onToggle();
			}}
			aria-label={starred ? "Unstar" : "Star"}
			aria-pressed={starred}
		>
			<StarIcon
				key={pops}
				size={14}
				weight={starred ? "fill" : "regular"}
				className={`${starred ? "text-kumo-warning" : "text-kumo-subtle"} ${pops ? "animate-pop" : ""}`}
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
