// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { folderUsesNewSeen } from "shared/list-sections";
import { patchEmailListCache } from "~/lib/list-sections";
import api from "~/services/api";
import type { Email } from "~/types";
import { queryKeys } from "./keys";

// ---------- Types ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
	newCount?: number;
	seenCount?: number;
}

// ---------- Queries ----------

export function useEmails(
	mailboxId: string | undefined,
	params: Record<string, string>,
	options?: { enabled?: boolean; refetchInterval?: number },
) {
	const queryParams = params.folder
		? { ...params, threaded: "true" }
		: params;

	return useQuery<EmailListResponse>({
		queryKey: mailboxId
			? queryKeys.emails.list(mailboxId, queryParams)
			: ["emails", "_disabled"],
		queryFn: async () => {
			const data = await api.listEmails(mailboxId!, queryParams) as
				| EmailListResponse
				| Email[];
			if (data && typeof data === "object" && "emails" in data) {
				const typed = data as EmailListResponse;
				return {
					emails: typed.emails ?? [],
					totalCount: typed.totalCount ?? 0,
					newCount: typed.newCount,
					seenCount: typed.seenCount,
				};
			}
			const arr = Array.isArray(data) ? data : [];
			return { emails: arr, totalCount: arr.length };
		},
		enabled: !!mailboxId && (options?.enabled ?? true),
		refetchInterval: options?.refetchInterval,
	});
}

export function useEmail(
	mailboxId: string | undefined,
	emailId: string | undefined,
) {
	return useQuery<Email>({
		queryKey: mailboxId && emailId
			? queryKeys.emails.detail(mailboxId, emailId)
			: ["emails", "_disabled_detail"],
		queryFn: () => api.getEmail(mailboxId!, emailId!) as Promise<Email>,
		enabled: !!mailboxId && !!emailId,
	});
}

export function useThreadReplies(
	mailboxId: string | undefined,
	threadId: string | undefined | null,
) {
	const qc = useQueryClient();

	return useQuery<Email[]>({
		queryKey: mailboxId && threadId
			? queryKeys.emails.thread(mailboxId, threadId)
			: ["emails", "_disabled_thread"],
		queryFn: async ({ signal }) => {
			// Single request returns all thread emails with full bodies +
			// attachments. Eliminates the previous N+1 pattern that fired
			// a separate getEmail call per thread message.
			const emails = await api.getThread(mailboxId!, threadId!, { signal }) as Email[];

			// Populate individual email detail caches so clicking a thread
			// message in the panel doesn't re-fetch.
			for (const email of emails) {
				qc.setQueryData(
					queryKeys.emails.detail(mailboxId!, email.id),
					email,
				);
			}

			return emails;
		},
		enabled: !!mailboxId && !!threadId,
	});
}

// ---------- Mutations ----------

/** Invalidate both the email list and folder counts after any email mutation. */
function useInvalidateEmailData() {
	const qc = useQueryClient();
	return (mailboxId: string) => {
		qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
		qc.invalidateQueries({
			queryKey: queryKeys.folders.list(mailboxId),
		});
	};
}

export function useSendEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			email,
		}: { mailboxId: string; email: unknown }) =>
			api.sendEmail(mailboxId, email),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useUpdateEmail() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			data,
		}: { mailboxId: string; id: string; data: unknown }) =>
			api.updateEmail(mailboxId, id, data),
		onMutate: async ({ mailboxId, id, data }) => {
			// Only target list queries (3rd key element is an object = params),
			// NOT detail queries (string = emailId) or thread queries.
			const isListQuery = (query: { queryKey: readonly unknown[] }) =>
				query.queryKey[0] === "emails" &&
				query.queryKey[1] === mailboxId &&
				typeof query.queryKey[2] === "object" &&
				query.queryKey[2] !== null;

			// Cancel in-flight list queries so they don't overwrite our optimistic update
			await qc.cancelQueries({
				queryKey: ["emails", mailboxId],
				predicate: isListQuery,
			});

			// Snapshot current email list caches for rollback
			const listQueries = qc.getQueriesData<EmailListResponse>({
				queryKey: ["emails", mailboxId],
				predicate: isListQuery,
			});

			const patch = data as Partial<Email>;
			const readPatch = typeof patch.read === "boolean" ? patch.read : undefined;

			// Optimistically patch every cached email list that contains this email
			for (const [key, cached] of listQueries) {
				if (!cached?.emails) continue;
				const params = key[2] as Record<string, string> | undefined;
				const folder = params?.folder;
				if (readPatch !== undefined && folderUsesNewSeen(folder)) {
					qc.setQueryData(
						key,
						patchEmailListCache(cached, folder, { id, read: readPatch }),
					);
				} else if (readPatch !== undefined) {
					qc.setQueryData(key, {
						...cached,
						emails: cached.emails.map((e) =>
							e.id === id
								? {
										...e,
										...patch,
										thread_unread_count: readPatch
											? 0
											: Math.max(1, e.thread_unread_count ?? 1),
									}
								: e,
						),
					});
				} else {
					qc.setQueryData(key, {
						...cached,
						emails: cached.emails.map((e) =>
							e.id === id ? { ...e, ...patch } : e,
						),
					});
				}
			}

			// Also patch the detail cache
			const detailKey = queryKeys.emails.detail(mailboxId, id);
			const prevDetail = qc.getQueryData<Email>(detailKey);
			if (prevDetail) {
				qc.setQueryData(detailKey, {
					...prevDetail,
					...patch,
					...(readPatch !== undefined
						? {
								thread_unread_count: readPatch
									? 0
									: Math.max(1, prevDetail.thread_unread_count ?? 1),
							}
						: {}),
				});
			}

			return { listQueries, prevDetail, detailKey };
		},
		onError: (_err, _vars, context) => {
			// Roll back optimistic updates on failure
			if (context?.listQueries) {
				for (const [key, cached] of context.listQueries) {
					qc.setQueryData(key, cached);
				}
			}
			if (context?.prevDetail) {
				qc.setQueryData(context.detailKey, context.prevDetail);
			}
		},
		onSettled: (_data, _err, { mailboxId }) => {
			// Always refetch to ensure server truth
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		},
	});
}

