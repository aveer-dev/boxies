/**
 * Authentication-Results / ARC parser, spoof classification, from-filter gating.
 * Run: node --experimental-strip-types workers/test/email-auth.test.mjs
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	domainFromAddress,
	authTierOf,
	domainsAligned,
	isAuthFailed,
	isFromUntrusted,
	isTrustedAuthserv,
	mergeTrustedAuthHeaders,
	parseAuthSignals,
	parseAuthenticationResultsValue,
	parseStoredEmailAuth,
	serializeEmailAuth,
} from "../lib/email-auth.ts";
import {
	classifyFromHeaders,
	shouldAutoDraft,
} from "../lib/classify-email.ts";
import { applyInboxFilters, parseInboxFilters } from "../lib/inbox-filters.ts";
import PostalMime from "postal-mime";

function headers(...pairs) {
	return pairs.map(([key, value]) => ({ key, value }));
}

const CF_PASS =
	"mx.cloudflare.net; dkim=pass header.d=paypal.com header.s=s1; spf=pass smtp.mailfrom=notify@paypal.com; dmarc=pass header.from=paypal.com";

const CF_FAIL =
	"mx.cloudflare.net; dkim=fail header.d=evil.example; spf=fail smtp.mailfrom=spoof@evil.example; dmarc=fail header.from=paypal.com";

const CF_DKIM_PASS_SPF_FAIL =
	"mx.cloudflare.net; dkim=pass header.d=shop.example; spf=fail smtp.mailfrom=bounce@forwarder.example; dmarc=pass header.from=shop.example";

const ARC_FAIL =
	"i=1; mx.cloudflare.net; dkim=fail header.d=evil.example; dmarc=fail header.from=paypal.com; spf=fail smtp.mailfrom=bad@evil.example; arc=none";

const GMAIL_ARC_NONE = "i=1; mx.google.com; arc=none";

const ATTACKER_PASS =
	"evil.example; dkim=pass header.d=paypal.com; spf=pass smtp.mailfrom=notify@paypal.com; dmarc=pass header.from=paypal.com";

assert.equal(isTrustedAuthserv("mx.cloudflare.net"), true);
assert.equal(isTrustedAuthserv("email.cloudflare.net"), true);
assert.equal(isTrustedAuthserv("cloudflare.net"), true);
assert.equal(isTrustedAuthserv("mx.google.com"), false);
assert.equal(isTrustedAuthserv("evil.example"), false);

assert.equal(domainsAligned("paypal.com", "paypal.com"), true);
assert.equal(domainsAligned("notify.paypal.com", "paypal.com"), true);
assert.equal(domainsAligned("paypal.com", "mail.paypal.com"), true);
assert.equal(domainsAligned("paypal.com", "evil.example"), false);
assert.equal(domainFromAddress("PayPal <notify@paypal.com>"), "paypal.com");
assert.equal(domainFromAddress("@paypal.com"), "paypal.com");

{
	const parsed = parseAuthenticationResultsValue(CF_PASS);
	assert.equal(parsed?.authserv, "mx.cloudflare.net");
	assert.equal(parsed?.methods.find((m) => m.method === "dkim")?.result, "pass");
	assert.equal(
		parsed?.methods.find((m) => m.method === "dkim")?.properties["header.d"],
		"paypal.com",
	);
}

{
	const parsed = parseAuthenticationResultsValue(ARC_FAIL);
	assert.equal(parsed?.authserv, "mx.cloudflare.net");
	assert.equal(parsed?.methods.find((m) => m.method === "dmarc")?.result, "fail");
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_PASS]),
		headerFrom: "PayPal <notify@paypal.com>",
		envelopeFrom: "notify@paypal.com",
	});
	assert.equal(auth.source, "authentication-results");
	assert.equal(auth.dkim, "pass");
	assert.equal(auth.spf, "pass");
	assert.equal(auth.dmarc, "pass");
	assert.equal(auth.aligned, true);
	assert.equal(auth.spoofed, false);
	assert.equal(auth.dkimDomain, "paypal.com");
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers(["ARC-Authentication-Results", ARC_FAIL]),
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "bad@evil.example",
	});
	assert.equal(auth.source, "arc-authentication-results");
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.aligned, false);
	assert.equal(auth.spoofed, true);
}

{
	const auth = parseAuthSignals({
		mimeHeaders: headers(["Authentication-Results", ATTACKER_PASS]),
		headerFrom: "PayPal <notify@paypal.com>",
		envelopeFrom: "attacker@evil.example",
	});
	assert.equal(auth.source, "none");
	assert.equal(auth.spoofed, false);
	assert.equal(auth.aligned, null);
}

{
	const auth = parseAuthSignals({
		mimeHeaders: headers(["ARC-Authentication-Results", GMAIL_ARC_NONE]),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assert.equal(auth.source, "none");
	assert.equal(auth.spoofed, false);
}

{
	const auth = parseAuthSignals({
		headerFrom: "ada@example.com",
		envelopeFrom: "other@forwarder.example",
	});
	assert.equal(auth.source, "none");
	assert.equal(auth.spoofed, false);
	assert.equal(auth.aligned, null);
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_DKIM_PASS_SPF_FAIL]),
		headerFrom: "orders@shop.example",
		envelopeFrom: "bounce@forwarder.example",
	});
	assert.equal(auth.dkim, "pass");
	assert.equal(auth.spf, "fail");
	assert.equal(auth.aligned, true);
	assert.equal(auth.spoofed, false);
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Received-SPF",
			"pass (mx.cloudflare.net: domain of ada@example.com) envelope-from=ada@example.com",
		]),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assert.equal(auth.spf, "pass");
	assert.equal(auth.source, "none");
	assert.equal(auth.spoofed, false);
}

{
	const merged = mergeTrustedAuthHeaders(
		headers(["From", "Ada <ada@example.com>"]),
		headers(["Authentication-Results", CF_PASS]),
	);
	assert.equal(
		merged.some(
			(h) =>
				(h.key || "").toLowerCase() === "authentication-results" &&
				h.value === CF_PASS,
		),
		true,
	);
	const skipped = mergeTrustedAuthHeaders(
		headers(["From", "Ada <ada@example.com>"]),
		headers(["Authentication-Results", ATTACKER_PASS]),
	);
	assert.equal(
		skipped.some((h) => (h.key || "").toLowerCase() === "authentication-results"),
		false,
	);
}

{
	const stored = serializeEmailAuth(
		parseAuthSignals({
			envelopeHeaders: headers(["Authentication-Results", CF_FAIL]),
			headerFrom: "service@paypal.com",
			envelopeFrom: "spoof@evil.example",
		}),
	);
	const roundTrip = parseStoredEmailAuth(stored);
	assert.equal(roundTrip?.spoofed, true);
	assert.equal(roundTrip?.authTier, "failed");
	assert.equal(roundTrip?.source, "authentication-results");
}

{
	const spoofed = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_FAIL]),
		headerFrom: "CEO <ceo@paypal.com>",
		envelopeFrom: "spoof@evil.example",
	});
	const result = classifyFromHeaders({
		headers: headers(["From", "CEO <ceo@paypal.com>"]),
		subject: "Wire this invoice",
		sender: "ceo@paypal.com",
		auth: spoofed,
	});
	assert.deepEqual(result, {
		class: "spam",
		folderId: Folders.SPAM,
		reason: "auth-failed",
	});
	assert.equal(shouldAutoDraft(result, spoofed), false);
}

{
	const spoofed = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_FAIL]),
		headerFrom: "deals@paypal.com",
		envelopeFrom: "spoof@evil.example",
	});
	const result = classifyFromHeaders({
		headers: headers(["List-Id", "<news.paypal.com>"]),
		subject: "This week's deals",
		sender: "deals@paypal.com",
		auth: spoofed,
	});
	assert.equal(result?.class, "bulk");
	assert.equal(result?.folderId, Folders.PROMOTIONS);
	assert.equal(isAuthFailed(spoofed), true);
}

{
	const unknown = parseAuthSignals({
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	const result = classifyFromHeaders({
		headers: headers(["From", "Ada <ada@example.com>"]),
		subject: "Lunch",
		sender: "ada@example.com",
		auth: unknown,
	});
	assert.equal(result, null);
	assert.equal(
		shouldAutoDraft(
			{ class: "ham", folderId: "inbox", reason: "personal-ham" },
			unknown,
		),
		true,
	);
}

{
	const spoofed = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_FAIL]),
		headerFrom: "boss@paypal.com",
		envelopeFrom: "spoof@evil.example",
	});
	const rules = parseInboxFilters([
		{
			id: "paypal",
			from: "@paypal.com",
			folderId: "archive",
			forwardTo: "backup@example.com",
		},
	]);
	assert.equal(
		applyInboxFilters(rules, {
			sender: "boss@paypal.com",
			subject: "Invoice",
			headers: [],
			auth: spoofed,
		}),
		null,
	);
}

{
	const unknown = parseAuthSignals({
		headerFrom: "boss@paypal.com",
		envelopeFrom: "boss@paypal.com",
	});
	const rules = parseInboxFilters([
		{
			id: "paypal",
			from: "@paypal.com",
			folderId: "archive",
		},
	]);
	const hit = applyInboxFilters(rules, {
		sender: "boss@paypal.com",
		subject: "Invoice",
		headers: [],
		auth: unknown,
	});
	assert.equal(hit?.folderId, "archive");
}

{
	const spoofed = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_FAIL]),
		headerFrom: "list@news.example",
		envelopeFrom: "spoof@evil.example",
	});
	const rules = parseInboxFilters([
		{
			id: "lists",
			list: "*",
			folderId: "promotions",
		},
	]);
	const hit = applyInboxFilters(rules, {
		sender: "list@news.example",
		subject: "Weekly",
		headers: headers(["List-Unsubscribe", "<mailto:u@example.com>"]),
		auth: spoofed,
	});
	assert.equal(hit?.folderId, "promotions");
}

const CF_BLOG_ARC =
	"i=1; mx.cloudflare.net; dkim=pass header.d=cloudflare.com header.s=example09082023 header.b=IRdayjbb; dmarc=pass header.from=example.com policy.dmarc=reject; spf=none (mx.cloudflare.net: no SPF records found for postmaster@example.com) smtp.helo=smtp.example.com; spf=pass (mx.cloudflare.net: domain of joe@example.com designates 2a00:1440:4824:20::32e as permitted sender) smtp.mailfrom=joe@example.com; arc=none smtp.remote-ip=2a00:1440:4824:20::32e";

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers(["ARC-Authentication-Results", CF_BLOG_ARC]),
		headerFrom: "Joe <joe@example.com>",
		envelopeFrom: "joe@example.com",
	});
	assert.equal(auth.source, "arc-authentication-results");
	assert.equal(auth.dkim, "pass");
	assert.equal(auth.spf, "pass");
	assert.equal(auth.dmarc, "pass");
	assert.equal(auth.spfMailfrom, "joe@example.com");
	assert.equal(auth.aligned, true);
	assert.equal(auth.spoofed, false);
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"ARC-Authentication-Results",
			"i=1; mx.cloudflare.net; arc=none",
		]),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assert.equal(auth.source, "arc-authentication-results");
	assert.equal(auth.aligned, null);
	assert.equal(auth.spoofed, false);
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=none; spf=none; dmarc=none",
		]),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assert.equal(auth.dkim, "none");
	assert.equal(auth.aligned, null);
	assert.equal(auth.spoofed, false);
}

{
	const getOnly = {
		get(name) {
			return name.toLowerCase() === "arc-authentication-results"
				? CF_BLOG_ARC
				: null;
		},
	};
	const auth = parseAuthSignals({
		envelopeHeaders: getOnly,
		headerFrom: "joe@example.com",
		envelopeFrom: "joe@example.com",
	});
	assert.equal(auth.source, "arc-authentication-results");
	assert.equal(auth.dmarc, "pass");
	assert.equal(auth.spoofed, false);
	const merged = mergeTrustedAuthHeaders(
		headers(["From", "Joe <joe@example.com>"]),
		getOnly,
	);
	assert.equal(
		merged.some(
			(h) =>
				(h.key || "").toLowerCase() === "arc-authentication-results" &&
				h.value === CF_BLOG_ARC,
		),
		true,
	);
}

{
	const getAllHeaders = {
		get(name) {
			const all = this.getAll(name);
			return all.length ? all.join(", ") : null;
		},
		getAll(name) {
			if (name.toLowerCase() !== "authentication-results") return [];
			return [ATTACKER_PASS, CF_PASS];
		},
	};
	const auth = parseAuthSignals({
		envelopeHeaders: getAllHeaders,
		headerFrom: "PayPal <notify@paypal.com>",
		envelopeFrom: "notify@paypal.com",
	});
	assert.equal(auth.source, "authentication-results");
	assert.equal(auth.dmarc, "pass");
	assert.equal(auth.spoofed, false);
}

{
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=pass header.i=@paypal.com",
		]),
		headerFrom: "notify@paypal.com",
		envelopeFrom: "notify@paypal.com",
	});
	assert.equal(auth.dkimDomain, "paypal.com");
	assert.equal(auth.aligned, true);
	assert.equal(auth.spoofed, false);
}

{
	const raw = [
		"From: Joe <joe@example.com>",
		"To: you@inboxies.email",
		"Subject: Hello",
		`ARC-Authentication-Results: ${CF_BLOG_ARC}`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Hi",
	].join("\r\n");
	const parsed = await PostalMime.parse(raw);
	const auth = parseAuthSignals({
		mimeHeaders: parsed.headers,
		headerFrom: parsed.from?.address,
		envelopeFrom: "joe@example.com",
	});
	assert.equal(auth.source, "arc-authentication-results");
	assert.equal(auth.dmarc, "pass");
	assert.equal(auth.spf, "pass");
	assert.equal(auth.aligned, true);
	assert.equal(auth.spoofed, false);
}

{
	// Our MX prepends its verdict on top; a sender can append a forged
	// "cloudflare.net ... dmarc=pass" lower down. The topmost trusted one wins.
	const auth = parseAuthSignals({
		envelopeHeaders: headers(
			["Authentication-Results", CF_FAIL],
			["Authentication-Results", CF_PASS],
		),
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "spoof@evil.example",
	});
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.spoofed, true);
}

// ── Forgery via merged or mixed headers ──────────────────────────
{
	// workerd's Headers.get joins duplicates with ", ". A forged
	// "cloudflare.net; dmarc=pass" lower in the message must not merge into ours.
	const FORGED_CF_PASS = CF_PASS.replace("mx.cloudflare.net", "fake.cloudflare.net");
	const joinedOnly = {
		get(name) {
			return name.toLowerCase() === "authentication-results" ? `${CF_FAIL}, ${FORGED_CF_PASS}` : null;
		},
	};
	const auth = parseAuthSignals({
		envelopeHeaders: joinedOnly,
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "spoof@evil.example",
	});
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.spoofed, true, "a joined forged pass can't flip our fail");
}

{
	// If we can't tell which results header our hop wrote, the stricter wins.
	const auth = parseAuthSignals({
		envelopeHeaders: headers(
			["ARC-Authentication-Results", `i=1; ${CF_FAIL}`],
			["Authentication-Results", CF_PASS],
		),
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "spoof@evil.example",
	});
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.spoofed, true);
}

{
	// A DMARC pass for some other domain doesn't vouch for the From shown.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=pass header.d=evil.example; spf=pass smtp.mailfrom=x@evil.example; dmarc=pass header.from=evil.example",
		]),
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "x@evil.example",
	});
	assert.equal(auth.aligned, false);
	assert.equal(auth.spoofed, true);
}

{
	// With delivery headers present, the sender's own MIME headers are never consulted.
	const auth = parseAuthSignals({
		envelopeHeaders: headers(["Subject", "hi"]),
		mimeHeaders: [{ key: "authentication-results", value: CF_PASS }],
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "spoof@evil.example",
	});
	assert.equal(auth.source, "none");
	assert.notEqual(auth.aligned, true);
}

// ── Auth tiers (AVE-92) ──────────────────────────────────────────
{
	// Aligned pass → verified.
	const auth = parseAuthSignals({
		envelopeHeaders: headers(["Authentication-Results", CF_PASS]),
		headerFrom: "PayPal <notify@paypal.com>",
		envelopeFrom: "notify@paypal.com",
	});
	assert.equal(auth.authTier, "verified");
	assert.equal(isAuthFailed(auth), false);
	assert.equal(isFromUntrusted(auth), false);
}

{
	// SendGrid-style: passes only for the ESP, From domain has no DMARC
	// policy. Unverified, not spoofed, and not spam on auth alone.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=pass header.d=sendgrid.net header.s=s1; spf=pass smtp.mailfrom=bounces+123@em1234.sendgrid.net; dmarc=none header.from=smallbiz.example",
		]),
		headerFrom: "Ada <ada@smallbiz.example>",
		envelopeFrom: "bounces+123@em1234.sendgrid.net",
	});
	assert.equal(auth.aligned, false);
	assert.equal(auth.authTier, "unverified");
	assert.equal(auth.spoofed, false);
	assert.equal(isAuthFailed(auth), false);
	assert.equal(
		classifyFromHeaders({
			headers: headers(["From", "Ada <ada@smallbiz.example>"]),
			subject: "Your quote",
			sender: "ada@smallbiz.example",
			auth,
		}),
		null,
		"unverified mail goes to the normal classifier",
	);
	// Still not proven, so filters and auto-drafts stay off as before.
	assert.equal(isFromUntrusted(auth), true);
}

{
	// dmarc=fail under p=reject → failed → spam.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=pass header.d=evil.example; spf=softfail smtp.mailfrom=x@evil.example; dmarc=fail header.from=paypal.com policy.dmarc=reject",
		]),
		headerFrom: "PayPal <service@paypal.com>",
		envelopeFrom: "x@evil.example",
	});
	assert.equal(auth.dmarcPolicy, "reject");
	assert.equal(auth.authTier, "failed");
	assert.equal(auth.spoofed, true);
	assert.deepEqual(
		classifyFromHeaders({
			headers: headers(["From", "PayPal <service@paypal.com>"]),
			subject: "Verify your account",
			sender: "service@paypal.com",
			auth,
		}),
		{ class: "spam", folderId: Folders.SPAM, reason: "auth-failed" },
	);
}

{
	// p=quarantine counts too.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=none; spf=softfail smtp.mailfrom=x@evil.example; dmarc=fail header.from=bank.example policy.dmarc=quarantine",
		]),
		headerFrom: "bank@bank.example",
		envelopeFrom: "x@evil.example",
	});
	assert.equal(auth.authTier, "failed");
}

{
	// dmarc=fail but the domain only asks for p=none → unverified.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=pass header.d=mailer.example; spf=softfail smtp.mailfrom=x@mailer.example; dmarc=fail header.from=shop.example policy.dmarc=none",
		]),
		headerFrom: "orders@shop.example",
		envelopeFrom: "x@mailer.example",
	});
	assert.equal(auth.dmarcPolicy, "none");
	assert.equal(auth.authTier, "unverified");
	assert.equal(auth.spoofed, false);
}

{
	// SPF hard-fail with no DKIM pass → failed, even without a DMARC policy.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=ada@smallbiz.example; dmarc=none header.from=smallbiz.example",
		]),
		headerFrom: "ada@smallbiz.example",
		envelopeFrom: "ada@smallbiz.example",
	});
	assert.equal(auth.authTier, "failed");
}

{
	// SPF hard-fail but DKIM passes for some domain → not failed.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=pass header.d=list.example; spf=fail smtp.mailfrom=ada@smallbiz.example; dmarc=none header.from=smallbiz.example",
		]),
		headerFrom: "ada@smallbiz.example",
		envelopeFrom: "ada@smallbiz.example",
	});
	assert.equal(auth.authTier, "unverified");
}

{
	// SPF softfail alone is not a hard fail.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=none; spf=softfail smtp.mailfrom=ada@smallbiz.example; dmarc=none",
		]),
		headerFrom: "ada@smallbiz.example",
		envelopeFrom: "ada@smallbiz.example",
	});
	assert.equal(auth.authTier, "unverified");
}

{
	// No trusted verdict → unverified, never failed. An untrusted
	// (non-Cloudflare) results header can't fail or verify mail.
	const none = parseAuthSignals({ headerFrom: "ada@example.com", envelopeFrom: "ada@example.com" });
	assert.equal(none.authTier, "unverified");
	const forgedFail = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"evil.example; spf=fail smtp.mailfrom=ada@example.com; dmarc=fail header.from=example.com policy.dmarc=reject",
		]),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assert.equal(forgedFail.source, "none");
	assert.equal(forgedFail.authTier, "unverified");
	// Only Cloudflare-sealed ARC results count; another sealer's pass doesn't verify.
	const upstreamArc = parseAuthSignals({
		envelopeHeaders: headers([
			"ARC-Authentication-Results",
			"i=1; mx.google.com; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=ada@example.com; dmarc=pass header.from=example.com",
		]),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assert.equal(upstreamArc.source, "none");
	assert.equal(upstreamArc.authTier, "unverified");
	// Cloudflare's own ARC results do.
	const cfArc = parseAuthSignals({
		envelopeHeaders: headers(["ARC-Authentication-Results", CF_BLOG_ARC]),
		headerFrom: "joe@example.com",
		envelopeFrom: "joe@example.com",
	});
	assert.equal(cfArc.authTier, "verified");
	assert.equal(cfArc.dmarcPolicy, "reject");
}

{
	// A fail wins over a pass in the same verdict set.
	const auth = parseAuthSignals({
		envelopeHeaders: headers([
			"Authentication-Results",
			"mx.cloudflare.net; dkim=fail header.d=paypal.com; spf=pass smtp.mailfrom=x@paypal.com; dmarc=fail header.from=paypal.com policy.dmarc=reject",
		]),
		headerFrom: "service@paypal.com",
		envelopeFrom: "x@paypal.com",
	});
	assert.equal(auth.authTier, "failed");
}

{
	// Stored rows round-trip the tier; rows from before tiers fall back to `spoofed`.
	const verified = parseStoredEmailAuth(
		serializeEmailAuth(
			parseAuthSignals({
				envelopeHeaders: headers(["Authentication-Results", CF_PASS]),
				headerFrom: "notify@paypal.com",
				envelopeFrom: "notify@paypal.com",
			}),
		),
	);
	assert.equal(verified?.authTier, "verified");
	const legacySpoofed = parseStoredEmailAuth(
		JSON.stringify({ source: "authentication-results", aligned: false, spoofed: true, headerFrom: "a@b.example", envelopeFrom: "" }),
	);
	assert.equal(legacySpoofed?.authTier, "failed");
	assert.equal(legacySpoofed?.spoofed, true);
	const legacyAligned = parseStoredEmailAuth(
		JSON.stringify({ source: "authentication-results", aligned: true, spoofed: false, headerFrom: "a@b.example", envelopeFrom: "" }),
	);
	assert.equal(legacyAligned?.authTier, "verified");
	const legacyNone = parseStoredEmailAuth(
		JSON.stringify({ source: "none", aligned: null, spoofed: false, headerFrom: "a@b.example", envelopeFrom: "" }),
	);
	assert.equal(legacyNone?.authTier, "unverified");
	// `spoofed` always mirrors the tier.
	const stored = parseStoredEmailAuth(
		JSON.stringify({ source: "authentication-results", aligned: false, spoofed: true, authTier: "unverified", headerFrom: "a@b.example", envelopeFrom: "" }),
	);
	assert.equal(stored?.authTier, "unverified");
	assert.equal(stored?.spoofed, false);
	assert.equal(authTierOf(null), "unverified");
}

console.log("email-auth tests passed");
