// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import {
	CaretDownIcon,
	CaretUpIcon,
	LockSimpleIcon,
	PencilSimpleIcon,
	PushPinIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatListDate } from "shared/dates";
import { IconButton } from "~/components/IconButton";
import NoteEditor from "~/components/notes/NoteEditor";
import NoteMarkdown from "~/components/notes/NoteMarkdown";
import {
	type Point,
	type Size,
	clampNotePosition,
	keyboardNudge,
	notePreviewText,
	passedDragThreshold,
	stickyNotePosition,
} from "~/lib/thread-notes";
import { useCreateThreadNote, useDeleteThreadNote, useUpdateThreadNote } from "~/queries/thread-notes";
import type { ThreadNote } from "~/types";

/** Draft id for a sticky being written that isn't saved yet. */
const DRAFT_ID = "__new_sticky__";
const KEYBOARD_SAVE_DELAY_MS = 450;

function useElementSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size | null] {
	const ref = useRef<T>(null);
	const [size, setSize] = useState<Size | null>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const next = { width: el.offsetWidth, height: el.offsetHeight };
			setSize((prev) => (prev && prev.width === next.width && prev.height === next.height ? prev : next));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return [ref, size];
}

/**
 * The reader's sticky notes (whole-conversation notes to self), floating over
 * the message area like paper pinned to it. Each can be dragged anywhere in
 * the view (clamped to its edges); where it's dropped is saved.
 */
export default function StickyNotes({
	mailboxId,
	threadId,
	notes,
	creating,
	onCreatingDone,
}: {
	mailboxId: string;
	threadId: string;
	notes: ThreadNote[];
	/** A new sticky is being written (toolbar "Add sticky note"). */
	creating: boolean;
	onCreatingDone: () => void;
}) {
	const [layerRef, view] = useElementSize<HTMLDivElement>();
	const [front, setFront] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);

	const draft: ThreadNote | null = creating
		? {
				id: DRAFT_ID,
				threadId,
				emailId: null,
				noteType: "sticky",
				body: "",
				posX: null,
				posY: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}
		: null;
	const all = draft ? [...notes, draft] : notes;

	return (
		<div
			ref={layerRef}
			// Covers the messages so a drag keeps its pointer over email iframes.
			className={`absolute inset-0 z-10 overflow-hidden ${dragging ? "pointer-events-auto cursor-grabbing" : "pointer-events-none"}`}
		>
			{view &&
				all.map((note, index) => (
					<StickyNote
						key={note.id}
						note={note}
						index={index}
						view={view}
						mailboxId={mailboxId}
						threadId={threadId}
						isDraft={note.id === DRAFT_ID}
						inFront={front === note.id || (front === null && note.id === DRAFT_ID)}
						onFocus={() => setFront(note.id)}
						onDragChange={setDragging}
						onDraftDone={onCreatingDone}
					/>
				))}
		</div>
	);
}

