// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretLeftIcon, XIcon } from "@phosphor-icons/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	useRef,
} from "react";
import { IconButton } from "~/components/IconButton";
import ScrollArea from "~/components/ScrollArea";
import { useColumnFocus } from "~/hooks/useColumnFocus";
import { useColumnWidths } from "~/hooks/useColumnWidths";

/** Matches `--dock-h`: the band at the bottom the dock floats over. */
const DOCK_CLEARANCE = 88;

interface ColumnSize {
	/** Fluid default width (CSS), used until the column is dragged. */
	width: string;
	/** Drag limits, px. */
	min: number;
	max: number;
	/** Takes the free width (reader, settings page); hides the empty room. */
	grow?: boolean;
}

/**
 * Desktop sizes per column id. Defaults scale with the window; dragging a
 * column's edge pins it to a width (remembered per device; double-click the
 * edge to go back to fluid). On phones every column is one screen wide.
 */
const COLUMN_SIZES: Record<string, ColumnSize> = {
	accounts: { width: "clamp(220px, 17vw, 300px)", min: 200, max: 420 },
	folders: { width: "clamp(220px, 17vw, 300px)", min: 200, max: 420 },
	list: { width: "clamp(320px, 27vw, 440px)", min: 280, max: 720 },
	reader: { width: "clamp(520px, 48vw, 860px)", min: 420, max: 1600, grow: true },
	settings: { width: "clamp(380px, 30vw, 460px)", min: 340, max: 720 },
	"settings-page": { width: "clamp(480px, 40vw, 640px)", min: 420, max: 1200, grow: true },
	compose: { width: "clamp(480px, 40vw, 640px)", min: 420, max: 1000 },
	agent: { width: "clamp(340px, 28vw, 420px)", min: 320, max: 800 },
};
const DEFAULT_SIZE: ColumnSize = { width: "clamp(240px, 20vw, 320px)", min: 200, max: 720 };

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
		<header className="h-12 pl-2 pr-2 md:pl-4 border-b border-kumo-line flex items-center justify-between gap-2 shrink-0 bg-kumo-base">
			<div className="flex items-center gap-1.5 min-w-0">
				{!isRoot && (
					<IconButton
						label="Back"
						icon={CaretLeftIcon}
						onClick={(e) => (onClose ? onClose() : scrollToPreviousColumn(e))}
						className="md:hidden -ml-0.5"
					/>
				)}
				<div className={`min-w-0 flex items-center gap-1.5 ${isRoot ? "pl-2 md:pl-0" : ""}`}>
					{typeof title === "string" ? (
						<h2 className="text-sm font-medium text-kumo-subtle truncate transition-colors duration-200 group-data-[active=true]/column:text-kumo-default">
							{title}
						</h2>
					) : (
						title
					)}
					{counter !== undefined && counter !== null && counter !== 0 && (
						<span
							key={String(counter)}
							className="shrink-0 min-w-5 px-1.5 rounded-full bg-[var(--bg-badge)] text-2xs leading-[18px] text-center text-kumo-subtle tabular-nums animate-pop"
						>
							{counter}
						</span>
					)}
				</div>
			</div>
			<div className="flex items-center gap-0.5 shrink-0">
				{actions}
				{onClose && (
					<IconButton
						label={closeLabel}
						shortcut="Esc"
						icon={XIcon}
						close
						onClick={onClose}
						className="hidden md:inline-flex"
					/>
				)}
			</div>
		</header>
	);
}

export interface ColumnPaneProps extends ColumnHeaderProps {
	/** DOM id is `column-${id}`; also used for [ / ] keyboard focus and its size. */
	id: string;
	/**
	 * Size and remembered width to use when several columns share a kind
	 * (compose-1, compose-2… all size as "compose"). Defaults to `id`.
	 */
	sizeId?: string;
	hideHeader?: boolean;
	/** False when the content manages its own scrolling (reader, compose). */
	scrollBody?: boolean;
	/**
	 * When this changes (a different message, settings page, compose target)
	 * the canvas scrolls the column into view, as it does for a new column.
	 */
	revealKey?: string | number;
	children: ReactNode;
	className?: string;
	bodyClassName?: string;
}

