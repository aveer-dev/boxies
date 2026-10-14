// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { displaySenderName } from "shared/sender";
import { buildReplyEnvelope, plainTextToHtml } from "shared/reply-envelope";
import { Tip } from "~/components/IconButton";
import { useUIStore } from "~/hooks/useUIStore";
import { keysFor, useShortcut } from "~/lib/shortcuts";
import {
	buildQuotedReplyBlock,
	getSignatureBlock,
	htmlToPlainText,
} from "~/lib/utils";
import { useReplyToEmail } from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import type { Email } from "~/types";

function listLabel(value: string | string[] | undefined): string {
	if (!value) return "";
	return Array.isArray(value) ? value.join(", ") : value;
}

/**
 * Docked reply box under the reading room (Figma "Quick reply"). Sends a
 * plain Reply with the same envelope and quoting as the full composer;
 * Pop Out (⇧⌘O) moves the text into the compose column.
 */
export default function QuickReplyBar({
	mailboxId,
	replyTarget,
}: {
	mailboxId: string;
	/** The message a Reply answers (latest received in the thread). */
	replyTarget: Email;
}) {
	const [text, setText] = useState("");
	const [isSending, setIsSending] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const toastManager = useKumoToastManager();
	const replyMut = useReplyToEmail();
	const { data: mailbox } = useMailbox(mailboxId);
	const { startCompose, askAgent } = useUIStore();

	// A different thread starts with an empty box.
	// eslint-disable-next-line react-hooks/exhaustive-deps -- reset per message
	useEffect(() => setText(""), [replyTarget.id]);

	const envelope = mailbox
		? buildReplyEnvelope(
				replyTarget,
				{
					email: mailbox.email,
					name: mailbox.name,
					fromName: mailbox.settings?.fromName,
				},
				"reply",
			)
		: null;
	const toLabel = listLabel(envelope?.to) || replyTarget.sender;
	const firstName = displaySenderName(replyTarget).split(/\s+/)[0];

	const send = async () => {
		if (!text.trim() || isSending || !mailbox || !envelope) return;
		setIsSending(true);
		try {
			const html = `${plainTextToHtml(text)}${getSignatureBlock(mailbox.settings)}${buildQuotedReplyBlock(
				replyTarget.date,
				displaySenderName(replyTarget),
				replyTarget.body || "",
			)}`;
			await replyMut.mutateAsync({
				mailboxId,
				emailId: replyTarget.id,
				email: {
					to: envelope.to,
					cc: envelope.cc,
					from: envelope.from,
					subject: envelope.subject,
					html,
					text: htmlToPlainText(html),
				},
			});
			setText("");
			toastManager.add({ title: "Reply sent!" });
		} catch (err) {
			toastManager.add({
				title: (err instanceof Error && err.message) || "Failed to send reply.",
				variant: "error",
			});
		} finally {
			setIsSending(false);
		}
	};

	const popOut = () => {
		startCompose({ mode: "reply", originalEmail: replyTarget, initialBody: text });
		setText("");
		textareaRef.current?.blur();
	};

	const aiAssist = () =>
		askAgent(
			`Draft a reply to "${replyTarget.subject || "(no subject)"}" from ${displaySenderName(replyTarget)} <${replyTarget.sender}> (email id ${replyTarget.id}).${
				text.trim() ? ` Use these notes: ${text.trim()}` : ""
			}`,
		);

	// ⌘J works anywhere while a reader is open, not just inside the textarea;
	// it outranks the dock's plain Assistant toggle.
	useShortcut("assistant", aiAssist, { priority: 1 });

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			send();
		} else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
			e.preventDefault();
			popOut();
		} else if (e.key === "Escape") {
			e.stopPropagation();
			textareaRef.current?.blur();
		}
	};

	return (
		<div className="shrink-0 border-t border-kumo-line bg-kumo-base px-3 pt-3 pb-[var(--dock-h)]">
			<div className="rounded-2xl border border-kumo-line bg-kumo-control transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out)] focus-within:border-[var(--border-card)] focus-within:shadow-[0_0_0_3px_var(--accent-soft),0_8px_24px_rgba(0,0,0,0.06)]">
				<div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1.5 text-xs text-kumo-subtle border-b border-kumo-line">
					<div className="flex items-center gap-1.5 min-w-0">
						<span className="truncate">
							<span className="text-kumo-default">To:</span> {toLabel}
						</span>
						{replyTarget.cc && (
							<>
								<span aria-hidden>•</span>
								<span className="truncate">Cc: {replyTarget.cc}</span>
							</>
						)}
					</div>
					<Tip label="Open in composer" shortcut="⇧⌘O">
					<button
						type="button"
						onClick={popOut}
						className="group/pop inline-flex h-7 items-center gap-1.5 shrink-0 rounded-lg px-2 hover:text-kumo-default hover:bg-kumo-tint"
					>
						Pop out
						<ArrowSquareOutIcon
							size={14}
							className="transition-transform duration-200 ease-[var(--ease-out)] group-hover/pop:translate-x-px group-hover/pop:-translate-y-px"
						/>
					</button>
					</Tip>
				</div>
				<textarea
					ref={textareaRef}
					rows={3}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder={`Write a reply to ${firstName}…`}
					aria-label="Quick reply"
					className="block w-full resize-none bg-transparent px-3 py-2 text-sm text-kumo-default placeholder:text-kumo-subtle focus:outline-none"
				/>
				<div className="flex items-center justify-between gap-2 px-2 pb-2">
					<Tip label="Draft with the assistant" shortcut={keysFor("assistant")} side="top">
						<button
							type="button"
							onClick={aiAssist}
							className="group/ai inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--bg-badge)] px-3 text-xs font-medium text-kumo-strong shadow-[inset_0_0_0_1px_var(--border-card)] hover:bg-[var(--bg-card-hover)] hover:text-kumo-default"
						>
							<SparkleIcon
								size={14}
								className="transition-[rotate,scale] duration-300 ease-[var(--spring)] group-hover/ai:rotate-12 group-hover/ai:scale-110"
							/>
							AI Assist
						</button>
					</Tip>
					<Tip label="Send reply" shortcut="⌘↵" side="top">
						<Button
							size="sm"
							variant="primary"
							loading={isSending}
							disabled={!text.trim() || isSending || !mailbox}
							onClick={send}
						>
							Send
						</Button>
					</Tip>
				</div>
			</div>
		</div>
	);
}
