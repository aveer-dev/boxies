// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import {
	GearSixIcon,
	MagnifyingGlassIcon,
	PencilSimpleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useColumnStack } from "~/hooks/useColumnStack";

export interface FloatingDockProps {
	className?: string;
	onSearch?: (query: string) => void;
	onOpenSettings?: () => void;
	onOpenCompose?: () => void;
}

export default function FloatingDock({
	className = "",
	onSearch,
	onOpenSettings,
	onOpenCompose,
}: FloatingDockProps) {
	const { openPlatformColumn } = useColumnStack();
	const [searchQuery, setSearchQuery] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Global keyboard shortcuts:
	// - Cmd+K / Ctrl+K: focus Omnibar input
	// - Cmd+N / Ctrl+N: open/focus Compose column
	// - Cmd+, / Ctrl+,: open/focus Settings column
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
				e.preventDefault();
				if (onOpenCompose) {
					onOpenCompose();
				} else {
					openPlatformColumn("compose");
				}
			} else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
				e.preventDefault();
				if (onOpenSettings) {
					onOpenSettings();
				} else {
					openPlatformColumn("settings");
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [openPlatformColumn, onOpenCompose, onOpenSettings]);

	const handleSearchSubmit = (e: FormEvent) => {
		e.preventDefault();
		const trimmed = searchQuery.trim();
		if (onSearch) {
			onSearch(trimmed);
		} else {
			openPlatformColumn("search", trimmed ? { query: trimmed } : undefined);
		}
	};

	const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			if (searchQuery) {
				setSearchQuery("");
			} else {
				inputRef.current?.blur();
			}
		}
	};

	const handleSettingsClick = () => {
		if (onOpenSettings) {
			onOpenSettings();
		} else {
			openPlatformColumn("settings");
		}
	};

	const handleComposeClick = () => {
		if (onOpenCompose) {
			onOpenCompose();
		} else {
			openPlatformColumn("compose");
		}
	};

	return (
		<nav
			aria-label="Floating dock"
			className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 select-none pointer-events-auto ${className}`}
		>
			{/* Floating Settings FAB (⚙): circular elevated button */}
			<Tooltip content="Settings (⌘,)" side="top" asChild>
				<button
					type="button"
					onClick={handleSettingsClick}
					className="h-11 w-11 rounded-full bg-kumo-elevated/90 backdrop-blur-md border border-kumo-line text-kumo-default shadow-sm hover:bg-kumo-tint flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-kumo-ring shrink-0"
					aria-label="Settings"
				>
					<GearSixIcon size={20} />
				</button>
			</Tooltip>

			{/* Centered Omnibar Pill: liquid-glass capsule with search and ⌘K badge */}
			<form
				role="search"
				onSubmit={handleSearchSubmit}
				onClick={() => inputRef.current?.focus()}
				className="bg-kumo-elevated/90 backdrop-blur-md border border-kumo-line text-kumo-default shadow-sm rounded-full px-4 py-2.5 flex items-center gap-3 w-[460px] max-w-[90vw] transition-all hover:border-kumo-ring focus-within:border-kumo-ring focus-within:ring-1 focus-within:ring-kumo-ring/30 focus-within:shadow-md cursor-text"
			>
				<MagnifyingGlassIcon size={18} className="text-kumo-subtle shrink-0" />
				<input
					ref={inputRef}
					type="text"
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					onKeyDown={handleInputKeyDown}
					placeholder="Search messages, senders, or commands..."
					className="bg-transparent border-0 outline-none text-sm text-kumo-default placeholder:text-kumo-subtle flex-1 min-w-0"
					aria-label="Search messages, senders, or commands"
				/>
				{searchQuery && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setSearchQuery("");
							inputRef.current?.focus();
						}}
						className="p-0.5 rounded-full text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint transition-colors shrink-0"
						aria-label="Clear search"
					>
						<XIcon size={14} />
					</button>
				)}
				<kbd className="px-1.5 py-0.5 rounded bg-kumo-fill text-[11px] font-mono text-kumo-subtle font-medium border border-kumo-hairline select-none shrink-0 pointer-events-none">
					⌘K
				</kbd>
			</form>

			{/* Primary Compose FAB (✏): circular brand-colored button */}
			<Tooltip content="New Message (⌘N)" side="top" asChild>
				<button
					type="button"
					onClick={handleComposeClick}
					className="h-12 w-12 rounded-full bg-kumo-brand text-kumo-inverse hover:bg-kumo-brand-hover shadow-md flex items-center justify-center cursor-pointer transition-transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-kumo-ring shrink-0"
					aria-label="New Message"
				>
					<PencilSimpleIcon size={22} weight="bold" />
				</button>
			</Tooltip>
		</nav>
	);
}
