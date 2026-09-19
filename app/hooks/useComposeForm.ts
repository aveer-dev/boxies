// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "~/services/api";
import {
	buildQuotedReplyBlock,
	escapeHtml,
	formatComposeDate,
	getSignatureBlock,
	htmlToPlainText,
	splitEmailList,
	stripHtml,
	toEmailListValue,
} from "~/lib/utils";
import { displaySenderName } from "shared/sender";
import {
	replyToAddresses,
	replyAllAddresses,
	rewriteSelfReplyTo,
} from "shared/reply-recipients";
import { composeBodyHasUserContent } from "shared/compose-body";
import {
	OUTBOUND_SIZE_ERROR,
	remainingOutboundBudget,
} from "shared/compose-attachments";
import {
	estimateOutboundMessageBytes,
	MAX_OUTBOUND_MESSAGE_BYTES,
} from "shared/outbound-limits";
import { useDeleteEmail, useForwardEmail, useReplyToEmail, useSaveDraft, useSendEmail } from "~/queries/emails";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";
import {
	prepareComposeAttachment,
	type PreparedAttachment,
} from "~/lib/prepare-compose-attachment";

interface ComposeFormFields {
	to: string;
	cc: string;
	bcc: string;
	showCcBcc: boolean;
	subject: string;
	body: string;
}

const EMPTY_FIELDS: ComposeFormFields = {
	to: "",
	cc: "",
	bcc: "",
	showCcBcc: false,
	subject: "",
	body: "",
};

function getPrefixedSubject(subject: string, prefix: "Re" | "Fwd") {
	const expectedPrefix = `${prefix}: `;
	return subject.startsWith(expectedPrefix)
		? subject
		: `${expectedPrefix}${subject}`;
}

function buildForwardBody(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	sigBlock: string,
) {
	const senderLabel = displaySenderName(original);
	const safeSender = escapeHtml(
		senderLabel !== original.sender
			? `${senderLabel} <${original.sender}>`
			: original.sender,
	);
	const safeSubject = escapeHtml(original.subject);
	const safeBody = escapeHtml(stripHtml(original.body || "")).replace(/\n/g, "<br>");

	return `${sigBlock || "<p><br></p>"}<div style="border: 1px solid #ddd; padding: 1em; background-color: #f9f9f9; margin: 1em 0;"><strong>Forwarded message:</strong><br><strong>From:</strong> ${safeSender}<br><strong>Date:</strong> ${formatComposeDate(original.date)}<br><strong>Subject:</strong> ${safeSubject}<br><br>${safeBody}</div>`;
}

function buildReplyAllFields(
	original: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"]>,
	selfAddress?: string,
) {
	const recipients = replyAllAddresses(original, selfAddress);
	return {
		to: recipients.to.join(", "),
		cc: recipients.cc.join(", "),
		showCcBcc: recipients.cc.length > 0,
	};
}

function recipientFieldToString(value: string | string[]): string {
	return Array.isArray(value) ? value.join(", ") : value;
}

function isComposeDraftEmpty(
	to: string,
	cc: string,
	bcc: string,
	subject: string,
	body: string,
	sigBlock: string,
	attachmentCount = 0,
) {
	return (
		!to.trim() &&
		!cc.trim() &&
		!bcc.trim() &&
		!subject.trim() &&
		attachmentCount === 0 &&
		!composeBodyHasUserContent(body, sigBlock)
	);
}

function draftToField(
	draft: NonNullable<ReturnType<typeof useUIStore.getState>["composeOptions"]["draftEmail"]>,
	original: ReturnType<typeof useUIStore.getState>["composeOptions"]["originalEmail"],
	mailboxEmail?: string,
) {
	const savedTo = draft.recipient || "";
	if (!original || !mailboxEmail) return savedTo;
	return recipientFieldToString(rewriteSelfReplyTo(savedTo, original, mailboxEmail));
}

