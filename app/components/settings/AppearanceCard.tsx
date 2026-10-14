// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { CaretRightIcon, DesktopIcon, MoonIcon, SunIcon, TextAaIcon } from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";
import { useTextSizeWheel } from "~/components/TextSizeWheel";
import { slidingMarkClass, useSlidingHighlight } from "~/hooks/useSlidingHighlight";
import { keysFor } from "~/lib/shortcuts";
import { useTextSize } from "~/lib/text-size";
import { THEME_PREFERENCES, type ThemePreference, useTheme } from "~/lib/theme";

const THEME_ICONS = { system: DesktopIcon, light: SunIcon, dark: MoonIcon } as const;

/** System / Light / Dark, as a segmented control whose highlight glides between options. */
function ThemeSwitch() {
	const preference = useTheme((s) => s.preference);
	const setPreference = useTheme((s) => s.setPreference);
	const { railRef, markRef } = useSlidingHighlight<HTMLDivElement>(preference, '[aria-checked="true"]');

	const choose = (id: ThemePreference, el: HTMLElement) => {
		const r = el.getBoundingClientRect();
		setPreference(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
	};

	// Arrow keys move the choice, as in any radio group.
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		e.preventDefault();
		const index = THEME_PREFERENCES.findIndex((p) => p.id === preference);
		const next = THEME_PREFERENCES[(index + (e.key === "ArrowRight" ? 1 : -1) + THEME_PREFERENCES.length) % THEME_PREFERENCES.length];
		const button = railRef.current?.querySelector<HTMLElement>(`[data-theme-option="${next.id}"]`);
		if (!button) return;
		button.focus();
		choose(next.id, button);
	};

	return (
		<div
			ref={railRef}
			role="radiogroup"
			aria-label="Theme"
			onKeyDown={onKeyDown}
			className="relative grid grid-cols-3 rounded-xl bg-kumo-recessed p-1"
		>
			<span ref={markRef} aria-hidden className={`${slidingMarkClass} bg-kumo-base! shadow-[var(--shadow-menu)]`} />
			{THEME_PREFERENCES.map(({ id, label }) => {
				const Icon = THEME_ICONS[id];
				const checked = preference === id;
				return (
					<button
						key={id}
						type="button"
						role="radio"
						aria-checked={checked}
						tabIndex={checked ? 0 : -1}
						data-theme-option={id}
						onClick={(e) => choose(id, e.currentTarget)}
						className={`icon-motion relative z-[1] flex h-8 items-center justify-center gap-1.5 rounded-lg text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
							checked ? "font-medium text-kumo-default" : "text-kumo-subtle hover:text-kumo-default"
						}`}
					>
						<Icon size={14} weight={checked ? "fill" : "regular"} />
						{label}
					</button>
				);
			})}
		</div>
	);
}

/** Opens the text size wheel; shows the current size. */
function TextSizeRow() {
	const percent = useTextSize((s) => s.percent);
	const show = useTextSizeWheel((s) => s.show);
	return (
		<button
			type="button"
			onClick={show}
			className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-kumo-tint"
		>
			<TextAaIcon size={18} className="shrink-0 text-kumo-subtle" />
			<span className="min-w-0 flex-1">
				<span className="block text-sm text-kumo-default">Text size</span>
				<span className="block text-xs text-kumo-subtle">Scales every message, list and menu together</span>
			</span>
			<span className="text-sm tabular-nums text-kumo-strong">{Math.round(percent)}%</span>
			<kbd className="rounded-md bg-[var(--bg-badge)] px-1.5 font-sans text-2xs leading-[18px] text-kumo-subtle shadow-[inset_0_0_0_1px_var(--border-card)]">
				{keysFor("textSize")}
			</kbd>
			<CaretRightIcon
				size={16}
				className="shrink-0 text-kumo-subtle transition-transform duration-200 ease-[var(--ease-out)] group-hover:translate-x-0.5"
			/>
		</button>
	);
}

/** Device-level look and feel (not per mailbox): saved in this browser. */
export default function AppearanceCard() {
	return (
		<div className="rounded-2xl border border-kumo-line bg-kumo-base p-5">
			<div className="text-sm font-medium text-kumo-default mb-4">Appearance</div>
			<div className="space-y-2">
				<div className="flex items-baseline justify-between gap-3">
					<span className="text-sm text-kumo-default">Theme</span>
					<kbd className="rounded-md bg-[var(--bg-badge)] px-1.5 font-sans text-2xs leading-[18px] text-kumo-subtle shadow-[inset_0_0_0_1px_var(--border-card)]">
						{keysFor("toggleTheme")}
					</kbd>
				</div>
				<ThemeSwitch />
				<p className="text-xs text-kumo-subtle">
					System follows your device's light or dark setting.
				</p>
			</div>
			<div className="mt-4 border-t border-kumo-line pt-3">
				<TextSizeRow />
			</div>
		</div>
	);
}
