// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef } from "react";

/**
 * The one keyboard map for the web app. Key handlers, tooltips, menu hints,
 * the empty-column hints and the `?` cheat sheet all read from here, so a
 * shortcut is defined (and shown) in exactly one place.
 */

interface KeySpec {
	/** `KeyboardEvent.key`, lower-cased for letters. */
	key: string;
	shift?: boolean;
	/** ⌘ on macOS, Ctrl elsewhere. */
	mod?: boolean;
	/** Symbols reached with Shift (# ?): don't care whether Shift is down. */
	anyShift?: boolean;
}

interface ShortcutDef {
	/** What a tooltip, menu or the cheat sheet shows. */
	keys: string;
	label: string;
	group: "Mail" | "Navigation" | "App";
	match: KeySpec | KeySpec[];
	/** Also fires while typing in a field (e.g. ⌘K). */
	inFields?: boolean;
}

export const SHORTCUTS = {
	compose: { keys: "C", label: "New message", group: "Mail", match: { key: "c" } },
	reply: { keys: "R", label: "Reply", group: "Mail", match: { key: "r" } },
	replyAll: { keys: "A", label: "Reply all", group: "Mail", match: { key: "a" } },
	forward: { keys: "F", label: "Forward", group: "Mail", match: { key: "f" } },
	archive: { keys: "E", label: "Archive", group: "Mail", match: { key: "e" } },
	delete: { keys: "#", label: "Delete", group: "Mail", match: [{ key: "#", anyShift: true }, { key: "Delete" }] },
	toggleRead: { keys: "U", label: "Mark read / unread", group: "Mail", match: { key: "u" } },
	star: { keys: "S", label: "Star / unstar", group: "Mail", match: { key: "s" } },
	replyLater: { keys: "L", label: "Reply later", group: "Mail", match: { key: "l" } },
	openInColumn: { keys: "O", label: "Open in new column", group: "Navigation", match: { key: "o" } },
	popOut: { keys: "P", label: "Pop out message", group: "Navigation", match: { key: "p" } },
	prevColumn: { keys: "[", label: "Previous column", group: "Navigation", match: { key: "[" } },
	nextColumn: { keys: "]", label: "Next column", group: "Navigation", match: { key: "]" } },
	close: { keys: "Esc", label: "Close the last column", group: "Navigation", match: { key: "Escape" } },
	search: { keys: "⌘K", label: "Search", group: "Navigation", match: { key: "k", mod: true }, inFields: true },
	assistant: { keys: "⌘J", label: "Assistant", group: "App", match: { key: "j", mod: true }, inFields: true },
	toggleTheme: { keys: "⇧T", label: "Light / dark theme", group: "App", match: { key: "t", shift: true } },
	textSize: { keys: "T", label: "Text size", group: "App", match: { key: "t" } },
	cheatSheet: { keys: "?", label: "Keyboard shortcuts", group: "App", match: { key: "?", anyShift: true } },
} satisfies Record<string, ShortcutDef>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** Display keys for a shortcut, for `shortcut=` on buttons and menu items. */
export function keysFor(id: ShortcutId): string {
	return SHORTCUTS[id].keys;
}

export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target.isContentEditable
	);
}

/**
 * A modal dialog is open (toasts are role=dialog too, but aria-modal=false;
 * a dialog playing its exit animation is already `data-closed`).
 */
export function isModalOpen(): boolean {
	return Boolean(
		document.querySelector(
			':is([role=dialog], [role=alertdialog]):not([aria-modal="false"]):not([data-closed])',
		),
	);
}

function matches(spec: KeySpec, e: KeyboardEvent): boolean {
	const mod = e.metaKey || e.ctrlKey;
	if (Boolean(spec.mod) !== mod || e.altKey) return false;
	if (!spec.anyShift && Boolean(spec.shift) !== e.shiftKey) return false;
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	return key === spec.key;
}

/** Returns false when it didn't act, so the next handler for the key gets a turn. */
export type ShortcutHandler = (e: KeyboardEvent) => boolean | void;

interface Registration {
	handler: { current: ShortcutHandler };
	priority: number;
	order: number;
}

const registry = new Map<ShortcutId, Registration[]>();
let order = 0;
let listening = false;

function dispatch(e: KeyboardEvent) {
	if (e.defaultPrevented || e.isComposing) return;
	const typing = isTypingTarget(e.target);
	for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
		const def: ShortcutDef = SHORTCUTS[id];
		const specs = Array.isArray(def.match) ? def.match : [def.match];
		if (!specs.some((spec) => matches(spec, e))) continue;
		if (typing && !def.inFields) return;
		// A dialog owns the keyboard (its own Esc closes it).
		if (!def.inFields && isModalOpen()) return;
		// Highest priority first; among equals, the most recently mounted.
		const handlers = [...(registry.get(id) ?? [])].sort(
			(a, b) => b.priority - a.priority || b.order - a.order,
		);
		for (const { handler } of handlers) {
			if (handler.current(e) !== false) {
				e.preventDefault();
				return;
			}
		}
		return;
	}
}

/**
 * Binds `handler` to a shortcut while the component is mounted. Several
 * components can bind the same key: the highest `priority` runs first (a
 * focused list row beats the open reader), and a handler that returns
 * `false` passes the key on.
 */
export function useShortcut(
	id: ShortcutId,
	handler: ShortcutHandler,
	{ enabled = true, priority = 0 }: { enabled?: boolean; priority?: number } = {},
) {
	const ref = useRef(handler);
	ref.current = handler;

	useEffect(() => {
		if (!enabled) return;
		if (!listening) {
			window.addEventListener("keydown", dispatch);
			listening = true;
		}
		const registration: Registration = { handler: ref, priority, order: order++ };
		registry.set(id, [...(registry.get(id) ?? []), registration]);
		return () => {
			registry.set(
				id,
				(registry.get(id) ?? []).filter((r) => r !== registration),
			);
		};
	}, [id, enabled, priority]);
}
