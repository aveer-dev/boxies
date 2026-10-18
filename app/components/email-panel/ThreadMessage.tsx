// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button } from '@cloudflare/kumo';
import { ArrowClockwiseIcon, CaretDownIcon, CaretUpIcon, CodeIcon, PaperclipIcon, PaperPlaneTiltIcon, PencilSimpleIcon, SparkleIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { SummarySkeleton, SummaryText } from '~/components/email-panel/AISummaryCard';
import { useEmailQuickSummary, useRegenerateEmailSummary } from '~/queries/summaries';
import EmailAttachmentList from '~/components/EmailAttachmentList';
import { IconButton } from '~/components/IconButton';
import EmailIframe from '~/components/EmailIframe';
import { formatDetailDate, formatShortDate, hasFileAttachment, rewriteInlineImages, stripHtml } from '~/lib/utils';
import { displaySenderName } from 'shared/sender';
import type { Email } from '~/types';
import { deliveryStatusLabel, isDeliveryFailure } from '~/lib/delivery-status';
import { isAuthSpoofed } from '~/lib/email-auth';

interface ThreadMessageProps {
    email: Email;
    mailboxId?: string;
    mailboxEmail?: string;
    isLast: boolean;
    isDraft?: boolean;
    isSending?: boolean;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onSendDraft?: () => void;
    onEditDraft?: () => void;
    onDeleteDraft?: () => void;
    onViewSource?: () => void;
    onPreviewImage?: (url: string, filename: string) => void;
    /** Offer "Quick summary" (AVE-20): only for messages in a multi-message thread. */
    quickSummary?: boolean;
}

/** Inline AI summary of one thread message, generated when the user asks. */
function QuickSummary({ mailboxId, emailId }: { mailboxId?: string; emailId: string }) {
    const [requested, setRequested] = useState(false);
    const { data, isFetching, isError, refetch } = useEmailQuickSummary(mailboxId, emailId, requested);
    const regenerate = useRegenerateEmailSummary();

    if (!mailboxId) return null;
    if (!requested && !data) {
        return (
            <Button variant="ghost" size="sm" icon={<SparkleIcon size={14} />} onClick={() => setRequested(true)} className="mb-3 md:ml-10.5">
                Quick summary
            </Button>
        );
    }
    if (data && data.status === 'not_eligible') {
        return (
            <p className="mb-3 md:ml-10.5 text-xs text-kumo-subtle" role="status">
                {data.reason === 'too_short' ? 'This message is too short to summarize.' : 'This message can’t be summarized.'}
            </p>
        );
    }
    return (
        <div className="mb-3 md:ml-10.5 rounded-xl border border-kumo-line bg-kumo-tint px-3.5 py-2.5" aria-label="Quick summary">
            <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-kumo-subtle">
                    <SparkleIcon size={14} weight="fill" className="text-kumo-brand" aria-hidden />
                    Quick summary
                </span>
                {data?.status === 'ready' && (
                    <IconButton
                        label="Regenerate quick summary"
                        icon={ArrowClockwiseIcon}
                        iconClassName={regenerate.isPending ? 'animate-spin' : undefined}
                        disabled={regenerate.isPending}
                        onClick={() => regenerate.mutate({ mailboxId, emailId })}
                    />
                )}
            </div>
            {regenerate.isPending || (isFetching && !data) ? (
                <SummarySkeleton />
            ) : data?.status === 'ready' ? (
                <SummaryText summary={data.summary} />
            ) : isError ? (
                <p className="text-xs text-kumo-subtle" role="status">
                    Couldn’t summarize this message.{' '}
                    <button type="button" className="underline underline-offset-2 hover:text-kumo-default" onClick={() => refetch()}>
                        Try again
                    </button>
                </p>
            ) : (
                <SummarySkeleton />
            )}
        </div>
    );
}

function Avatar({ isDraft, isSelf, sender }: { isDraft?: boolean; isSelf: boolean; sender: string }) {
    return (
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isDraft ? 'bg-kumo-fill text-kumo-subtle' : isSelf ? 'bg-kumo-brand text-kumo-inverse' : 'bg-kumo-fill text-kumo-default'}`}>
            {isDraft ? 'D' : sender.charAt(0).toUpperCase()}
        </div>
    );
}

export default function ThreadMessage({ email, mailboxId, mailboxEmail, isLast, isDraft, isSending, isExpanded, onToggleExpand, onSendDraft, onEditDraft, onDeleteDraft, onViewSource, onPreviewImage, quickSummary }: ThreadMessageProps) {
    const isSelf = email.sender === mailboxEmail;
    const deliveryFailed = isDeliveryFailure(email.delivery_status);
    const spoofed = isAuthSpoofed(email);
    const accent = spoofed
        ? 'border-l-2 border-l-kumo-destructive bg-kumo-destructive/[0.02]'
        : isDraft || deliveryFailed
            ? 'border-l-2 border-l-kumo-warning bg-kumo-warning/[0.02]'
            : '';
    const containerClassName = `${!isLast ? 'border-b border-kumo-line' : ''} ${accent}`;
    const senderName = displaySenderName(email);
    const senderLabel = isDraft ? 'Draft reply' : isSelf ? 'You' : senderName;

    if (!isExpanded) {
        return (
            <div className={containerClassName}>
                <button type="button" onClick={onToggleExpand} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-kumo-tint rounded-2xl text-left transition-colors">
                    <Avatar isDraft={isDraft} isSelf={isSelf} sender={senderName} />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-kumo-default truncate">{senderLabel}</span>
                            <span className="text-xs text-kumo-subtle shrink-0 flex items-center gap-1.5">
                                {deliveryFailed && <Badge variant="outline">{deliveryStatusLabel(email.delivery_status)}</Badge>}
                                {spoofed && <Badge variant="outline">Spoofed</Badge>}
                                {hasFileAttachment(email) && <PaperclipIcon size={12} className="shrink-0" aria-label="Has attachment" />}
                                {formatDetailDate(email.date)}
                            </span>
                        </div>
                        <p className="text-xs text-kumo-subtle truncate">{stripHtml(email.body || '').slice(0, 80)}</p>
                    </div>
                    <CaretDownIcon size={16} className="text-kumo-subtle shrink-0" />
                </button>
            </div>
        );
    }

    return (
        <div className={`group/thread-msg animate-reveal ${containerClassName}`}>
            <div className="px-4 py-4 md:px-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <button type="button" onClick={onToggleExpand} className="shrink-0" aria-label="Collapse message">
                            <div className="cursor-pointer hover:ring-2 hover:ring-[var(--border-control)] transition-shadow rounded-full">
                                <Avatar isDraft={isDraft} isSelf={isSelf} sender={senderName} />
                            </div>
                        </button>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-kumo-default truncate">{senderLabel}</span>
                                {isDraft && <Badge variant="outline">Draft</Badge>}
                                {deliveryFailed && (
                                    <Badge variant="outline">{deliveryStatusLabel(email.delivery_status)}</Badge>
                                )}
                                {spoofed && <Badge variant="outline">Spoofed</Badge>}
                            </div>
                            {!isDraft && !isSelf && senderName !== email.sender && <div className="text-xs text-kumo-subtle truncate">{email.sender}</div>}
                            <div className="text-xs text-kumo-subtle">To: {email.recipient}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {hasFileAttachment(email) && <PaperclipIcon size={12} className="text-kumo-subtle shrink-0" aria-label="Has attachment" />}
                        <span className="text-xs text-kumo-subtle">{formatShortDate(email.date)}</span>
                        {onViewSource && <IconButton label="View source" icon={CodeIcon} onClick={onViewSource} />}
                        <IconButton label="Collapse message" icon={CaretUpIcon} onClick={onToggleExpand} />
                    </div>
                </div>

                {spoofed && (
                    <div className="mb-3 md:ml-10.5 rounded-md border border-kumo-destructive/40 bg-kumo-destructive/10 px-3 py-2 text-xs text-kumo-default" role="status">
                        <div className="font-medium text-kumo-destructive">This sender isn’t authenticated.</div>
                        <div className="mt-0.5 text-kumo-subtle">The From address failed SPF/DKIM/DMARC alignment.</div>
                    </div>
                )}

                {deliveryFailed && (
                    <div className="mb-3 md:ml-10.5 rounded-md border border-kumo-warning/40 bg-kumo-warning/10 px-3 py-2 text-xs text-kumo-default" role="status">
                        <div className="font-medium">{deliveryStatusLabel(email.delivery_status)}</div>
                        {email.delivery_error && (
                            <div className="mt-0.5 text-kumo-subtle">{email.delivery_error}</div>
                        )}
                    </div>
                )}

                {quickSummary && !isDraft && <QuickSummary mailboxId={mailboxId} emailId={email.id} />}

                <div className="md:ml-10.5">
                    <EmailIframe body={rewriteInlineImages(email.body || '', mailboxId || '', email.id, email.attachments)} autoSize />
                </div>

                {isDraft && (onSendDraft || onEditDraft || onDeleteDraft) && (
                    <div className="flex gap-2 mt-3 md:ml-10.5">
                        {onSendDraft && (
                            <Button variant="primary" size="sm" icon={<PaperPlaneTiltIcon size={14} />} onClick={onSendDraft} loading={isSending} disabled={isSending}>
                                {isSending ? 'Sending...' : 'Send'}
                            </Button>
                        )}
                        {onEditDraft && (
                            <Button variant="secondary" size="sm" icon={<PencilSimpleIcon size={14} />} onClick={onEditDraft} disabled={isSending}>
                                Edit
                            </Button>
                        )}
                        {onDeleteDraft && (
                            <Button variant="ghost" size="sm" icon={<TrashIcon size={14} />} onClick={onDeleteDraft} disabled={isSending}>
                                Discard
                            </Button>
                        )}
                    </div>
                )}

                <EmailAttachmentList mailboxId={mailboxId} emailId={email.id} attachments={email.attachments} onPreviewImage={onPreviewImage} className="mt-3 md:ml-10.5" />
            </div>
        </div>
    );
}
