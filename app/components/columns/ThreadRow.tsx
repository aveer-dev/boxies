// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	type Icon,
	type IconWeight,
	ArrowBendUpLeftIcon,
	DotsThreeIcon,
	LockSimpleIcon,
	PaperclipIcon,
	PushPinIcon,
	StarIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, type MouseEvent, type ReactNode, useState } from "react";
import { formatListDate } from "shared/dates";
import { useContextMenu } from "~/components/ContextMenu";
import { IconButton, Tip } from "~/components/IconButton";
import { isAuthSpoofed } from "~/lib/email-auth";
import { deliveryStatusLabel, isDeliveryFailure } from "~/lib/delivery-status";
import { notePreviewText } from "~/lib/thread-notes";
import { getNonInlineAttachments, hasFileAttachment } from "~/lib/utils";
import type { Email } from "~/types";

export function ThreadChip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center max-w-[160px] truncate rounded-full bg-[var(--bg-badge)] px-2 py-px text-xs text-kumo-strong shadow-[inset_0_0_0_1px_var(--border-card)] transition-colors hover:bg-[var(--bg-card-hover)]">
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
	onMenu,
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
	/**
	 * Opens the row's actions menu: at the pointer on right-click, under the
	 * row from the keyboard (menu key / ⇧F10), or beside the ⋯ button.
	 */
	onMenu?: (from: MouseEvent<HTMLElement> | HTMLElement) => void;
	/** Position in the list: staggers the entrance of the first rows. */
	index?: number;
}) {
	// The row stays marked while its menu is open.
	const menuOpen = useContextMenu(
		(s) => s.menu?.returnFocus?.closest<HTMLElement>("[data-email-id]")?.dataset.emailId === email.id,
	);
	const fileCount = getNonInlineAttachments(email.attachments).length;
	const hasFiles = hasFileAttachment(email);
	// Notes to self (AVE-60): the sticky's text on the bottom row; inline notes as a count.
	const stickyPreview = email.has_sticky_note ? notePreviewText(email.sticky_note_text) : "";
	const inlineNotes = email.inline_note_count ?? 0;
	const showChips = Boolean(chips) || hasFiles || inlineNotes > 0;

	return (
		<div
			role="button"
			tabIndex={0}
			aria-current={isSelected ? "true" : undefined}
			data-email-id={email.id}
			data-menu-open={menuOpen || undefined}
			onClick={onOpen}
			onContextMenu={onMenu}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				} else if (onMenu && (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey))) {
					e.preventDefault();
					onMenu(e.currentTarget);
				}
			}}
			style={{ "--i": index } as CSSProperties}
			className={`row-enter group relative mx-2 mb-0.5 flex gap-3 pl-3.5 pr-4 py-4 rounded-xl cursor-pointer transition-colors duration-150 active:bg-kumo-fill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
				isSelected
					? "bg-kumo-fill [--row-bg:var(--color-kumo-fill)]"
					: "hover:bg-kumo-tint data-[menu-open]:bg-kumo-tint [--row-bg:var(--color-kumo-tint)]"
			}`}
		>
			<div className="w-1.5 shrink-0 pt-2">
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
						<span className="shrink-0 min-w-5 rounded-full bg-[var(--bg-badge)] px-1.5 text-center text-xs leading-[18px] text-kumo-subtle tabular-nums">
							{email.thread_count}
						</span>
					)}
					{email.has_draft && (
						<span className="shrink-0 rounded-full bg-[var(--bg-badge)] px-1.5 text-xs font-medium leading-[18px] text-kumo-strong">
							Draft
						</span>
					)}
					{isDeliveryFailure(email.delivery_status) && (
						<span className="shrink-0 rounded-full bg-[var(--bg-badge)] px-1.5 text-xs font-medium leading-[18px] text-kumo-strong">
							{deliveryStatusLabel(email.delivery_status)}
						</span>
					)}
					{isAuthSpoofed(email) && (
						<span className="shrink-0 text-xs font-medium text-kumo-danger">Spoofed</span>
					)}
					{email.needs_reply && !email.has_draft && (
						<Tip label="Needs reply">
							<span className="shrink-0 text-kumo-strong">
								<ArrowBendUpLeftIcon size={14} weight="bold" />
							</span>
						</Tip>
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
							className={`absolute right-0 top-1/2 -translate-y-1/2 flex items-center pl-3 opacity-0 translate-x-1 pointer-events-none transition-[opacity,translate] duration-200 ease-[var(--ease-out)] group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:translate-x-0 group-focus-within:pointer-events-auto bg-[linear-gradient(to_right,transparent,var(--row-bg)_12px)]`}
						>
							{onToggleStar && (
								<StarToggle starred={email.starred} onToggle={onToggleStar} />
							)}
							{hoverActions}
							{onMenu && (
								<IconButton
									label="More actions"
									icon={DotsThreeIcon}
									weight="bold"
									aria-haspopup="menu"
									onClick={(e) => {
										e.stopPropagation();
										onMenu(e.currentTarget);
									}}
								/>
							)}
						</span>
					</span>
				</div>
				<div
					className={`mt-1 truncate text-sm ${isUnread ? "font-medium text-kumo-default" : "text-kumo-strong"}`}
				>
					{subject ?? (email.subject || "(no subject)")}
				</div>
				{snippet && (
					<div className="mt-1 truncate text-sm text-kumo-subtle">{snippet}</div>
				)}
				{showChips && (
					<div className="mt-2.5 flex items-center gap-2 flex-wrap">
						{chips}
						{hasFiles && (
							<span className="inline-flex items-center gap-1 text-xs text-kumo-subtle">
								<PaperclipIcon size={12} aria-label="Has attachment" />
								{fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "Files"}
							</span>
						)}
						{inlineNotes > 0 && (
							<span className="inline-flex items-center gap-1 rounded-full bg-[var(--note-paper)] px-1.5 py-px text-xs text-[var(--note-muted)] shadow-[inset_0_0_0_1px_var(--note-paper-edge)]">
								<LockSimpleIcon size={12} weight="bold" aria-hidden className="text-[var(--note-pin)]" />
								{inlineNotes} private note{inlineNotes === 1 ? "" : "s"}
							</span>
						)}
					</div>
				)}
				{stickyPreview && (
					<div className="mt-2.5 flex items-start gap-1.5 rounded-lg rounded-br-[10px] bg-[var(--note-paper)] px-2.5 py-1.5 text-xs leading-[1.125rem] text-[var(--note-ink)] shadow-[inset_0_0_0_1px_var(--note-paper-edge)]">
						<PushPinIcon size={12} weight="fill" aria-hidden className="mt-[3px] shrink-0 text-[var(--note-pin)]" />
						<span className="sr-only">Note to self: </span>
						<span className="min-w-0 line-clamp-2 break-words font-medium">{stickyPreview}</span>
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
		<IconButton
			label={starred ? "Unstar" : "Star"}
			icon={StarIcon}
			weight={starred ? "fill" : "regular"}
			iconKey={pops}
			iconClassName={`${starred ? "text-kumo-default" : ""} ${pops ? "animate-pop" : ""}`}
			onClick={(e) => {
				e.stopPropagation();
				if (!starred) setPops((n) => n + 1);
				onToggle();
			}}
			aria-pressed={starred}
		/>
	);
}

/** Small icon button for a row's hover actions. */
export function RowAction({
	label,
	shortcut,
	icon,
	weight,
	onClick,
}: {
	label: string;
	shortcut?: string;
	icon: Icon;
	weight?: IconWeight;
	onClick: () => void;
}) {
	return (
		<IconButton
			label={label}
			shortcut={shortcut}
			icon={icon}
			weight={weight}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
		/>
	);
}
