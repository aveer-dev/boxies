// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowClockwiseIcon, XIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "~/components/IconButton";
import { SummaryIcon } from "~/components/icons/SummaryIcon";
import { useRegenerateThreadSummary, useThreadSummary } from "~/queries/summaries";
import type { AiSummary } from "~/types";

/**
 * Summary text, clamped to two lines until the reader asks for more. Key
 * points only show expanded. Plain text: React escapes it. The toggle only
 * appears when there is more to see, and the clamp is a line count, so the
 * block's height is the same whether it came from the cache or the model.
 */
export function SummaryText({ summary }: { summary: AiSummary }) {
	const [expanded, setExpanded] = useState(false);
	const [overflows, setOverflows] = useState(false);
	const textRef = useRef<HTMLParagraphElement>(null);

	useLayoutEffect(() => {
		const el = textRef.current;
		if (!el || expanded) return;
		const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [expanded, summary.summary]);

	const hasMore = overflows || summary.key_points.length > 0;

	return (
		<div>
			<p ref={textRef} className={expanded ? undefined : "line-clamp-2"}>
				{summary.summary}
			</p>
			{expanded && summary.key_points.length > 0 && (
				<ul className="mt-1 list-disc space-y-0.5 pl-4">
					{summary.key_points.map((point, i) => (
						<li key={i}>{point}</li>
					))}
				</ul>
			)}
			{hasMore && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					className="mt-0.5 text-xs font-medium text-kumo-subtle underline-offset-2 hover:text-kumo-default hover:underline focus-visible:underline focus-visible:outline-none"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}
		</div>
	);
}

/** Two muted lines, the height of the clamped text, while the model works. */
export function SummarySkeleton({ label = "Summarizing…" }: { label?: string }) {
	return (
		<div className="flex h-10 flex-col justify-center gap-2" aria-busy="true" aria-label={label}>
			<div className="h-2 w-full animate-pulse rounded bg-kumo-fill" />
			<div className="h-2 w-3/5 animate-pulse rounded bg-kumo-fill" />
		</div>
	);
}

/**
 * The quiet summary layout shared by the thread summary and per-message
 * quick summaries: the summary glyph, muted text, and small actions that
 * stay out of the way until hovered or focused (always visible on touch).
 */
export function SummaryBlock({
	label,
	summary,
	loading,
	errorText,
	onRetry,
	onRegenerate,
	regenerating,
	regenerateFailed,
	onClose,
	className = "",
}: {
	label: string;
	summary: AiSummary | undefined;
	loading: boolean;
	/** Set when there's nothing to show because the request failed. */
	errorText?: string;
	onRetry?: () => void;
	onRegenerate?: () => void;
	regenerating?: boolean;
	regenerateFailed?: boolean;
	onClose?: () => void;
	className?: string;
}) {
	const quietAction = "md:opacity-0 md:group-hover/summary:opacity-100 md:group-focus-within/summary:opacity-100 transition-opacity";
	return (
		<section aria-label={label} className={`group/summary flex items-start gap-2 ${className}`}>
			<SummaryIcon size={14} className="mt-[3px] shrink-0 text-kumo-subtle" aria-hidden />
			<div className="min-w-0 flex-1 text-[13px] leading-5 text-kumo-subtle">
				{loading || regenerating ? (
					<SummarySkeleton />
				) : summary ? (
					<>
						<SummaryText summary={summary} />
						{regenerateFailed && (
							<p className="text-xs" role="status">
								Couldn’t regenerate. The previous summary is shown.
							</p>
						)}
					</>
				) : errorText ? (
					<p className="text-xs" role="status">
						{errorText}{" "}
						{onRetry && (
							<button type="button" className="underline underline-offset-2 hover:text-kumo-default" onClick={onRetry}>
								Try again
							</button>
						)}
					</p>
				) : (
					<SummarySkeleton />
				)}
			</div>
			<div className="-my-1 flex shrink-0 items-center">
				{summary && onRegenerate && (
					<IconButton
						label="Regenerate summary"
						icon={ArrowClockwiseIcon}
						className={`text-kumo-subtle ${quietAction}`}
						iconClassName={regenerating ? "animate-spin" : undefined}
						disabled={regenerating}
						onClick={onRegenerate}
					/>
				)}
				{onClose && (
					<IconButton label="Hide summary" icon={XIcon} className={`text-kumo-subtle ${quietAction}`} onClick={onClose} />
				)}
			</div>
		</section>
	);
}

/**
 * AI summary at the top of the reader (AVE-20). Renders nothing while the
 * mail isn't eligible (Screener, Spam, too short, …).
 */
export default function AISummaryCard({
	mailboxId,
	threadId,
	enabled,
}: {
	mailboxId: string | undefined;
	threadId: string | undefined;
	/** False for folders that never get summaries; skips the request. */
	enabled: boolean;
}) {
	const { data, isPending, isError, refetch, isFetching } = useThreadSummary(mailboxId, threadId, enabled);
	const regenerate = useRegenerateThreadSummary();

	if (!enabled || !mailboxId || !threadId) return null;
	if (data && data.status !== "ready") return null;
	if (!data && !isPending && !isError) return null;

	return (
		<SummaryBlock
			key={threadId}
			label="AI summary"
			className="mx-4 mb-3 shrink-0 md:mx-6 animate-reveal"
			summary={data?.status === "ready" ? data.summary : undefined}
			loading={isFetching && !data}
			errorText={isError && !data ? "Couldn’t summarize this email." : undefined}
			onRetry={() => refetch()}
			onRegenerate={() => regenerate.mutate({ mailboxId, threadId })}
			regenerating={regenerate.isPending}
			regenerateFailed={regenerate.isError}
		/>
	);
}
