// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import {
	type Icon,
	CodeSimpleIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListChecksIcon,
	TextBIcon,
	TextItalicIcon,
} from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { THREAD_NOTE_BODY_MAX } from "shared/thread-notes";
import NoteMarkdown from "~/components/notes/NoteMarkdown";
import { IconButton } from "~/components/IconButton";
import { type NoteFormat, applyNoteFormat } from "~/lib/thread-notes";

const FORMATS: { format: NoteFormat; label: string; shortcut?: string; icon: Icon }[] = [
	{ format: "bold", label: "Bold", shortcut: "⌘B", icon: TextBIcon },
	{ format: "italic", label: "Italic", shortcut: "⌘I", icon: TextItalicIcon },
	{ format: "code", label: "Code", icon: CodeSimpleIcon },
	{ format: "link", label: "Link", shortcut: "⌘K", icon: LinkSimpleIcon },
	{ format: "bullet", label: "Bulleted list", icon: ListBulletsIcon },
	{ format: "checklist", label: "Checklist", icon: ListChecksIcon },
];

const SHORTCUT_FORMATS: Record<string, NoteFormat> = { b: "bold", i: "italic", k: "link" };

/**
 * Markdown editor for a note to self: a plain textarea with a few formatting
 * buttons and a Write / Preview switch. ⌘/Ctrl+Enter saves, Esc cancels.
 */
export default function NoteEditor({
	initialBody = "",
	placeholder = "Write a note to yourself…",
	saving = false,
	submitLabel = "Save",
	autoFocus = true,
	onSave,
	onCancel,
}: {
	initialBody?: string;
	placeholder?: string;
	saving?: boolean;
	submitLabel?: string;
	autoFocus?: boolean;
	onSave: (body: string) => void;
	onCancel: () => void;
}) {
	const [body, setBody] = useState(initialBody);
	const [preview, setPreview] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const pendingSelection = useRef<[number, number] | null>(null);

	// Grow with the text (up to the max-height cap), and restore the caret
	// after a formatting button rewrote the value.
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
		if (pendingSelection.current) {
			const [start, end] = pendingSelection.current;
			pendingSelection.current = null;
			el.focus();
			el.setSelectionRange(start, end);
		}
	}, [body, preview]);

	useLayoutEffect(() => {
		if (!autoFocus) return;
		const el = textareaRef.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}, [autoFocus]);

	const tooLong = body.length > THREAD_NOTE_BODY_MAX;
	const canSave = body.trim().length > 0 && !tooLong && !saving && body !== initialBody;
	const nearLimit = body.length > THREAD_NOTE_BODY_MAX * 0.9;

	const format = (kind: NoteFormat) => {
		const el = textareaRef.current;
		if (!el) return;
		const edit = applyNoteFormat(body, el.selectionStart, el.selectionEnd, kind);
		pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
		setBody(edit.text);
	};
	const save = () => {
		if (canSave) onSave(body.trim());
	};

	return (
		<div
			className="flex flex-col gap-2"
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					onCancel();
				} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					save();
				}
			}}
		>
			<div className="flex items-center gap-0.5">
				<div role="tablist" aria-label="Note editor mode" className="mr-1 flex rounded-lg bg-current/[0.06] p-0.5 text-xs">
					{(["Write", "Preview"] as const).map((label) => {
						const active = (label === "Preview") === preview;
						return (
							<button
								key={label}
								type="button"
								role="tab"
								aria-selected={active}
								onClick={() => setPreview(label === "Preview")}
								className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
									active ? "bg-kumo-control text-kumo-default shadow-[0_0_0_1px_var(--border-card)]" : "opacity-70 hover:opacity-100"
								}`}
							>
								{label}
							</button>
						);
					})}
				</div>
				{!preview &&
					FORMATS.map(({ format: kind, label, shortcut, icon }) => (
						<IconButton
							key={kind}
							label={label}
							shortcut={shortcut}
							icon={icon}
							tooltipSide="top"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => format(kind)}
						/>
					))}
			</div>

			{preview ? (
				<div className="min-h-[72px] max-h-[240px] overflow-y-auto rounded-lg px-2.5 py-2 text-13 leading-relaxed shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_14%,transparent)]">
					{body.trim() ? <NoteMarkdown body={body} /> : <span className="opacity-60">Nothing to preview</span>}
				</div>
			) : (
				<textarea
					ref={textareaRef}
					value={body}
					rows={3}
					aria-label="Note (Markdown)"
					placeholder={placeholder}
					onChange={(e) => setBody(e.target.value)}
					onKeyDown={(e) => {
						const kind = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey ? SHORTCUT_FORMATS[e.key.toLowerCase()] : undefined;
						if (kind) {
							e.preventDefault();
							format(kind);
						}
					}}
					className="block min-h-[72px] max-h-[240px] w-full resize-none overflow-y-auto rounded-lg bg-kumo-control/70 px-2.5 py-2 text-13 leading-relaxed text-kumo-default placeholder:text-kumo-inactive shadow-[inset_0_0_0_1px_color-mix(in_srgb,currentColor_14%,transparent)] focus:outline-none focus:shadow-[inset_0_0_0_1px_var(--focus-ring)]"
				/>
			)}

			<div className="flex items-center gap-2">
				<span className={`text-2xs ${tooLong ? "text-kumo-danger" : "opacity-70"}`}>
					{nearLimit ? `${body.length.toLocaleString()} / ${THREAD_NOTE_BODY_MAX.toLocaleString()}` : "Markdown supported"}
				</span>
				<div className="ml-auto flex items-center gap-1.5">
					<Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" onClick={save} disabled={!canSave} loading={saving}>
						{submitLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
