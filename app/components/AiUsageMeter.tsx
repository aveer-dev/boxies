// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	aiUsageLevel,
	formatAiUsageReset,
	type AiUsageMeter as Meter,
} from "../../shared/ai-quota";

const FILL: Record<ReturnType<typeof aiUsageLevel>, string> = {
	normal: "bg-kumo-brand",
	warning: "bg-kumo-warning",
	exhausted: "bg-kumo-danger",
};

/**
 * Thin usage bar with "12 / 50 AI chats today" and the reset time (AVE-45).
 * Calm under 80%, warning tint from 80%, red at the limit.
 */
export function AiUsageMeter({
	meter,
	noun,
	resetsAt,
	className = "",
}: {
	meter: Meter;
	/** Plural noun, e.g. "AI chats". */
	noun: string;
	resetsAt: string;
	className?: string;
}) {
	const level = aiUsageLevel(meter);
	const pct = meter.limit > 0 ? Math.min(100, (meter.used / meter.limit) * 100) : 100;
	return (
		<div className={className}>
			<div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] leading-4">
				<span className={level === "normal" ? "text-kumo-subtle" : "font-medium text-kumo-default"}>
					<span className="tabular-nums">
						{meter.used} / {meter.limit}
					</span>{" "}
					{noun} today
				</span>
				<span className="shrink-0 text-kumo-subtle">{formatAiUsageReset(resetsAt)}</span>
			</div>
			<div
				role="meter"
				aria-label={`${noun} used today`}
				aria-valuemin={0}
				aria-valuemax={meter.limit}
				aria-valuenow={meter.used}
				className="h-1 overflow-hidden rounded-full bg-kumo-tint"
			>
				<div
					className={`h-full rounded-full transition-[width] duration-300 ease-out ${FILL[level]}`}
					style={{ width: `${pct}%` }}
				/>
			</div>
		</div>
	);
}
