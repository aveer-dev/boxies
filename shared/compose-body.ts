// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Compose-body helpers shared by web and tests.
 */

function stripTags(html: string): string {
	return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Whether compose HTML has user-authored text beyond empty paragraphs and the
 * mailbox signature. Signature-only bodies should not trigger draft saves.
 */
export function composeBodyHasUserContent(
	bodyHtml: string,
	signatureHtml = "",
): boolean {
	const bodyText = stripTags(bodyHtml);
	if (!bodyText) return false;
	const signatureText = stripTags(signatureHtml);
	if (!signatureText) return true;
	if (bodyText === signatureText) return false;
	if (!bodyText.includes(signatureText)) return true;
	return bodyText.replace(signatureText, "").replace(/\s+/g, " ").trim().length > 0;
}
