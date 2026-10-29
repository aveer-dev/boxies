// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, useKumoToastManager } from "@cloudflare/kumo";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Folders, FOLDER_DISPLAY_NAMES, isPurposeFolderId } from "shared/folders";
import { rewriteSelfReplyTo } from "shared/reply-recipients";
import EmailPanelDialogs from "~/components/email-panel/EmailPanelDialogs";
import ScrollArea from "~/components/ScrollArea";
import EmailPanelHeader from "~/components/email-panel/EmailPanelHeader";
import EmailPanelToolbar from "~/components/email-panel/EmailPanelToolbar";
import ScreenerTriageBar from "~/components/email-panel/ScreenerTriageBar";
import SingleMessageView from "~/components/email-panel/SingleMessageView";
import ThreadMessage from "~/components/email-panel/ThreadMessage";
import InlineNotes from "~/components/notes/InlineNotes";
import StickyNotes from "~/components/notes/StickyNotes";
import { groupThreadNotes, threadKeyFor } from "~/lib/thread-notes";
import { useThreadNotes } from "~/queries/thread-notes";
import AISummaryCard from "~/components/email-panel/AISummaryCard";
import { isSummaryFolderEligible, MIN_SUMMARY_CHARS } from "shared/ai-summaries";
import { splitEmailList, stripHtml, toEmailListValue } from "~/lib/utils";
import { createSendKeyStore } from "~/lib/send-idempotency";
import api from "~/services/api";
import { useSpamVerdictToast } from "~/hooks/useSpamVerdictToast";
import { useDeleteEmail, useEmail, useMoveEmail, useReplyToEmail, useSendEmail, useThreadReplies, useUpdateEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import { type ShortcutId, useShortcut } from "~/lib/shortcuts";
import type { Email, Folder, Mailbox } from "~/types";
import { displaySenderName } from "shared/sender";
import { bodyHasInlineQuote } from "shared/quoted-html";

function EmailPanelSkeleton() {
	return (
		<div className="animate-pulse p-5 space-y-4">
			<div className="h-5 w-2/3 rounded bg-kumo-fill" />
			<div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-kumo-fill" /><div className="space-y-2 flex-1"><div className="h-3 w-40 rounded bg-kumo-fill" /><div className="h-2.5 w-24 rounded bg-kumo-fill" /></div></div>
			<div className="space-y-2 pt-4"><div className="h-2.5 w-full rounded bg-kumo-fill" /><div className="h-2.5 w-5/6 rounded bg-kumo-fill" /><div className="h-2.5 w-4/6 rounded bg-kumo-fill" /><div className="h-2.5 w-3/4 rounded bg-kumo-fill" /></div>
		</div>
	);
}

export default function EmailPanel({
	emailId,
	mailboxId: propMailboxId,
	folder: propFolder,
	onClose,
	chips,
	renderFooter,
	inPopOut = false,
}: {
	emailId: string;
	mailboxId?: string;
	folder?: string;
	/** Close the reader (back / delete / move / triage done). */
	onClose: () => void;
	/** Folder / tag chips above the subject. */
	chips?: ReactNode;
	/** Docked under the thread; receives the message a reply should answer. */
	renderFooter?: (replyTarget: Email) => ReactNode;
	/** Shown in the pop-out sheet (AVE-29) rather than a column. */
	inPopOut?: boolean;
}) {
	const params = useParams<{ mailboxId: string; folder: string }>();
	const mailboxId = propMailboxId || params.mailboxId;
	const folder = propFolder || params.folder;
	const { data: email } = useEmail(mailboxId, emailId) as { data?: Email };
	const { data: threadRepliesRaw } = useThreadReplies(mailboxId, email?.thread_id) as {
		data?: Email[];
	};
	const updateEmail = useUpdateEmail();
	const deleteEmailMut = useDeleteEmail();
	const moveEmailMut = useMoveEmail();
	const sendEmailMut = useSendEmail();
	const replyMut = useReplyToEmail();
	/** Idempotency-Key per draft: retries of one draft's send reuse it. */
	const draftSendKeys = useRef(createSendKeyStore()).current;
	const { data: folders = [] } = useFolders(mailboxId) as { data?: Folder[] };
	const { data: currentMailbox } = useMailbox(mailboxId) as {
		data?: Mailbox;
	};
	const { startCompose, openPopOut } = useUIStore();
	const closePanel = onClose;
	const toastManager = useKumoToastManager();
	const [isSending, setIsSending] = useState(false);
	const [sourceViewEmail, setSourceViewEmail] = useState<Email | null>(null);
	const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
	const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);
	const [pendingPurposeMove, setPendingPurposeMove] = useState<string | null>(null);
	/** Report spam confirmation: "move their other mail" (AVE-98) and, for RFC 8058 bulk mail, "Unsubscribe" (AVE-99). */
	const [reportSpamOpen, setReportSpamOpen] = useState(false);
	const [alsoUnsubscribe, setAlsoUnsubscribe] = useState(false);
	const [alsoRefile, setAlsoRefile] = useState(true);
	const showSpamVerdictToast = useSpamVerdictToast(mailboxId);
	const isDraftFolder = folder === Folders.DRAFT;
	// Notes to self (AVE-60): stickies float over the messages, inline notes sit under theirs.
	const threadKey = email ? threadKeyFor(email) : undefined;
	const { data: threadNotes } = useThreadNotes(mailboxId, threadKey);
	const { sticky: stickyNotes, inlineByEmail } = useMemo(() => groupThreadNotes(threadNotes), [threadNotes]);
	const [composingNoteFor, setComposingNoteFor] = useState<string | null>(null);
	const [creatingSticky, setCreatingSticky] = useState(false);

	const threadReplies = useMemo(() => {
		if (!threadRepliesRaw || !email) return [];
		return threadRepliesRaw.filter((e) => e.id !== email.id);
	}, [threadRepliesRaw, email]);

	const allMessages = useMemo(() => {
		if (!email) return [];
		return [email, ...threadReplies].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	}, [email, threadReplies]);

	// Reset expanded state only when the selected email changes, not on every refetch.
	// Using allMessages as a dependency would reset user expand/collapse state on background refetches.
	const currentEmailId = email?.id;
	useEffect(() => { if (allMessages.length > 1) setExpandedMessages(new Set([allMessages[0].id])); }, [currentEmailId]); // eslint-disable-line react-hooks/exhaustive-deps

	const toggleExpand = (msgId: string) => { setExpandedMessages((prev) => { const next = new Set(prev); if (next.has(msgId)) next.delete(msgId); else next.add(msgId); return next; }); };

	const draftMessageIds = useMemo(() => {
		const ids = new Set<string>();
		for (const msg of allMessages) { if (msg.folder_id === Folders.DRAFT) ids.add(msg.id); else if (isDraftFolder && msg.id === emailId) ids.add(msg.id); }
		return ids;
	}, [allMessages, isDraftFolder, emailId]);

	const lastReceivedMessage = useMemo(() => {
		const ce = currentMailbox?.email;
		const received = allMessages.filter((msg) => !draftMessageIds.has(msg.id) && msg.sender !== ce);
		if (received.length > 0) return received[0];
		const nonDrafts = allMessages.filter((msg) => !draftMessageIds.has(msg.id));
		return nonDrafts.length > 0 ? nonDrafts[0] : email;
	}, [allMessages, draftMessageIds, currentMailbox?.email, email]);

	// AI summary (AVE-20): only for mail that reached the mailbox and has
	// enough text. The server re-checks both; this just skips pointless calls.
	const summaryMessages = useMemo(
		() => allMessages.filter((msg) => !draftMessageIds.has(msg.id) && isSummaryFolderEligible(msg.folder_id)),
		[allMessages, draftMessageIds],
	);
	const summaryEnabled = useMemo(() => {
		if (!email || !isSummaryFolderEligible(email.folder_id) || isDraftFolder) return false;
		let chars = 0;
		for (const msg of summaryMessages) {
			chars += stripHtml(msg.body || "").length;
			if (chars >= MIN_SUMMARY_CHARS) return true;
		}
		return false;
	}, [email, isDraftFolder, summaryMessages]);
	// Quick summaries: per message, only in a thread with more than one
	// message, and not on messages too short to be worth it.
	const quickSummaryIds = useMemo(
		() =>
			new Set(
				summaryMessages.length > 1
					? summaryMessages
							.filter((msg) => stripHtml(msg.body || "").length >= MIN_SUMMARY_CHARS)
							.map((msg) => msg.id)
					: [],
			),
		[summaryMessages],
	);

	const moveToFolders = useMemo(() => { const cur = folder || email?.folder_id; return folders.filter((f) => f.id !== cur); }, [folders, folder, email?.folder_id]);

	// Keyboard: the open message's actions, filled in below once it's loaded.
	const rootRef = useRef<HTMLDivElement>(null);
	const keyActions = useRef<Partial<Record<ShortcutId, () => void>>>({});
	const inCharge = () => {
		// A popped-out message has the keyboard while it's open.
		const popOut = document.querySelector("[data-popout]");
		if (popOut) return popOut.contains(rootRef.current);
		const column = rootRef.current?.closest<HTMLElement>("section[data-column-id]");
		if (!column) return false;
		if (column.dataset.active === "true") return true;
		// No reader column is active: the route's reader answers.
		return (
			column.dataset.columnId === "reader" &&
			!document.querySelector('section[data-column-id^="reader"][data-active="true"]')
		);
	};
	const useReaderKey = (id: ShortcutId) =>
		useShortcut(id, () => {
			const run = keyActions.current[id];
			if (!run || !inCharge()) return false;
			run();
		});
	useReaderKey("reply");
	useReaderKey("replyAll");
	useReaderKey("forward");
	useReaderKey("archive");
	useReaderKey("delete");
	useReaderKey("toggleRead");
	useReaderKey("star");
	useReaderKey("replyLater");
	useReaderKey("popOut");

	if (!email) {
		keyActions.current = {};
		return <EmailPanelSkeleton />;
	}

	const toggleStar = () => { if (mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } }); };
	const toggleReplyLater = () => {
		if (mailboxId) {
			updateEmail.mutate({
				mailboxId,
				id: email.id,
				data: { reply_later: !email.reply_later },
			});
		}
	};
	const runMove = (folderId: string, setSenderPreference: boolean) => {
		if (!mailboxId) return;
		moveEmailMut.mutate(
			{ mailboxId, id: email.id, folderId, setSenderPreference },
			{
				onSuccess: (result) => {
					// Into / out of Spam: Not spam / Report spam toast with Undo (AVE-98).
					if (showSpamVerdictToast(result, { folderId, sender: email.sender })) {
						closePanel();
						return;
					}
					if (setSenderPreference && result?.refiledCount && result.refiledCount > 0) {
						toastManager.add({
							title: `Moved — updated ${result.refiledCount} from this sender`,
						});
					}
					closePanel();
				},
			},
		);
	};
	const handleMove = (folderId: string) => {
		if (!mailboxId) return;
		const isSelf =
			Boolean(currentMailbox?.email) &&
			email.sender?.toLowerCase() === currentMailbox?.email?.toLowerCase();
		// Into or out of Spam is Not spam / Report spam: leaving Spam is the
		// signal, so there's no "remember?" prompt (the server teaches the sender).
		if (email.folder_id === Folders.SPAM || folderId === Folders.SPAM) {
			runMove(folderId, true);
			return;
		}
		if (isPurposeFolderId(folderId) && email.sender && !isSelf) {
			setPendingPurposeMove(folderId);
			return;
		}
		runMove(folderId, false);
	};
	const isOwnMessage =
		Boolean(currentMailbox?.email) &&
		email.sender?.toLowerCase() === currentMailbox?.email?.toLowerCase();
	// Same rules as iOS/Android: received mail can be reported; anything in
	// Spam can be rescued; your own messages, drafts and Sent are never judged.
	const spamAction: "report" | "not-spam" | null = isOwnMessage
		? null
		: email.folder_id === Folders.SPAM
			? "not-spam"
			: isDraftFolder || email.folder_id === Folders.DRAFT || email.folder_id === Folders.SENT
				? null
				: "report";
	const runSpamAction = (options: { unsubscribe?: boolean; refileSender?: boolean } = {}) => {
		if (!mailboxId || !spamAction) return;
		const folderId = spamAction === "report" ? Folders.SPAM : Folders.INBOX;
		moveEmailMut.mutate(
			{
				mailboxId,
				id: email.id,
				folderId,
				setSenderPreference: true,
				unsubscribe: options.unsubscribe,
				refileSender: options.refileSender,
			},
			{
				onSuccess: (result) => {
					if (!showSpamVerdictToast(result, { folderId, sender: email.sender })) {
						toastManager.add({ title: spamAction === "report" ? "Reported as spam" : "Moved to Inbox" });
					}
					closePanel();
				},
			},
		);
	};
	const handleSpamAction = () => {
		// Report spam confirms first: "Also move their other mail to Spam"
		// (checked by default, AVE-98) and, for RFC 8058 bulk mail,
		// "Unsubscribe" (unchecked by default, AVE-99). Not spam runs
		// straight away; its toast has Undo.
		if (spamAction === "report") {
			setAlsoUnsubscribe(false);
			setAlsoRefile(true);
			setReportSpamOpen(true);
			return;
		}
		runSpamAction();
	};
	const handleDelete = () => { if (mailboxId) { if (!window.confirm("Are you sure you want to delete this email?")) return; deleteEmailMut.mutate({ mailboxId, id: email.id }); closePanel(); } };

	const handleEditDraft = (draftMsg?: Email) => {
		const target = draftMsg || email;
		// A "Fwd:" draft reopens as a forward, so it keeps the forwarded-message quote.
		if (target.in_reply_to) { startCompose({ mode: /^fwd:/i.test(target.subject || "") ? "forward" : "reply", originalEmail: allMessages.find((msg) => msg.id === target.in_reply_to), draftEmail: target }); }
		else { startCompose({ mode: "new", originalEmail: undefined, draftEmail: target }); }
	};

	const handleDeleteDraft = async (draftMsg?: Email) => {
		const target = draftMsg || email;
		if (!mailboxId) return;
		if (!window.confirm("Discard this draft?")) return;
		deleteEmailMut.mutate({ mailboxId, id: target.id });
		toastManager.add({ title: "Draft discarded" });
		if (target.id === emailId) closePanel();
	};

	const handleSendDraft = async (draftMsg?: Email) => {
		let target = draftMsg || email;
		if (!mailboxId || !currentMailbox) return;
		setIsSending(true);
		try {
			if (!target.recipient || !target.subject) { try { const fresh = await api.getEmail(mailboxId, target.id) as Email; if (fresh) target = fresh; } catch {} }
			if (!target.recipient) { toastManager.add({ title: "Cannot send: no recipient set on this draft.", variant: "error" }); return; }
			const toRecipients = splitEmailList(target.recipient);
			if (toRecipients.length === 0) { toastManager.add({ title: "Cannot send: no valid recipient set on this draft.", variant: "error" }); return; }
			const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
			const from = fromName && fromName !== currentMailbox.email ? { email: currentMailbox.email, name: fromName } : currentMailbox.email;
			const originalEmail = target.in_reply_to ? allMessages.find((msg) => msg.id === target.in_reply_to) : undefined;
			let sendTo: string | string[] = toEmailListValue(toRecipients) ?? toRecipients;
			if (originalEmail) {
				sendTo = rewriteSelfReplyTo(sendTo, originalEmail, currentMailbox.email);
			}
			const emailData = {
				to: sendTo,
				cc: toEmailListValue(splitEmailList(target.cc)),
				bcc: toEmailListValue(splitEmailList(target.bcc)),
				from,
				subject: target.subject || "(no subject)",
				html: target.body || "",
				text: target.body ? target.body.replace(/<[^>]*>/g, "").trim() : "",
				// The Worker quotes the original, unless this older draft already has it inline (AVE-133).
				...(originalEmail && !bodyHasInlineQuote(target.body)
					? { quote_original: true, quote_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined }
					: {}),
			};
			const idempotencyKey = draftSendKeys.keyFor(target.id);
			if (originalEmail) await replyMut.mutateAsync({ mailboxId, emailId: originalEmail.id, email: emailData, idempotencyKey }); else await sendEmailMut.mutateAsync({ mailboxId, email: emailData, idempotencyKey });
			draftSendKeys.release(target.id);
			const draftIds = new Set(
				allMessages.filter((msg) => draftMessageIds.has(msg.id)).map((msg) => msg.id),
			);
			draftIds.add(target.id);
			await Promise.all(
				[...draftIds].map((id) =>
					deleteEmailMut.mutateAsync({ mailboxId, id }).catch(() => undefined),
				),
			);
			toastManager.add({ title: "Email sent!" });
			if (isDraftFolder) closePanel();
		} catch (err) {
			const message = (err instanceof Error ? err.message : null) || "Failed to send email.";
			toastManager.add({ title: message, variant: "error" });
		} finally { setIsSending(false); }
	};

	const reply = () => startCompose({ mode: "reply", originalEmail: lastReceivedMessage });
	const replyAll = () => startCompose({ mode: "reply-all", originalEmail: lastReceivedMessage });
	const forward = () => startCompose({ mode: "forward", originalEmail: email });
	const toggleRead = () => {
		if (mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { read: !email.read } });
	};
	const archive = email.folder_id === Folders.ARCHIVE ? undefined : () => handleMove(Folders.ARCHIVE);
	const popOut = inPopOut
		? undefined
		: () => openPopOut(email.id, rootRef.current?.closest<HTMLElement>("section[data-column-id]")?.dataset.columnId);
	keyActions.current = {
		...(isDraftFolder ? {} : { reply, replyAll, forward }),
		popOut,
		archive,
		delete: handleDelete,
		toggleRead,
		star: toggleStar,
		replyLater: toggleReplyLater,
	};

	const hasThread = allMessages.length > 1;
	const notesFor = (msgId: string) => {
		const notes = inlineByEmail.get(msgId) ?? [];
		if (!mailboxId || !threadKey || (notes.length === 0 && composingNoteFor !== msgId)) return undefined;
		return (
			<InlineNotes
				mailboxId={mailboxId}
				threadId={threadKey}
				emailId={msgId}
				notes={notes}
				composing={composingNoteFor === msgId}
				onComposeDone={() => setComposingNoteFor(null)}
			/>
		);
	};
	// Gate on the message folder only (match iOS/Android) so a Screener
	// sidebar selection cannot triage a non-screener thread message.
	const isScreenerFolder = email.folder_id === Folders.SCREENER;

	return (
		<div ref={rootRef} className="flex flex-col h-full">
			<EmailPanelToolbar
				email={email}
				mailboxId={mailboxId}
				isDraftFolder={isDraftFolder}
				isSending={isSending}
				moveToFolders={moveToFolders}
				onBack={closePanel}
				onSendDraft={() => handleSendDraft()}
				onEditDraft={() => handleEditDraft()}
				onReply={reply}
				onReplyAll={replyAll}
				onForward={forward}
				onToggleStar={toggleStar}
				onToggleReplyLater={toggleReplyLater}
				onToggleRead={toggleRead}
				onArchive={archive}
				onPopOut={popOut}
				inPopOut={inPopOut}
				onMove={handleMove}
				spamAction={spamAction}
				onSpamAction={handleSpamAction}
				onViewSource={() => setSourceViewEmail(email)}
				onDelete={handleDelete}
				onAddStickyNote={mailboxId && !isDraftFolder ? () => setCreatingSticky(true) : undefined}
			/>

			{isScreenerFolder && mailboxId && email.sender && (
				<ScreenerTriageBar
					mailboxId={mailboxId}
					emailId={email.id}
					sender={email.sender}
					senderName={email.sender_name}
					onDone={closePanel}
				/>
			)}

			<EmailPanelHeader
				subject={email.subject}
				messageCount={allMessages.length}
				showThreadCount={hasThread}
				chips={chips}
			/>

			<AISummaryCard
				mailboxId={mailboxId}
				threadId={email.thread_id || email.id}
				enabled={summaryEnabled}
			/>

			{/* A single message fills the reader and its body scrolls itself. */}
			<div className="relative flex-1 min-h-0">
			<ScrollArea className="h-full" contentClassName={`animate-reveal ${hasThread ? "" : "h-full"}`}>
				{hasThread ? (
					allMessages.map((msg, idx) => {
						const isDraft = draftMessageIds.has(msg.id);
						return (
							<ThreadMessage
								key={msg.id}
								email={msg}
								mailboxId={mailboxId}
								mailboxEmail={currentMailbox?.email}
								isLast={idx === allMessages.length - 1}
								isDraft={isDraft}
								isSending={isDraft ? isSending : false}
								isExpanded={expandedMessages.has(msg.id)}
								onToggleExpand={() => toggleExpand(msg.id)}
								onSendDraft={isDraft ? () => handleSendDraft(msg) : undefined}
								onEditDraft={isDraft ? () => handleEditDraft(msg) : undefined}
								onDeleteDraft={isDraft ? () => handleDeleteDraft(msg) : undefined}
								onViewSource={() => setSourceViewEmail(msg)}
								quickSummary={quickSummaryIds.has(msg.id)}
								onPreviewImage={(url, filename) =>
									setPreviewImage({ url, filename })
								}
								notes={notesFor(msg.id)}
								onAddNote={isDraft || !mailboxId ? undefined : () => setComposingNoteFor(msg.id)}
							/>
						);
					})
				) : (
					<SingleMessageView
						email={email}
						mailboxId={mailboxId}
						onPreviewImage={(url, filename) =>
							setPreviewImage({ url, filename })
						}
						notes={notesFor(email.id)}
					/>
				)}
			</ScrollArea>
			{mailboxId && threadKey && (stickyNotes.length > 0 || creatingSticky) && (
				<StickyNotes
					mailboxId={mailboxId}
					threadId={threadKey}
					notes={stickyNotes}
					creating={creatingSticky}
					onCreatingDone={() => setCreatingSticky(false)}
				/>
			)}
			</div>

			{renderFooter && lastReceivedMessage && !isDraftFolder && email.folder_id !== Folders.DRAFT &&
				renderFooter(lastReceivedMessage)}

			<EmailPanelDialogs
				sourceViewEmail={sourceViewEmail}
				previewImage={previewImage}
				onCloseSource={() => setSourceViewEmail(null)}
				onClosePreview={() => setPreviewImage(null)}
			/>

			<Dialog.Root open={reportSpamOpen} onOpenChange={setReportSpamOpen}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Report spam?
					</Dialog.Title>
					<p className="text-sm text-kumo-subtle mb-4">
						Future mail from{" "}
						<span className="font-medium text-kumo-default">
							{displaySenderName(email)}
						</span>{" "}
						will go to Spam.
					</p>
					<div className="flex flex-col gap-3 mb-5">
						<label className="flex items-start gap-2.5 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={alsoRefile}
								onChange={(e) => setAlsoRefile(e.target.checked)}
								className="mt-0.5 h-4 w-4 rounded border-kumo-line accent-[var(--accent)] cursor-pointer"
							/>
							<span className="text-sm">
								<span className="font-medium text-kumo-default">Move their other mail to Spam</span>
								<span className="block text-kumo-subtle">
									Also moves what they sent to Inbox, Promotions and Updates.
								</span>
							</span>
						</label>
						{email.one_click_unsubscribe ? (
							<label className="flex items-start gap-2.5 cursor-pointer select-none">
								<input
									type="checkbox"
									checked={alsoUnsubscribe}
									onChange={(e) => setAlsoUnsubscribe(e.target.checked)}
									className="mt-0.5 h-4 w-4 rounded border-kumo-line accent-[var(--accent)] cursor-pointer"
								/>
								<span className="text-sm">
									<span className="font-medium text-kumo-default">Unsubscribe</span>
									<span className="block text-kumo-subtle">
										Also ask the sender to stop sending to this list.
									</span>
								</span>
							</label>
						) : null}
					</div>
					<div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
						<Dialog.Close>
							<Button variant="ghost">Cancel</Button>
						</Dialog.Close>
						<Button
							variant="primary"
							onClick={() => {
								setReportSpamOpen(false);
								runSpamAction({
									unsubscribe: email.one_click_unsubscribe ? alsoUnsubscribe : false,
									refileSender: alsoRefile,
								});
							}}
						>
							Report spam
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root
				open={pendingPurposeMove !== null}
				onOpenChange={(open) => {
					if (!open) setPendingPurposeMove(null);
				}}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">
						Put future mail here?
					</Dialog.Title>
					<p className="text-sm text-kumo-subtle mb-4">
						Also file future messages from{" "}
						<span className="font-medium text-kumo-default">
							{displaySenderName(email)}
						</span>{" "}
						into{" "}
						{pendingPurposeMove
							? FOLDER_DISPLAY_NAMES[pendingPurposeMove] ?? pendingPurposeMove
							: "this folder"}
						, and move their existing Inbox / Promotions / Updates mail.
					</p>
					<div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
						<Button
							variant="ghost"
							onClick={() => {
								const folderId = pendingPurposeMove;
								setPendingPurposeMove(null);
								if (folderId) runMove(folderId, false);
							}}
						>
							Just this message
						</Button>
						<Button
							variant="primary"
							onClick={() => {
								const folderId = pendingPurposeMove;
								setPendingPurposeMove(null);
								if (folderId) runMove(folderId, true);
							}}
						>
							Yes, for this sender
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
