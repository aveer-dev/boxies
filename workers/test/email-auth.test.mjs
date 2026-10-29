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
	isTrustedArcSealer,
	isTrustedAuthserv,
	mergeTrustedAuthHeaders,
	parseAuthSignals,
	parseAuthenticationResultsValue,
	parseStoredEmailAuth,
	serializeEmailAuth,
	TRUSTED_ARC_SEALERS,
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
	// Failed auth wins over list headers (spam-management-plan §5 step 1), so a
	// sender preference can't file forged list mail into Inbox.
	assert.equal(result?.class, "spam");
	assert.equal(result?.reason, "auth-failed");
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

// --- Trusted ARC sealers (AVE-101) ---------------------------------------
// Forwarded mail: Cloudflare's own SPF/DKIM/DMARC fail after the forwarder
// rewrites the envelope (and here the body), but Cloudflare validated the
// ARC chain and the last sealer is a trusted mailbox provider that saw it pass.

assert.deepEqual(
	[...TRUSTED_ARC_SEALERS],
	[
		"google.com",
		"outlook.com",
		"microsoft.com",
		"icloud.com",
		"protonmail.ch",
		"proton.me",
		"messagingengine.com",
		"yahoo.com",
		"aol.com",
	],
);
assert.equal(isTrustedArcSealer("google.com"), true);
assert.equal(isTrustedArcSealer("GOOGLE.COM."), true);
assert.equal(isTrustedArcSealer("eur.outlook.com"), true);
assert.equal(isTrustedArcSealer("microsoft.com"), true);
assert.equal(isTrustedArcSealer("evilgoogle.com"), false);
assert.equal(isTrustedArcSealer("google.com.evil.io"), false);
assert.equal(isTrustedArcSealer("notoutlook.com"), false);
assert.equal(isTrustedArcSealer("google.co"), false);
assert.equal(isTrustedArcSealer("evil.io/google.com"), false);
assert.equal(isTrustedArcSealer(""), false);
for (const d of [
	"icloud.com",
	"protonmail.ch",
	"proton.me",
	"messagingengine.com",
	"yahoo.com",
	"aol.com",
]) {
	assert.equal(isTrustedArcSealer(d), true, d);
}
for (const d of [
	"evilicloud.com",
	"icloud.com.evil.io",
	"icloud.co",
	"me.com",
	"protonmail.com.attacker.example",
	"proton.me.uk",
	"fakemessagingengine.com",
	"fastmail.com",
	"zoho.com",
	// Zoho seals mail it sends with its own dmarc=pass claim (AVE-102).
	"zohomail.com",
	"zohomail.eu",
	"zohomail.com.evil.io",
	"notyahoo.com",
	"yahoo.co",
	"aol.co",
	"hey.com",
]) {
	assert.equal(isTrustedArcSealer(d), false, d);
}
assert.equal(isTrustedArcSealer(null), false);

// Cloudflare's verdict on Gmail-forwarded mail: SPF passes only for Gmail's
// SRS address, DKIM broke, so DMARC fails under p=reject → `failed` alone.
const CF_FORWARDED_ARC_PASS =
	"mx.cloudflare.net; dkim=fail header.d=example.com; spf=pass smtp.mailfrom=me+caf_=me=inboxies.example@gmail.com; dmarc=fail header.from=example.com policy.dmarc=reject; arc=pass smtp.remote-ip=209.85.220.41";
const GOOGLE_SEAL_1 =
	"i=1; a=rsa-sha256; t=1729500000; cv=none; d=google.com; s=arc-20240605; b=Zm9vYmFy+/K1x2Y3==";
const GOOGLE_AAR_1 =
	"i=1; mx.google.com; dkim=pass header.i=@example.com header.s=s1 header.b=AbCd; spf=pass (google.com: domain of ada@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=ada@example.com; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=example.com";
const MICROSOFT_SEAL_1 =
	"i=1; a=rsa-sha256; s=arcselector10001; d=microsoft.com; cv=none; b=UVdFUlRZ\r\n\tYWJj==";
const MICROSOFT_AAR_1 =
	"i=1; mx.microsoft.com 1; spf=pass smtp.mailfrom=contoso.com; dmarc=pass action=none header.from=contoso.com; dkim=pass header.d=contoso.com; arc=none";

// Cloudflare's own ARC set, as Email Routing adds it to every message it
// delivers (AVE-102): one instance above the chain that arrived, its results
// repeating Cloudflare's Authentication-Results.
function cloudflareSet(instance, cf, cv = instance === 1 ? "none" : "pass") {
	return [
		["ARC-Seal", `i=${instance}; a=rsa-sha256; s=cf2024-1; d=cloudflare-email.net; cv=${cv}; b=Q2xvdWRmbGFyZQ==`],
		["ARC-Message-Signature", `i=${instance}; a=rsa-sha256; c=relaxed/relaxed; d=cloudflare-email.net; s=cf2024-1; h=from:to; bh=x; b=y`],
		["ARC-Authentication-Results", `i=${instance}; ${cf}`],
	];
}

