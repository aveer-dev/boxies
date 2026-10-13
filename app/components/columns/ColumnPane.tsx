// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretLeftIcon, XIcon } from "@phosphor-icons/react";
import type { MouseEvent, ReactNode } from "react";
import ScrollArea from "~/components/ScrollArea";
import { useColumnFocus } from "~/hooks/useColumnFocus";

/** Matches `--dock-h`: the band at the bottom the dock floats over. */
const DOCK_CLEARANCE = 88;

export interface ColumnHeaderProps {
	title?: ReactNode;
	/** Count shown in a small pill after the title (e.g. "Inbox [14]"). */
	counter?: number | string;
	actions?: ReactNode;
	/** Renders ✕ (and the mobile back chevron) that calls this. */
	onClose?: () => void;
	closeLabel?: string;
	/** Hide the mobile back chevron (first column). */
	isRoot?: boolean;
}

function scrollToPreviousColumn(e: MouseEvent<HTMLElement>) {
	const section = e.currentTarget.closest("section[data-column-id]");
	const prev = section?.previousElementSibling;
	if (prev instanceof HTMLElement) {
		prev.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
	}
}

/** 44px column header used by every pane (and settings sub-pages). */
export function ColumnHeader({
	title,
	counter,
	actions,
	onClose,
	closeLabel = "Close column",
	isRoot = false,
}: ColumnHeaderProps) {
	return (
		<header className="h-11 pl-2 pr-2 md:pl-4 border-b border-kumo-line flex items-center justify-between gap-2 shrink-0 bg-kumo-base/90 backdrop-blur-md">
			<div className="flex items-center gap-1.5 min-w-0">
				{!isRoot && (
					<button
						type="button"
						onClick={(e) => (onClose ? onClose() : scrollToPreviousColumn(e))}
						className="md:hidden -ml-0.5 p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
						aria-label="Back"
					>
						<CaretLeftIcon size={18} />
					</button>
				)}
				<div className={`min-w-0 flex items-center gap-1.5 ${isRoot ? "pl-2 md:pl-0" : ""}`}>
					{typeof title === "string" ? (
						<h2 className="text-xs font-medium text-kumo-subtle truncate transition-colors duration-200 group-data-[active=true]/column:text-kumo-default">
							{title}
						</h2>
					) : (
						title
					)}
					{counter !== undefined && counter !== null && counter !== 0 && (
						<span
							key={String(counter)}
							className="shrink-0 min-w-4 px-1.5 rounded-full bg-[var(--bg-badge)] text-[10px] leading-4 text-center text-kumo-subtle tabular-nums animate-pop"
						>
							{counter}
						</span>
					)}
				</div>
			</div>
			<div className="flex items-center gap-0.5 shrink-0">
				{actions}
				{onClose && (
					<button
						type="button"
						onClick={onClose}
						className="hidden md:inline-flex p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
						aria-label={closeLabel}
						title={`${closeLabel} (Esc)`}
					>
						<XIcon size={14} />
					</button>
				)}
			</div>
		</header>
	);
}

export interface ColumnPaneProps extends ColumnHeaderProps {
	/** DOM id is `column-${id}`; also used for [ / ] keyboard focus. */
	id: string;
	/**
	 * Desktop width classes. On phones every column is one full screen wide
	 * and the canvas snaps between them.
	 */
	widthClassName?: string;
	hideHeader?: boolean;
	/** False when the content manages its own scrolling (reader, compose). */
	scrollBody?: boolean;
	/**
	 * When this changes (a different message, settings page, compose target)
	 * the canvas scrolls the column into view, as it does for a new column.
	 */
	revealKey?: string | number;
	/** Takes the free width (reader, settings page); hides the empty room. */
	grow?: boolean;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
}

export default function ColumnPane({
	id,
	widthClassName = "md:w-[300px]",
	hideHeader = false,
	scrollBody = true,
	revealKey,
	grow = false,
	children,
	className = "",
	bodyClassName = "",
	...header
}: ColumnPaneProps) {
	const setActiveColumn = useColumnFocus((s) => s.setActiveColumn);
	const isActive = useColumnFocus((s) => s.activeColumnId === id);
	const label = typeof header.title === "string" ? header.title : id;

	return (
		<section
			id={`column-${id}`}
			data-column-id={id}
			data-reveal-key={revealKey ?? ""}
			data-active={isActive}
			data-grow={grow || undefined}
			// Capture phase: runs before child handlers, so a click that opens the
			// next column doesn't get its focus stolen back by this one.
			onPointerDownCapture={() => setActiveColumn(id)}
			className={`group/column column-enter h-full w-screen shrink-0 snap-start flex flex-col min-w-0 border-r border-kumo-line bg-kumo-base ${widthClassName} ${className}`}
			aria-label={`${label} column`}
		>
			{!hideHeader && <ColumnHeader {...header} />}
			{scrollBody ? (
				<ScrollArea
					className="flex-1"
					contentClassName={`pb-[var(--dock-h)] ${bodyClassName}`}
					trackInsetBottom={DOCK_CLEARANCE}
				>
					{children}
				</ScrollArea>
			) : (
				<div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${bodyClassName}`}>
					{children}
				</div>
			)}
		</section>
	);
}