function StickyNote({
	note,
	index,
	view,
	mailboxId,
	threadId,
	isDraft,
	inFront,
	onFocus,
	onDragChange,
	onDraftDone,
}: {
	note: ThreadNote;
	index: number;
	view: Size;
	mailboxId: string;
	threadId: string;
	isDraft: boolean;
	inFront: boolean;
	onFocus: () => void;
	onDragChange: (dragging: boolean) => void;
	onDraftDone: () => void;
}) {
	const toastManager = useKumoToastManager();
	const createNote = useCreateThreadNote();
	const updateNote = useUpdateThreadNote();
	const deleteNote = useDeleteThreadNote();
	const [noteRef, measured] = useElementSize<HTMLDivElement>();
	const [editing, setEditing] = useState(isDraft);
	const [collapsed, setCollapsed] = useState(false);
	// While dragging (or nudging with keys) the note shows here, not at its saved spot.
	const [livePosition, setLivePosition] = useState<Point | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const drag = useRef<{ pointerId: number; from: Point; start: Point; moved: boolean } | null>(null);
	const keySave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => () => clearTimeout(keySave.current), []);

	const size = measured ?? { width: 260, height: 120 };
	const resting = stickyNotePosition(note, index, size, view);
	const position = livePosition ? clampNotePosition(livePosition, size, view) : resting;

	const savePosition = (point: Point) => {
		if (isDraft) return; // saved with the note on create
		updateNote.mutate(
			{ mailboxId, threadId, noteId: note.id, data: { posX: point.x, posY: point.y } },
			{
				onSettled: () => setLivePosition(null),
				onError: () => toastManager.add({ title: "Couldn't move the note", variant: "error" }),
			},
		);
	};

	const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, textarea")) return;
		onFocus();
		drag.current = { pointerId: e.pointerId, from: { x: e.clientX, y: e.clientY }, start: position, moved: false };
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		const pointer = { x: e.clientX, y: e.clientY };
		if (!d.moved) {
			if (!passedDragThreshold(d.from, pointer)) return;
			d.moved = true;
			setIsDragging(true);
			onDragChange(true);
		}
		setLivePosition(
			clampNotePosition({ x: d.start.x + pointer.x - d.from.x, y: d.start.y + pointer.y - d.from.y }, size, view),
		);
	};
	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d || d.pointerId !== e.pointerId) return;
		drag.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
		if (!d.moved) return;
		setIsDragging(false);
		onDragChange(false);
		const end = clampNotePosition(
			{ x: d.start.x + e.clientX - d.from.x, y: d.start.y + e.clientY - d.from.y },
			size,
			view,
		);
		setLivePosition(end);
		if (end.x !== resting.x || end.y !== resting.y) savePosition(end);
		else setLivePosition(null);
	};
	const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.target !== e.currentTarget) return;
		const nudge = keyboardNudge(e.key, e.shiftKey);
		if (!nudge) return;
		e.preventDefault();
		const next = clampNotePosition({ x: position.x + nudge.x, y: position.y + nudge.y }, size, view);
		setLivePosition(next);
		clearTimeout(keySave.current);
		keySave.current = setTimeout(() => savePosition(next), KEYBOARD_SAVE_DELAY_MS);
	};

	const save = (body: string) => {
		if (isDraft) {
			createNote.mutate(
				{ mailboxId, threadId, data: { body, noteType: "sticky", posX: position.x, posY: position.y } },
				{
					onSuccess: () => onDraftDone(),
					onError: () => toastManager.add({ title: "Couldn't save the note", variant: "error" }),
				},
			);
			return;
		}
		updateNote.mutate(
			{ mailboxId, threadId, noteId: note.id, data: { body } },
			{
				onSuccess: () => setEditing(false),
				onError: () => toastManager.add({ title: "Couldn't save the note", variant: "error" }),
			},
		);
	};
	const remove = () => {
		if (!window.confirm("Delete this note?")) return;
		deleteNote.mutate(
			{ mailboxId, threadId, noteId: note.id },
			{ onError: () => toastManager.add({ title: "Couldn't delete the note", variant: "error" }) },
		);
	};

	const lifted = isDragging || editing;

	return (
		<div
			ref={noteRef}
			role="group"
			aria-label="Sticky note to self"
			data-sticky-note={note.id}
			onFocusCapture={onFocus}
			onPointerDownCapture={onFocus}
			style={
				{
					transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
					zIndex: inFront ? 2 : 1,
				} as CSSProperties
			}
			className={`note-paper pointer-events-auto absolute left-0 top-0 ${editing ? "w-[min(340px,calc(100%-24px))]" : "w-[min(260px,calc(100%-24px))]"} ${
				livePosition && !isDragging ? "transition-transform duration-200 ease-[var(--ease-out)]" : ""
			}`}
		>
			<div
				className={`group/sticky relative rounded-[3px] rounded-br-[14px] bg-[var(--note-paper)] text-[var(--note-ink)] shadow-[var(--note-shadow)] transition-[rotate,scale,box-shadow] duration-300 ease-[var(--spring)] motion-safe:animate-reveal ${
					lifted ? "rotate-0" : "motion-safe:-rotate-[1.2deg] hover:rotate-0"
				} ${isDragging ? "scale-[1.02]" : ""}`}
			>
				{/* The pin, top-centre. */}
				<PushPinIcon
					size={18}
					weight="fill"
					aria-hidden
					className="absolute -top-2 left-1/2 -translate-x-1/2 rotate-[20deg] text-[var(--note-pin)] drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]"
				/>
				{/* Header: the drag handle. */}
				<div
					tabIndex={0}
					role="button"
					aria-roledescription="draggable note"
					aria-label="Move note. Drag, or use the arrow keys."
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					onKeyDown={onHandleKeyDown}
					className={`flex touch-none select-none items-center gap-1 rounded-t-[3px] pl-3 pr-1 pt-2.5 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
						isDragging ? "cursor-grabbing" : "cursor-grab"
					}`}
				>
					<span className="min-w-0 flex-1 truncate text-2xs font-medium text-[var(--note-muted)]">
						Note to self
					</span>
					{!isDraft && !editing && (
						<span className="flex items-center opacity-70 transition-opacity group-hover/sticky:opacity-100 group-focus-within/sticky:opacity-100">
							<IconButton
								label={collapsed ? "Expand note" : "Fold note"}
								icon={collapsed ? CaretDownIcon : CaretUpIcon}
								tooltipSide="top"
								aria-expanded={!collapsed}
								onClick={() => setCollapsed((c) => !c)}
							/>
							<IconButton label="Edit note" icon={PencilSimpleIcon} tooltipSide="top" onClick={() => { setCollapsed(false); setEditing(true); }} />
							<IconButton label="Delete note" icon={TrashIcon} tooltipSide="top" onClick={remove} />
						</span>
					)}
				</div>

				<div className="px-3 pb-3">
					{editing ? (
						<NoteEditor
							initialBody={note.body}
							placeholder="Pin a note to this conversation…"
							saving={createNote.isPending || updateNote.isPending}
							submitLabel={isDraft ? "Add note" : "Save"}
							onSave={save}
							onCancel={() => (isDraft ? onDraftDone() : setEditing(false))}
						/>
					) : collapsed ? (
						<p className="truncate text-13">{notePreviewText(note.body)}</p>
					) : (
						<>
							<div className="max-h-[220px] overflow-y-auto text-13 leading-relaxed">
								<NoteMarkdown body={note.body} />
							</div>
							{/* updatedAt also moves when the note is dragged, so show when it was written. */}
							<div className="mt-2 flex items-center gap-1 text-3xs text-[var(--note-muted)]">
								<LockSimpleIcon size={10} weight="bold" aria-hidden />
								Only visible to you · {formatListDate(note.createdAt)}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
