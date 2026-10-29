// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog } from "@cloudflare/kumo";
import { Modal, ModalHeader } from "~/components/Modal";
import { downloadFile } from "~/lib/utils";
import type { Email } from "~/types";

interface PreviewImage {
	url: string;
	filename: string;
}

interface EmailPanelDialogsProps {
	sourceViewEmail: Email | null;
	previewImage: PreviewImage | null;
	onCloseSource: () => void;
	onClosePreview: () => void;
}

function getSourceHeaders(msg: Email): { key: string; value: string }[] {
	if (msg.raw_headers) {
		try {
			const parsed = JSON.parse(msg.raw_headers);
			if (Array.isArray(parsed)) {
				return parsed.map((header) => ({
					key: header.key || header.name || "",
					value: String(header.value || ""),
				}));
			}
			if (typeof parsed === "object" && parsed !== null) {
				return Object.entries(parsed).map(([key, value]) => ({
					key,
					value: String(value),
				}));
			}
		} catch {
			// Fall through to field-based headers.
		}
	}

	const headers: { key: string; value: string }[] = [];
	if (msg.sender) headers.push({ key: "From", value: msg.sender });
	if (msg.recipient) headers.push({ key: "To", value: msg.recipient });
	if (msg.cc) headers.push({ key: "Cc", value: msg.cc });
	if (msg.bcc) headers.push({ key: "Bcc", value: msg.bcc });
	if (msg.subject) headers.push({ key: "Subject", value: msg.subject });
	if (msg.date) headers.push({ key: "Date", value: msg.date });
	if (msg.message_id) headers.push({ key: "Message-ID", value: msg.message_id });
	if (msg.in_reply_to) headers.push({ key: "In-Reply-To", value: msg.in_reply_to });
	if (msg.email_references) {
		headers.push({ key: "References", value: msg.email_references });
	}
	if (msg.thread_id) headers.push({ key: "X-Thread-ID", value: msg.thread_id });
	return headers;
}

export default function EmailPanelDialogs({
	sourceViewEmail,
	previewImage,
	onCloseSource,
	onClosePreview,
}: EmailPanelDialogsProps) {
	const sourceHeaders = sourceViewEmail ? getSourceHeaders(sourceViewEmail) : [];

	return (
		<>
			<Dialog.Root
				open={sourceViewEmail !== null}
				onOpenChange={(open) => {
					if (!open) onCloseSource();
				}}
			>
				<Modal size="lg">
					<ModalHeader title="Email source headers" description={sourceViewEmail?.subject || undefined} />
					{sourceViewEmail && (
						<div className="max-h-[60vh] overflow-y-auto">
							<table className="w-full text-sm border-collapse">
								<tbody>
									{sourceHeaders.map((header, idx) => (
										<tr
											key={`${header.key}-${idx}`}
											className={idx % 2 === 0 ? "bg-kumo-tint/50" : ""}
										>
											<td className="py-1.5 px-3 font-mono font-semibold text-kumo-default whitespace-nowrap align-top w-[160px]">
												{header.key}
											</td>
											<td className="py-1.5 px-3 font-mono text-kumo-subtle break-all">
												{header.value}
											</td>
										</tr>
									))}
								</tbody>
							</table>
							{sourceHeaders.length === 0 && (
								<p className="text-sm text-kumo-subtle text-center py-8">
									No header data available for this email.
								</p>
							)}
						</div>
					)}
				</Modal>
			</Dialog.Root>

			<Dialog.Root
				open={previewImage !== null}
				onOpenChange={(open) => {
					if (!open) onClosePreview();
				}}
			>
				<Modal size="lg">
					<ModalHeader title={previewImage?.filename} />
					{previewImage && (
						<div className="flex flex-col items-center justify-center bg-kumo-tint/30 rounded-lg p-4 min-h-[200px]">
							<img
								src={previewImage.url}
								alt={previewImage.filename}
								className="max-w-full max-h-[70vh] object-contain rounded shadow-sm"
							/>
						</div>
					)}
					<div className="flex justify-end items-center mt-4">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => {
								if (previewImage) {
									downloadFile(previewImage.url, previewImage.filename);
								}
							}}
						>
							Download Original
						</Button>
					</div>
				</Modal>
			</Dialog.Root>
		</>
	);
}