function delivered(pairs, from = "Ada <ada@example.com>") {
	return parseAuthSignals({
		envelopeHeaders: headers(...pairs),
		headerFrom: from,
		envelopeFrom: "me+caf_=me=inboxies.example@gmail.com",
	});
}

// Parses `extra` as Cloudflare delivers it, with its own set above the
// highest instance in `extra`, and checks that the same headers without
// that set (mail stored before Cloudflare sealed) parse identically: the
// upstream set is judged the same way either way.
function forwarded(extra, { cf = CF_FORWARDED_ARC_PASS, from = "Ada <ada@example.com>" } = {}) {
	const top = Math.max(
		0,
		...extra
			.filter(([key]) => key === "ARC-Seal")
			.map(([, value]) => Number(/^\s*i=(\d+)/.exec(value)?.[1] ?? 0)),
	);
	const auth = delivered([...cloudflareSet(top + 1, cf), ["Authentication-Results", cf], ...extra], from);
	assert.deepEqual(delivered([["Authentication-Results", cf], ...extra], from), auth);
	return auth;
}

{
	// Baseline: without ARC sets the same Cloudflare verdict is `failed`.
	const auth = forwarded([]);
	assert.equal(auth.authTier, "failed");
	assert.equal(auth.arcSealer, undefined);
}

{
	// Gmail forward → verified via google.com's seal.
	const auth = forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Message-Signature", "i=1; a=rsa-sha256; c=relaxed/relaxed; d=google.com; s=arc-20240605; h=from:to; bh=x; b=y"],
		["ARC-Authentication-Results", GOOGLE_AAR_1],
	]);
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.spoofed, false);
	assert.equal(auth.aligned, true);
	assert.equal(auth.arcSealer, "google.com");
	assert.equal(isFromUntrusted(auth), false);
	// Cloudflare's own verdicts are kept as reported.
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.source, "authentication-results");
	// Round-trips through storage.
	const stored = parseStoredEmailAuth(serializeEmailAuth(auth));
	assert.equal(stored?.authTier, "verified");
	assert.equal(stored?.arcSealer, "google.com");
}

{
	// Microsoft 365 forward (d=microsoft.com) → verified. Exchange Online
	// resends under an SRS envelope in the forwarding tenant's domain.
	const auth = forwarded(
		[
			["ARC-Seal", MICROSOFT_SEAL_1],
			["ARC-Authentication-Results", MICROSOFT_AAR_1],
		],
		{
			cf: "mx.cloudflare.net; dkim=fail header.d=contoso.com; spf=pass smtp.mailfrom=bounces+SRS=k5mZq=QD@fabrikam.onmicrosoft.com; dmarc=fail header.from=contoso.com policy.dmarc=quarantine; arc=pass",
			from: "user@contoso.com",
		},
	);
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.arcSealer, "microsoft.com");
}

{
	// outlook.com subdomain sealing as the second hop (cv=pass) after a list
	// at i=1; DKIM-aligned pass is enough without a DMARC verdict (the SPF
	// pass is for the list, not the From).
	const auth = forwarded(
		[
			["ARC-Seal", "i=2; a=rsa-sha256; s=arcselector9901; d=eur.outlook.com; cv=pass; b=AAAA"],
			["ARC-Authentication-Results", "i=2; mx.microsoft.com 1; spf=pass smtp.mailfrom=bounce@lists.example; dkim=pass header.d=mail.fabrikam.example; arc=pass (0 oda=0 ltdi=0)"],
			["ARC-Seal", "i=1; a=rsa-sha256; d=lists.example; s=s1; cv=none; b=BBBB"],
			["ARC-Authentication-Results", "i=1; lists.example; dkim=pass header.d=fabrikam.example"],
		],
		{
			cf: "mx.cloudflare.net; dkim=fail header.d=fabrikam.example; spf=pass smtp.mailfrom=bounces+SRS=Lm3Qw=RT@fabrikam.onmicrosoft.com; dmarc=none header.from=fabrikam.example; arc=pass",
			from: "ana@fabrikam.example",
		},
	);
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.arcSealer, "eur.outlook.com");
}

{
	// Unverified (not failed) mail is upgraded too.
	const auth = forwarded(
		[
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		],
		{ cf: "mx.cloudflare.net; dkim=none; spf=pass smtp.mailfrom=me@gmail.com; dmarc=none header.from=example.com; arc=pass" },
	);
	assert.equal(auth.authTier, "verified");
}

