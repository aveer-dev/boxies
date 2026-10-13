// The contact form's rules, shared by the browser (contact-form.ts) and the
// endpoint (pages/api/contact.ts), so both sides agree on what's valid.
// No imports: this file ships to the browser.

// Deliberately loose: something@something.tld, with none of the characters
// that could break out of a mail header. Printable ASCII only: the address
// goes into Reply-To as is, and a header can't carry control characters or
// accents without encoding.
export const EMAIL_RE = /^(?=[\x21-\x7e]+$)[^@<>(),;:"\\]+@[^@<>(),;:"\\]+\.[^@<>(),;:"\\]+$/;

export const LIMITS = {
	email: 254,
	name: 100,
	messageMin: 10,
	messageMax: 5000,
	// Bots fill the form faster than this (ms since the form appeared).
	minFillTime: 2000,
} as const;

export type FieldName = "email" | "name" | "topic" | "mailbox" | "message";
export type FieldError = "required" | "format" | "short" | "long";
