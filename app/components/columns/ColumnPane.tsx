// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretLeftIcon, XIcon } from "@phosphor-icons/react";
import type { MouseEvent, ReactNode } from "react";
import { useColumnFocus } from "~/hooks/useColumnFocus";

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
		<header className="h-11 pl-2 pr-2 md:pl-4 border-b border-kumo-line flex items-center justify-between gap-2 shrink-0 bg-kumo-base">
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
						<h2 className="text-xs font-medium text-kumo-subtle truncate">{title}</h2>
					) : (
						title
					)}
					{counter !== undefined && counter !== null && counter !== 0 && (
						<span className="shrink-0 min-w-4 px-1 rounded border border-kumo-line text-[10px] leading-4 text-center text-kumo-subtle tabular-nums">
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
						className="hidden md:inline-flex p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors"
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
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
}

export default function ColumnPane({
	id,
	widthClassName = "md:w-[300px]",
	hideHeader = false,
	scrollBody = true,
	children,
	className = "",
	bodyClassName = "",
	...header
}: ColumnPaneProps) {
	const setActiveColumn = useColumnFocus((s) => s.setActiveColumn);
	const label = typeof header.title === "string" ? header.title : id;

	return (
		<section
			id={`column-${id}`}
			data-column-id={id}
			// Capture phase: runs before child handlers, so a click that opens the
			// next column doesn't get its focus stolen back by this one.
			onPointerDownCapture={() => setActiveColumn(id)}
			className={`h-full w-screen shrink-0 snap-start flex flex-col min-w-0 border-r border-kumo-line bg-kumo-base ${widthClassName} ${className}`}
			aria-label={`${label} column`}
		>
			{!hideHeader && <ColumnHeader {...header} />}
			<div
				className={`flex-1 min-h-0 ${scrollBody ? "overflow-y-auto overscroll-y-contain pb-20" : "flex flex-col overflow-hidden"} ${bodyClassName}`}
			>
				{children}
			</div>
		</section>
	);
}