function buildInitialComposeFields(
	composeOptions: ReturnType<typeof useUIStore.getState>["composeOptions"],
	mailboxEmail: string | undefined,
	sigBlock: string,
): ComposeFormFields {
	const { draftEmail: draft, originalEmail: original, mode } = composeOptions;

	if (draft) {
		return {
			to: draftToField(draft, original, mailboxEmail?.toLowerCase()),
			cc: draft.cc || "",
			bcc: draft.bcc || "",
			showCcBcc: Boolean(draft.cc || draft.bcc),
			subject: draft.subject || "",
			body: draft.body || "",
		};
	}

	if (!original) {
		return {
			...EMPTY_FIELDS,
			body: sigBlock,
		};
	}

	if (mode === "reply") {
		return {
			...EMPTY_FIELDS,
			to: replyToAddresses(original, mailboxEmail?.toLowerCase()).join(", "),
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `${sigBlock || "<p><br></p>"}${buildQuotedReplyBlock(original.date, displaySenderName(original), original.body || "")}`,
		};
	}

	if (mode === "reply-all") {
		const recipients = buildReplyAllFields(original, mailboxEmail?.toLowerCase());
		return {
			...EMPTY_FIELDS,
			...recipients,
			subject: getPrefixedSubject(original.subject, "Re"),
			body: `${sigBlock || "<p><br></p>"}${buildQuotedReplyBlock(original.date, displaySenderName(original), original.body || "")}`,
		};
	}

	if (mode === "forward") {
		return {
			...EMPTY_FIELDS,
			subject: getPrefixedSubject(original.subject, "Fwd"),
			body: buildForwardBody(original, sigBlock),
		};
	}

	return {
		...EMPTY_FIELDS,
		body: sigBlock,
	};
}

export type DraftSaveStatus = "idle" | "saving" | "saved" | "error";

