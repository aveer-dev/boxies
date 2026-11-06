// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One-time codes (AVE-175): find the verification / sign-in code in a
 * message so readers and push notifications can offer it for one-tap copy.
 * Heuristics only, no AI call.
 *
 * A candidate is a 4–8 digit number ("482913", "482 913", "482-913") or a
 * short upper-case token with letters and digits ("K7Q2XP"). It counts when:
 * - strong: it directly follows "code / passcode / OTP / PIN (is|:)", or is
 *   followed by "is your … code" ("482913 is your Google verification code");
 * - weak (digits only, used when there is no strong match): a code keyword
 *   such as "verification", "one-time", "sign in" or "2FA" sits within the
 *   same stretch of text, and no other weak candidate competes.
 *
 * Everything that looks like a number for something else is rejected: the
 * clause before it mentioning an order, invoice, tracking, booking, account
 * number, phone, price, promo / discount / gift / referral code, …; prices
 * ($, decimals, currency words); dates and times; phone and other longer
 * digit groups; years in weak matches; US ZIP codes after a state.
 */

import type { EmailOtp } from "../../shared/mail-cards.ts";

export interface OneTimeCodeInput {
	subject?: string | null;
	text?: string | null;
	html?: string | null;
}

const MAX_BODY_CHARS = 8000;

/** The message is about a code at all. */
const CODE_TOPIC =
	/\b(?:code|passcode|pass code|otp|one[-\s]?time|verification|verify|2fa|two[-\s]?(?:factor|step)|mfa|multi[-\s]?factor|sign[-\s]?in|log[-\s]?in|security pin)\b/i;

/** Keywords strong enough on their own to anchor a weak (nearby) match. */
const OTP_KEYWORD =
	/\b(?:verification|verify|one[-\s]?time|otp|passcode|pass code|security code|login code|log[-\s]?in code|sign[-\s]?in code|2fa|two[-\s]?(?:factor|step)|mfa|multi[-\s]?factor|authentication code|access code|confirm(?:ation)? code)\b/gi;