// workerd Headers: get() comma-joins duplicates, getAll() throws. Both as
// Cloudflare delivers it (its seal and results joined ahead of Google's)
// and without Cloudflare's set.
for (const [seals, arcResultsJoined] of [
	[
		`${cloudflareSet(2, CF_FORWARDED_ARC_PASS)[0][1]}, ${GOOGLE_SEAL_1}`,
		`i=2; ${CF_FORWARDED_ARC_PASS}, ${GOOGLE_AAR_1}`,
	],
	[GOOGLE_SEAL_1, GOOGLE_AAR_1],
]) {
	const values = new Map([
		["authentication-results", CF_FORWARDED_ARC_PASS],
		["arc-seal", seals],
		["arc-authentication-results", arcResultsJoined],
	]);
	const auth = parseAuthSignals({
		envelopeHeaders: {
			get: (name) => values.get(name.toLowerCase()) ?? null,
			getAll: () => {
				throw new TypeError("getAll only supports Set-Cookie");
			},
		},
		headerFrom: "ada@example.com",
		envelopeFrom: "x@gmail.com",
	});
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.arcSealer, "google.com");
}

// Each additional mailbox provider, sealing a forward from Ada at
// example.com, is upgraded by its own seal. Fixtures mirror each provider's
// header shape (selector, authserv-id); signatures are placeholders since
// Cloudflare's arc=pass is the signature check.
const PROVIDER_SEALS = [
	{
		d: "icloud.com",
		seal: "i=1; a=rsa-sha256; d=icloud.com; s=1a1hai; t=1729500000; cv=none; b=SWNsb3Vk",
		aar: "i=1; mx.icloud.com; dkim=pass (2048-bit key) header.d=example.com header.i=@example.com header.b=AbCd; spf=pass (mx.icloud.com: domain of ada@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=ada@example.com; dmarc=pass (p=reject sp=reject) header.from=example.com",
	},
	{
		d: "protonmail.ch",
		seal: "i=1; a=rsa-sha256; s=protonmail3; d=protonmail.ch; t=1729500000; cv=none; b=UHJvdG9u",
		aar: "i=1; mail.protonmail.ch; dkim=pass (2048-bit key) header.d=example.com header.i=@example.com header.b=\"AbCd\"; spf=pass smtp.mailfrom=example.com; dmarc=pass (p=reject dis=none) header.from=example.com",
	},
	{
		d: "proton.me",
		seal: "i=1; a=rsa-sha256; s=protonmail; d=proton.me; t=1729500000; cv=none; b=UHJvdG9uTWU=",
		// DMARC is the only proof: the SPF pass is for an ESP, not the From.
		aar: "i=1; mail.protonmail.ch; spf=pass smtp.mailfrom=bounce@esp.example; dmarc=pass (p=reject dis=none) header.from=example.com",
	},
	{
		d: "messagingengine.com",
		seal: "i=1; a=rsa-sha256; cv=none; d=messagingengine.com; s=fm2; t=1729500000; b=RmFzdG1haWw=",
		aar: "i=1; mx.messagingengine.com; x-csa=none; x-me-sender=none; x-ptr=pass smtp.helo=mail.example.com policy.ptr=mail.example.com; bimi=none (No BIMI records found); arc=none (no signatures found); dkim=pass (2048-bit rsa key sha256) header.d=example.com header.i=@example.com header.b=AbCd header.a=rsa-sha256 header.s=s1 x-bits=2048; dmarc=pass policy.published-domain-policy=reject policy.applied-disposition=none policy.evaluated-disposition=none (p=reject,d=none,d.eval=none) policy.policy-from=p header.from=example.com; spf=pass smtp.mailfrom=ada@example.com smtp.helo=mail.example.com",
	},
	{
		d: "yahoo.com",
		seal: "i=1; a=rsa-sha256; t=1729500000; cv=none; d=yahoo.com; s=arc-20240116; b=WWFob28=",
		aar: "i=1; atlas-production.v2-mail-prod1-gq1.omega.yahoo.com; dkim=pass header.i=@example.com header.s=s1; spf=pass smtp.mailfrom=example.com; dmarc=pass(p=REJECT) header.from=example.com;",
	},
	{
		d: "aol.com",
		seal: "i=1; a=rsa-sha256; t=1729500000; cv=none; d=aol.com; s=arc-20240116; b=QU9M",
		aar: "i=1; atlas-production.v2-mail-prod1-gq1.omega.yahoo.com; dkim=pass header.i=@example.com header.s=s1; spf=pass smtp.mailfrom=example.com; dmarc=pass(p=REJECT) header.from=example.com;",
	},
];

for (const { d, seal, aar } of PROVIDER_SEALS) {
	const auth = forwarded([
		["ARC-Seal", seal],
		["ARC-Message-Signature", `i=1; a=rsa-sha256; c=relaxed/relaxed; d=${d}; s=s1; h=from:to; bh=x; b=y`],
		["ARC-Authentication-Results", aar],
	]);
	assert.equal(auth.authTier, "verified", d);
	assert.equal(auth.arcSealer, d, d);
	assert.equal(isFromUntrusted(auth), false, d);
}

