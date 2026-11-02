/**
 * One-time code detection (AVE-175): realistic 2FA / sign-in mail finds the
 * code; receipts, orders, shipping, phone numbers and promo codes don't.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/one-time-code.test.mjs
 */

import assert from "node:assert/strict";
import { detectOneTimeCode } from "../lib/one-time-code.ts";
import { detectMailCards } from "../lib/mail-cards.ts";
import { mailCardsAllowed } from "../../shared/mail-cards.ts";

function code(input) {
	return detectOneTimeCode(input)?.code ?? null;
}

// ── Positives ────────────────────────────────────────────────────

const positives = [
	{
		name: "Google verification (SMS-style subject)",
		input: {
			subject: "G-482913 is your Google verification code",
			text: "Google\n\nUse this code to finish setting up your account.\n\n482913\n\nThis code will expire in 10 minutes.",
		},
		expected: "482913",
	},
	{
		name: "Google account verification HTML",
		input: {
			subject: "Email verification code",
			html: `<html><body><table><tr><td><img src="https://www.gstatic.com/logo.png" alt="Google"></td></tr>
				<tr><td><h1>Verify your email</h1></td></tr>
				<tr><td>Google received a request to use <b>pat@example.com</b> as a recovery email for Google Account pat.lee@gmail.com.</td></tr>
				<tr><td>Use this code to finish setting up this recovery email:</td></tr>
				<tr><td style="font-size:36px;letter-spacing:4px"><b>739104</b></td></tr>
				<tr><td>This code will expire 24 hours after this email was sent.</td></tr>
				<tr><td>© 2026 Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA</td></tr></table></body></html>`,
		},
		expected: "739104",
	},
	{
		name: "GitHub device verification",
		input: {
			subject: "[GitHub] Please verify your device",
			text: [
				"Hey octocat!",
				"",
				"A sign in attempt requires further verification because we did not recognize your device. To complete the sign in, enter the verification code on the unrecognized device.",
				"",
				"Device: Chrome on macOS",
				"Verification code: 204815",
				"",
				"If you did not attempt to sign in to your account, your password may be compromised. Visit https://github.com/settings/security to create a new, strong password for your GitHub account.",
				"",
				"Thanks,",
				"The GitHub Team",
			].join("\n"),
		},
		expected: "204815",
	},
	{
		name: "Apple ID verification",
		input: {
			subject: "Verify your Apple Account email address",
			text: "Verify your email address.\n\nYou've selected this email address as your new Apple Account. To verify this email address belongs to you, enter the code below on the email verification page:\n\n583920\n\nThis code will expire three hours after this email was sent.\n\nWhy you received this email.\nApple requires verification whenever an email address is selected as an Apple Account.\n\nApple Support\nOne Apple Park Way, Cupertino, CA 95014",
		},
		expected: "583920",
	},
	{
		name: "Microsoft account security code",
		input: {
			subject: "Microsoft account security code",
			text: "Microsoft account\n\nSecurity code\n\nPlease use the following security code for the Microsoft account pa***@example.com.\n\nSecurity code: 6194\n\nIf you don't recognize the Microsoft account pa***@example.com, you can click here to remove your email address from that account.\n\nThanks,\nThe Microsoft account team",
		},
		expected: "6194",
	},
	{
		name: "Bank one-time passcode",
		input: {
			subject: "Your one-time passcode",
			text: "Dear Customer,\n\nYour one-time passcode (OTP) is 48291375. It is valid for 5 minutes. Never share this code with anyone, including bank staff.\n\nIf you did not request this, call us on +44 20 7946 0958.\n\nAccount ending in 4421.\n\nNorthwind Bank plc",
		},
		expected: "48291375",
	},
	{
		name: "Slack-style alphanumeric confirmation code",
		input: {
			subject: "Confirm your email address",
			text: "Confirm your email address\n\nEnter it in your open browser window and we'll help you get signed in. Your confirmation code:\n\nK7Q2XP\n\nIf you didn't request this email, there's nothing to worry about.",
		},
		expected: "K7Q2XP",
	},
	{
		name: "Spaced six digits",
		input: {
			subject: "Your login code",
			text: "Here is your login code: 482 913\nIt expires in 15 minutes.",
		},
		expected: "482913",
	},
	{
		name: "Code is sentence after code",
		input: {
			subject: "Sign in to Acme",
			text: "Hi Pat,\n\n551204 is your Acme sign-in code. Don't share it with anyone.",
		},
		expected: "551204",
	},
	{
		name: "Weak: keyword in subject, code alone in body",
		input: {
			subject: "Two-factor authentication",
			text: "Enter 902114 to continue.\n\nAcme Inc.",
		},
		expected: "902114",
	},
];

for (const { name, input, expected } of positives) {
	assert.equal(code(input), expected, name);
}

// ── Negatives ────────────────────────────────────────────────────

