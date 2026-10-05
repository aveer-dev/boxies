// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { useColumnStack } from "~/hooks/useColumnStack";

export interface ColumnPaneProps {
	/** Unique column identifier (maps to DOM id: column-${id}) */
	id: string;
	/** Primary column title shown in header */
	title?: ReactNode;
	/** Optional secondary text or email handle */
	subtitle?: string;
	/** Optional counter badge (e.g. unread count or message count) */
	counter?: number | string;
	/** Optional custom badge node (for backward compatibility) */
	badge?: ReactNode;
	/** Column width in pixels (number) or Tailwind width/flex classes (string) */
	width?: number | string;
	/** Whether column can be closed by user */
	closable?: boolean;
	/** Whether column currently has active user focus */
	isActive?: boolean;
	/** Callback invoked when close button (✕) is clicked */
	onClose?: () => void;
	/** Callback invoked when column is clicked/focused */
	onFocus?: () => void;
	/** Optional custom actions rendered in header before close button */
	headerActions?: ReactNode;
	/** Alias for headerActions (for backward compatibility) */
	actions?: ReactNode;
	/** Custom header override if column manages its own chrome */
	customHeader?: ReactNode;
	/** Hide header completely */
	hideHeader?: boolean;
	/** Column body contents */
	children: ReactNode;
	/** Additional classes for root pane wrapper */
	className?: string;
	/** Additional classes for scrollable body container */
	bodyClassName?: string;
	/** Alias for bodyClassName (for backward compatibility) */
	contentClassName?: string;
}

/**
 * Resolves width prop into inline styles and Tailwind utility classes.
 */
function resolveWidth(width?: number | string): {
	style: CSSProperties;
	className: string;
} {
	if (typeof width === "number") {
		return {
			style: { width: `${width}px`, minWidth: `${width}px` },
			className: "shrink-0",
		};
	}

	if (typeof width === "string") {
		// If width is a Tailwind utility class (e.g. 'min-w-[848px] flex-1' or 'w-[300px]')
		if (
			width.startsWith("w-") ||
			width.startsWith("min-w") ||
			width.includes("flex")
		) {
			return {
				style: {},
				className: `${width} shrink-0`,
			};
		}
		// Arbitrary CSS dimension (e.g. '300px')
		return {
			style: { width, minWidth: width },
			className: "shrink-0",
		};
	}

	// Default fallback width
	return {
		style: { width: "300px", minWidth: "300px" },
		className: "shrink-0",
	};
}

export default function ColumnPane({
	id,
	title,
	subtitle,
	counter,
	badge,
	width,
	closable = false,
	isActive: propIsActive,
	onClose,
	onFocus,
	headerActions,
	actions,
	customHeader,
	hideHeader = false,
	children,
	className = "",
	bodyClassName = "",
	contentClassName = "",
}: ColumnPaneProps) {
	const { closeColumn, activeColumnId, setActiveColumn } = useColumnStack();
	const isActive = propIsActive !== undefined ? propIsActive : activeColumnId === id;
	const { style: widthStyle, className: widthClass } = resolveWidth(width);

	const handleFocus = () => {
		if (onFocus) {
			onFocus();
		} else {
			setActiveColumn(id);
		}
	};

	const handleClose = () => {
		if (onClose) {
			onClose();
		} else {
			closeColumn(id);
		}
	};

	const effectiveBodyClass = bodyClassName || contentClassName || "";
	const effectiveActions = headerActions || actions;

	return (
		<section
			id={`column-${id}`}
			data-column-id={id}
			data-active={isActive ? "true" : "false"}
			onClick={handleFocus}
			style={widthStyle}
			className={`h-full flex flex-col shrink-0 min-w-0 border-r border-kumo-line bg-kumo-base relative select-none transition-colors duration-150 ${widthClass} ${
				isActive ? "ring-1 ring-inset ring-kumo-line/50" : ""
			} ${className}`}
			aria-label={`${typeof title === "string" ? title : id} column`}
		>
			{/* Column Header */}
			{!hideHeader && (
				customHeader ? (
					customHeader
				) : (
					<header className="h-12 px-4 border-b border-kumo-line flex items-center justify-between shrink-0 bg-kumo-base z-10 select-none">
						{/* Title, Subtitle & Counter */}
						<div className="flex items-center gap-2 min-w-0 mr-2">
							{typeof title === "string" ? (
								<h2 className="text-sm font-semibold text-kumo-default truncate tracking-tight">
									{title}
								</h2>
							) : (
								title
							)}
							{subtitle && (
								<span className="text-xs text-kumo-subtle truncate max-w-[120px]">
									{subtitle}
								</span>
							)}
							{counter !== undefined && counter !== null && (
								<Badge variant="secondary" className="text-xs font-mono shrink-0">
									{counter}
								</Badge>
							)}
							{badge}
						</div>

						{/* Header Actions & Close Button */}
						<div className="flex items-center gap-1 shrink-0">
							{effectiveActions}

							{closable && (
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										handleClose();
									}}
									className="p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-line"
									aria-label={`Close ${typeof title === "string" ? title : id} column`}
									title="Close column (✕)"
								>
									<XIcon size={16} weight="bold" />
								</button>
							)}
						</div>
					</header>
				)
			)}

			{/* Scrollable Body Container */}
			<div
				className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain select-text bg-kumo-base ${effectiveBodyClass}`}
			>
				{children}
			</div>
		</section>
	);
}