{
	// Fastmail sealing as the second hop (cv=pass) over a list's i=1 set.
	const fastmail = PROVIDER_SEALS.find((p) => p.d === "messagingengine.com");
	const auth = forwarded([
		["ARC-Seal", fastmail.seal.replace("i=1", "i=2").replace("cv=none", "cv=pass")],
		["ARC-Authentication-Results", fastmail.aar.replace("i=1", "i=2")],
		["ARC-Seal", "i=1; a=rsa-sha256; d=lists.example; s=s1; cv=none; b=BBBB"],
		["ARC-Authentication-Results", "i=1; lists.example; dkim=pass header.d=example.com"],
	]);
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.arcSealer, "messagingengine.com");
}

// --- Negative cases: each must stay at Cloudflare's own tier. ------------

function assertNotUpgraded(auth, expected = "failed") {
	assert.equal(auth.authTier, expected);
	assert.equal(auth.arcSealer, undefined);
}

// Look-alike / untrusted sealers.
for (const d of ["evilgoogle.com", "google.com.evil.io", "attacker.example", "outlook.com.attacker.example"]) {
	assertNotUpgraded(
		forwarded([
			["ARC-Seal", GOOGLE_SEAL_1.replace("d=google.com", `d=${d}`)],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		]),
	);
}

// Cloudflare reports the chain failed, absent, or says nothing about ARC:
// a forged google.com set must not count.
for (const arc of ["arc=fail", "arc=none", "arc=permerror", ""]) {
	const cf = CF_FORWARDED_ARC_PASS.replace(/; arc=pass smtp\.remote-ip=\S+$/, arc ? `; ${arc}` : "");
	assert.notEqual(cf, CF_FORWARDED_ARC_PASS);
	assertNotUpgraded(
		forwarded(
			[
				["ARC-Seal", GOOGLE_SEAL_1],
				["ARC-Authentication-Results", GOOGLE_AAR_1],
			],
			{ cf },
		),
	);
}

{
	// Our real Authentication-Results says arc=fail; a forged Cloudflare ARC
	// results header claiming arc=pass lower down must not outvote it.
	const auth = forwarded(
		[
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", "i=2; mx.cloudflare.net; dmarc=pass header.from=example.com; arc=pass"],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		],
		{ cf: CF_FORWARDED_ARC_PASS.replace("arc=pass", "arc=fail") },
	);
	assertNotUpgraded(auth);
}

{
	// No trusted Cloudflare header at all: upstream ARC is never enough.
	const auth = parseAuthSignals({
		envelopeHeaders: headers(
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
			["Authentication-Results", "evil.example; arc=pass"],
		),
		headerFrom: "ada@example.com",
		envelopeFrom: "ada@example.com",
	});
	assertNotUpgraded(auth, "unverified");
}

// Broken chain shapes.
assertNotUpgraded(
	forwarded([
		["ARC-Seal", GOOGLE_SEAL_1.replace("cv=none", "cv=fail")],
		["ARC-Authentication-Results", GOOGLE_AAR_1],
	]),
);
assertNotUpgraded(
	forwarded([
		// i=2 must carry cv=pass.
		["ARC-Seal", GOOGLE_SEAL_1.replace("i=1", "i=2")],
		["ARC-Authentication-Results", GOOGLE_AAR_1.replace("i=1", "i=2")],
	]),
);
assertNotUpgraded(
	forwarded([
		// Duplicate seal at the top instance.
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", GOOGLE_AAR_1],
	]),
);
assertNotUpgraded(
	forwarded([
		// Results header with no matching seal at its instance.
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", "i=2; mx.google.com; dmarc=pass header.from=example.com"],
		["ARC-Authentication-Results", GOOGLE_AAR_1],
	]),
);
assertNotUpgraded(
	forwarded([
		// Seal with no results header at the top instance.
		["ARC-Seal", GOOGLE_SEAL_1],
	]),
);
assertNotUpgraded(
	forwarded([
		// Seal with a duplicated tag is malformed.
		["ARC-Seal", `${GOOGLE_SEAL_1}; d=google.com`],
		["ARC-Authentication-Results", GOOGLE_AAR_1],
	]),
);

{
	// Google sealed first, then an untrusted hop sealed on top (and could
	// have rewritten the message): the older trusted set is not used.
	const auth = forwarded([
		["ARC-Seal", "i=2; a=rsa-sha256; d=attacker.example; s=s1; cv=pass; b=CCCC"],
		["ARC-Authentication-Results", "i=2; attacker.example; dmarc=pass header.from=example.com; arc=pass"],
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", GOOGLE_AAR_1],
	]);
	assertNotUpgraded(auth);
}

{
	// Top results header claims to be ours: never treat it as upstream's.
	const auth = forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", GOOGLE_AAR_1.replace("mx.google.com", "mx.cloudflare.net")],
	]);
	assertNotUpgraded(auth);
}

