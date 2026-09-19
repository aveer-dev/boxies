// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { PreparedAttachment } from "~/lib/prepare-compose-attachment";
import { formatByteSize } from "shared/compose-attachments";

export default function ComposeAttachChips({
	attachments,
	onRemove,
}: {
	attachments: PreparedAttachment[];
	onRemove: (id: string) => void;
}) {
	if (attachments.length === 0) return null;

	return (
		<div className="flex gap-2 overflow-x-auto px-1 py-2">
			{attachments.length > 1 && (
				<span className="text-xs text-kumo-subtle shrink-0 self-center">
					{attachments.length} attachments
				</span>
			)}
			{attachments.map((attachment) => (
				<div
					key={attachment.id}
					className="flex items-center gap-2 rounded-xl bg-kumo-recessed px-2.5 py-2 max-w-[180px] shrink-0"
				>
					<div className="min-w-0">
						<div className="text-[11px] text-kumo-default truncate">{attachment.filename}</div>
						<div className="text-[9px] text-kumo-subtle">{formatByteSize(attachment.size)}</div>
					</div>
					<button
						type="button"
						onClick={() => onRemove(attachment.id)}
						className="text-kumo-subtle hover:text-kumo-default text-sm leading-none px-1"
						aria-label={`Remove ${attachment.filename}`}
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}
