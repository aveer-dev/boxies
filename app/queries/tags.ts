// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Tag, TagRef } from "shared/tags";
import { compareTagNames, patchThreadTag, tagThreadKey, withTag } from "~/lib/tags";
import api from "~/services/api";
import type { Email } from "~/types";
import { queryKeys } from "./keys";

/**
 * Tags (AVE-240 / AVE-241): labels an email carries any number of, beside
 * its one folder. Custom folders are a different thing (`queries/folders`).
 */

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

export function useTags(mailboxId: string | undefined) {
	return useQuery<Tag[]>({
		queryKey: mailboxId ? queryKeys.tags.list(mailboxId) : ["tags", "_disabled"],
		queryFn: async () => (await api.listTags(mailboxId!)).tags ?? [],
		enabled: !!mailboxId,
	});
}

/**
 * Everything with tag `tagId`, one row per conversation, newest first
 * (outside Trash, Spam and Drafts). Keyed under `emails` with a params object
 * so live events and the optimistic read/star patches reach it like any list.
 */
export function useTaggedEmails(
	mailboxId: string | undefined,
	tagId: string | undefined,
	params: { page: string; limit: string },
) {
	const queryParams = { tag: tagId ?? "", threaded: "true", ...params };
	return useQuery<EmailListResponse>({
		queryKey: mailboxId && tagId ? queryKeys.emails.list(mailboxId, queryParams) : ["emails", "_disabled_tag"],
		queryFn: async () => {
			const { tag: _tag, ...rest } = queryParams;
			const data = await api.listTaggedEmails(mailboxId!, tagId!, rest);
			return { emails: data.emails ?? [], totalCount: data.totalCount ?? 0 };
		},
		enabled: !!mailboxId && !!tagId,
		refetchInterval: 30_000,
	});
}

/** Lists, rows and readers that show tag names or tag counts. */
function invalidateTagged(qc: QueryClient, mailboxId: string) {
	qc.invalidateQueries({ queryKey: queryKeys.tags.list(mailboxId) });
	qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
	qc.invalidateQueries({ queryKey: ["search", mailboxId] });
}

export function useCreateTag() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, name }: { mailboxId: string; name: string }) => api.createTag(mailboxId, name),
		onSuccess: (tag, { mailboxId }) => {
			qc.setQueryData<Tag[]>(queryKeys.tags.list(mailboxId), (old) =>
				old ? [...old.filter((t) => t.id !== tag.id), tag].sort(compareTagNames) : old,
			);
			qc.invalidateQueries({ queryKey: queryKeys.tags.list(mailboxId) });
		},
	});
}

export function useRenameTag() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, tagId, name }: { mailboxId: string; tagId: string; name: string }) =>
			api.renameTag(mailboxId, tagId, name),
		onSuccess: (_tag, { mailboxId }) => invalidateTagged(qc, mailboxId),
	});
}

export function useDeleteTag() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, tagId }: { mailboxId: string; tagId: string }) => api.deleteTag(mailboxId, tagId),
		onSuccess: (_data, { mailboxId }) => invalidateTagged(qc, mailboxId),
	});
}

/** Patch one cached payload (list, search page, thread or single email). */
function patchCached(data: unknown, threadId: string, tag: TagRef, on: boolean): unknown {
	if (!data || typeof data !== "object") return data;
	if (Array.isArray(data)) return patchThreadTag(data as Email[], threadId, tag, on);
	const list = data as Partial<EmailListResponse>;
	if (Array.isArray(list.emails)) {
		const emails = patchThreadTag(list.emails, threadId, tag, on);
		return emails === list.emails ? data : { ...list, emails };
	}
	const email = data as Email;
	if (typeof email.id === "string" && tagThreadKey(email) === threadId) {
		return { ...email, tags: withTag(email.tags, tag, on) };
	}
	return data;
}

/**
 * Adds (`on`) or removes a tag on every message of a conversation. Rows and
 * the reader update at once; the server's answer (and the `email_updated`
 * events it sends) settle the rest.
 */
export function useSetThreadTag() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			mailboxId,
			threadId,
			tag,
			on,
		}: { mailboxId: string; threadId: string; tag: TagRef; on: boolean }) =>
			api.setThreadTag(mailboxId, threadId, tag.id, on),
		onMutate: async ({ mailboxId, threadId, tag, on }) => {
			const scopes = [["emails", mailboxId], ["search", mailboxId]] as const;
			for (const queryKey of scopes) await qc.cancelQueries({ queryKey });
			const snapshots = scopes.flatMap((queryKey) => qc.getQueriesData({ queryKey }));
			for (const queryKey of scopes) {
				qc.setQueriesData({ queryKey }, (old: unknown) => patchCached(old, threadId, tag, on));
			}
			return { snapshots };
		},
		onError: (_err, _vars, context) => {
			for (const [key, data] of context?.snapshots ?? []) qc.setQueryData(key, data);
		},
		onSettled: (_data, _err, { mailboxId }) => invalidateTagged(qc, mailboxId),
	});
}