// The trusted sealer's verdict must prove the visible From.
assertNotUpgraded(
	forwarded(
		[
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		],
		// Google vouched for example.com; the From we show is paypal.com.
		{ from: "service@paypal.com", cf: CF_FORWARDED_ARC_PASS.replace("header.from=example.com", "header.from=paypal.com") },
	),
);
assertNotUpgraded(
	forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", "i=1; mx.google.com; dkim=pass header.d=sendgrid.net; spf=pass smtp.mailfrom=bounce@sendgrid.net; dmarc=pass header.from=other.example"],
	]),
);
assertNotUpgraded(
	forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		// A DMARC fail at the sealer vetoes an aligned DKIM pass.
		["ARC-Authentication-Results", "i=1; mx.google.com; dkim=pass header.d=example.com; dmarc=fail header.from=example.com"],
	]),
);
assertNotUpgraded(
	forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		// A bare TLD never aligns.
		["ARC-Authentication-Results", "i=1; mx.google.com; dkim=pass header.d=com; spf=pass smtp.mailfrom=x@com"],
	]),
);
assertNotUpgraded(
	forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		// dmarc=pass without saying which From it evaluated.
		["ARC-Authentication-Results", "i=1; mx.google.com; dmarc=pass"],
	]),
);

{
	// Cloudflare's DMARC evaluated a different From than the one we show
	// (ambiguous From): ARC can't vouch for it either.
	const auth = forwarded(
		[
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		],
		{ cf: CF_FORWARDED_ARC_PASS.replace("header.from=example.com", "header.from=other.example") },
	);
	assertNotUpgraded(auth);
}

{
	// No visible From → nothing to prove.
	const auth = forwarded(
		[
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		],
		{ from: "" },
	);
	assert.equal(auth.arcSealer, undefined);
	assert.notEqual(auth.authTier, "verified");
}

// The new providers get the same negative treatment.
for (const { d, seal, aar } of PROVIDER_SEALS) {
	// Look-alike sealer domains carrying the provider's own results.
	for (const fake of [`evil${d}`, `${d}.evil.io`, `${d.split(".")[0]}.attacker.example`]) {
		assertNotUpgraded(
			forwarded([
				["ARC-Seal", seal.replace(`d=${d}`, `d=${fake}`)],
				["ARC-Authentication-Results", aar],
			]),
		);
	}
	// Broken chain: Cloudflare says arc=fail, or the seal itself says cv=fail.
	assertNotUpgraded(
		forwarded(
			[
				["ARC-Seal", seal],
				["ARC-Authentication-Results", aar],
			],
			{ cf: CF_FORWARDED_ARC_PASS.replace("arc=pass", "arc=fail") },
		),
	);
	assertNotUpgraded(
		forwarded([
			["ARC-Seal", seal.replace("cv=none", "cv=fail")],
			["ARC-Authentication-Results", aar],
		]),
	);
	// An untrusted hop sealed on top of the provider's set.
	assertNotUpgraded(
		forwarded([
			["ARC-Seal", "i=2; a=rsa-sha256; d=attacker.example; s=s1; cv=pass; b=CCCC"],
			["ARC-Authentication-Results", "i=2; attacker.example; dmarc=pass header.from=example.com"],
			["ARC-Seal", seal],
			["ARC-Authentication-Results", aar],
		]),
	);
	// The provider vouched for example.com, but the visible From is someone else.
	assertNotUpgraded(
		forwarded(
			[
				["ARC-Seal", seal],
				["ARC-Authentication-Results", aar],
			],
			{ from: "service@paypal.com", cf: CF_FORWARDED_ARC_PASS.replace("header.from=example.com", "header.from=paypal.com") },
		),
	);
}

{
	// Providers not on the list (Hey, plain fastmail.com) are not trusted
	// even with an otherwise perfect chain.
	for (const d of ["hey.com", "fastmail.com", "me.com"]) {
		assertNotUpgraded(
			forwarded([
				["ARC-Seal", GOOGLE_SEAL_1.replace("d=google.com", `d=${d}`)],
				["ARC-Authentication-Results", GOOGLE_AAR_1],
			]),
		);
	}
	// Nor is Zoho, even forwarding in its own header shape (see the AVE-102
	// fixtures below for why it was taken off the list).
	for (const d of ["zohomail.com", "zohomail.eu"]) {
		assertNotUpgraded(
			forwarded([
				["ARC-Seal", `i=1; a=rsa-sha256; t=1729500000; cv=none; d=${d}; s=zohoarc; b=Wm9obw==`],
				["ARC-Authentication-Results", `i=1; mx.${d}; dkim=pass header.i=example.com; spf=pass smtp.mailfrom=ada@example.com; dmarc=pass header.from=<ada@example.com>`],
			]),
		);
	}
}

