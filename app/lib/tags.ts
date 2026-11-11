// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { normalizeTagName, type TagRef } from "../../shared/tags";

/**
 * Tags on web (AVE-241): many per email, on top of the one folder it lives
 * in (shared/tags.ts has the API). Pure helpers for the picker and for
 * patching cached lists while a tag change is in flight.
 */

/** Name order, as the Worker sorts them (case-insensitive). */
export function compareTagNames(a: TagRef, b: TagRef): number {
	const x = a.name.toLowerCase();
	const y = b.name.toLowerCase();
	return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `tags` with `tag` added (`on`) or removed, sorted by name. */
export function withTag(tags: readonly TagRef[] | undefined, tag: TagRef, on: boolean): TagRef[] {
	const rest = (tags ?? []).filter((t) => t.id !== tag.id);
	return (on ? [...rest, { id: tag.id, name: tag.name }] : rest).sort(compareTagNames);
}

/** Every tag on any of `messages`, once each, sorted by name (a thread's tags). */
export function unionTags(messages: readonly { tags?: readonly TagRef[] }[]): TagRef[] {
	const byId = new Map<string, TagRef>();
	for (const message of messages) for (const tag of message.tags ?? []) byId.set(tag.id, tag);
	return [...byId.values()].sort(compareTagNames);
}

/** The conversation key the tag routes use: `thread_id`, or the email's own id. */
export function tagThreadKey(email: { id: string; thread_id?: string | null }): string {
	return email.thread_id || email.id;
}

/**
 * `emails` with `tag` added to or removed from every row of thread
 * `threadId` (tagging a thread tags all its messages). Returns `emails`
 * itself when no row belongs to the thread.
 */
export function patchThreadTag<T extends { id: string; thread_id?: string | null; tags?: TagRef[] }>(
	emails: readonly T[],
	threadId: string,
	tag: TagRef,
	on: boolean,
): readonly T[] {
	let changed = false;
	const next = emails.map((email) => {
		if (tagThreadKey(email) !== threadId) return email;
		changed = true;
		return { ...email, tags: withTag(email.tags, tag, on) };
	});
	return changed ? next : emails;
}

/**
 * What the tag picker lists for what's typed: the tags whose name contains
 * it (all of them for an empty query), and the name to offer "Create" with,
 * or null when it's empty, invalid, or already a tag (names are unique
 * case-insensitively).
 */
export function tagPickerOptions<T extends TagRef>(
	tags: readonly T[],
	query: string,
): { matches: T[]; create: string | null } {
	const normalized = normalizeTagName(query);
	const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
	const matches = needle ? tags.filter((t) => t.name.toLowerCase().includes(needle)) : [...tags];
	if (!normalized.ok) return { matches, create: null };
	const taken = tags.some((t) => t.name.toLowerCase() === normalized.key);
	return { matches, create: taken ? null : normalized.name };
}
