/**
 * Authentication-Results / ARC parser, spoof classification, from-filter gating.
 * Run: node --experimental-strip-types workers/test/email-auth.test.mjs
 */

import assert from "node:assert/strict";
import { Folders } from "../../shared/folders.ts";
import {
	domainFromAddress,
	domainsAligned,
	isAuthSpoofed,
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
		reason: "auth-spoofed",
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
	assert.equal(isAuthSpoofed(spoofed), true);
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

console.log("email-auth tests passed");