// --- Behind Cloudflare's own ARC set -------------------------------------
// Real deliveries carry Cloudflare's set on top (AVE-102), so the upstream
// sealer is read one instance below it. `forwarded` above covers the common
// shapes; these pin the Cloudflare set itself.

const GOOGLE_SET_1 = [
	["ARC-Seal", GOOGLE_SEAL_1],
	["ARC-Message-Signature", "i=1; a=rsa-sha256; c=relaxed/relaxed; d=google.com; s=arc-20240605; h=from:to; bh=x; b=y"],
	["ARC-Authentication-Results", GOOGLE_AAR_1],
];
const GOOGLE_SEAL_2 = GOOGLE_SEAL_1.replace("i=1", "i=2").replace("cv=none", "cv=pass");
const GOOGLE_AAR_2 = GOOGLE_AAR_1.replace("i=1", "i=2");

{
	// Gmail forward in the order Cloudflare hands it to the Worker: its set
	// at i=2, then Authentication-Results, then Google's set at i=1.
	const auth = delivered([
		...cloudflareSet(2, CF_FORWARDED_ARC_PASS),
		["Authentication-Results", CF_FORWARDED_ARC_PASS],
		...GOOGLE_SET_1,
	]);
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.arcSealer, "google.com");
	assert.equal(auth.dmarc, "fail");
}

{
	// Direct mail: Cloudflare's set is the only one (i=1), so there is no
	// upstream sealer and Cloudflare's own tier stands.
	const auth = delivered([
		...cloudflareSet(1, CF_FORWARDED_ARC_PASS.replace("arc=pass", "arc=none")),
		["Authentication-Results", CF_FORWARDED_ARC_PASS.replace("arc=pass", "arc=none")],
	]);
	assertNotUpgraded(auth);
}

// A Cloudflare seal that isn't on top. Google at i=2 over Cloudflare at i=1
// would upgrade without the Cloudflare seal; with it, it must not.
assert.equal(
	delivered([
		["Authentication-Results", CF_FORWARDED_ARC_PASS],
		["ARC-Seal", GOOGLE_SEAL_2],
		["ARC-Authentication-Results", GOOGLE_AAR_2],
	]).arcSealer,
	"google.com",
);
assertNotUpgraded(
	delivered([
		["Authentication-Results", CF_FORWARDED_ARC_PASS],
		["ARC-Seal", GOOGLE_SEAL_2],
		["ARC-Authentication-Results", GOOGLE_AAR_2],
		...cloudflareSet(1, CF_FORWARDED_ARC_PASS),
	]),
);

// Forged extra sets around Cloudflare's: each must not upgrade.
for (const [label, forged] of [
	[
		// A set claiming the instance above Cloudflare's, lower in the message.
		"set above cloudflare",
		[
			["ARC-Seal", "i=3; a=rsa-sha256; t=1729500000; cv=pass; d=google.com; s=arc-20240605; b=Rm9yZ2Vk"],
			["ARC-Authentication-Results", GOOGLE_AAR_1.replace("i=1", "i=3")],
		],
	],
	// A results header alone above Cloudflare's instance.
	["results above cloudflare", [["ARC-Authentication-Results", "i=3; mx.google.com; dmarc=pass header.from=example.com"]]],
	// A second results header at Cloudflare's instance.
	["results beside cloudflare", [["ARC-Authentication-Results", "i=2; mx.google.com; dmarc=pass header.from=example.com"]]],
	// A second seal at Cloudflare's instance.
	["seal beside cloudflare", [["ARC-Seal", "i=2; a=rsa-sha256; t=1729500000; cv=pass; d=google.com; s=arc-20240605; b=Rm9yZ2Vk"]]],
	// A second Cloudflare seal under the upstream set.
	["second cloudflare seal", [["ARC-Seal", "i=1; a=rsa-sha256; s=cf2024-1; d=cloudflare-email.net; cv=none; b=Rm9yZ2Vk"]]],
	// A second upstream seal at i=1.
	["second upstream seal", [["ARC-Seal", GOOGLE_SEAL_1]]],
]) {
	const auth = delivered([
		...cloudflareSet(2, CF_FORWARDED_ARC_PASS),
		["Authentication-Results", CF_FORWARDED_ARC_PASS],
		...GOOGLE_SET_1,
		...forged,
	]);
	assert.equal(auth.authTier, "failed", label);
	assert.equal(auth.arcSealer, undefined, label);
}

