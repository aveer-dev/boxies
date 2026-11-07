// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useState } from "react";
import { PaperclipIcon, FileIcon, ImageIcon, WarningIcon } from "@phosphor-icons/react";
import { isDangerousAttachment, isPreviewableImage } from "shared/attachment-risk";
import ConfirmDialog from "~/components/settings/ConfirmDialog";
import { formatBytes, getAttachmentUrl, getNonInlineAttachments } from "~/lib/utils";
import type { Attachment } from "~/types";

/** Opens the download the same way the plain attachment link does. */
function openAttachment(url: string) {
	const link = document.createElement("a");
	link.href = url;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	document.body.appendChild(link);
	link.click();
	link.remove();
}

interface EmailAttachmentListProps {
	mailboxId?: string;
	emailId: string;
	attachments?: Attachment[];
	onPreviewImage?: (url: string, filename: string) => void;
	className?: string;
	showHeading?: boolean;
}

export default function EmailAttachmentList({
	mailboxId,
	emailId,
	attachments,
	onPreviewImage,
	className,
	showHeading = false,
}: EmailAttachmentListProps) {
	// A dangerous attachment (AVE-114) waiting on "Download anyway".
	const [pending, setPending] = useState<{ url: string; filename: string } | null>(null);

	if (!mailboxId) return null;

	const files = getNonInlineAttachments(attachments);
	if (files.length === 0) return null;

	return (
		<div className={className}>
			{showHeading && (
				<div className="flex items-center gap-2 mb-2.5">
					<PaperclipIcon size={13} className="text-kumo-subtle" />
					<span className="text-2xs font-medium uppercase tracking-wider text-kumo-subtle">
						Attachments ({files.length} file{files.length !== 1 ? "s" : ""} •{" "}
						{formatBytes(files.reduce((sum, f) => sum + (f.size || 0), 0))})
					</span>
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{files.map((attachment) => {
					const url = getAttachmentUrl(mailboxId, emailId, attachment.id);
					// SVG and other non-raster "images" are served as downloads, not previewed.
					const isImage = isPreviewableImage(attachment);
					const dangerous = attachment.dangerous ?? isDangerousAttachment(attachment);

					if (dangerous) {
						return (
							<button
								key={attachment.id}
								type="button"
								onClick={() => setPending({ url, filename: attachment.filename })}
								title="This file can run code on your device"
								className="flex items-center gap-2 rounded-md border border-kumo-warning/40 bg-kumo-warning/10 px-3 py-2 transition-colors hover:bg-kumo-warning-tint text-sm text-left"
							>
								<WarningIcon size={16} weight="fill" className="text-kumo-warning shrink-0" />
								<span className="text-kumo-default font-medium truncate max-w-[140px]">
									{attachment.filename}
								</span>
								<span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
								<span className="rounded-full bg-kumo-warning-tint px-1.5 py-px text-2xs font-medium text-kumo-warning">
									Executable
								</span>
							</button>
						);
					}

					if (isImage && onPreviewImage) {
						return (
							<button
								key={attachment.id}
								type="button"
								onClick={() => onPreviewImage(url, attachment.filename)}
								className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2 transition-colors hover:bg-kumo-tint text-sm text-left"
							>
								<ImageIcon size={16} className="text-kumo-subtle shrink-0" />
								<span className="text-kumo-default font-medium truncate max-w-[140px]">
									{attachment.filename}
								</span>
								<span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
							</button>
						);
					}

					return (
						<a
							key={attachment.id}
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2 rounded-md border border-kumo-line px-3 py-2 no-underline transition-colors hover:bg-kumo-tint text-sm"
						>
							<FileIcon size={16} className="text-kumo-subtle shrink-0" />
							<span className="text-kumo-default font-medium truncate max-w-[140px]">
								{attachment.filename}
							</span>
							<span className="text-kumo-subtle">{formatBytes(attachment.size)}</span>
						</a>
					);
				})}
			</div>
			<ConfirmDialog
				open={pending !== null}
				title="Download this file?"
				description={
					<>
						<span className="font-medium text-kumo-default">{pending?.filename}</span> is a program,
						script or macro document. Opening it can run code on your device. Only download it if
						you trust the sender and expected this file.
					</>
				}
				confirmLabel="Download anyway"
				onConfirm={() => {
					if (pending) openAttachment(pending.url);
					setPending(null);
				}}
				onCancel={() => setPending(null)}
			/>
		</div>
	);
}
