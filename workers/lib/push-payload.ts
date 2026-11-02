// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface PushAlertCopy {
	/** APNs `alert.subtitle` — subject when a body preview is available. */
	subtitle?: string;
	/** APNs `alert.body` — preview text, or subject when no preview. */
	body: string;
	/** FCM `notification.body` — `subject\npreview` when both exist. */
	fcmBody: string;
}

/** Lightweight HTML → plain text for push previews (keeps this module testable). */
function stripToPreview(snippet: string | null | undefined, maxLength = 140): string {
	const text = (snippet ?? "")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Build notification copy: sender stays as title (caller); description is the
 * body preview, with subject kept visible via APNs subtitle / FCM first line.
 * A one-time code (AVE-175) leads the body as "Code 482913 · …" so it can be
 * read without opening the mail; on FCM it leads the first line, which is
 * what a collapsed Android notification shows.
 */
export function composePushAlert(options: {
	subject?: string | null;
	snippet?: string | null;
	oneTimeCode?: string | null;
}): PushAlertCopy {
	const subject = (options.subject ?? "").trim() || "(No subject)";
	const preview = stripToPreview(options.snippet);
	const code = options.oneTimeCode?.trim();
	const lead = (text: string) => (code ? `Code ${code} · ${text}` : text);
	if (!preview) {
		return { body: lead(subject), fcmBody: lead(subject) };
	}
	return {
		subtitle: subject,
		body: lead(preview),
		fcmBody: `${lead(subject)}\n${preview}`,
	};
}