// Cloudflare's set itself must be well formed.
for (const [label, top] of [
	// Seal at i=2 with cv=none: not a valid chain.
	["cv=none at i=2", cloudflareSet(2, CF_FORWARDED_ARC_PASS, "none")],
	// Results at Cloudflare's instance that aren't Cloudflare's.
	[
		"untrusted results",
		[cloudflareSet(2, CF_FORWARDED_ARC_PASS)[0], ["ARC-Authentication-Results", `i=2; mx.google.com; dmarc=pass header.from=example.com; arc=pass`]],
	],
	// Cloudflare's results don't say arc=pass, though Authentication-Results does.
	["results without arc=pass", cloudflareSet(2, CF_FORWARDED_ARC_PASS.replace("arc=pass", "arc=none"))],
	// Seal with no results header at all.
	["seal only", [cloudflareSet(2, CF_FORWARDED_ARC_PASS)[0]]],
]) {
	const auth = delivered([...top, ["Authentication-Results", CF_FORWARDED_ARC_PASS], ...GOOGLE_SET_1]);
	assert.equal(auth.authTier, "failed", label);
	assert.equal(auth.arcSealer, undefined, label);
}

// A trusted sealer that sent the message rather than forwarded it: Cloudflare
// saw the same envelope the sealer recorded, so the sealer's dmarc=pass is
// only its own claim and Cloudflare's dmarc=fail stands.
{
	const cf =
		"mx.cloudflare.net; dkim=fail header.d=example.com; spf=pass smtp.mailfrom=bounce@esp.example; dmarc=fail header.from=example.com policy.dmarc=quarantine; arc=pass";
	const sent = (mailfrom) => [
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", `i=1; mx.google.com; spf=pass smtp.mailfrom=${mailfrom}; dmarc=pass header.from=example.com`],
	];
	assertNotUpgraded(forwarded(sent("bounce@esp.example"), { cf }));
	// Same organisation's envelope (parent or subdomain) counts as the same.
	assertNotUpgraded(forwarded(sent("bounce@mail.esp.example"), { cf }));
	assertNotUpgraded(forwarded(sent("bounce@esp.example"), { cf: cf.replace("@esp.example", "@mail.esp.example") }));
	// Control: under a forwarder's envelope the same results upgrade.
	const forward = forwarded(sent("bounce@esp.example"), {
		cf: cf.replace("bounce@esp.example", "me+caf_=me=inboxies.example@gmail.com"),
	});
	assert.equal(forward.authTier, "verified");
	assert.equal(forward.arcSealer, "google.com");
}
// When either side names no envelope we can't tell a forward from a send.
assertNotUpgraded(
	forwarded([
		["ARC-Seal", GOOGLE_SEAL_1],
		["ARC-Authentication-Results", "i=1; mx.google.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com"],
	]),
);
assertNotUpgraded(
	forwarded(
		[
			["ARC-Seal", GOOGLE_SEAL_1],
			["ARC-Authentication-Results", GOOGLE_AAR_1],
		],
		{ cf: CF_FORWARDED_ARC_PASS.replace(/spf=pass smtp\.mailfrom=\S+;/, "spf=none smtp.helo=mail-sor-f41.google.com;") },
	),
);

// Real Cloudflare Email Routing headers captured for AVE-102 (2026-10-29).
// Values are verbatim apart from the test sender's own addresses
// (owner.example, relay.example) and shortened ARC-Seal signatures. They
// confirm Cloudflare states `policy.dmarc=` on both pass and fail, and still
// delivers p=quarantine failures to the Worker.
const CF_REAL_PASS =
	"mx.cloudflare.net; dkim=pass header.d=inboxies.email header.s=cf-bounce header.b=Px9vMp/T; dkim=pass header.d=cloudflare-smtp.net header.s=cf2024-1 header.b=bq8eZZHN; dmarc=pass header.from=inboxies.email policy.dmarc=reject; spf=none (mx.cloudflare.net: no SPF records found for postmaster@bg-bbi.cloudflare-smtp.net) smtp.helo=bg-bbi.cloudflare-smtp.net; spf=pass (mx.cloudflare.net: domain of b1auisllvs4odkrxqxxxcv5yvaffaimunktcq4ucnttyndaawqpq@cf-bounce.inboxies.email designates 104.30.16.118 as permitted sender) smtp.mailfrom=b1auisllvs4odkrxqxxxcv5yvaffaimunktcq4ucnttyndaawqpq@cf-bounce.inboxies.email; arc=none smtp.remote-ip=104.30.16.118";
const cfRealDmarcFail = (policy) =>
	`mx.cloudflare.net; dmarc=fail (policy not aligned) header.from=owner.example policy.dmarc=${policy}; spf=none (mx.cloudflare.net: no SPF records found for postmaster@sender5-of-o54.zoho.com) smtp.helo=sender5-of-o54.zoho.com; spf=pass (mx.cloudflare.net: domain of sender@relay.example designates 165.173.182.54 as permitted sender) smtp.mailfrom=sender@relay.example; arc=pass smtp.remote-ip=165.173.182.54`;
