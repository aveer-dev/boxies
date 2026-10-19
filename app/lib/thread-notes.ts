// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Pure helpers for notes to self in the web reader (AVE-60): which note goes
 * where, where a sticky note sits, and the small markdown edits the note
 * editor's buttons make. No React or DOM here, so it is unit tested directly.
 *
 * A sticky note's `posX` / `posY` are CSS pixels from the top-left corner of
 * the reader's message area. They're clamped on every render, so a note saved
 * in a wide column still shows inside a narrow one (the saved value is only
 * rewritten when the user drags it).
 */

import type { ThreadNote } from "shared/thread-notes";

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/** Gap kept between a sticky note and the edges of the view. */
export const STICKY_EDGE = 12;
/** Each further sticky without a saved spot opens this much lower and to the left. */
export const STICKY_CASCADE = 24;
/** Pixels a pointer must travel before a press on the note becomes a drag. */
export const DRAG_THRESHOLD = 3;
/** Arrow keys move a focused note this far (Shift: ×4). */
export const KEYBOARD_STEP = 8;

/** The conversation key notes are filed under: the thread id, or the email's own id. */
export function threadKeyFor(email: { id: string; thread_id?: string | null }): string {
	return email.thread_id || email.id;
}

/** Keep a note of `note` size fully inside `view`, `edge` pixels from every side. */
export function clampNotePosition(
	position: Point,
	note: Size,
	view: Size,
	edge = STICKY_EDGE,
): Point {
	const clampAxis = (value: number, noteLength: number, viewLength: number) => {
		const max = viewLength - noteLength - edge;
		// A view smaller than the note: pin it to the start edge.
		if (max <= edge) return edge;
		if (!Number.isFinite(value)) return edge;
		return Math.round(Math.min(Math.max(value, edge), max));
	};
	return {
		x: clampAxis(position.x, note.width, view.width),
		y: clampAxis(position.y, note.height, view.height),
	};
}

/**
 * Where a sticky note shows: its saved spot, or (never dragged) the top-right
 * corner, cascading so several new notes don't stack exactly. Always clamped.
 */
export function stickyNotePosition(
	note: Pick<ThreadNote, "posX" | "posY">,
	index: number,
	noteSize: Size,
	view: Size,
): Point {
	const saved = note.posX != null && note.posY != null;
	const cascade = Math.max(0, index) * STICKY_CASCADE;
	const start = saved
		? { x: note.posX as number, y: note.posY as number }
		: { x: view.width - noteSize.width - STICKY_EDGE - cascade, y: STICKY_EDGE + cascade };
	return clampNotePosition(start, noteSize, view);
}

/** True once a pointer has moved far enough from where it pressed to count as a drag. */
export function passedDragThreshold(from: Point, to: Point, threshold = DRAG_THRESHOLD): boolean {
	return Math.hypot(to.x - from.x, to.y - from.y) >= threshold;
}

/** Arrow-key nudge for a focused note, or null for other keys. */
export function keyboardNudge(key: string, shift: boolean): Point | null {
	const step = shift ? KEYBOARD_STEP * 4 : KEYBOARD_STEP;
	switch (key) {
		case "ArrowLeft":
			return { x: -step, y: 0 };
		case "ArrowRight":
			return { x: step, y: 0 };
		case "ArrowUp":
			return { x: 0, y: -step };
		case "ArrowDown":
			return { x: 0, y: step };
		default:
			return null;
	}
}

/**
 * Splits a thread's notes for the reader: sticky notes for the overlay, and
 * inline notes grouped under the message they annotate (oldest first, as the
 * API returns them).
 */
export function groupThreadNotes(notes: readonly ThreadNote[] | undefined): {
	sticky: ThreadNote[];
	inlineByEmail: Map<string, ThreadNote[]>;
} {
	const sticky: ThreadNote[] = [];
	const inlineByEmail = new Map<string, ThreadNote[]>();
	for (const note of notes ?? []) {
		if (note.noteType === "sticky") {
			sticky.push(note);
		} else if (note.emailId) {
			const list = inlineByEmail.get(note.emailId);
			if (list) list.push(note);
			else inlineByEmail.set(note.emailId, [note]);
		}
	}
	return { sticky, inlineByEmail };
}

/**
 * One line of plain text from a note's markdown, for the list row preview:
 * no heading / list / quote markers, emphasis or code ticks; links keep their
 * label; whitespace collapsed.
 */
export function notePreviewText(markdown: string | null | undefined): string {
	if (!markdown) return "";
	return markdown
		.replace(/```[^\n]*\n?/g, " ")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/gm, "")
		.replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
		.replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/g, "$1$2")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

// ── Editor formatting ────────────────────────────────────────────

export type NoteFormat = "bold" | "italic" | "code" | "link" | "bullet" | "checklist";

export interface TextEdit {
	text: string;
	selectionStart: number;
	selectionEnd: number;
}

const WRAP: Record<"bold" | "italic" | "code", string> = { bold: "**", italic: "_", code: "`" };
const LINE_PREFIX: Record<"bullet" | "checklist", string> = { bullet: "- ", checklist: "- [ ] " };

/**
 * Applies an editor button to the textarea's text and selection.
 * - bold / italic / code wrap the selection (or unwrap it when already wrapped),
 *   and with nothing selected insert the markers with the caret between them.
 * - link turns the selection into `[selection](url)` with `url` selected.
 * - bullet / checklist prefix every selected line (or remove the prefix when
 *   every line already has it).
 */
export function applyNoteFormat(
	text: string,
	selectionStart: number,
	selectionEnd: number,
	format: NoteFormat,
): TextEdit {
	const start = Math.max(0, Math.min(selectionStart, selectionEnd, text.length));
	const end = Math.min(text.length, Math.max(selectionStart, selectionEnd));
	const selected = text.slice(start, end);
	const before = text.slice(0, start);
	const after = text.slice(end);

	if (format === "bold" || format === "italic" || format === "code") {
		const mark = WRAP[format];
		const wrappedOutside = before.endsWith(mark) && after.startsWith(mark);
		if (wrappedOutside && selected.length > 0) {
			return {
				text: before.slice(0, -mark.length) + selected + after.slice(mark.length),
				selectionStart: start - mark.length,
				selectionEnd: end - mark.length,
			};
		}
		return {
			text: before + mark + selected + mark + after,
			selectionStart: start + mark.length,
			selectionEnd: end + mark.length,
		};
	}

	if (format === "link") {
		const label = selected || "link";
		const url = "https://";
		const inserted = `[${label}](${url})`;
		const urlStart = start + label.length + 3;
		return {
			text: before + inserted + after,
			selectionStart: urlStart,
			selectionEnd: urlStart + url.length,
		};
	}

	// Line prefixes: work on whole lines touched by the selection.
	const prefix = LINE_PREFIX[format];
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const nextBreak = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
	const lineEnd = nextBreak === -1 ? text.length : nextBreak;
	const lines = text.slice(lineStart, lineEnd).split("\n");
	const allPrefixed = lines.every((line) => line.startsWith(prefix));
	const nextLines = lines.map((line) =>
		allPrefixed ? line.slice(prefix.length) : line.startsWith(prefix) ? line : prefix + line,
	);
	const replaced = nextLines.join("\n");
	const delta = replaced.length - (lineEnd - lineStart);
	const firstDelta = nextLines[0].length - lines[0].length;
	return {
		text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
		selectionStart: Math.max(lineStart, start + firstDelta),
		selectionEnd: Math.max(lineStart, end + delta),
	};
}
