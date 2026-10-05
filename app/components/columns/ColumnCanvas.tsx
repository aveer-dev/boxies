// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
} from "react";
import { type ColumnItem, useColumnStack } from "~/hooks/useColumnStack";
import AccountsColumn from "./AccountsColumn";
import ColumnPane from "./ColumnPane";
import FloatingDock from "./FloatingDock";
import FoldersTagsColumn from "./FoldersTagsColumn";
import {
	AgentColumn,
	ComposeColumn,
	SearchColumn,
	SettingsColumn,
} from "./PlatformColumns";
import ReadingRoomColumn from "./ReadingRoomColumn";
import ThreadListColumn from "./ThreadListColumn";

export interface ColumnCanvasProps {
	/** Optional custom child panes (used during custom rendering or testing) */
	children?: ReactNode;
	/** Optional custom renderer for column items in the stack */
	renderColumn?: (column: ColumnItem, index: number) => ReactNode;
	/** Additional canvas classes */
	className?: string;
}

/**
 * Fallback column body placeholder when column adapters are loading or in preview.
 */
function PlaceholderColumnContent({ column }: { column: ColumnItem }) {
	return (
		<div className="p-4 text-xs text-kumo-subtle space-y-2">
			<div className="font-mono text-kumo-strong font-medium">
				[{column.type.toUpperCase()}] {column.title}
			</div>
			<p className="leading-relaxed">
				Column pane mounted with stable DOM state.
			</p>
			{column.props && (
				<pre className="p-2 rounded bg-kumo-recessed text-[11px] overflow-x-auto text-kumo-default">
					{JSON.stringify(column.props, null, 2)}
				</pre>
			)}
		</div>
	);
}

export default function ColumnCanvas({
	children,
	renderColumn,
	className = "",
}: ColumnCanvasProps) {
	const canvasRef = useRef<HTMLDivElement>(null);
	const { columns, activeColumnId, setActiveColumn, scrollToColumn } =
		useColumnStack();

	const prevActiveIdRef = useRef<string | null>(null);
	const prevCountRef = useRef<number>(columns.length);

	/**
	 * Smooth Auto-Scroll Trigger:
	 * Fires whenever activeColumnId changes or a new column is appended to the stack.
	 * Schedules scroll execution in a requestAnimationFrame to guarantee React DOM commit.
	 */
	useEffect(() => {
		if (!activeColumnId) return;

		const isNewActive = activeColumnId !== prevActiveIdRef.current;
		const isAppended = columns.length > prevCountRef.current;

		if (isNewActive || isAppended) {
			const rafId = requestAnimationFrame(() => {
				const targetElement =
					document.getElementById(`column-${activeColumnId}`) ||
					document.getElementById(`column-pane-${activeColumnId}`);
				if (targetElement) {
					targetElement.scrollIntoView({
						behavior: "smooth",
						inline: "nearest",
						block: "nearest",
					});
				}
			});

			prevActiveIdRef.current = activeColumnId;
			prevCountRef.current = columns.length;

			return () => cancelAnimationFrame(rafId);
		}

		prevCountRef.current = columns.length;
	}, [activeColumnId, columns.length]);

	/**
	 * Mouse Wheel Usability Handler:
	 * Allows desktop users with vertical scroll wheels to scroll the horizontal
	 * canvas when hovering over non-scrollable areas (headers, borders, canvas base).
	 */
	const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
		// If the event already has dominant horizontal delta, allow native browser panning
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

		// Check if the target is inside an element that is vertically scrollable
		let el = e.target as HTMLElement | null;
		while (el && el !== canvasRef.current) {
			const style = window.getComputedStyle(el);
			const isScrollable =
				style.overflowY === "auto" || style.overflowY === "scroll";
			const hasVerticalOverflow = el.scrollHeight > el.clientHeight;

			if (isScrollable && hasVerticalOverflow) {
				// Allow the inner vertical container to scroll normally
				return;
			}
			el = el.parentElement;
		}

		// Target is on header or non-scrollable area: convert vertical wheel to horizontal scroll
		if (canvasRef.current) {
			canvasRef.current.scrollLeft += e.deltaY;
		}
	}, []);

	// Keyboard shortcuts for horizontal canvas navigation: [ and ] to pan between columns
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				(e.target as HTMLElement).isContentEditable
			) {
				return;
			}

			if (e.key === "[") {
				e.preventDefault();
				const currentIdx = columns.findIndex((c) => c.id === activeColumnId);
				if (currentIdx > 0) {
					const prevId = columns[currentIdx - 1].id;
					setActiveColumn(prevId);
					scrollToColumn(prevId);
				}
			} else if (e.key === "]") {
				e.preventDefault();
				const currentIdx = columns.findIndex((c) => c.id === activeColumnId);
				if (currentIdx >= 0 && currentIdx < columns.length - 1) {
					const nextId = columns[currentIdx + 1].id;
					setActiveColumn(nextId);
					scrollToColumn(nextId);
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [columns, activeColumnId, setActiveColumn, scrollToColumn]);

	return (
		<div
			ref={canvasRef}
			onWheel={handleWheel}
			className={`overflow-x-auto h-screen w-screen bg-kumo-base scroll-smooth flex flex-row flex-nowrap relative select-none overscroll-x-contain overflow-y-hidden ${className}`}
			role="region"
			aria-label="Horizontal Column Navigation Canvas"
		>
			{children ? (
				children
			) : (
				columns.map((col, index) => {
					if (renderColumn) {
						return (
							<div key={col.id} className="h-full">
								{renderColumn(col, index)}
							</div>
						);
					}

					switch (col.type) {
						case "accounts":
							return <AccountsColumn key={col.id} />;
						case "folders":
							return (
								<FoldersTagsColumn
									key={col.id}
									mailboxId={col.props?.mailboxId}
								/>
							);
						case "threads":
							return (
								<ThreadListColumn
									key={col.id}
									mailboxId={col.props?.mailboxId}
									folderId={col.props?.folderId}
								/>
							);
						case "reader":
							return (
								<ReadingRoomColumn
									key={col.id}
									emailId={col.props?.emailId}
									mailboxId={col.props?.mailboxId}
									folderId={col.props?.folderId}
								/>
							);
						case "settings":
							return <SettingsColumn key={col.id} columnId={col.id} />;
						case "compose":
							return <ComposeColumn key={col.id} columnId={col.id} />;
						case "search":
							return (
								<SearchColumn
									key={col.id}
									columnId={col.id}
									initialQuery={col.props?.query}
								/>
							);
						case "agent":
							return <AgentColumn key={col.id} columnId={col.id} />;
						default:
							return (
								<ColumnPane
									key={col.id}
									id={col.id}
									title={col.title}
									subtitle={col.subtitle}
									width={col.width}
									closable={col.closable}
								>
									<PlaceholderColumnContent column={col} />
								</ColumnPane>
							);
					}
				})
			)}

			{/* Floating Dock: Omnibar & Quick Actions */}
			<FloatingDock />
		</div>
	);
}
