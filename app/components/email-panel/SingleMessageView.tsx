// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { PaperclipIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import EmailIframe from "~/components/EmailIframe";
import { formatDetailDate, hasFileAttachment, rewriteInlineImages } from "~/lib/utils";
import { displaySenderName } from "shared/sender";
import type { Email } from "~/types";
import { deliveryStatusLabel, isDeliveryFailure } from "~/lib/delivery-status";
import { isAuthSpoofed } from "~/lib/email-auth";

function senderInitials(name: string): string {
	const words = name.replace(/[<>"]/g, "").trim().split(/[\s@._-]+/).filter(Boolean);
	const letters = words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
	return letters || "?";
}

interface SingleMessageViewProps {
	email: Email;
	mailboxId?: string;
	onPreviewImage: (url: string, filename: string) => void;
}

export default function SingleMessageView({
	email,
	mailboxId,
	onPreviewImage,
}: SingleMessageViewProps) {
	const senderName = displaySenderName(email);
	const deliveryFailed = isDeliveryFailure(email.delivery_status);
	const spoofed = isAuthSpoofed(email);

	return (
		<div className="flex flex-col h-full">
			<div className="px-4 py-4 border-b border-kumo-line md:px-6">
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2.5 min-w-0">
						<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kumo-contrast text-sm font-semibold text-kumo-inverse">
							{senderInitials(senderName)}
						</div>
						<div className="min-w-0">
							<div className="text-sm font-medium text-kumo-default truncate">
								{senderName}
							</div>
							<div className="text-xs text-kumo-subtle truncate">{email.sender}</div>
							{spoofed && (
								<div className="text-xs text-kumo-destructive font-medium">Spoofed</div>
							)}
							<div className="text-xs text-kumo-subtle">To: {email.recipient}</div>
						</div>
					</div>
					<span className="text-xs text-kumo-subtle shrink-0 flex items-center gap-1.5">
						{hasFileAttachment(email) && (
							<PaperclipIcon size={12} className="shrink-0" aria-label="Has attachment" />
						)}
						{formatDetailDate(email.date)}
					</span>
				</div>
			</div>

			{(email.alias_id || email.recipient?.includes("@private.")) && (
				<div className="mx-4 mt-3 md:mx-6 flex items-center gap-2 rounded-md border border-sky-500/20 bg-sky-950/20 px-3 py-2 text-xs text-sky-300">
					<ShieldCheckIcon size={16} className="text-sky-400 shrink-0" />
					<span>
						Received via private email: <strong className="font-mono font-medium text-sky-200">{email.recipient}</strong>
					</span>
				</div>
			)}

			{spoofed && (
				<div className="mx-4 mt-3 md:mx-6 rounded-md border border-kumo-destructive/40 bg-kumo-destructive/10 px-3 py-2 text-xs text-kumo-default" role="status">
					<div className="font-medium text-kumo-destructive">This sender isn’t authenticated.</div>
					<div className="mt-0.5 text-kumo-subtle">The From address failed SPF/DKIM/DMARC alignment.</div>
				</div>
			)}

			{deliveryFailed && (
				<div className="mx-4 mt-3 md:mx-6 rounded-md border border-kumo-warning/40 bg-kumo-warning/10 px-3 py-2 text-xs text-kumo-default" role="status">
					<div className="font-medium">{deliveryStatusLabel(email.delivery_status)}</div>
					{email.delivery_error && (
						<div className="mt-0.5 text-kumo-subtle">{email.delivery_error}</div>
					)}
				</div>
			)}

			<div className="flex-1 min-h-0">
				<EmailIframe
					body={rewriteInlineImages(
						email.body || "",
						mailboxId || "",
						email.id,
						email.attachments,
					)}
				/>
			</div>

			<EmailAttachmentList
				mailboxId={mailboxId}
				emailId={email.id}
				attachments={email.attachments}
				onPreviewImage={onPreviewImage}
				className="px-4 py-4 border-t border-kumo-line shrink-0 md:px-6"
				showHeading
			/>
		</div>
	);
}
