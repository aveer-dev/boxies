// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Bounce / complaint suppressions on the web client (AVE-83; server AVE-37).
 *
 * A send, reply or forward to a suppressed recipient comes back as
 * `409 { error, code: "recipient_suppressed", suppressed: SuppressedRecipient[] }`.
 * The composer shows each address with its reason and offers Un-suppress
 * (`DELETE /api/v1/mailboxes/:id/suppressions/:address`) followed by a retry.
 */

/** Same value as the server's `RECIPIENT_SUPPRESSED_CODE`. */
export const RECIPIENT_SUPPRESSED_CODE = "recipient_suppressed";

export type SuppressionReason = "hard_bounce" | "complaint";

/** The server's `SuppressionView`. */
export interface SuppressedRecipient {
	address: string;
	domain: string;
	reason: SuppressionReason;
	source: string;
	detail: string | null;
	/** ISO 8601. */
	suppressedAt: string;
	/** False when another mailbox's send caused it and the caller isn't a domain admin. */
	canUnsuppress: boolean;
}

function isSuppressedRecipient(value: unknown): value is SuppressedRecipient {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.address === "string" && v.address.length > 0;
}

/**
 * The suppressed recipients a failed send reports, or null when the error is
 * anything else. Accepts any thrown value (an `ApiError` carries `status` and
 * the parsed JSON `body`).
 */
export function suppressedRecipientsFromError(err: unknown): SuppressedRecipient[] | null {
	if (!err || typeof err !== "object") return null;
	const { status, body } = err as { status?: unknown; body?: unknown };
	if (status !== 409 || !body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	if (b.code !== RECIPIENT_SUPPRESSED_CODE || !Array.isArray(b.suppressed)) return null;
	const list = b.suppressed.filter(isSuppressedRecipient).map((s) => ({
		address: s.address.toLowerCase(),
		domain: typeof s.domain === "string" ? s.domain : "",
		reason: (s.reason === "complaint" ? "complaint" : "hard_bounce") as SuppressionReason,
		source: typeof s.source === "string" ? s.source : "",
		detail: typeof s.detail === "string" && s.detail ? s.detail : null,
		suppressedAt: typeof s.suppressedAt === "string" ? s.suppressedAt : "",
		canUnsuppress: s.canUnsuppress === true,
	}));
	return list.length > 0 ? list : null;
}

/** "Oct 1, 2026" in the viewer's locale; the raw value if it isn't a date. */
export function formatSuppressionDate(iso: string, locale?: string): string {
	const date = new Date(iso);
	if (!iso || Number.isNaN(date.getTime())) return iso;
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

/** "This address bounced on Oct 1, 2026" / "… marked earlier mail as spam on …". */
export function suppressionReasonText(
	s: Pick<SuppressedRecipient, "reason" | "suppressedAt">,
	locale?: string,
): string {
	const when = formatSuppressionDate(s.suppressedAt, locale);
	const on = when ? ` on ${when}` : "";
	return s.reason === "complaint"
		? `This address marked earlier mail as spam${on}`
		: `This address bounced${on}`;
}

/** Short label for a reason, for lists. */
export function suppressionReasonLabel(reason: SuppressionReason): string {
	return reason === "complaint" ? "Marked as spam" : "Bounced";
}

/** Bare, lower-cased address from "Name <a@b>" or "a@b"; null if it isn't one. */
export function bareAddress(value: string): string | null {
	const trimmed = value.trim();
	const angle = trimmed.match(/<([^>]+)>/);
	const addr = (angle ? angle[1] : trimmed).trim().toLowerCase();
	const at = addr.lastIndexOf("@");
	return at > 0 && at < addr.length - 1 ? addr : null;
}

/**
 * The suppressions still among the compose's recipients. Removing an address
 * from To / Cc / Bcc clears its notice without another send attempt.
 */
export function suppressionsStillAddressed(
	suppressed: SuppressedRecipient[],
	recipients: string[],
): SuppressedRecipient[] {
	const current = new Set(
		recipients.map(bareAddress).filter((a): a is string => a !== null),
	);
	return suppressed.filter((s) => current.has(s.address.toLowerCase()));
}

/** API path segment for an address (the server decodes it). */
export function suppressionAddressPath(address: string): string {
	return encodeURIComponent(address.trim().toLowerCase());
}