const negatives = [
	{
		name: "Order confirmation",
		input: {
			subject: "Your Amazon.com order #112-4829135-1234567 has shipped",
			text: "Hello Pat,\n\nYour order code is 48291. Order total: $45.99\nArriving Tuesday, November 4.\n\nTrack your package: tracking number 1Z999AA10123456784\n\nQuestions? Call 1-888-280-4331.",
		},
	},
	{
		name: "Receipt with prices",
		input: {
			subject: "Your receipt from Blue Bottle Coffee",
			text: "Receipt #2049-1182\nLatte 5.50\nCroissant 4.25\nTotal $9.75\nPaid with Visa ending in 4242\nAuth code 0123 approved on 11/01/2026 09:42",
		},
	},
	{
		name: "Shipping tracking",
		input: {
			subject: "Your package is on the way",
			text: "Good news! Your shipment is on its way.\nTracking code: 92748901\nCarrier: USPS\nEstimated delivery: 2026-11-05\nShip to: 123 Main St, Springfield, IL 62704",
		},
	},
	{
		name: "Promo code newsletter",
		input: {
			subject: "20% off this weekend only — use code SAVE20",
			text: "Treat yourself! Use code SAVE20 at checkout for 20% off.\n\nPromo code: WELCOME15\n\nYour discount code is 482913.\n\nOffer ends 11/03. Unsubscribe.",
		},
	},
	{
		name: "Referral and gift codes",
		input: {
			subject: "You've got a gift!",
			text: "Your gift code: GFT8K2Q9\nYour referral code is RFR2026X. Share it with friends.",
		},
	},
	{
		name: "Phone numbers and support line",
		input: {
			subject: "Verify your phone number",
			text: "We'll call you at (415) 555-0132 shortly. If you need help, call our support line 0800 123 4567 or text HELP to 72345.",
		},
	},
	{
		name: "Newsletter talking about code",
		input: {
			subject: "This week in code review",
			text: "In 2026 we merged 4213 pull requests. Read about how we shipped version 3.2 with 1500 fewer lines of code.",
		},
	},
	{
		name: "Invoice",
		input: {
			subject: "Invoice INV-20481 for October",
			text: "Invoice number 20481\nAmount due: 1200 USD\nDue date: November 15, 2026\nUse reference code 778812 when paying.",
		},
	},
	{
		name: "Flight booking confirmation code",
		input: {
			subject: "Your trip confirmation",
			text: "Your booking confirmation code is KXJ4TR. Flight UA 1234 departs 08:45 from SFO, gate 52.",
		},
	},
	{
		name: "Ambiguous: two numbers near a keyword",
		input: {
			subject: "Verification",
			text: "Verification of your 2 accounts: 482913 and 559102 were updated.",
		},
	},
	{
		name: "Plain personal mail",
		input: {
			subject: "Lunch on Friday?",
			text: "Hey! Want to grab lunch Friday at 12:30? I'm at 4100 Market St.",
		},
	},
	{
		name: "Year only",
		input: {
			subject: "Verify your account",
			text: "Welcome! Please verify your email to finish signing up. © 2026 Acme Inc.",
		},
	},
];

for (const { name, input } of negatives) {
	assert.equal(code(input), null, name);
}

assert.equal(detectOneTimeCode({}), null);
assert.equal(detectOneTimeCode({ subject: "", text: "", html: "" }), null);

// ── Inbound wrapper and gating ───────────────────────────────────

{
	const ics = [
		"BEGIN:VCALENDAR",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		"SUMMARY:Vendor review",
		"DTSTART:20261103T170000Z",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");
	// A Teams invite's "Passcode: …" is a meeting passcode, not a sign-in code.
	const cards = detectMailCards({
		subject: "Invitation: Vendor review",
		text: "Microsoft Teams meeting\nMeeting ID: 245 123 456 789\nPasscode: Xy7Bq2",
		attachments: [{ filename: "invite.ics", mimeType: "text/calendar", method: "REQUEST", content: new TextEncoder().encode(ics) }],
	});
	assert.equal(cards.invite?.title, "Vendor review");
	assert.equal(cards.otp, null);

	const otpOnly = detectMailCards({ subject: "Your verification code", text: "Your code is 482913.", attachments: [] });
	assert.deepEqual(otpOnly, { otp: { code: "482913" }, invite: null });
}

assert.equal(mailCardsAllowed({ folder_id: "inbox", auth_tier: "verified" }), true);
assert.equal(mailCardsAllowed({ folder_id: "updates", auth_tier: "unverified" }), true);
assert.equal(mailCardsAllowed({ folder_id: "inbox", auth_tier: null }), true);
assert.equal(mailCardsAllowed({ folder_id: "spam", auth_tier: "verified" }), false);
assert.equal(mailCardsAllowed({ folder_id: "inbox", auth_tier: "failed" }), false);

console.log("one-time-code: ok");
