// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Outbound send quota per mailbox (AVE-125). The unit is a recipient, not a
 * message: a message to 30 people uses 30. Same numbers on every plan.
 *
 * The windows are sized so the 50-recipient cap (shared/outbound-limits.ts) is
 * usable: one full-size message per hour leaves room for 50 more recipients,
 * and a day holds six full-size messages or 300 one-to-one emails.
 *
 * MailboxDO.checkSendRateLimit reads the `send_log` window sums and asks
 * {@link sendQuotaError} whether this message fits.
 */

export {
	MAX_RECIPIENTS_PER_MESSAGE,
	TOO_MANY_RECIPIENTS_ERROR,
	countRecipients,
	recipientCapError,
	type RecipientField,
} from "../../shared/outbound-limits.ts";

/** Recipients a mailbox may send to in any rolling hour. */
export const SEND_QUOTA_RECIPIENTS_PER_HOUR = 100;
/** Recipients a mailbox may send to in any rolling 24 hours. */
export const SEND_QUOTA_RECIPIENTS_PER_DAY = 300;

/**
 * Whether a message to `recipients` people fits the quota, given the
 * recipients already sent to in the last hour and day. Returns the error to
 * show (429) or null. A message is never split: it fits whole or is refused.
 */
export function sendQuotaError(input: {
	recipients: number;
	usedLastHour: number;
	usedLastDay: number;
}): string | null {
	const recipients = Math.max(1, Math.floor(input.recipients) || 1);
	if (input.usedLastHour + recipients > SEND_QUOTA_RECIPIENTS_PER_HOUR) {
		return quotaMessage("hour", SEND_QUOTA_RECIPIENTS_PER_HOUR, input.usedLastHour, recipients);
	}
	if (input.usedLastDay + recipients > SEND_QUOTA_RECIPIENTS_PER_DAY) {
		return quotaMessage("day", SEND_QUOTA_RECIPIENTS_PER_DAY, input.usedLastDay, recipients);
	}
	return null;
}

function quotaMessage(window: "hour" | "day", limit: number, used: number, recipients: number): string {
	const base = `Rate limit exceeded: max ${limit} recipients per ${window} per mailbox`;
	const left = Math.max(0, limit - used);
	// Say why a message is refused while some quota is still left.
	if (left > 0 && recipients > 1) {
		return `${base} (this message has ${recipients}, ${left} left)`;
	}
	return base;
}
