// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import {
	UNVERIFIED_SENDER_TITLE,
	showsUnverifiedBanner,
	spamReasonLine,
	unverifiedSenderDetail,
} from "shared/spam-reason";
import { emailAuthTier } from "~/lib/email-auth";
import type { Email } from "~/types";

type NoticeEmail = Pick<
	Email,
	"auth" | "auth_tier" | "classification_reason" | "folder_id" | "sender"
>;

/** One muted line saying why a message is in Spam / Screened out. */
export function SpamReasonLine({
	email,
	className = "",
}: {
	email: NoticeEmail;
	className?: string;
}) {
	const line = spamReasonLine(email.classification_reason, email.folder_id);
	if (!line) return null;
	return (
		<div
			className={`flex items-center gap-1.5 text-xs text-kumo-subtle ${className}`}
			role="note"
		>
			<InfoIcon size={14} className="shrink-0" aria-hidden />
			<span className="min-w-0 truncate">{line}</span>
		</div>
	);
}

/** "Unverified sender" banner for `unverified` mail, allowed senders included. */
export function UnverifiedSenderBanner({
	email,
	className = "",
}: {
	email: NoticeEmail;
	className?: string;
}) {
	if (!showsUnverifiedBanner(emailAuthTier(email))) return null;
	return (
		<div
			className={`flex items-start gap-2 rounded-md border border-kumo-warning/40 bg-kumo-warning/10 px-3 py-2 text-xs text-kumo-default ${className}`}
			role="status"
		>
			<WarningCircleIcon size={16} className="mt-px shrink-0 text-kumo-warning" aria-hidden />
			<div className="min-w-0">
				<div className="font-medium">{UNVERIFIED_SENDER_TITLE}</div>
				<div className="mt-0.5 text-kumo-subtle">{unverifiedSenderDetail(email.sender)}</div>
			</div>
		</div>
	);
}
