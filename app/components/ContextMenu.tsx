// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretRightIcon, type Icon } from "@phosphor-icons/react";
import {
	type CSSProperties,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { ICON_SIZE } from "~/components/IconButton";

export type MenuEntry =
	| {
			type: "item";
			label: string;
			icon?: Icon;
			shortcut?: string;
			danger?: boolean;
			disabled?: boolean;
			onSelect: () => void;
	  }
	| { type: "submenu"; label: string; icon?: Icon; items: MenuEntry[] }
	| { type: "separator" }
	| { type: "label"; label: string };

interface OpenMenu {
	/** Where it opens: the pointer, or the edge of the button that opened it. */
	x: number;
	y: number;
	/** Opened from a button: open below/left-aligned to it rather than at a point. */
	anchor?: DOMRect;
	entries: MenuEntry[];
	/** Gets focus back on close (the row or ⋯ button). */
	returnFocus?: HTMLElement | null;
	/** Opened with the keyboard: the first item takes focus. */
	viaKeyboard?: boolean;
	label?: string;
}

interface MenuState {
	menu: OpenMenu | null;
	open: (menu: OpenMenu) => void;
	close: () => void;
}

export const useContextMenu = create<MenuState>((set) => ({
	menu: null,
	open: (menu) => set({ menu }),
	close: () => set({ menu: null }),
}));

const MARGIN = 8;
/** Keeps clear of the dock band at the bottom of the screen. */
const BOTTOM_CLEARANCE = 88;
const SUBMENU_DELAY = 120;

const isActionable = (e: MenuEntry) =>
	(e.type === "item" && !e.disabled) || e.type === "submenu";

/**
 * One level of the menu: a list of items with a highlight that glides to
 * the active one. Submenus open beside it on hover (after a beat, so a
 * diagonal move toward them doesn't flicker) or with →.
 */
function MenuPanel({
	entries,
	x,
	y,
	anchor,
	side = "right",
	label,
	autoFocus,
	onDone,
	onBack,
	depth,
}: {
	entries: MenuEntry[];
	x: number;
	y: number;
	anchor?: DOMRect;
	/** Submenus open to the right of their item, or left when there's no room. */
	side?: "right" | "left";
	label?: string;
	autoFocus: boolean;
	/** Closes the whole menu (after a selection or Esc on the root). */
	onDone: (restoreFocus: boolean) => void;
	/** ← / Esc in a submenu: back to the parent item. */
	onBack?: () => void;
	depth: number;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const markRef = useRef<HTMLSpanElement>(null);
	const [active, setActive] = useState(-1);
	const [sub, setSub] = useState<{ index: number; rect: DOMRect; focus: boolean } | null>(null);
	const [chosen, setChosen] = useState(-1);
	const [origin, setOrigin] = useState("top left");
	const subTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

	// Place inside the viewport: flip left / up when it would overflow.
	useLayoutEffect(() => {
		const panel = panelRef.current;
		if (!panel) return;
		const { width, height } = panel.getBoundingClientRect();
		const maxBottom = window.innerHeight - BOTTOM_CLEARANCE;
		let left: number;
		let top: number;
		let fromRight = false;
		let fromBottom = false;
		if (anchor) {
			// Under the ⋯ button, right edges aligned; above it if there's no room.
			left = anchor.right - width;
			top = anchor.bottom + 6;
			fromRight = true;
			if (top + height > maxBottom) {
				top = anchor.top - 6 - height;
				fromBottom = true;
			}
		} else if (depth > 0) {
			// Beside the parent item, its first row level with the item.
			left = side === "right" ? x : x - width;
			fromRight = side === "left";
			top = y - 6;
			if (top + height > maxBottom) {
				top = maxBottom - height;
				fromBottom = true;
			}
		} else {
			left = x;
			top = y;
			if (left + width > window.innerWidth - MARGIN) {
				left = x - width;
				fromRight = true;
			}
			if (top + height > maxBottom) {
				top = y - height;
				fromBottom = true;
			}
		}
		left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
		top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, maxBottom - height));
		panel.style.left = `${left}px`;
		panel.style.top = `${top}px`;
		// Grows out of the corner nearest the pointer.
		setOrigin(`${fromBottom ? "bottom" : "top"} ${fromRight ? "right" : "left"}`);
	}, [x, y, anchor, depth, side]);

	// Keyboard-opened menus (and submenus opened with →) start on the first item.
	useEffect(() => {
		if (autoFocus) {
			const first = entries.findIndex(isActionable);
			setActive(first);
			itemRefs.current[first]?.focus({ preventScroll: true });
		} else {
			panelRef.current?.focus({ preventScroll: true });
		}
		return () => clearTimeout(subTimer.current);
	}, [autoFocus, entries]);

	// The highlight glides to the active item.
	useLayoutEffect(() => {
		const mark = markRef.current;
		const item = itemRefs.current[active];
		if (!mark) return;
		if (!item) {
			mark.style.opacity = "0";
			return;
		}
		mark.style.opacity = "1";
		mark.style.height = `${item.offsetHeight}px`;
		mark.style.transform = `translateY(${item.offsetTop}px)`;
		requestAnimationFrame(() => {
			mark.dataset.ready = "true";
		});
	}, [active]);

	const focusItem = (index: number) => {
		setActive(index);
		itemRefs.current[index]?.focus({ preventScroll: true });
	};

	const move = (by: 1 | -1) => {
		const n = entries.length;
		for (let step = 1; step <= n; step++) {
			const i = (((active < 0 ? (by > 0 ? -1 : 0) : active) + by * step) % n + n) % n;
			if (isActionable(entries[i])) return focusItem(i);
		}
	};

	const openSub = (index: number, focus: boolean) => {
		const item = itemRefs.current[index];
		const panel = panelRef.current;
		if (!item || !panel) return;
		// Level with the item, but outside the panel's edges.
		const i = item.getBoundingClientRect();
		const p = panel.getBoundingClientRect();
		setSub({ index, rect: new DOMRect(p.left, i.top, p.width, i.height), focus });
	};

	const choose = (index: number) => {
		const entry = entries[index];
		if (entry.type === "submenu") return openSub(index, true);
		if (entry.type !== "item" || entry.disabled) return;
		// A quick blink confirms the choice, then the menu goes and the action runs.
		setChosen(index);
		if (markRef.current) markRef.current.dataset.blink = "true";
		setTimeout(() => {
			onDone(true);
			entry.onSelect();
		}, 140);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		// Keys inside an open submenu belong to it.
		if (e.target instanceof Node && !panelRef.current?.contains(e.target)) return;
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				move(1);
				break;
			case "ArrowUp":
				e.preventDefault();
				move(-1);
				break;
			case "Home":
				e.preventDefault();
				focusItem(entries.findIndex(isActionable));
				break;
			case "End": {
				e.preventDefault();
				const last = [...entries].reverse().findIndex(isActionable);
				if (last >= 0) focusItem(entries.length - 1 - last);
				break;
			}
			case "ArrowRight":
				if (entries[active]?.type === "submenu") {
					e.preventDefault();
					openSub(active, true);
				}
				break;
			case "ArrowLeft":
				if (onBack) {
					e.preventDefault();
					onBack();
				}
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				if (active >= 0) choose(active);
				break;
			case "Escape":
				e.preventDefault();
				e.stopPropagation();
				if (onBack) onBack();
				else onDone(true);
				break;
			case "Tab":
				e.preventDefault();
				onDone(true);
				break;
			default:
				// Type a letter to jump to the next item starting with it.
				if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey) {
					const n = entries.length;
					for (let step = 1; step <= n; step++) {
						const i = (active + step + n) % n;
						const entry = entries[i];
						if (isActionable(entry) && "label" in entry && entry.label.toLowerCase().startsWith(e.key.toLowerCase())) {
							focusItem(i);
							break;
						}
					}
				}
		}
	};

	const subEntry = sub ? entries[sub.index] : null;
	const subRoom = sub ? window.innerWidth - sub.rect.right > 240 : true;

	return (
		<>
			<div
				ref={panelRef}
				role="menu"
				aria-label={label}
				tabIndex={-1}
				onKeyDown={onKeyDown}
				onContextMenu={(e) => e.preventDefault()}
				onPointerLeave={() => {
					// The highlight follows the pointer out, unless a submenu holds it.
					if (!sub && chosen < 0) setActive(-1);
					clearTimeout(subTimer.current);
				}}
				style={{ transformOrigin: origin } as CSSProperties}
				className="context-menu fixed z-[96] min-w-[220px] max-h-[calc(100dvh-104px)] overflow-y-auto overscroll-contain rounded-2xl bg-kumo-elevated p-1.5 shadow-[var(--shadow-menu)] outline-none"
			>
				<div className="relative">
					<span
						ref={markRef}
						aria-hidden
						className="pointer-events-none absolute inset-x-0 top-0 rounded-lg bg-kumo-fill opacity-0 data-[ready=true]:transition-[transform,height,opacity] data-[ready=true]:duration-[260ms] data-[ready=true]:ease-[var(--spring)]"
					/>
					{entries.map((entry, i) => {
						if (entry.type === "separator") {
							return <div key={`sep-${i}`} role="separator" className="my-1 -mx-1.5 h-px bg-kumo-line" />;
						}
						if (entry.type === "label") {
							return (
								<div key={`label-${i}`} className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-kumo-subtle">
									{entry.label}
								</div>
							);
						}
						const Glyph = entry.icon;
						const isSub = entry.type === "submenu";
						const danger = entry.type === "item" && entry.danger;
						const disabled = entry.type === "item" && entry.disabled;
						return (
							<button
								key={`${entry.label}-${i}`}
								ref={(el) => {
									itemRefs.current[i] = el;
								}}
								type="button"
								role="menuitem"
								tabIndex={-1}
								aria-haspopup={isSub ? "menu" : undefined}
								aria-expanded={isSub ? sub?.index === i : undefined}
								aria-disabled={disabled || undefined}
								data-active={active === i || undefined}
								data-chosen={chosen === i || undefined}
								onPointerMove={() => {
									if (active !== i) focusItem(i);
									clearTimeout(subTimer.current);
									subTimer.current = setTimeout(() => {
										if (isSub) openSub(i, false);
										else setSub(null);
									}, SUBMENU_DELAY);
								}}
								onClick={() => choose(i)}
								className={`context-menu-item group/item relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-sm outline-none ${
									disabled
										? "cursor-default text-kumo-inactive"
										: danger
											? "text-kumo-danger"
											: "text-kumo-default"
								}`}
							>
								{Glyph && (
									<span
										className={`shrink-0 transition-[color,translate] duration-200 ease-[var(--ease-out)] group-data-[active]/item:translate-x-px ${
											danger ? "" : "text-kumo-subtle group-data-[active]/item:text-kumo-default"
										}`}
									>
										<Glyph size={ICON_SIZE} />
									</span>
								)}
								<span className="flex-1 truncate">{entry.label}</span>
								{entry.type === "item" && entry.shortcut && (
									<kbd className="ml-4 font-sans text-xs text-kumo-subtle">{entry.shortcut}</kbd>
								)}
								{isSub && (
									<CaretRightIcon
										size={12}
										className="ml-4 text-kumo-subtle transition-transform duration-200 ease-[var(--ease-out)] group-data-[active]/item:translate-x-0.5"
									/>
								)}
							</button>
						);
					})}
				</div>
			</div>
			{sub && subEntry?.type === "submenu" && (
				<MenuPanel
					key={sub.index}
					entries={subEntry.items}
					x={subRoom ? sub.rect.right + 4 : sub.rect.left - 4}
					y={sub.rect.top}
					side={subRoom ? "right" : "left"}
					label={subEntry.label}
					autoFocus={sub.focus}
					depth={depth + 1}
					onDone={onDone}
					onBack={() => {
						const index = sub.index;
						setSub(null);
						focusItem(index);
					}}
				/>
			)}
		</>
	);
}