export function useMarkThreadRead() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			threadId,
		}: { mailboxId: string; threadId: string }) =>
			api.markThreadRead(mailboxId, threadId),
		onMutate: async ({ mailboxId, threadId }) => {
			const isListQuery = (query: { queryKey: readonly unknown[] }) =>
				query.queryKey[0] === "emails" &&
				query.queryKey[1] === mailboxId &&
				typeof query.queryKey[2] === "object" &&
				query.queryKey[2] !== null;

			await qc.cancelQueries({
				queryKey: ["emails", mailboxId],
				predicate: isListQuery,
			});

			const listQueries = qc.getQueriesData<EmailListResponse>({
				queryKey: ["emails", mailboxId],
				predicate: isListQuery,
			});

			for (const [key, cached] of listQueries) {
				if (!cached?.emails) continue;
				const params = key[2] as Record<string, string> | undefined;
				const folder = params?.folder;
				qc.setQueryData(
					key,
					patchEmailListCache(cached, folder, { threadId, read: true }),
				);
			}

			return { listQueries };
		},
		onError: (_err, _vars, context) => {
			if (context?.listQueries) {
				for (const [key, cached] of context.listQueries) {
					qc.setQueryData(key, cached);
				}
			}
		},
		onSettled: (_data, _err, { mailboxId }) => {
			qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
			qc.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		},
	});
}

export function useDeleteEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
		}: { mailboxId: string; id: string }) =>
			api.deleteEmail(mailboxId, id),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useMoveEmail() {
	const invalidate = useInvalidateEmailData();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			id,
			folderId,
			setSenderPreference,
		}: {
			mailboxId: string;
			id: string;
			folderId: string;
			setSenderPreference?: boolean;
		}) =>
			api.moveEmail(mailboxId, id, folderId, { setSenderPreference }),
		onSuccess: (_data, { mailboxId, setSenderPreference }) => {
			invalidate(mailboxId);
			if (setSenderPreference) {
				qc.invalidateQueries({ queryKey: ["sender-preferences", mailboxId] });
			}
		},
	});
}

export function useSaveDraft() {
	const queryClient = useQueryClient();
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			draft,
		}: {
			mailboxId: string;
			draft: {
				to?: string;
				cc?: string;
				bcc?: string;
				subject?: string;
				body: string;
				in_reply_to?: string;
				thread_id?: string;
				draft_id?: string;
			};
		}) => api.saveDraft(mailboxId, draft),
		onMutate: async ({ mailboxId, draft }) => {
			if (draft.in_reply_to || draft.thread_id) {
				queryClient.setQueriesData<{ emails: Email[]; totalCount: number }>(
					{ queryKey: ["emails", mailboxId] },
					(old) => {
						if (!old || !old.emails) return old;
						return {
							...old,
							emails: old.emails.map((e) => {
								const matchesThread =
									draft.thread_id && (e.thread_id === draft.thread_id || e.id === draft.thread_id);
								const matchesOriginal =
									draft.in_reply_to && (e.id === draft.in_reply_to || e.thread_id === draft.in_reply_to);
								if (matchesThread || matchesOriginal) {
									const wasDraft = e.has_draft === true;
									const newCount = !wasDraft ? (e.thread_count || 1) + 1 : e.thread_count;
									return { ...e, has_draft: true, thread_count: newCount };
								}
								return e;
							}),
						};
					},
				);
			}
		},
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useReplyToEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			email,
		}: { mailboxId: string; emailId: string; email: unknown }) =>
			api.replyToEmail(mailboxId, emailId, email),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useForwardEmail() {
	const invalidate = useInvalidateEmailData();
	return useMutation({
		mutationFn: ({
			mailboxId,
			emailId,
			email,
		}: { mailboxId: string; emailId: string; email: unknown }) =>
			api.forwardEmail(mailboxId, emailId, email),
		onSuccess: (_data, { mailboxId }) => invalidate(mailboxId),
	});
}
