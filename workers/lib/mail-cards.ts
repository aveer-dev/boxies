// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reader cards for an inbound message (AVE-175): its one-time code and its
 * calendar invite, from the postal-mime parse. Detection never fails the
 * inbound path; an error just means no card.
 */

import type { EmailInvite, EmailOtp } from "../../shared/mail-cards.ts";
import { inviteFromAttachments, type CalendarAttachmentLike } from "./calendar-invite.ts";
import { detectOneTimeCode } from "./one-time-code.ts";

export interface MailCardSource {
	subject?: string | null;
	text?: string | null;
	html?: string | null;
	attachments?: readonly CalendarAttachmentLike[] | null;
}

export interface MailCards {
	otp: EmailOtp | null;
	invite: EmailInvite | null;
}

export function detectMailCards(parsed: MailCardSource): MailCards {
	let invite: EmailInvite | null = null;
	let otp: EmailOtp | null = null;
	try {
		invite = inviteFromAttachments(parsed.attachments);
	} catch (e) {
		console.warn("Invite detection failed:", (e as Error).message);
	}
	// An invite's body talks about meeting IDs and passcodes; it is not a
	// sign-in mail, so it never gets a code card.
	if (!invite) {
		try {
			otp = detectOneTimeCode({ subject: parsed.subject, text: parsed.text, html: parsed.html });
		} catch (e) {
			console.warn("One-time code detection failed:", (e as Error).message);
		}
	}
	return { otp, invite };
}
