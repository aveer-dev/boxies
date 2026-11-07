// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button } from '@cloudflare/kumo';
import { CaretDownIcon, CaretUpIcon, CodeIcon, DotsThreeIcon, NotePencilIcon, PaperclipIcon, PaperPlaneTiltIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { SummaryBlock } from '~/components/email-panel/AISummaryCard';
import FloatingPanel from '~/components/FloatingPanel';
import { SummaryIcon } from '~/components/icons/SummaryIcon';
import { useEmailQuickSummary, useRegenerateEmailSummary } from '~/queries/summaries';
import EmailAttachmentList from '~/components/EmailAttachmentList';
import { IconButton } from '~/components/IconButton';
import MessageBody from '~/components/email-panel/MessageBody';
import { formatDetailDate, formatShortDate, hasFileAttachment, stripHtml } from '~/lib/utils';
import { displaySenderName } from 'shared/sender';
import type { Email } from '~/types';
import { deliveryStatusLabel, isDeliveryFailure } from '~/lib/delivery-status';
import { isAuthSpoofed } from '~/lib/email-auth';
import { SpamReasonLine, UnverifiedSenderBanner } from './SenderTrustNotices';

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
    /** Notes to self on this message, shown in line under it (AVE-60). */
    notes?: ReactNode;
    /** Starts a private note on this message. */
    onAddNote?: () => void;
    /** Offer a quick summary (AVE-20): only for messages in a multi-message thread. */
    quickSummary?: boolean;
}

/** Inline AI summary of one thread message, fetched once the user asks for it. */
function QuickSummary({ mailboxId, emailId, onClose }: { mailboxId: string; emailId: string; onClose: () => void }) {
    const { data, isFetching, isError, refetch } = useEmailQuickSummary(mailboxId, emailId, true);
    const regenerate = useRegenerateEmailSummary();

    if (data && data.status === 'not_eligible') {
        return (
            <p className="mb-3 md:ml-10.5 text-xs text-kumo-subtle" role="status">
                {data.reason === 'too_short' ? 'This message is too short to summarize.' : 'This message can’t be summarized.'}
            </p>
        );
    }
    return (
        <SummaryBlock
            label="Quick summary"
            className="mb-3 md:ml-10.5 animate-reveal"
            summary={data?.status === 'ready' ? data.summary : undefined}
            loading={isFetching && !data}
            errorText={isError && !data ? 'Couldn’t summarize this message.' : undefined}
            onRetry={() => refetch()}
            onRegenerate={() => regenerate.mutate({ mailboxId, emailId })}
            regenerating={regenerate.isPending}
            regenerateFailed={regenerate.isError}
            onClose={onClose}
        />
    );
}

/** The message's "More" menu: Summarize (when offered) and View source. */
function MessageOptionsMenu({ onSummarize, summaryOpen, onViewSource }: { onSummarize?: () => void; summaryOpen: boolean; onViewSource?: () => void }) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);
    const itemClass = 'w-full flex items-center gap-2.5 text-left px-2.5 py-2 rounded-lg text-sm text-kumo-default hover:bg-kumo-overlay focus-visible:bg-kumo-overlay focus-visible:outline-none transition-colors duration-100';

    if (!onSummarize && !onViewSource) return null;
    return (
        <>
            <IconButton
                ref={triggerRef}
                label="More options"
                icon={DotsThreeIcon}
                weight="bold"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
            />
            <FloatingPanel anchorRef={triggerRef} open={open} onClose={close} role="menu" aria-label="Message options" className="min-w-[180px]">
                {onSummarize && (
                    <button type="button" role="menuitem" className={itemClass} onClick={() => { onSummarize(); close(); }}>
                        <SummaryIcon size={16} className="text-kumo-subtle" aria-hidden />
                        {summaryOpen ? 'Hide summary' : 'Summarize'}
                    </button>
                )}
                {onViewSource && (
                    <button type="button" role="menuitem" className={itemClass} onClick={() => { onViewSource(); close(); }}>
                        <CodeIcon size={16} className="text-kumo-subtle" aria-hidden />
                        View source
                    </button>
                )}
            </FloatingPanel>
        </>
    );
}

function Avatar({ isDraft, isSelf, sender }: { isDraft?: boolean; isSelf: boolean; sender: string }) {
    return (
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isDraft ? 'bg-kumo-fill text-kumo-subtle' : isSelf ? 'bg-kumo-brand text-kumo-inverse' : 'bg-kumo-fill text-kumo-default'}`}>
            {isDraft ? 'D' : sender.charAt(0).toUpperCase()}
        </div>
    );
}

export default function ThreadMessage({ email, mailboxId, mailboxEmail, isLast, isDraft, isSending, isExpanded, onToggleExpand, onSendDraft, onEditDraft, onDeleteDraft, onViewSource, onPreviewImage, quickSummary, notes, onAddNote }: ThreadMessageProps) {
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
    // Quick summary stays hidden until asked for (icon button or the More menu).
    const canSummarize = Boolean(quickSummary && !isDraft && mailboxId);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const toggleSummary = useCallback(() => setSummaryOpen((v) => !v), []);

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
                {notes && <div className="px-4 pb-3 pl-[60px]">{notes}</div>}
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
                            <SpamReasonLine email={email} className="mt-1" />
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        {hasFileAttachment(email) && <PaperclipIcon size={12} className="text-kumo-subtle shrink-0" aria-label="Has attachment" />}
                        <span className="text-xs text-kumo-subtle">{formatShortDate(email.date)}</span>
                        {onAddNote && <IconButton label="Add private note" icon={NotePencilIcon} onClick={onAddNote} />}
                        {canSummarize && (
                            <IconButton
                                label={summaryOpen ? 'Hide summary' : 'Summarize'}
                                icon={SummaryIcon}
                                className={summaryOpen ? 'text-kumo-default' : 'text-kumo-subtle'}
                                aria-pressed={summaryOpen}
                                onClick={toggleSummary}
                            />
                        )}
                        <MessageOptionsMenu onSummarize={canSummarize ? toggleSummary : undefined} summaryOpen={summaryOpen} onViewSource={onViewSource} />
                        <IconButton label="Collapse message" icon={CaretUpIcon} onClick={onToggleExpand} />
                    </div>
                </div>

                <UnverifiedSenderBanner email={email} className="mb-3 md:ml-10.5" />

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

                {canSummarize && summaryOpen && mailboxId && (
                    <QuickSummary mailboxId={mailboxId} emailId={email.id} onClose={() => setSummaryOpen(false)} />
                )}

                <div className="md:ml-10.5">
                    <MessageBody email={email} mailboxId={mailboxId} autoSize />
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

                {notes && <div className="mt-3 md:ml-10.5">{notes}</div>}
            </div>
        </div>
    );
}
