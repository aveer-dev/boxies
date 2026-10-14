// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	GearSixIcon,
	MagnifyingGlassIcon,
	NotePencilIcon,
	RobotIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { IconButton, Tip } from "~/components/IconButton";
import ProgressiveBlur from "~/components/ProgressiveBlur";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";
import { useTheme } from "~/lib/theme";
import { isModalOpen, isTypingTarget, revealColumn } from "./ColumnCanvas";

const SEARCH_HINTS = ["from:", "is:unread", "is:starred", "has:attachment", "before:2025-01-01"];

/** The liquid-glass pill the native apps use for their bars. */
const glass =
	"bg-[var(--glass-bg)] backdrop-blur-xl backdrop-saturate-150 shadow-[var(--glass-ring)]";

const roundButton =
	"relative h-10 w-10 shrink-0 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

/** A panel toggle: opens it, brings it back on screen, or closes it when it's in view. */
function PanelToggle({
	label,
	shortcut,
	isOpen,
	columnId,
	onOpen,
	onClose,
	icon,
}: {
	label: string;
	shortcut?: string;
	isOpen: boolean;
	columnId: string;
	onOpen: () => void;
	onClose: () => void;
	icon: React.ReactNode;
}) {
	return (
		<Tip label={isOpen ? `Hide ${label.toLowerCase()}` : label} shortcut={shortcut} side="top">
			<button
				type="button"
				onClick={() => {
					if (!isOpen) onOpen();
					else if (!revealColumn(columnId)) onClose();
				}}
				className={`${roundButton} ${glass} ${
					isOpen ? "text-kumo-default" : "text-kumo-strong hover:text-kumo-default hover:bg-[var(--bg)]"
				}`}
				aria-label={label}
				aria-pressed={isOpen}
			>
				{icon}
				{/* "Open" dot, like a running app in a dock. */}
				<span
					aria-hidden
					className={`absolute bottom-1 left-1/2 -ml-[2px] h-1 w-1 rounded-full bg-kumo-contrast transition-[opacity,scale] duration-300 ease-[var(--spring)] ${
						isOpen ? "opacity-100 scale-100" : "opacity-0 scale-0"
					}`}
				/>
			</button>
		</Tip>
	);
}

/**
 * Bottom dock (Figma "Header"): search pill (⌘K), settings, agent, compose (C).
 * It spans the screen over a progressive blur, so columns scroll away beneath it.
 */
export default function FloatingDock() {
	const [searchParams] = useSearchParams();
	const { isSearch, isSettings, search, closeSearch, openSettings, closeSettings } =
		useMailNavigation();
	const { startCompose, isAgentPanelOpen, openAgentPanel, closeAgentPanel } = useUIStore();
	const urlQuery = isSearch ? searchParams.get("q") || "" : "";
	const [query, setQuery] = useState(urlQuery);
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Keep the pill in sync with the URL (back/forward, filter menu).
	useEffect(() => setQuery(urlQuery), [urlQuery]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			} else if (
				!e.metaKey &&
				!e.ctrlKey &&
				!e.altKey &&
				!isTypingTarget(e.target) &&
				!isModalOpen()
			) {
				if (e.key.toLowerCase() === "c" && !e.shiftKey) {
					e.preventDefault();
					startCompose();
				} else if (e.key === "T" && e.shiftKey) {
					e.preventDefault();
					useTheme.getState().toggle();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [startCompose]);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		const q = query.trim();
		if (q) {
			search(q);
			inputRef.current?.blur();
		}
	};

	const clear = () => {
		setQuery("");
		if (isSearch) closeSearch();
		inputRef.current?.focus();
	};

	return (
		<div className="fixed inset-x-0 bottom-0 z-40 h-[var(--dock-h)] pointer-events-none">
			<ProgressiveBlur edge="bottom" />
			<nav
				aria-label="Dock"
				className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 w-[min(672px,calc(100vw-2rem))]"
			>
				<form
					role="search"
					onSubmit={submit}
					className={`group/search relative flex-1 min-w-0 flex items-center gap-2.5 h-10 pl-3.5 pr-1.5 rounded-full ${glass} transition-[box-shadow,background-color] duration-200 ease-[var(--ease-out)] focus-within:bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] focus-within:shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.45),0_0_0_1px_var(--border-card),0_8px_24px_rgba(0,0,0,0.08)]`}
				>
					<MagnifyingGlassIcon
						size={14}
						className="shrink-0 text-kumo-subtle transition-colors duration-200 group-focus-within/search:text-kumo-default"
					/>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.stopPropagation();
								if (query) clear();
								else inputRef.current?.blur();
							}
						}}
						placeholder="Search messages, senders, or commands…"
						aria-label="Search mail"
						className="flex-1 min-w-0 bg-transparent text-sm text-kumo-default placeholder:text-kumo-subtle outline-none"
					/>
					{query ? (
						<IconButton
							label="Clear search"
							shortcut="Esc"
							icon={XIcon}
							close
							tooltipSide="top"
							onClick={clear}
							className="rounded-full! animate-pop"
						/>
					) : (
						<kbd className="hidden sm:inline-block shrink-0 rounded-full bg-[var(--bg-badge)] px-2 text-xs leading-5 font-sans text-kumo-subtle shadow-[inset_0_0_0_1px_var(--border-card)]">
							⌘K
						</kbd>
					)}
					{isFocused && !query && (
						<div
							className={`absolute bottom-full left-0 right-0 mb-2 rounded-2xl ${glass} px-3.5 py-2.5 text-xs text-kumo-subtle origin-bottom animate-reveal`}
						>
							Try{" "}
							{SEARCH_HINTS.map((hint) => (
								<code
									key={hint}
									className="mr-1.5 rounded-md bg-[var(--bg-badge)] px-1.5 py-px text-xs text-kumo-default"
								>
									{hint}
								</code>
							))}
						</div>
					)}
				</form>

				<PanelToggle
					label="Settings"
					isOpen={isSettings}
					columnId="settings"
					onOpen={openSettings}
					onClose={closeSettings}
					icon={<GearSixIcon size={16} />}
				/>
				<PanelToggle
					label="Assistant"
					shortcut="⌘J"
					isOpen={isAgentPanelOpen}
					columnId="agent"
					onOpen={openAgentPanel}
					onClose={closeAgentPanel}
					icon={<RobotIcon size={16} />}
				/>
				<Tip label="New message" shortcut="C" side="top">
					<button
						type="button"
						onClick={() => startCompose()}
						className={`${roundButton} bg-kumo-contrast text-kumo-inverse shadow-[0_4px_12px_rgba(0,0,0,0.16)] hover:bg-[color-mix(in_oklab,var(--text-primary)_84%,var(--accent))]`}
						aria-label="Compose"
					>
						<NotePencilIcon size={16} />
					</button>
				</Tip>
			</nav>
		</div>
	);
}
