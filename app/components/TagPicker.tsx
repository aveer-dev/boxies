// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { CheckIcon, PlusIcon, TagSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type { TagRef } from "shared/tags";
import FloatingPanel from "~/components/FloatingPanel";
import { tagPickerOptions } from "~/lib/tags";
import { useCreateTag, useSetThreadTag, useTags } from "~/queries/tags";

/** A tag on a mail row or in the reader: a quiet pill with a tag glyph. */
export function TagChip({ name, children }: { name: string; children?: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1 max-w-[160px] rounded-full bg-[var(--bg-badge)] px-1.5 py-px text-xs text-kumo-strong shadow-[inset_0_0_0_1px_var(--border-card)]">
			<TagSimpleIcon size={11} weight="bold" aria-hidden className="shrink-0 text-kumo-subtle" />
			<span className="truncate">{name}</span>
			{children}
		</span>
	);
}

/**
 * Adds and removes tags on a conversation (AVE-241): type to filter, click a
 * tag to toggle it, or create the typed name and apply it in one go. Stays
 * open so several tags can be set at once; Esc or a click outside closes it.
 */
export function TagPicker({
	mailboxId,
	threadId,
	applied,
	anchorRef,
	open,
	onClose,
	align = "left",
}: {
	mailboxId: string;
	/** The conversation key (`thread_id`, or the email's id). */
	threadId: string;
	/** Tags the conversation carries now. */
	applied: readonly TagRef[];
	anchorRef: RefObject<HTMLElement | null>;
	open: boolean;
	onClose: () => void;
	align?: "left" | "right";
}) {
	const { data: tags = [], isLoading } = useTags(open ? mailboxId : undefined);
	const createTag = useCreateTag();
	const setThreadTag = useSetThreadTag();
	const toastManager = useKumoToastManager();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActive(0);
		const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(id);
	}, [open]);

	const appliedIds = useMemo(() => new Set(applied.map((t) => t.id)), [applied]);
	const { matches, create } = useMemo(() => tagPickerOptions(tags, query), [tags, query]);
	const optionCount = matches.length + (create ? 1 : 0);
	const activeIndex = Math.min(active, Math.max(0, optionCount - 1));

	const fail = (err: unknown, fallback: string) =>
		toastManager.add({ title: err instanceof Error ? err.message : fallback, variant: "error" });

	const toggle = (tag: TagRef) => {
		const on = !appliedIds.has(tag.id);
		setThreadTag.mutate(
			{ mailboxId, threadId, tag: { id: tag.id, name: tag.name }, on },
			{ onError: (err) => fail(err, on ? "Couldn't add the tag" : "Couldn't remove the tag") },
		);
	};

	const createAndApply = (name: string) => {
		createTag.mutate(
			{ mailboxId, name },
			{
				onSuccess: (tag) => {
					setQuery("");
					setActive(0);
					toggleOn(tag);
				},
				onError: (err) => fail(err, "Couldn't create the tag"),
			},
		);
	};
	const toggleOn = (tag: TagRef) =>
		setThreadTag.mutate(
			{ mailboxId, threadId, tag: { id: tag.id, name: tag.name }, on: true },
			{ onError: (err) => fail(err, "Couldn't add the tag") },
		);

	const choose = (index: number) => {
		if (index < matches.length) toggle(matches[index]);
		else if (create) createAndApply(create);
	};

	const optionClass = (index: number) =>
		`w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg text-sm text-kumo-default transition-colors duration-100 focus-visible:outline-none ${
			index === activeIndex ? "bg-kumo-overlay" : "hover:bg-kumo-overlay"
		}`;

	return (
		<FloatingPanel
			anchorRef={anchorRef}
			open={open}
			onClose={onClose}
			align={align}
			aria-label="Tags"
			className="w-[260px]"
		>
			<div className="px-1 pt-0.5 pb-1.5">
				<input
					ref={inputRef}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setActive(0);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowDown") {
							e.preventDefault();
							setActive((i) => (optionCount ? (Math.min(i, optionCount - 1) + 1) % optionCount : 0));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setActive((i) => (optionCount ? (Math.min(i, optionCount - 1) - 1 + optionCount) % optionCount : 0));
						} else if (e.key === "Enter") {
							e.preventDefault();
							if (optionCount > 0) choose(activeIndex);
						}
					}}
					placeholder="Find or create a tag"
					aria-label="Find or create a tag"
					role="combobox"
					aria-expanded
					aria-controls="tag-picker-options"
					aria-activedescendant={optionCount > 0 ? `tag-picker-option-${activeIndex}` : undefined}
					maxLength={200}
					className="w-full rounded-lg bg-kumo-tint px-2.5 py-1.5 text-sm text-kumo-default placeholder:text-kumo-subtle outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
				/>
			</div>
			<div className="h-px bg-kumo-line mb-1 -mx-1" />
			<div id="tag-picker-options" role="listbox" aria-label="Tags" aria-multiselectable>
				{isLoading && tags.length === 0 ? (
					<p className="px-2.5 py-2 text-sm text-kumo-subtle">Loading tags…</p>
				) : optionCount === 0 ? (
					<p className="px-2.5 py-2 text-sm text-kumo-subtle">
						{tags.length === 0 ? "No tags yet. Type a name to create one." : "No matching tags"}
					</p>
				) : null}
				{matches.map((tag, index) => {
					const on = appliedIds.has(tag.id);
					return (
						<button
							key={tag.id}
							id={`tag-picker-option-${index}`}
							type="button"
							role="option"
							aria-selected={on}
							tabIndex={-1}
							className={optionClass(index)}
							onMouseEnter={() => setActive(index)}
							onClick={() => toggle(tag)}
						>
							<span className="w-4 shrink-0 flex justify-center text-kumo-default">
								{on ? <CheckIcon size={14} weight="bold" /> : null}
							</span>
							<span className="truncate flex-1">{tag.name}</span>
						</button>
					);
				})}
				{create && (
					<button
						id={`tag-picker-option-${matches.length}`}
						type="button"
						role="option"
						aria-selected={false}
						tabIndex={-1}
						disabled={createTag.isPending}
						className={optionClass(matches.length)}
						onMouseEnter={() => setActive(matches.length)}
						onClick={() => createAndApply(create)}
					>
						<span className="w-4 shrink-0 flex justify-center text-kumo-subtle">
							<PlusIcon size={14} weight="bold" />
						</span>
						<span className="truncate flex-1">
							Create <span className="font-medium">“{create}”</span>
						</span>
					</button>
				)}
			</div>
		</FloatingPanel>
	);
}
