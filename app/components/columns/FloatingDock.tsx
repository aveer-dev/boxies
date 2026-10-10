// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import {
	GearSixIcon,
	MagnifyingGlassIcon,
	NotePencilIcon,
	RobotIcon,
	XIcon,
} from "@phosphor-icons/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMailNavigation } from "~/hooks/useMailNavigation";
import { useUIStore } from "~/hooks/useUIStore";
import { isModalOpen, isTypingTarget } from "./ColumnCanvas";

const SEARCH_HINTS = ["from:", "is:unread", "is:starred", "has:attachment", "before:2025-01-01"];

const roundButton =
	"h-10 w-10 shrink-0 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kumo-brand";

/**
 * Bottom dock (Figma "Header"): search pill (⌘K), settings, agent, compose (C).
 */
export default function FloatingDock() {
	const [searchParams] = useSearchParams();
	const { isSearch, isSettings, search, closeSearch, openSettings, closeSettings } =
		useMailNavigation();
	const { startCompose, isAgentPanelOpen, toggleAgentPanel } = useUIStore();
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
				e.key.toLowerCase() === "c" &&
				!e.metaKey &&
				!e.ctrlKey &&
				!e.altKey &&
				!isTypingTarget(e.target) &&
				!isModalOpen()
			) {
				e.preventDefault();
				startCompose();
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
		<nav
			aria-label="Dock"
			className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 w-[min(672px,calc(100vw-2rem))]"
		>
			<form
				role="search"
				onSubmit={submit}
				className="relative flex-1 min-w-0 flex items-center gap-2.5 h-10 pl-3 pr-1.5 rounded-lg border border-kumo-line bg-kumo-base/85 backdrop-blur-md shadow-lg focus-within:border-kumo-fill-hover"
			>
				<MagnifyingGlassIcon size={14} className="shrink-0 text-kumo-subtle" />
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
					<button
						type="button"
						onClick={clear}
						className="p-1 rounded-md text-kumo-subtle hover:text-kumo-default hover:bg-kumo-tint"
						aria-label="Clear search"
					>
						<XIcon size={13} />
					</button>
				) : (
					<kbd className="hidden sm:inline-block shrink-0 rounded border border-kumo-line px-1.5 text-[11px] leading-5 font-sans text-kumo-subtle">
						⌘K
					</kbd>
				)}
				{isFocused && !query && (
					<div className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-kumo-line bg-kumo-elevated shadow-lg px-3 py-2 text-xs text-kumo-subtle">
						Try{" "}
						{SEARCH_HINTS.map((hint) => (
							<code key={hint} className="mr-1.5 rounded bg-kumo-tint px-1 text-kumo-default">
								{hint}
							</code>
						))}
					</div>
				)}
			</form>

			<Tooltip content="Settings" side="top" asChild>
				<button
					type="button"
					onClick={isSettings ? closeSettings : openSettings}
					className={`${roundButton} border border-kumo-line backdrop-blur-md shadow-lg ${
						isSettings ? "bg-kumo-fill text-kumo-default" : "bg-kumo-base/85 text-kumo-strong hover:bg-kumo-tint"
					}`}
					aria-label="Settings"
					aria-pressed={isSettings}
				>
					<GearSixIcon size={16} />
				</button>
			</Tooltip>
			<Tooltip content={isAgentPanelOpen ? "Hide agent" : "Agent (⌘J in a message)"} side="top" asChild>
				<button
					type="button"
					onClick={toggleAgentPanel}
					className={`${roundButton} border border-kumo-line backdrop-blur-md shadow-lg ${
						isAgentPanelOpen ? "bg-kumo-fill text-kumo-default" : "bg-kumo-base/85 text-kumo-strong hover:bg-kumo-tint"
					}`}
					aria-label="Toggle agent"
					aria-pressed={isAgentPanelOpen}
				>
					<RobotIcon size={16} />
				</button>
			</Tooltip>
			<Tooltip content="New message (C)" side="top" asChild>
				<button
					type="button"
					onClick={() => startCompose()}
					className={`${roundButton} bg-kumo-contrast text-kumo-inverse shadow-lg hover:opacity-90`}
					aria-label="Compose"
				>
					<NotePencilIcon size={16} />
				</button>
			</Tooltip>
		</nav>
	);
}
