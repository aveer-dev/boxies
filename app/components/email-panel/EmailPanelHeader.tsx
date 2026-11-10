// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";
import { Link } from "react-router";
import { TagChip } from "~/components/TagPicker";

interface EmailPanelHeaderProps {
	subject: string;
	messageCount: number;
	showThreadCount: boolean;
	/** Folder / flag chips shown above the subject. */
	chips?: ReactNode;
	/** The conversation's tags (AVE-241), each linking to its tag view. */
	tags?: { id: string; name: string; href: string }[];
}

export default function EmailPanelHeader({
	subject,
	messageCount,
	showThreadCount,
	chips,
	tags = [],
}: EmailPanelHeaderProps) {
	return (
		<div className="px-4 pt-4 pb-3 shrink-0 md:px-6 md:pt-5 animate-reveal">
			{(chips || tags.length > 0) && (
				<div className="flex flex-wrap items-center gap-1.5 mb-3">
					{chips}
					{tags.map((tag) => (
						<Link key={tag.id} to={tag.href} className="no-underline" aria-label={`Tag ${tag.name}`}>
							<TagChip name={tag.name} />
						</Link>
					))}
				</div>
			)}
			<h2 className="text-xl md:text-[length:calc(22px*var(--font-scale))] font-semibold leading-tight tracking-[-0.015em] text-kumo-default break-words">
				{subject || "(no subject)"}
			</h2>
			{showThreadCount && (
				<span className="text-xs text-kumo-subtle mt-1 block">
					{messageCount} messages in this thread
				</span>
			)}
		</div>
	);
}