/** "code is" / "OTP:" / "passcode (OTP) is" right before the candidate. */
const STRONG_BEFORE =
	/(?:code|passcode|pass code|otp|pin|password|token)\b(?:(?:\s+[a-z'’-]+){1,8}?\s*(?:is|was|:)|[^A-Za-z0-9\n]{0,6}(?:\(?otp\)?[^A-Za-z0-9\n]{0,4})?(?:(?:is|was|below|here)\b)?)[^A-Za-z0-9]{0,4}$/i;

/** "… is your Acme verification code" right after the candidate. */
const STRONG_AFTER =
	/^[^A-Za-z0-9\n]{0,3}(?:is|as)\s+(?:your|the)\s+(?:[\w'’.-]+\s+){0,4}?(?:code|passcode|otp|pin)\b/i;

/** Clause before the candidate says it's a number for something else. */
const NEGATIVE_BEFORE = new RegExp(
	[
		"\\border\\b",
		"\\binvoice",
		"\\btracking",
		"\\bshipment",
		"\\bparcel",
		"\\bpackage",
		"\\bref(?:erence)?\\b",
		"\\bticket",
		"\\bcase (?:no|number|id|#)",
		"\\bbooking",
		"\\breservation",
		"\\bitinerary",
		"\\bflight",
		"\\bconfirmation (?:no|number|#)",
		"\\baccount (?:no|number|#|ending)",
		"\\bacct\\b",
		"\\b(?:member(?:ship)?|customer|client|employee|student) (?:no|number|id|#)",
		"\\bzip\\b",
		"\\bpostal",
		"\\bpost ?code",
		"\\bpin ?code",
		"\\bsuite\\b",
		"\\bapt\\b",
		"\\bcard ending",
		"\\bending (?:in|with)",
		"\\bends in",
		"\\blast (?:4|four)",
		"\\bphone",
		"\\btel\\b",
		"\\bcall\\b",
		"\\bfax\\b",
		"\\bmobile\\b",
		"\\bwhatsapp",
		"\\bsent to\\s*\\+?\\(?$",
		"\\btext \\w+ to\\b",
		"\\bsku\\b",
		"\\bitem\\b",
		"\\bmodel\\b",
		"\\bserial",
		"\\breceipt",
		"\\btransaction",
		"\\btxn\\b",
		"\\bloan\\b",
		"\\bpolicy (?:no|number|#)",
		"\\bclaim",
		"\\broom\\b",
		"\\bgate\\b",
		"\\bseat\\b",
		"\\bpromo",
		"%\\s*off\\b",
		"\\bsale\\b",
		"\\bshop\\b",
		"\\bcheckout",
		"\\bdiscount",
		"\\bcoupon",
		"\\bvoucher",
		"\\bgift",
		"\\breferral",
		"\\breward",
		"\\binvit(?:e|ation) code",
		"\\bprice",
		"\\btotal\\b",
		"\\bamount",
		"\\bbalance",
		"\\bsubtotal",
		"\\bqty\\b",
		"\\bquantity",
		"\\bext\\.?\\b",
		"\\bextension",
		"\\bunsubscribe",
		"\\b(?:usd|eur|gbp|ngn|inr|cad|aud|rs\\.?|kes|ghs|zar)\\s*$",
		"[$€£¥₦₹]\\s*$",
		"#\\s*$",
		"\\bno\\.\\s*$",
		",\\s*[A-Z]{2}\\s*$",
	].join("|"),
	"i",
);

/** Text right after the candidate makes it a price, discount or measure. */
const NEGATIVE_AFTER =
	/^[^\S\n]*(?:%|\boff\b|(?:usd|eur|gbp|ngn|inr|naira|dollars?|euros?|pounds?)\b|(?:km|mi|kg|lbs?|mb|gb|ms|px)\b|(?:[^.\n!?]{0,40}?(?:%\s*off|\boff your|\bdiscount|\bcheckout|\bat check-out|\bshop\b|\bstore\b|\bpurchase)))/i;

const CANDIDATE = /(?<![A-Za-z0-9])(\d{3}[ -]\d{3}|[A-Z0-9]{4,8})(?![A-Za-z0-9])/g;

function htmlToText(html: string): string {
	return html
		.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(?:p|div|td|th|tr|li|h[1-6]|table|section|center|blockquote)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;|&#160;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
		.replace(/&[a-z]+;/gi, " ");
}

function normalize(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[​-‍﻿]/g, "")
		.replace(/[ \t ]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{3,}/g, "\n\n");
}

/** Text of the clause around `index`: back to the previous sentence break, capped. */
function clauseBefore(text: string, index: number, max = 60): string {
	const window = text.slice(Math.max(0, index - max), index);
	const breaks = [...window.matchAll(/[.!?](?:\s|$)|\n\n/g)];
	const last = breaks[breaks.length - 1];
	return last ? window.slice(last.index! + last[0].length) : window;
}

interface Candidate {
	code: string;
	index: number;
	strong: boolean;
	weak: boolean;
	/** Distance to the nearest OTP keyword, for ranking weak matches. */
	distance: number;
}

function adjacentRejects(text: string, start: number, end: number): boolean {
	const prev = text[start - 1] ?? "";
	const prev2 = text[start - 2] ?? "";
	const next = text[end] ?? "";
	const next2 = text[end + 1] ?? "";
	// Google's SMS-style "G-482913" is a code; any other prefix glued on makes
	// it part of a URL, email, path, hashtag, price, version, date or time.
	const googleStyle = prev === "-" && prev2 === "G" && !/[A-Za-z0-9]/.test(text[start - 3] ?? "");
	if (!googleStyle) {
		if (/[$€£¥₦₹#+/\\@_=&?~%]/.test(prev)) return true;
		if (/[.:,-]/.test(prev) && /[A-Za-z0-9]/.test(prev2)) return true;
	}
	if (/[/\\@_%=&]/.test(next)) return true;
	if (/[.:,-]/.test(next) && /[A-Za-z0-9]/.test(next2)) return true;
	// One group of a longer number: "(555) 019 2834", "4111 1111 1111".
	const before = text.slice(Math.max(0, start - 4), start);
	const after = text.slice(end, end + 4);
	if (/\d[\s).-]{1,2}$/.test(before) || /^[\s(.-]{1,2}\d/.test(after)) return true;
	return false;
}

function isYear(code: string): boolean {
	return /^(?:19|20)\d{2}$/.test(code);
}

function nearestKeywordDistance(text: string, start: number, end: number): number {
	let best = Number.POSITIVE_INFINITY;
	OTP_KEYWORD.lastIndex = 0;
	for (const match of text.matchAll(OTP_KEYWORD)) {
		const kStart = match.index!;
		const kEnd = kStart + match[0].length;
		// Same paragraph only.
		const between = kEnd <= start ? text.slice(kEnd, start) : text.slice(end, kStart);
		if (/\n\s*\n[\s\S]*\n\s*\n/.test(between)) continue;
		const distance = kEnd <= start ? start - kEnd : kStart - end;
		if (distance >= 0 && distance < best) best = distance;
	}
	return best;
}

function candidatesIn(text: string): Candidate[] {
	const out: Candidate[] = [];
	for (const match of text.matchAll(CANDIDATE)) {
		const raw = match[1];
		const start = match.index!;
		const end = start + raw.length;
		const code = raw.replace(/[ -]/g, "");
		const numeric = /^\d+$/.test(code);
		if (!numeric) {
			// Alphanumeric codes need letters and digits ("K7Q2XP"); plain words
			// in capitals ("HTTPS", "FAQ") and bare numbers are handled above.
			if (!/\d/.test(code) || !/[A-Z]/.test(code)) continue;
			if (code.length < 5) continue;
		}
		if (adjacentRejects(text, start, end)) continue;

		const clause = clauseBefore(text, start);
		if (NEGATIVE_BEFORE.test(clause)) continue;
		const following = text.slice(end, end + 60);
		if (NEGATIVE_AFTER.test(following)) continue;

		const preceding = text.slice(Math.max(0, start - 60), start);
		const strong = STRONG_BEFORE.test(preceding) || STRONG_AFTER.test(following);
		let weak = false;
		let distance = Number.POSITIVE_INFINITY;
		if (!strong && numeric && !isYear(code)) {
			distance = nearestKeywordDistance(text, start, end);
			weak = distance <= 80;
		}
		if (strong || weak) out.push({ code, index: start, strong, weak, distance });
	}
	return out;
}

/**
 * The one-time code in a message, or null. Callers decide whether the
 * message is eligible at all (see shared/mail-cards.ts mailCardsAllowed).
 */
export function detectOneTimeCode(input: OneTimeCodeInput): EmailOtp | null {
	const subject = normalize(input.subject ?? "").replace(/\n/g, " ").trim();
	const bodySource = input.text?.trim() ? input.text : input.html ? htmlToText(input.html) : "";
	const body = normalize(bodySource).slice(0, MAX_BODY_CHARS).trim();
	if (!subject && !body) return null;
	if (!CODE_TOPIC.test(subject) && !CODE_TOPIC.test(body)) return null;

	// Subject and body are separate paragraphs so keywords don't leak across.
	const text = `${subject}\n\n\n${body}`;
	const candidates = candidatesIn(text);

	// Candidates come in reading order, so the subject's code wins, then the
	// first one in the body.
	const strong = candidates.find((c) => c.strong);
	if (strong) return { code: strong.code };

	const weak = candidates.filter((c) => c.weak);
	if (weak.length === 0) return null;
	const distinct = new Set(weak.map((c) => c.code));
	// Several unrelated numbers near a keyword: too ambiguous to offer.
	if (distinct.size > 1) return null;
	return { code: weak[0].code };
}
