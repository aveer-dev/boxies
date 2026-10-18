// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowClockwiseIcon, SparkleIcon } from "@phosphor-icons/react";
import { IconButton } from "~/components/IconButton";
import { useRegenerateThreadSummary, useThreadSummary } from "~/queries/summaries";
import type { AiSummary } from "~/types";

/** Summary sentences plus any key points. Plain text: React escapes it. */
export function SummaryText({ summary }: { summary: AiSummary }) {
	return (
		<div className="text-sm leading-relaxed text-kumo-default">
			<p>{summary.summary}</p>
			{summary.key_points.length > 0 && (
				<ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-kumo-default">
					{summary.key_points.map((point, i) => (
						<li key={i}>{point}</li>
					))}
				</ul>
			)}
		</div>
	);
}

export function SummarySkeleton({ label = "Summarizing…" }: { label?: string }) {
	return (
		<div className="space-y-2" aria-busy="true" aria-label={label}>
			<div className="h-2.5 w-full animate-pulse rounded bg-kumo-fill" />
			<div className="h-2.5 w-4/5 animate-pulse rounded bg-kumo-fill" />
		</div>
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

	const busy = regenerate.isPending || (isFetching && !data);
	const failed = (isError && !data) || regenerate.isError;

	return (
		<section
			aria-label="AI summary"
			className="mx-4 mb-3 shrink-0 rounded-xl border border-kumo-line bg-kumo-tint px-3.5 py-3 md:mx-6 animate-reveal"
		>
			<div className="mb-1.5 flex items-center justify-between gap-2">
				<span className="flex items-center gap-1.5 text-xs font-medium text-kumo-subtle">
					<SparkleIcon size={14} weight="fill" className="text-kumo-brand" aria-hidden />
					Summary
				</span>
				{data?.status === "ready" && (
					<IconButton
						label="Regenerate summary"
						icon={ArrowClockwiseIcon}
						iconClassName={regenerate.isPending ? "animate-spin" : undefined}
						disabled={regenerate.isPending}
						onClick={() => regenerate.mutate({ mailboxId, threadId })}
					/>
				)}
			</div>
			{busy ? (
				<SummarySkeleton />
			) : data?.status === "ready" ? (
				<>
					<SummaryText summary={data.summary} />
					{regenerate.isError && (
						<p className="mt-1.5 text-xs text-kumo-subtle" role="status">
							Couldn’t regenerate. The previous summary is shown.
						</p>
					)}
				</>
			) : failed ? (
				<p className="text-xs text-kumo-subtle" role="status">
					Couldn’t summarize this email.{" "}
					<button type="button" className="underline underline-offset-2 hover:text-kumo-default" onClick={() => refetch()}>
						Try again
					</button>
				</p>
			) : (
				<SummarySkeleton />
			)}
		</section>
	);
}
