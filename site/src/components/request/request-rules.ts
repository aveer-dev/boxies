// The request form's rules (AVE-81), shared by the browser (request-form.ts) and
// the endpoint (src/lib/requests.ts), so both sides agree on what's valid.
// Ships to the browser: the only import is the contact form's email rule, which
// has no imports of its own.
import { EMAIL_RE } from "../support/contact-rules.ts";

export { EMAIL_RE };

export type RequestKind = "feature" | "bug" | "feedback";
export type RequestPlatform = "web" | "ios" | "android" | "other";

export interface KindInfo {
	value: RequestKind;
	/** The choice on the form. */
	label: string;
	/** Prefixes the Linear issue's title and names it in the confirmation email. */
	noun: string;
	/** The Linear label, besides `user-request`. */
	linearLabel: string;
	titlePlaceholder: string;
	detailsPlaceholder: string;
}

export const KINDS: KindInfo[] = [
	{
		value: "feature",
		label: "Feature request",
		noun: "feature request",
		linearLabel: "feature",
		titlePlaceholder: "Snooze a thread until Monday",
		detailsPlaceholder: "What would you use it for, and how do you get by without it today?",
	},
	{
		value: "bug",
		label: "Bug report",
		noun: "bug report",
		linearLabel: "bug",
		titlePlaceholder: "Search misses mail from last week",
		detailsPlaceholder: "What did you do, what happened, and what did you expect?",
	},
	{
		value: "feedback",
		label: "Feedback",
		noun: "feedback",
		linearLabel: "feedback",
		titlePlaceholder: "The Screener took a while to get used to",
		detailsPlaceholder: "What’s working, what isn’t, or anything else on your mind.",
	},
];

export const PLATFORMS: { value: RequestPlatform; label: string }[] = [
	{ value: "web", label: "Web" },
	{ value: "ios", label: "iPhone" },
	{ value: "android", label: "Android" },
	{ value: "other", label: "Something else" },
];

/** Every request carries this label, so they can be found (and kept off the roadmap, which reads `public-roadmap` only). */
export const REQUEST_LABEL = "user-request";

export const REQUEST_LIMITS = {
	email: 254,
	titleMin: 4,
	titleMax: 120,
	detailsMin: 10,
	detailsMax: 4000,
	// Bots fill the form faster than this (ms since the form appeared).
	minFillTime: 2000,
} as const;

export type RequestField = "kind" | "title" | "details" | "email" | "platform";
export type RequestFieldError = "required" | "format" | "short" | "long";

export const kindInfo = (value: string): KindInfo | undefined => KINDS.find((k) => k.value === value);
export const platformLabel = (value: string): string | undefined => PLATFORMS.find((p) => p.value === value)?.label;

export interface RequestValues {
	kind: string;
	title: string;
	details: string;
	email: string;
	platform: string;
}

/** One field's error, or null. Values are expected trimmed. The platform only counts for bugs. */
export function checkField(field: RequestField, v: RequestValues): RequestFieldError | null {
	switch (field) {
		case "kind":
			return !v.kind ? "required" : kindInfo(v.kind) ? null : "format";
		case "title":
			if (!v.title) return "required";
			if ([...v.title].length < REQUEST_LIMITS.titleMin) return "short";
			return [...v.title].length > REQUEST_LIMITS.titleMax ? "long" : null;
		case "details":
			if (!v.details) return "required";
			if ([...v.details].length < REQUEST_LIMITS.detailsMin) return "short";
			return [...v.details].length > REQUEST_LIMITS.detailsMax ? "long" : null;
		case "email":
			if (!v.email) return "required";
			if (v.email.length > REQUEST_LIMITS.email) return "long";
			return EMAIL_RE.test(v.email) ? null : "format";
		case "platform":
			if (v.kind !== "bug") return null;
			if (!v.platform) return "required";
			return platformLabel(v.platform) ? null : "format";
	}
}

export const REQUEST_FIELDS: RequestField[] = ["kind", "title", "details", "email", "platform"];

/** Every field's error, only the ones that have one. */
export function checkAll(v: RequestValues): Partial<Record<RequestField, RequestFieldError>> {
	const errors: Partial<Record<RequestField, RequestFieldError>> = {};
	for (const f of REQUEST_FIELDS) {
		const e = checkField(f, v);
		if (e) errors[f] = e;
	}
	return errors;
}
