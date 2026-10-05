// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useReplyToEmail } from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import type { Email } from "~/types";

interface QuickReplyBarProps {
	mailboxId: string;
	email: Email;
	onPopOut?: (text: string) => void;
}

export default function QuickReplyBar({
	mailboxId,
	email,
	onPopOut,
}: QuickReplyBarProps) {
	const [replyText, setReplyText] = useState("");
	const [isSending, setIsSending] = useState(false);
	const toastManager = useKumoToastManager();
	const replyMut = useReplyToEmail();
	const { data: mailbox } = useMailbox(mailboxId);

	const handleSendReply = async () => {
		if (!replyText.trim() || isSending) return;
		setIsSending(true);
		try {
			await replyMut.mutateAsync({
				mailboxId,
				emailId: email.id,
				data: {
					replyAll: false,
					body: replyText.trim(),
				},
			});
			toastManager.add({ title: "Reply sent!" });
			setReplyText("");
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Failed to send reply";
			toastManager.add({ title: msg, variant: "error" });
		} finally {
			setIsSending(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			handleSendReply();
		}
		if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
			e.preventDefault();
			onPopOut?.(replyText);
		}
	};

	const recipientLabel = email.sender || "Sender";

	return (
		<div className="border-t border-kumo-line bg-kumo-base p-3 shrink-0">
			<div className="rounded-lg border border-kumo-line bg-kumo-elevated p-2.5 shadow-sm space-y-2">
				{/* Top meta line: Recipients & Pop Out */}
				<div className="flex items-center justify-between text-[11px] text-kumo-subtle pb-1 border-b border-kumo-line/50">
					<div className="flex items-center gap-1.5 truncate">
						<span className="font-medium text-kumo-default">To:</span>
						<span className="truncate">{recipientLabel}</span>
						{email.cc && (
							<>
								<span>•</span>
								<span className="truncate">Cc: {email.cc}</span>
							</>
						)}
					</div>
					<button
						type="button"
						onClick={() => onPopOut?.(replyText)}
						className="inline-flex items-center gap-1 text-[10px] text-kumo-subtle hover:text-kumo-default px-1.5 py-0.5 rounded hover:bg-kumo-tint shrink-0 transition-colors"
						title="Pop Out (⇧⌘O)"
					>
						<span>Pop Out</span>
						<ArrowSquareOutIcon size={12} />
					</button>
				</div>

				{/* Textarea */}
				<textarea
					rows={3}
					value={replyText}
					onChange={(e) => setReplyText(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={`Write a reply to ${recipientLabel} or type '/' for templates...`}
					className="w-full bg-transparent text-xs text-kumo-default placeholder:text-kumo-subtle/80 resize-none focus:outline-none leading-relaxed"
				/>

				{/* Bottom Actions */}
				<div className="flex items-center justify-between pt-1 border-t border-kumo-line/40">
					<div className="flex items-center gap-2">
						<button
							type="button"
							className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-kumo-strong bg-kumo-recessed border border-kumo-line hover:bg-kumo-tint transition-colors"
							title="AI Assist (⌘J)"
						>
							<SparkleIcon size={13} className="text-kumo-brand" />
							<span>AI Assist</span>
							<kbd className="text-[9px] font-mono text-kumo-subtle">⌘J</kbd>
						</button>
					</div>

					<div className="flex items-center gap-2">
						<Button
							size="sm"
							loading={isSending}
							onClick={handleSendReply}
							disabled={!replyText.trim() || isSending}
						>
							Send (⌘↵)
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
