// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";

interface EmailPanelHeaderProps {
	subject: string;
	messageCount: number;
	showThreadCount: boolean;
	/** Folder / tag chips shown above the subject. */
	chips?: ReactNode;
}

export default function EmailPanelHeader({
	subject,
	messageCount,
	showThreadCount,
	chips,
}: EmailPanelHeaderProps) {
	return (
		<div className="px-4 pt-4 pb-3 shrink-0 md:px-6 md:pt-5">
			{chips && <div className="flex flex-wrap items-center gap-1.5 mb-3">{chips}</div>}
			<h2 className="text-xl md:text-2xl font-bold leading-tight tracking-tight text-kumo-default break-words">
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