/**
 * Renders the open context menu (one at a time, app-wide) into <body>, so no
 * column or scroller clips it. Closes on outside press, scroll, resize,
 * window blur, Esc or a selection, and hands focus back to where it came from.
 */
export function ContextMenuHost() {
	const menu = useContextMenu((s) => s.menu);
	const close = useContextMenu((s) => s.close);

	const done = useCallback(
		(restoreFocus: boolean) => {
			const target = useContextMenu.getState().menu?.returnFocus;
			close();
			if (restoreFocus) target?.focus({ preventScroll: true });
		},
		[close],
	);

	useEffect(() => {
		if (!menu) return;
		const outside = (e: Event) => {
			if (e.target instanceof Element && e.target.closest(".context-menu")) return;
			done(false);
		};
		const dismiss = () => done(false);
		document.addEventListener("pointerdown", outside, true);
		document.addEventListener("scroll", outside, true);
		window.addEventListener("resize", dismiss);
		window.addEventListener("blur", dismiss);
		return () => {
			document.removeEventListener("pointerdown", outside, true);
			document.removeEventListener("scroll", outside, true);
			window.removeEventListener("resize", dismiss);
			window.removeEventListener("blur", dismiss);
		};
	}, [menu, done]);

	if (!menu || typeof document === "undefined") return null;
	return createPortal(
		<MenuPanel
			key={`${menu.x},${menu.y}`}
			entries={menu.entries}
			x={menu.x}
			y={menu.y}
			anchor={menu.anchor}
			label={menu.label}
			autoFocus={Boolean(menu.viaKeyboard)}
			depth={0}
			onDone={done}
		/>,
		document.body,
	);
}
