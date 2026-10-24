// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { CreateThreadNoteRequest, ThreadNote, UpdateThreadNoteRequest } from "~/types";
import { queryKeys } from "./keys";

/** The signed-in user's notes on one conversation (oldest first). */
export function useThreadNotes(mailboxId: string | undefined, threadId: string | undefined) {
	return useQuery<ThreadNote[]>({
		queryKey:
			mailboxId && threadId
				? queryKeys.threadNotes.list(mailboxId, threadId)
				: ["thread-notes", "_disabled"],
		queryFn: async ({ signal }) => (await api.listThreadNotes(mailboxId!, threadId!, { signal })).notes,
		enabled: !!mailboxId && !!threadId,
	});
}

/**
 * List rows carry the latest sticky note's text and the inline count, so a
 * note's body changing (or a note coming or going) refreshes folder lists.
 * Only list queries (3rd key element = params object), not threads/details.
 */
function invalidateNoteRows(qc: QueryClient, mailboxId: string) {
	qc.invalidateQueries({
		queryKey: ["emails", mailboxId],
		predicate: (query) => typeof query.queryKey[2] === "object" && query.queryKey[2] !== null,
	});
}

export function useCreateThreadNote() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			threadId,
			data,
		}: { mailboxId: string; threadId: string; data: CreateThreadNoteRequest }) =>
			api.createThreadNote(mailboxId, threadId, data),
		onSuccess: (note, { mailboxId, threadId }) => {
			qc.setQueryData<ThreadNote[]>(queryKeys.threadNotes.list(mailboxId, threadId), (prev) =>
				prev ? [...prev.filter((n) => n.id !== note.id), note] : [note],
			);
			invalidateNoteRows(qc, mailboxId);
		},
	});
}

type NoteSnapshot = { key: readonly unknown[]; previous: ThreadNote[] | undefined };

/** Optimistically patch one note in its thread's cache; returns a rollback snapshot. */
async function patchCachedNote(
	qc: QueryClient,
	mailboxId: string,
	threadId: string,
	patch: (notes: ThreadNote[]) => ThreadNote[],
): Promise<NoteSnapshot> {
	const key = queryKeys.threadNotes.list(mailboxId, threadId);
	await qc.cancelQueries({ queryKey: key });
	const previous = qc.getQueryData<ThreadNote[]>(key);
	if (previous) qc.setQueryData<ThreadNote[]>(key, patch(previous));
	return { key, previous };
}

export function useUpdateThreadNote() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			noteId,
			data,
		}: { mailboxId: string; threadId: string; noteId: string; data: UpdateThreadNoteRequest }) =>
			api.updateThreadNote(mailboxId, noteId, data),
		onMutate: ({ mailboxId, threadId, noteId, data }) =>
			patchCachedNote(qc, mailboxId, threadId, (notes) =>
				notes.map((n) =>
					n.id === noteId
						? {
								...n,
								...(data.body !== undefined ? { body: data.body } : {}),
								...(data.posX !== undefined ? { posX: data.posX } : {}),
								...(data.posY !== undefined ? { posY: data.posY } : {}),
							}
						: n,
				),
			),
		onError: (_err, _vars, snapshot) => {
			if (snapshot) qc.setQueryData(snapshot.key, snapshot.previous);
		},
		onSuccess: (note, { mailboxId, threadId, data }) => {
			qc.setQueryData<ThreadNote[]>(queryKeys.threadNotes.list(mailboxId, threadId), (prev) =>
				prev?.map((n) => (n.id === note.id ? note : n)),
			);
			// Moving a sticky doesn't change any list row.
			if (data.body !== undefined) invalidateNoteRows(qc, mailboxId);
		},
	});
}

export function useDeleteThreadNote() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, noteId }: { mailboxId: string; threadId: string; noteId: string }) =>
			api.deleteThreadNote(mailboxId, noteId),
		onMutate: ({ mailboxId, threadId, noteId }) =>
			patchCachedNote(qc, mailboxId, threadId, (notes) => notes.filter((n) => n.id !== noteId)),
		onError: (_err, _vars, snapshot) => {
			if (snapshot) qc.setQueryData(snapshot.key, snapshot.previous);
		},
		onSuccess: (_data, { mailboxId }) => invalidateNoteRows(qc, mailboxId),
	});
}