export function useComposeForm(mailboxId?: string, _folder?: string) {
	const toastManager = useKumoToastManager();
	const { composeOptions, closePanel, closeCompose } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const sendEmailMutation = useSendEmail();
	const saveDraftMutation = useSaveDraft();
	const replyMutation = useReplyToEmail();
	const forwardMutation = useForwardEmail();
	const deleteEmailMutation = useDeleteEmail();

	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [showCcBcc, setShowCcBcc] = useState(false);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isSavingDraft, setIsSavingDraft] = useState(false);
	const [isSending, setIsSending] = useState(false);
	const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("idle");
	const [savedDraftId, setSavedDraftId] = useState<string | undefined>(composeOptions.draftEmail?.id);
	const lastInitializedOptionsRef = useRef<typeof composeOptions | null>(null);
	const lastSavedSnapshotRef = useRef<string>("");
	const saveGenerationRef = useRef(0);
	const isSendingRef = useRef(false);
	const isDraftEdit = !!composeOptions.draftEmail;

	const formTitle = useMemo(() => {
		if (isDraftEdit) return "Edit Draft";
		switch (composeOptions.mode) { case "reply": return "Reply"; case "reply-all": return "Reply All"; case "forward": return "Forward"; default: return "New Message"; }
	}, [composeOptions.mode, isDraftEdit]);

	const sigBlock = useMemo(() => getSignatureBlock(currentMailbox?.settings), [currentMailbox]);

	useEffect(() => {
		if (lastInitializedOptionsRef.current === composeOptions) return;
		lastInitializedOptionsRef.current = composeOptions;

		const selfAddress = (currentMailbox?.email || mailboxId)?.toLowerCase();
		const initialFields = buildInitialComposeFields(
			composeOptions,
			selfAddress,
			sigBlock,
		);
		setError(null);
		setTo(initialFields.to);
		setCc(initialFields.cc);
		setBcc(initialFields.bcc);
		setShowCcBcc(initialFields.showCcBcc);
		setSubject(initialFields.subject);
		setBody(initialFields.body);
		setAttachments([]);
		setSavedDraftId(composeOptions.draftEmail?.id);
		lastSavedSnapshotRef.current = `${initialFields.to}|${initialFields.cc}|${initialFields.bcc}|${initialFields.subject}|${initialFields.body}`;
		setSaveStatus("idle");
		saveGenerationRef.current += 1;
		isSendingRef.current = false;
	}, [composeOptions, currentMailbox?.email, sigBlock, mailboxId]);

	const resolvedDraftId = (res?: { id?: string; draft_id?: string } | null) =>
		res?.draft_id || res?.id;

	// Debounced auto-save effect (3.0s)
	const consecutiveFailuresRef = useRef(0);

	useEffect(() => {
		if (!mailboxId || isSending) return;
		const currentSnapshot = `${to}|${cc}|${bcc}|${subject}|${body}`;
		const isEmpty = isComposeDraftEmpty(to, cc, bcc, subject, body, sigBlock, attachments.length);

		if (isEmpty || currentSnapshot === lastSavedSnapshotRef.current) {
			return;
		}

		const generation = saveGenerationRef.current;
		const timer = setTimeout(async () => {
			setIsSavingDraft(true);
			setSaveStatus("saving");
			try {
				const res = await saveDraftMutation.mutateAsync({
					mailboxId,
					draft: {
						to: to || undefined,
						cc: cc || undefined,
						bcc: bcc || undefined,
						subject: subject || undefined,
						body,
						in_reply_to: composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to || undefined,
						thread_id: composeOptions.originalEmail?.thread_id || composeOptions.draftEmail?.thread_id || undefined,
						draft_id: savedDraftId || composeOptions.draftEmail?.id || undefined,
					},
				});
				if (generation !== saveGenerationRef.current) {
					const staleId = resolvedDraftId(res);
					if (staleId && mailboxId && isSendingRef.current) {
						deleteEmailMutation.mutate({ mailboxId, id: staleId });
					}
					return;
				}
				lastSavedSnapshotRef.current = currentSnapshot;
				const nextId = resolvedDraftId(res);
				if (nextId) {
					setSavedDraftId(nextId);
				}
				consecutiveFailuresRef.current = 0;
				setSaveStatus("saved");
			} catch {
				if (generation !== saveGenerationRef.current) return;
				consecutiveFailuresRef.current += 1;
				setSaveStatus("error");
				if (consecutiveFailuresRef.current >= 3) {
					toastManager.add({ title: "Failed to save draft.", variant: "error" });
				}
			} finally {
				if (generation === saveGenerationRef.current) {
					setIsSavingDraft(false);
				}
			}
		}, 3000);

		return () => clearTimeout(timer);
	}, [to, cc, bcc, subject, body, sigBlock, mailboxId, isSending, savedDraftId, composeOptions, saveDraftMutation]);

	const handleSaveDraft = async () => {
		if (!mailboxId || isSending) return;
		if (isComposeDraftEmpty(to, cc, bcc, subject, body, sigBlock, attachments.length)) return;
		setIsSavingDraft(true);
		setSaveStatus("saving");
		setError(null);
		const currentSnapshot = `${to}|${cc}|${bcc}|${subject}|${body}`;
		const generation = saveGenerationRef.current;
		try {
			const res = await saveDraftMutation.mutateAsync({
				mailboxId,
				draft: {
					to: to || undefined,
					cc: cc || undefined,
					bcc: bcc || undefined,
					subject,
					body,
					in_reply_to: composeOptions.originalEmail?.id || composeOptions.draftEmail?.in_reply_to || undefined,
					thread_id: composeOptions.originalEmail?.thread_id || composeOptions.draftEmail?.thread_id || undefined,
					draft_id: savedDraftId || composeOptions.draftEmail?.id || undefined,
				},
			});
			if (generation !== saveGenerationRef.current) return;
			lastSavedSnapshotRef.current = currentSnapshot;
			const nextId = resolvedDraftId(res);
			if (nextId) {
				setSavedDraftId(nextId);
			}
			setSaveStatus("saved");
			toastManager.add({ title: "Draft saved!" });
		} catch (err: unknown) {
			if (generation !== saveGenerationRef.current) return;
			const message = (err instanceof Error ? err.message : null) || "Failed to save draft.";
			setError(message);
			setSaveStatus("error");
			toastManager.add({ title: message, variant: "error" });
		} finally {
			if (generation === saveGenerationRef.current) {
				setIsSavingDraft(false);
			}
		}
	};

	const handleDiscard = (onClose: () => void) => {
		saveGenerationRef.current += 1;
		isSendingRef.current = false;
		const draftId = savedDraftId || composeOptions.draftEmail?.id;
		if (draftId && mailboxId) {
			deleteEmailMutation.mutate({ mailboxId, id: draftId });
		}
		onClose();
	};

	const handleSend = async (e: FormEvent, onClose: () => void) => {
		e.preventDefault();
		if (isSendingRef.current) return;
		isSendingRef.current = true;
		setError(null);
		if (!currentMailbox || !mailboxId) {
			isSendingRef.current = false;
			setError("No mailbox selected.");
			return;
		}
		const toRecipients = splitEmailList(to);
		if (toRecipients.length === 0) {
			isSendingRef.current = false;
			setError("Add at least one recipient.");
			return;
		}
		saveGenerationRef.current += 1;
		const ccRecipients = splitEmailList(cc); const bccRecipients = splitEmailList(bcc);
		const fromName = currentMailbox.settings?.fromName || currentMailbox.name;
		const from = fromName && fromName !== currentMailbox.email ? { email: currentMailbox.email, name: fromName } : currentMailbox.email;
		let sendTo: string | string[] = toEmailListValue(toRecipients) ?? toRecipients;
		const original = composeOptions.originalEmail;
		const mode = composeOptions.mode;
		if ((mode === "reply" || mode === "reply-all") && original) {
			sendTo = rewriteSelfReplyTo(sendTo, original, currentMailbox.email || mailboxId);
		}
		const text = htmlToPlainText(body);
		const sizeInput = {
			html: body,
			text,
			attachments: attachments.map((item) => ({ content: item.content })),
		};
		if (estimateOutboundMessageBytes(sizeInput) > MAX_OUTBOUND_MESSAGE_BYTES) {
			isSendingRef.current = false;
			setError(OUTBOUND_SIZE_ERROR);
			toastManager.add({ title: OUTBOUND_SIZE_ERROR, variant: "error" });
			return;
		}
		const emailData = {
			to: sendTo,
			cc: toEmailListValue(ccRecipients),
			bcc: toEmailListValue(bccRecipients),
			from,
			subject,
			html: body,
			text,
			attachments: attachments.length
				? attachments.map((item) => ({
					content: item.content,
					filename: item.filename,
					type: item.type,
					disposition: item.disposition,
				}))
				: undefined,
		};
		const draftId = savedDraftId || composeOptions.draftEmail?.id;
		const originalId = original?.id || composeOptions.draftEmail?.in_reply_to;
		setIsSending(true); toastManager.add({ title: "Sending email..." });
		try {
			if ((mode === "reply" || mode === "reply-all") && originalId) await replyMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else if (mode === "forward" && originalId) await forwardMutation.mutateAsync({ mailboxId, emailId: originalId, email: emailData });
			else await sendEmailMutation.mutateAsync({ mailboxId, email: emailData });
			if (draftId) deleteEmailMutation.mutate({ mailboxId, id: draftId });
			toastManager.add({ title: "Email sent!" });
			onClose();
		} catch (err: unknown) {
			isSendingRef.current = false;
			let message = (err instanceof Error ? err.message : null) || "Failed to send email.";
			if (
				(err instanceof ApiError && err.status === 413) ||
				/5\s*mib|too large|content_too_large/i.test(message)
			) {
				message = OUTBOUND_SIZE_ERROR;
			}
			setError(message);
			toastManager.add({ title: message, variant: "error" });
		} finally {
			setIsSending(false);
		}
	};

	const addFiles = async (files: File[]) => {
		let budget = remainingOutboundBudget({
			html: body,
			text: htmlToPlainText(body),
			attachments: attachments.map((item) => ({ content: item.content })),
		});
		const next: PreparedAttachment[] = [];
		for (const file of files) {
			const result = await prepareComposeAttachment(file, budget);
			if (!result.ok) {
				toastManager.add({ title: result.error, variant: "error" });
				continue;
			}
			next.push(result.attachment);
			budget = Math.max(0, budget - result.attachment.size);
		}
		if (next.length) {
			setAttachments((current) => [...current, ...next]);
		}
	};

	const removeAttachment = (id: string) => {
		setAttachments((current) => current.filter((item) => item.id !== id));
	};

	const overSize = useMemo(
		() =>
			estimateOutboundMessageBytes({
				html: body,
				text: htmlToPlainText(body),
				attachments: attachments.map((item) => ({ content: item.content })),
			}) > MAX_OUTBOUND_MESSAGE_BYTES,
		[body, attachments],
	);

	return {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		attachments,
		addFiles,
		removeAttachment,
		overSize,
		error: overSize ? OUTBOUND_SIZE_ERROR : error,
		setError,
		isSavingDraft,
		isSending,
		saveStatus,
		formTitle,
		handleSaveDraft,
		handleDiscard,
		handleSend,
		closeCompose,
		closePanel,
	};
}
