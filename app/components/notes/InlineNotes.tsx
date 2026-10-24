// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { LockSimpleIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { formatListDate } from "shared/dates";
import { IconButton } from "~/components/IconButton";
import NoteEditor from "~/components/notes/NoteEditor";
import NoteMarkdown from "~/components/notes/NoteMarkdown";
import { useCreateThreadNote, useDeleteThreadNote, useUpdateThreadNote } from "~/queries/thread-notes";
import type { ThreadNote } from "~/types";

// The note palette (--note-*), so a note to self never reads as a message.
const CARD =
	"note-paper rounded-xl border border-solid border-[var(--note-paper-edge)] bg-[var(--note-paper)] px-3 py-2.5 text-[var(--note-ink)]";

function PrivateLabel({ date, edited }: { date?: string; edited?: boolean }) {
	return (
		<span className="flex min-w-0 items-center gap-1.5 text-2xs text-[var(--note-muted)]">
			<LockSimpleIcon size={12} weight="bold" className="shrink-0 text-[var(--note-pin)]" aria-hidden />
			<span className="truncate">
				<span className="font-medium text-[var(--note-ink)]">Private note to self</span> · Only visible to you
				{date && (
					<>
						{" · "}
						{edited ? "Edited " : ""}
						{formatListDate(date)}
					</>
				)}
			</span>
		</span>
	);
}

/**
 * Notes to self on one message, in line under it in the thread, plus the
 * composer when the user is adding one. Private: only their author sees them.
 */
export default function InlineNotes({
	mailboxId,
	threadId,
	emailId,
	notes,
	composing = false,
	onComposeDone,
	className = "",
}: {
	mailboxId: string;
	threadId: string;
	emailId: string;
	notes: ThreadNote[];
	composing?: boolean;
	onComposeDone?: () => void;
	className?: string;
}) {
	const toastManager = useKumoToastManager();
	const createNote = useCreateThreadNote();
	if (notes.length === 0 && !composing) return null;

	return (
		<div className={`flex flex-col gap-2 ${className}`}>
			{notes.map((note) => (
				<InlineNote key={note.id} mailboxId={mailboxId} threadId={threadId} note={note} />
			))}
			{composing && (
				<div className={`${CARD} animate-reveal`}>
					<div className="mb-2">
						<PrivateLabel />
					</div>
					<NoteEditor
						placeholder="Add a private note about this message…"
						submitLabel="Add note"
						saving={createNote.isPending}
						onCancel={() => onComposeDone?.()}
						onSave={(body) =>
							createNote.mutate(
								{ mailboxId, threadId, data: { body, noteType: "inline", emailId } },
								{
									onSuccess: () => onComposeDone?.(),
									onError: () => toastManager.add({ title: "Couldn't save the note", variant: "error" }),
								},
							)
						}
					/>
				</div>
			)}
		</div>
	);
}

function InlineNote({ mailboxId, threadId, note }: { mailboxId: string; threadId: string; note: ThreadNote }) {
	const toastManager = useKumoToastManager();
	const updateNote = useUpdateThreadNote();
	const deleteNote = useDeleteThreadNote();
	const [editing, setEditing] = useState(false);

	return (
		<div className={`group/note ${CARD}`} data-inline-note={note.id}>
			<div className="flex items-center gap-2">
				<PrivateLabel date={note.updatedAt} edited={note.updatedAt !== note.createdAt} />
				{!editing && (
					<span className="-my-1 ml-auto flex shrink-0 items-center opacity-60 transition-opacity group-hover/note:opacity-100 group-focus-within/note:opacity-100">
						<IconButton label="Edit note" icon={PencilSimpleIcon} onClick={() => setEditing(true)} />
						<IconButton
							label="Delete note"
							icon={TrashIcon}
							onClick={() => {
								if (!window.confirm("Delete this note?")) return;
								deleteNote.mutate(
									{ mailboxId, threadId, noteId: note.id },
									{ onError: () => toastManager.add({ title: "Couldn't delete the note", variant: "error" }) },
								);
							}}
						/>
					</span>
				)}
			</div>
			<div className="mt-1.5">
				{editing ? (
					<NoteEditor
						initialBody={note.body}
						saving={updateNote.isPending}
						onCancel={() => setEditing(false)}
						onSave={(body) =>
							updateNote.mutate(
								{ mailboxId, threadId, noteId: note.id, data: { body } },
								{
									onSuccess: () => setEditing(false),
									onError: () => toastManager.add({ title: "Couldn't save the note", variant: "error" }),
								},
							)
						}
					/>
				) : (
					<NoteMarkdown body={note.body} className="text-13 leading-relaxed" />
				)}
			</div>
		</div>
	);
}