export default function ColumnPane({
	id,
	sizeId = id,
	hideHeader = false,
	scrollBody = true,
	revealKey,
	children,
	className = "",
	bodyClassName = "",
	...header
}: ColumnPaneProps) {
	const setActiveColumn = useColumnFocus((s) => s.setActiveColumn);
	const isActive = useColumnFocus((s) => s.activeColumnId === id);
	const label = typeof header.title === "string" ? header.title : id;
	const size = COLUMN_SIZES[sizeId] ?? DEFAULT_SIZE;
	const pinned = useColumnWidths((s) => s.widths[sizeId]);
	const style = { "--col-w": pinned ? `${pinned}px` : size.width } as CSSProperties;

	return (
		<section
			id={`column-${id}`}
			data-column-id={id}
			data-reveal-key={revealKey ?? ""}
			data-active={isActive}
			data-grow={size.grow || undefined}
			style={style}
			// Capture phase: runs before child handlers, so a click that opens the
			// next column doesn't get its focus stolen back by this one.
			onPointerDownCapture={() => setActiveColumn(id)}
			className={`group/column column-enter relative h-full w-screen shrink-0 snap-start flex flex-col min-w-0 border-r border-kumo-line bg-kumo-base ${
				size.grow ? "md:w-auto md:flex-[1_0_var(--col-w)]" : "md:w-[var(--col-w)]"
			} ${className}`}
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
			<ResizeHandle id={sizeId} label={label} size={size} />
		</section>
	);
}

/**
 * Drag (or ←/→) the column's right edge to resize it; double-click to return
 * to the fluid default. Width updates live on the column's `--col-w` and is
 * saved on release.
 */
function ResizeHandle({ id, label, size }: { id: string; label: string; size: ColumnSize }) {
	const setWidth = useColumnWidths((s) => s.setWidth);
	const resetWidth = useColumnWidths((s) => s.resetWidth);
	const pinned = useColumnWidths((s) => s.widths[id]);
	const drag = useRef<{ x: number; width: number; next: number } | null>(null);

	const column = (el: HTMLElement) => el.closest<HTMLElement>("section[data-column-id]");
	const clamp = (w: number) => Math.min(size.max, Math.max(size.min, w));

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		const section = column(e.currentTarget);
		if (!section || e.button !== 0) return;
		e.preventDefault();
		const width = section.getBoundingClientRect().width;
		drag.current = { x: e.clientX, width, next: width };
		e.currentTarget.setPointerCapture(e.pointerId);
		e.currentTarget.dataset.dragging = "true";
		document.documentElement.classList.add("is-resizing-columns");
	};
	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		const section = column(e.currentTarget);
		if (!drag.current || !section) return;
		drag.current.next = clamp(drag.current.width + e.clientX - drag.current.x);
		section.style.setProperty("--col-w", `${drag.current.next}px`);
	};
	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
		delete e.currentTarget.dataset.dragging;
		document.documentElement.classList.remove("is-resizing-columns");
		if (Math.abs(drag.current.next - drag.current.width) >= 1) setWidth(id, drag.current.next);
		drag.current = null;
	};
	const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
		column(e.currentTarget)?.style.removeProperty("--col-w");
		resetWidth(id);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		const section = column(e.currentTarget);
		if (!section) return;
		e.preventDefault();
		const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowLeft" ? -1 : 1);
		setWidth(id, clamp(section.getBoundingClientRect().width + step));
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize ${label} column`}
			aria-valuemin={size.min}
			aria-valuemax={size.max}
			aria-valuenow={pinned}
			tabIndex={0}
			title="Drag to resize · double-click to reset"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onDoubleClick={onDoubleClick}
			onKeyDown={onKeyDown}
			className="group/resize absolute inset-y-0 -right-[4px] z-30 hidden w-[9px] cursor-col-resize touch-none md:block focus-visible:outline-none"
		>
			<span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-[background-color,width] duration-150 ease-[var(--ease-out)] group-hover/resize:w-[2px] group-hover/resize:bg-[var(--border-control)] group-focus-visible/resize:w-[2px] group-focus-visible/resize:bg-[var(--focus-ring)] group-data-[dragging=true]/resize:w-[2px] group-data-[dragging=true]/resize:bg-[var(--text-muted)]" />
		</div>
	);
}