// Zoho seals the mail it sends (i=1) and claims dmarc=pass for the "Send Mail
// As" address, though Cloudflare finds DMARC failing. Two things keep that
// claim from counting: Zoho isn't an allowlisted sealer, and Cloudflare's SPF
// names the same envelope Zoho recorded (sender@relay.example), so the
// message was sent by Zoho, not forwarded through it.
const ZOHO_SEAL_1 = "i=1; a=rsa-sha256; t=1793232963; cv=none; d=zohomail.com; s=zohoarc; b=Wm9obw==";
const ZOHO_AAR_1 =
	"i=1; mx.zohomail.com; spf=pass smtp.mailfrom=sender@relay.example; dmarc=pass header.from=<personal@owner.example>";

// `cloudflare: false` drops Cloudflare's set (stored mail); `sealer` swaps
// Zoho's seal domain; `envelope` swaps the envelope Cloudflare's SPF saw.
function cfRealZohoSendAs(policy, { cloudflare = true, sealer = "zohomail.com", envelope } = {}) {
	let cf = cfRealDmarcFail(policy);
	if (envelope) cf = cf.replace("smtp.mailfrom=sender@relay.example", `smtp.mailfrom=${envelope}`);
	return parseAuthSignals({
		envelopeHeaders: headers(
			...(cloudflare
				? [
						["ARC-Seal", "i=2; a=rsa-sha256; s=cf2024-1; d=cloudflare-email.net; cv=pass; b=Q2xvdWRmbGFyZQ=="],
						["ARC-Authentication-Results", `i=2; ${cf}`],
					]
				: []),
			["Authentication-Results", cf],
			["ARC-Seal", ZOHO_SEAL_1.replace("d=zohomail.com", `d=${sealer}`)],
			["ARC-Authentication-Results", ZOHO_AAR_1],
		),
		headerFrom: "AVE-102 test <personal@owner.example>",
		envelopeFrom: "sender@relay.example",
	});
}

{
	// Email Sending from inboxies.email: aligned DKIM, p=reject → verified.
	const auth = parseAuthSignals({
		envelopeHeaders: headers(
			["ARC-Authentication-Results", `i=1; ${CF_REAL_PASS}`],
			["Authentication-Results", CF_REAL_PASS],
		),
		headerFrom: "AVE-102 test <ave102-test@inboxies.email>",
		envelopeFrom: "b1auisllvs4odkrxqxxxcv5yvaffaimunktcq4ucnttyndaawqpq@cf-bounce.inboxies.email",
	});
	assert.equal(auth.dmarc, "pass");
	assert.equal(auth.dmarcPolicy, "reject");
	assert.equal(auth.aligned, true);
	assert.equal(auth.authTier, "verified");
}

{
	// Zoho "Send Mail As" another domain, From domain at p=none → unverified.
	const auth = cfRealZohoSendAs("none");
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.dmarcPolicy, "none");
	assert.equal(auth.aligned, false);
	assertNotUpgraded(auth, "unverified");
	assert.notEqual(
		classifyFromHeaders({
			headers: headers(["From", "AVE-102 test <personal@owner.example>"]),
			subject: "[AVE-102 test] dmarc none",
			sender: "personal@owner.example",
			auth,
		})?.reason,
		"auth-failed",
	);
}

{
	// Same send with the From domain at p=quarantine → failed → spam.
	const auth = cfRealZohoSendAs("quarantine");
	assert.equal(auth.dmarc, "fail");
	assert.equal(auth.dmarcPolicy, "quarantine");
	assertNotUpgraded(auth, "failed");
	assert.equal(auth.spoofed, true);
	assert.deepEqual(
		classifyFromHeaders({
			headers: headers(["From", "AVE-102 test <personal@owner.example>"]),
			subject: "[AVE-102 test] dmarc quarantine",
			sender: "personal@owner.example",
			auth,
		}),
		{ class: "spam", folderId: Folders.SPAM, reason: "auth-failed" },
	);
}

// Zoho's claim doesn't count with or without Cloudflare's set, from either
// Zoho data centre, or even under a trusted sealer's d=: the unchanged
// envelope alone stops it.
for (const [policy, tier] of [
	["none", "unverified"],
	["quarantine", "failed"],
]) {
	for (const cloudflare of [true, false]) {
		for (const sealer of ["zohomail.com", "zohomail.eu", "google.com"]) {
			assertNotUpgraded(cfRealZohoSendAs(policy, { cloudflare, sealer }), tier);
		}
	}
}
{
	// Control: it's the envelope that stops the google.com variant. Under a
	// forwarder's envelope the same claim would upgrade.
	const auth = cfRealZohoSendAs("quarantine", {
		sealer: "google.com",
		envelope: "me+caf_=me=inboxies.example@gmail.com",
	});
	assert.equal(auth.authTier, "verified");
	assert.equal(auth.arcSealer, "google.com");
}

console.log("email-auth tests passed");
