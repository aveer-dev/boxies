/**
 * Tests for Cloudflare Registrar domain availability, Stripe $20/yr subscription checkout sessions,
 * transparent fee breakdown, hosted bridge redirects, HMAC webhook verification, and automated domain provisioning.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-purchase-and-billing.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { setDevRuntimeForTesting } from "../lib/dev-runtime.ts";
import { createTestD1 } from "./d1-shim.mjs";
import { createZone } from "../lib/cloudflare-client.ts";
import {
	checkDomainAvailability,
	mockRegisterElsewhereForTesting,
	registerDomain,
	getDomainEppCode,
	setDomainTransferLock,
	computeDomainPricing,
	computeRetailPrice,
} from "../lib/cloudflare-registrar.ts";
import {
	saveDomainMetadata,
	getDomainMetadata,
} from "../lib/domain-registry.ts";
import {
	verifyStripeWebhookSignature,
	billingSessionKey,
} from "../routes/billing.ts";
import { STRIPE_API_VERSION } from "../lib/stripe.ts";

// These suites drive the in-memory Cloudflare / registrar mocks, which are
// dev-only (production fails closed without credentials). Opt in explicitly.
setDevRuntimeForTesting(true);

function mockBucket(initial = {}) {
	const store = new Map(
		Object.entries(initial).map(([key, value]) => [
			key,
			typeof value === "string" ? value : JSON.stringify(value),
		]),
	);
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { json: async () => JSON.parse(text) };
		},
		async put(key, value) {
			store.set(key, typeof value === "string" ? value : JSON.stringify(value));
		},
		async head(key) {
			return store.has(key) ? { key } : null;
		},
		async list({ prefix = "" } = {}) {
			return {
				objects: [...store.keys()]
					.filter((key) => key.startsWith(prefix))
					.map((key) => ({ key })),
			};
		},
		async delete(key) {
			store.delete(key);
		},
	};
}

// One AUTH_DB per bucket: the envs built over a bucket share its state.
const authDbs = new WeakMap();
function authDbFor(bucket) {
	if (!authDbs.has(bucket)) authDbs.set(bucket, createTestD1());
	return authDbs.get(bucket);
}

/** The `domain_reservation` row for `domain`, if any. */
function reservationIn(bucket, domain) {
	return authDbFor(bucket).prepare("select * from domain_reservation where domain = ?").bind(domain).first();
}

function mockEnv(bucket, extras = {}) {
	return {
		BUCKET: bucket,
		EMAIL_ADDRESSES: [],
		DOMAINS: "inboxies.email",
		AUTH_DB: authDbFor(bucket),
		BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
		APP_BASE_URL: "https://inboxies.email",
		WORKER_NAME: "agentic-inbox",
		EMAIL: {
			send: async () => ({ messageId: "msg-1" }),
		},
		MAILBOX: {
			idFromName(name) {
				return name;
			},
			get(id) {
				return {
					id,
					reviveMailbox: async () => {},
					getFolders: async () => [],
					getEmails: async () => [],
					countEmails: async () => 0,
					purgeMailbox: async () => ({ conversationIds: [] }),
				};
			},
		},
		EMAIL_AGENT: {
			idFromName(name) {
				return name;
			},
			get() {
				return { purge: async () => {} };
			},
		},
		...extras,
	};
}

async function stripeSignatureHeader(rawBody, secret, ts = Math.floor(Date.now() / 1000)) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${rawBody}`));
	const hex = Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `t=${ts},v1=${hex}`;
}

function postWebhook(rawBody, env, headers = {}) {
	return apiApp.request(
		"/api/v1/billing/stripe-webhook",
		{
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: rawBody,
		},
		env,
	);
}

/** Mirrors workers/app.ts: API routes mounted ahead of the React Router catch-all. */
function workerShell() {
	const shell = new Hono();
	shell.route("/", apiApp);
	shell.all("*", (c) => c.text("react-router"));
	return shell;
}

/** Run `fn` as dev or production, then restore this file's dev default. */
async function withRuntime(dev, fn) {
	setDevRuntimeForTesting(dev);
	try {
		return await fn();
	} finally {
		setDevRuntimeForTesting(true);
	}
}
const withDevRuntime = (fn) => withRuntime(true, fn);
const withProdRuntime = (fn) => withRuntime(false, fn);

async function runTests() {
	console.log("Starting Cloudflare Registrar & Stripe Billing tests...\n");

	// ---------------------------------------------------------
	// 1. Unit Tests: Transparent Pricing & Cloudflare Registrar Client
	// ---------------------------------------------------------
	console.log("1. Testing Cloudflare Registrar Client & Transparent Pricing...");

	const comPricing = computeDomainPricing(10.44);
	assert.equal(comPricing.totalAnnualUsd, 20.0, "Standard .com wholesale maps to $20.00 total");
	assert.equal(comPricing.domainFeeUsd, 10.44, "Domain fee is $10.44");
	assert.equal(comPricing.platformFeeUsd, 9.56, "Platform & AI fee is $9.56 ($20.00 - $10.44)");
	assert.equal(computeRetailPrice(10.44), 20.0);

	const orgPricing = computeDomainPricing(10.11);
	assert.equal(orgPricing.totalAnnualUsd, 20.0, "Standard .org wholesale maps to $20.00 total");
	assert.equal(orgPricing.domainFeeUsd, 10.11);
	assert.equal(orgPricing.platformFeeUsd, 9.89);

	// Domains > $15 wholesale add flat $10 fee
	const ioPricing = computeDomainPricing(35.0);
	assert.equal(ioPricing.totalAnnualUsd, 45.0, "Premium .io ($35) maps to $45 total ($35 + $10)");
	assert.equal(ioPricing.domainFeeUsd, 35.0);
	assert.equal(ioPricing.platformFeeUsd, 10.0);
	assert.equal(computeRetailPrice(35.0), 45.0);

	const mockEnvInst = { CF_API_TOKEN: "", CF_ACCOUNT_ID: "" };

	const availCom = await checkDomainAvailability(mockEnvInst, "brand-new-startup-123.com");
	assert.equal(availCom.available, true, "New domain should be available");
	assert.equal(availCom.registered, false);
	assert.equal(availCom.retailPriceUsd, 20.0, "Retail price should be $20.00");
	assert.equal(availCom.pricing.domainFeeUsd, 10.44);
	assert.equal(availCom.pricing.platformFeeUsd, 9.56);
	assert.equal(availCom.tldSupported, true);

	const taken = await checkDomainAvailability(mockEnvInst, "google.com");
	assert.equal(taken.available, false, "google.com should not be available");
	assert.equal(taken.registered, true);

	const unsupported = await checkDomainAvailability(mockEnvInst, "example.faketld");
	assert.equal(unsupported.tldSupported, false);
	assert.equal(unsupported.available, false);

	// Test registration
	const registered = await registerDomain(mockEnvInst, "brand-new-startup-123.com");
	assert.equal(registered.status, "active");
	assert.equal(registered.registrationInfo.provider, "cloudflare_registrar");
	assert.equal(registered.locked, true);

	// Test transfer lock and EPP code
	const unlocked = await setDomainTransferLock(mockEnvInst, "brand-new-startup-123.com", false);
	assert.equal(unlocked, false);

	const eppCode = await getDomainEppCode(mockEnvInst, "brand-new-startup-123.com");
	assert.match(eppCode, /^EPP-/, "EPP code format should start with EPP-");

	// Test live Cloudflare Registrar API check (POST /accounts/{account_id}/registrar/domain-check)
	const origFetch = globalThis.fetch;
	try {
		globalThis.fetch = async (url, init) => {
			const urlStr = String(url);
			if (urlStr.includes("/registrar/domain-check")) {
				const body = JSON.parse(init.body);
				const reqDomain = body.domains[0];
				if (reqDomain === "live-available.com") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							success: true,
							result: {
								domains: [
									{
										name: "live-available.com",
										registrable: true,
										tier: "standard",
										pricing: {
											currency: "USD",
											registration_cost: "10.44",
											renewal_cost: "10.44",
										},
									},
								],
							},
						}),
					};
				} else if (reqDomain === "live-taken.com") {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							success: true,
							result: {
								domains: [
									{
										name: "live-taken.com",
										registrable: false,
										reason: "domain_unavailable",
									},
								],
							},
						}),
					};
				}
			}
			return origFetch(url, init);
		};

		const liveEnv = { CF_API_TOKEN: "test-token", CF_ACCOUNT_ID: "test-account" };
		const liveAvail = await checkDomainAvailability(liveEnv, "live-available.com");
		assert.equal(liveAvail.available, true, "Domain from live domain-check should be available");
		assert.equal(liveAvail.registered, false);
		assert.equal(liveAvail.retailPriceUsd, 20.0);
		assert.equal(liveAvail.pricing.domainFeeUsd, 10.44);
		assert.equal(liveAvail.pricing.platformFeeUsd, 9.56);

		const liveTaken = await checkDomainAvailability(liveEnv, "live-taken.com");
		assert.equal(liveTaken.available, false, "Domain from live domain-check should be taken");
		assert.equal(liveTaken.registered, true);

		// Test DoH fallback when registrar domain-check endpoint errors
		globalThis.fetch = async (url) => {
			const urlStr = String(url);
			if (urlStr.includes("/registrar/domain-check")) {
				return {
					ok: false,
					status: 403,
					json: async () => ({
						success: false,
						errors: [{ code: 10000, message: "Authentication error / unauthorized" }],
					}),
				};
			}
			if (urlStr.includes("cloudflare-dns.com/dns-query")) {
				if (urlStr.includes("doh-taken.com")) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							Status: 0,
							Answer: [{ name: "doh-taken.com", type: 2, data: "ns1.cloudflare.com" }],
						}),
					};
				}
				if (urlStr.includes("doh-available.com")) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							Status: 3, // NXDOMAIN
						}),
					};
				}
			}
			return origFetch(url);
		};

		const fallbackAvail = await checkDomainAvailability(liveEnv, "doh-available.com");
		assert.equal(fallbackAvail.available, true, "Fallback via DoH NXDOMAIN should report domain available");
		assert.equal(fallbackAvail.registered, false);

		const fallbackTaken = await checkDomainAvailability(liveEnv, "doh-taken.com");
		assert.equal(fallbackTaken.available, false, "Fallback via DoH NS should report domain taken");
		assert.equal(fallbackTaken.registered, true);
	} finally {
		globalThis.fetch = origFetch;
	}

	console.log("✔ Cloudflare Registrar & transparent pricing unit tests passed");

	// ---------------------------------------------------------
	// 2. HTTP Endpoint: GET /api/v1/auth/domains/check
	// ---------------------------------------------------------
	console.log("\n2. Testing GET /api/v1/auth/domains/check...");
	const bucket = mockBucket();
	const env = mockEnv(bucket);
	const reservationOf = (domain) => reservationIn(bucket, domain);

	// Invalid domain
	const invRes = await apiApp.request("/api/v1/auth/domains/check?domain=invalid", {}, env);
	assert.equal(invRes.status, 400);

	// Available domain
	const checkRes = await apiApp.request("/api/v1/auth/domains/check?domain=fresh-domain-88.com", {}, env);
	assert.equal(checkRes.status, 200);
	const checkData = await checkRes.json();
	assert.equal(checkData.available, true);
	assert.equal(checkData.retailPriceUsd, 20.0);
	assert.equal(checkData.pricing.domainFeeUsd, 10.44);
	assert.equal(checkData.pricing.platformFeeUsd, 9.56);
	assert.equal(checkData.alreadyInInboxies, false);

	// Domain already registered in Inboxies R2
	await saveDomainMetadata(bucket, {
		domain: "existing-inboxies.org",
		zoneId: "zone-existing",
		ownerUserId: "u-1",
		adminUserIds: ["u-1"],
		status: "active",
		nameservers: ["ns1.cloudflare.com"],
		emailRoutingEnabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	const existsRes = await apiApp.request("/api/v1/auth/domains/check?domain=existing-inboxies.org", {}, env);
	assert.equal(existsRes.status, 200);
	const existsData = await existsRes.json();
	assert.equal(existsData.available, false);
	assert.equal(existsData.alreadyInInboxies, true);
	assert.equal(existsData.retailPriceUsd, 20.0);

	console.log("✔ Domain availability check HTTP tests passed");

	// ---------------------------------------------------------
	// 3. HTTP Endpoint: POST /api/v1/billing/create-domain-checkout
	// ---------------------------------------------------------
	console.log("\n3. Testing POST /api/v1/billing/create-domain-checkout...");

	const ownerLogin = { username: "founder", password: "SuperSecretPassword123!" };
	const postCheckout = (body, envToUse = env) =>
		apiApp.request(
			"/api/v1/billing/create-domain-checkout",
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
			envToUse,
		);

	// Somebody must own what gets bought: a signed-in caller or a new login.
	const ownerlessRes = await postCheckout({ domain: "ownerless-domain.com" });
	assert.equal(ownerlessRes.status, 400, "signed-out checkout without a login is refused");

	// Conflict if domain is already in Inboxies
	const conflictRes = await postCheckout({ domain: "existing-inboxies.org", ...ownerLogin });
	assert.equal(conflictRes.status, 409);

	// Unavailable domain
	const unavailRes = await postCheckout({ domain: "google.com", ...ownerLogin });
	assert.equal(unavailRes.status, 400);

	const mockCheckoutBody = JSON.stringify({
		domain: "my-novel-company.com",
		username: "founder",
		displayName: "Alex Founder",
		password: "SuperSecretPassword123!",
		client: "ios",
	});
	// Mock session creation (without Stripe key) in local dev
	const checkoutRes = await withDevRuntime(() =>
		apiApp.request(
			"/api/v1/billing/create-domain-checkout",
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: mockCheckoutBody },
			env,
		),
	);
	assert.equal(checkoutRes.status, 200);
	const checkoutData = await checkoutRes.json();
	assert.equal(checkoutData.domain, "my-novel-company.com");
	assert.equal(checkoutData.priceUsd, 20.0);
	assert.equal(checkoutData.pricing.domainFeeUsd, 10.44);
	assert.equal(checkoutData.pricing.platformFeeUsd, 9.56);
	assert.ok(checkoutData.checkoutUrl.includes("my-novel-company.com"));
	assert.ok(checkoutData.sessionId.startsWith("mock_cs_"));
	const mockHoldId = new URL(checkoutData.checkoutUrl).searchParams.get("hold");
	assert.ok(mockHoldId, "the checkout URL carries its hold id for cancel");
	const mockRecord = await (await bucket.get(billingSessionKey(checkoutData.sessionId))).json();
	assert.ok(mockRecord.passwordHash, "the password hash stays in our own record");
	assert.equal(await reservationOf("my-novel-company.com").then((r) => r?.session_id), checkoutData.sessionId);

	// The domain is held: a second buyer can't start paying for it.
	const secondBuyerRes = await withDevRuntime(() =>
		postCheckout({ domain: "my-novel-company.com", username: "other", password: "AnotherPassword123!" }),
	);
	assert.equal(secondBuyerRes.status, 409, "a held domain can't be checked out twice");

	// Live Stripe Session Creation (with STRIPE_SECRET_KEY set)
	const stripeEnv = mockEnv(bucket, { STRIPE_SECRET_KEY: "sk_test_mock_key_123" });
	const originalFetch = globalThis.fetch;
	let capturedStripePayload = null;
	let capturedStripeHeaders = null;

	try {
		globalThis.fetch = async (url, init) => {
			const urlStr = String(url);
			if (urlStr.includes("api.stripe.com/v1/checkout/sessions")) {
				capturedStripePayload = new URLSearchParams(init.body);
				capturedStripeHeaders = init.headers;
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cs_stripe_live_test_777",
						url: "https://checkout.stripe.com/c/pay/cs_stripe_live_test_777",
					}),
				};
			}
			return originalFetch(url, init);
		};

		const liveCheckoutRes = await apiApp.request(
			"/api/v1/billing/create-domain-checkout",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "my-live-company.com",
					username: "founder",
					password: "SuperSecretPassword123!",
					client: "ios",
				}),
			},
			stripeEnv,
		);

		assert.equal(liveCheckoutRes.status, 200);
		const liveData = await liveCheckoutRes.json();
		assert.equal(liveData.sessionId, "cs_stripe_live_test_777");
		assert.equal(liveData.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_stripe_live_test_777");

		// Verify Stripe payload complies with rules:
		assert.ok(capturedStripePayload, "Stripe API payload should have been captured");
		assert.equal(capturedStripePayload.get("mode"), "subscription", "Mode must be subscription");
		assert.equal(capturedStripePayload.get("line_items[0][price_data][recurring][interval]"), "year");
		assert.equal(capturedStripePayload.get("line_items[0][price_data][unit_amount]"), "1044", "Domain fee is 1044 cents");
		assert.equal(capturedStripePayload.get("line_items[1][price_data][recurring][interval]"), "year");
		assert.equal(capturedStripePayload.get("line_items[1][price_data][unit_amount]"), "956", "Platform/AI fee is 956 cents");
		assert.ok(capturedStripePayload.get("success_url").startsWith("https://inboxies.email/api/v1/billing/checkout-return"));
		assert.ok(capturedStripePayload.get("cancel_url").startsWith("https://inboxies.email/api/v1/billing/checkout-cancel"));
		assert.equal(capturedStripePayload.get("payment_method_types[0]"), null, "Must omit payment_method_types for dynamic methods");
		assert.equal(capturedStripePayload.get("metadata[passwordHash]"), null, "No password hash in Stripe metadata");
		assert.equal(capturedStripePayload.get("subscription_data[metadata][domain]"), "my-live-company.com");
		const expiresAt = Number(capturedStripePayload.get("expires_at"));
		assert.ok(expiresAt - Date.now() / 1000 >= 34 * 60, "checkout expiry leaves room above Stripe's 30-minute minimum");
		assert.ok(new URL(capturedStripePayload.get("cancel_url")).searchParams.get("hold"), "cancel URL can release the hold");
		assert.equal(capturedStripeHeaders["Stripe-Version"], STRIPE_API_VERSION, "Stripe API version is pinned");
		const liveRecord = await (await bucket.get(billingSessionKey("cs_stripe_live_test_777"))).json();
		assert.ok(liveRecord.passwordHash, "the hash lives in our record instead");
		for (const [k, v] of capturedStripePayload) {
			assert.ok(!/password/i.test(k) && v !== liveRecord.passwordHash, `Stripe payload must not carry a password (${k})`);
		}
		assert.equal((await reservationOf("my-live-company.com"))?.session_id, "cs_stripe_live_test_777");
	} finally {
		globalThis.fetch = originalFetch;
	}

	console.log("✔ Create domain checkout subscription session tests passed");

	// ---------------------------------------------------------
	// 4. HTTP Endpoints: Hosted Bridge (checkout-return & checkout-cancel & checkout-status)
	// ---------------------------------------------------------
	console.log("\n4. Testing Hosted Bridge Endpoints (checkout-return, checkout-cancel, checkout-status)...");

	// Mobile return triggers deep link redirect with token if available
	const mobileReturnRes = await apiApp.request(
		"/api/v1/billing/checkout-return?domain=my-novel-company.com&session_id=cs_test_123&client=ios",
		{
			headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
		},
		env,
	);
	assert.equal(mobileReturnRes.status, 302);
	const mobileLoc = mobileReturnRes.headers.get("Location");
	assert.ok(mobileLoc.startsWith("inboxies://onboarding/domain-ready?domain=my-novel-company.com"));

	// Desktop web return redirects to /checkout/success
	const webReturnRes = await apiApp.request(
		"/api/v1/billing/checkout-return?domain=my-novel-company.com&session_id=cs_test_123",
		{
			headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
		},
		env,
	);
	assert.equal(webReturnRes.status, 302);
	assert.ok(webReturnRes.headers.get("Location").includes("/checkout/success"));

	// Cancellation endpoints
	const mobileCancelRes = await apiApp.request(
		"/api/v1/billing/checkout-cancel?domain=my-novel-company.com&client=ios",
		{},
		env,
	);
	assert.equal(mobileCancelRes.status, 302);
	assert.equal(mobileCancelRes.headers.get("Location"), "inboxies://onboarding/cancelled?domain=my-novel-company.com");

	const webCancelRes = await apiApp.request(
		"/api/v1/billing/checkout-cancel?domain=my-novel-company.com",
		{},
		env,
	);
	assert.equal(webCancelRes.status, 302);
	assert.equal(webCancelRes.headers.get("Location"), "/checkout/cancel?domain=my-novel-company.com");

	// Cancel without the checkout's hold id (anyone can hit this URL) keeps the hold.
	await apiApp.request("/api/v1/billing/checkout-cancel?domain=my-novel-company.com&hold=not-the-hold", {}, env);
	assert.ok(await reservationOf("my-novel-company.com"), "a guessed hold id releases nothing");
	// The checkout's own cancel URL gives the domain back.
	const holdCancelRes = await apiApp.request(
		`/api/v1/billing/checkout-cancel?domain=my-novel-company.com&hold=${encodeURIComponent(mockHoldId)}`,
		{},
		env,
	);
	assert.equal(holdCancelRes.status, 302);
	assert.equal(await reservationOf("my-novel-company.com"), null, "cancel releases the hold");
	const cancelledRecord = await (await bucket.get(billingSessionKey(checkoutData.sessionId))).json();
	assert.equal(cancelledRecord.status, "canceled");
	assert.equal(cancelledRecord.passwordHash, undefined, "a cancelled checkout drops the password hash");

	// Status endpoint
	const statusRes = await apiApp.request(
		"/api/v1/billing/checkout-status?domain=my-novel-company.com",
		{},
		env,
	);
	assert.equal(statusRes.status, 200);
	const statusData = await statusRes.json();
	assert.ok(statusData.status);

	console.log("✔ Hosted bridge endpoints tests passed");

	// ---------------------------------------------------------
	// 5. HTTP Endpoint: POST /api/v1/billing/stripe-webhook & HMAC Signature Verification
	// ---------------------------------------------------------
	console.log("\n5. Testing POST /api/v1/billing/stripe-webhook fulfillment & HMAC signature verification...");

	// Unit test for verifyStripeWebhookSignature
	const webhookSecret = "whsec_test_secret_for_unit_tests_12345";
	const rawPayload = JSON.stringify({ hello: "world" });
	const ts = Math.floor(Date.now() / 1000);
	const signedContent = `${ts}.${rawPayload}`;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(webhookSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const validSigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
	const validSigHex = Array.from(new Uint8Array(validSigBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const goodHeader = `t=${ts},v1=${validSigHex}`;
	const badHeader = `t=${ts},v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb`;

	const goodVerify = await verifyStripeWebhookSignature(rawPayload, goodHeader, webhookSecret);
	assert.equal(goodVerify.valid, true, "Valid HMAC signature should pass");

	const badVerify = await verifyStripeWebhookSignature(rawPayload, badHeader, webhookSecret);
	assert.equal(badVerify.valid, false, "Tampered signature should fail");

	// Webhook HTTP verification with secret configured
	const secureEnv = mockEnv(bucket, { STRIPE_WEBHOOK_SECRET: webhookSecret });

	const webhookPayload = {
		id: "evt_test_123",
		type: "checkout.session.completed",
		data: {
			object: {
				id: "cs_test_completed_123",
				payment_status: "paid",
				customer: "cus_test_founder",
				subscription: "sub_test_founder",
				metadata: {
					domain: "my-novel-company.com",
					username: "founder",
					displayName: "Alex Founder",
					totalAnnualUsd: "20.00",
					domainFeeUsd: "10.44",
					platformFeeUsd: "9.56",
				},
			},
		},
	};

	const rawWebhookBody = JSON.stringify(webhookPayload);
	const hookTs = Math.floor(Date.now() / 1000);
	const hookSigBuf = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(`${hookTs}.${rawWebhookBody}`),
	);
	const hookSigHex = Array.from(new Uint8Array(hookSigBuf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	// The checkout session record that create-domain-checkout would have saved.
	await bucket.put(billingSessionKey("cs_test_completed_123"), {
		sessionId: "cs_test_completed_123",
		domain: "my-novel-company.com",
		status: "pending",
		pricing: computeDomainPricing(10.44),
		username: "founder",
		displayName: "Alex Founder",
		passwordHash: "mock-pw-hash-99",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});
	await withProdRuntime(async () => {
		// Production without a usable secret fails closed, signed or not
		for (const [label, misconfiguredEnv] of [
			["missing secret", env],
			["placeholder secret", mockEnv(bucket, { STRIPE_WEBHOOK_SECRET: "whsec_..." })],
		]) {
			const unsignedRes = await postWebhook(rawWebhookBody, misconfiguredEnv);
			assert.equal(unsignedRes.status, 503, `Prod + ${label}: unsigned event must be rejected`);
			assert.match((await unsignedRes.json()).error, /not configured/);

			const forgedRes = await postWebhook(rawWebhookBody, misconfiguredEnv, {
				"stripe-signature": await stripeSignatureHeader(rawWebhookBody, "whsec_attacker_chosen"),
			});
			assert.equal(forgedRes.status, 503, `Prod + ${label}: self-signed event must be rejected`);
		}

		// 1. Rejected on invalid signature
		const rejectRes = await apiApp.request(
			"/api/v1/billing/stripe-webhook",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"stripe-signature": `t=${hookTs},v1=invalid_sig`,
				},
				body: rawWebhookBody,
			},
			secureEnv,
		);
		assert.equal(rejectRes.status, 400);

		const unsignedProdRes = await postWebhook(rawWebhookBody, secureEnv);
		assert.equal(unsignedProdRes.status, 400, "Prod + secret: missing stripe-signature must be rejected");

		const wrongSecretRes = await postWebhook(rawWebhookBody, secureEnv, {
			"stripe-signature": await stripeSignatureHeader(rawWebhookBody, "whsec_some_other_secret"),
		});
		assert.equal(wrongSecretRes.status, 400, "Prod + secret: signature from another secret must be rejected");
	});

	// A configured secret is enforced in local dev too
	const devUnsignedWithSecretRes = await withDevRuntime(() => postWebhook(rawWebhookBody, secureEnv));
	assert.equal(devUnsignedWithSecretRes.status, 400, "Dev + secret: unsigned event must be rejected");

	assert.equal(
		await getDomainMetadata(bucket, "my-novel-company.com"),
		null,
		"Rejected webhooks must not provision the domain",
	);

	// 2. Accepted on valid signature
	const webhookRes = await apiApp.request(
		"/api/v1/billing/stripe-webhook",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"stripe-signature": `t=${hookTs},v1=${hookSigHex}`,
			},
			body: rawWebhookBody,
		},
		secureEnv,
	);

	assert.equal(webhookRes.status, 200);
	const webhookData = await webhookRes.json();
	assert.equal(webhookData.status, "provisioned");
	assert.equal(webhookData.retailPriceUsd, 20.0);
	assert.equal(webhookData.pricing.domainFeeUsd, 10.44);
	assert.equal(webhookData.pricing.platformFeeUsd, 9.56);

	// Verify Domain Metadata was saved in R2
	const savedMeta = await getDomainMetadata(bucket, "my-novel-company.com");
	assert.ok(savedMeta, "Domain metadata should exist in R2");
	assert.equal(savedMeta.domain, "my-novel-company.com");
	assert.equal(savedMeta.status, "active");
	assert.equal(savedMeta.emailRoutingEnabled, true);
	assert.equal(savedMeta.registration?.provider, "cloudflare_registrar");
	assert.equal(savedMeta.registration?.retailPriceUsd, 20.0);
	assert.equal(savedMeta.registration?.locked, true);
	assert.equal(savedMeta.billing?.checkoutSessionId, "cs_test_completed_123");
	assert.equal(savedMeta.billing?.subscriptionId, "sub_test_founder");
	assert.equal(savedMeta.billing?.status, "active");
	assert.ok(await bucket.get("billing/customers/cus_test_founder.json"), "customer → domain index for lifecycle events");
	assert.equal(await reservationOf("my-novel-company.com"), null, "provisioning releases the hold");
	const fulfilledRecord = await (await bucket.get(billingSessionKey("cs_test_completed_123"))).json();
	assert.equal(fulfilledRecord.status, "ready");
	assert.equal(fulfilledRecord.passwordHash, undefined, "the password hash is dropped once the account exists");

	// Verify Admin Mailbox was provisioned in R2
	const mailboxMeta = await bucket.get("mailboxes/founder@my-novel-company.com.json");
	assert.ok(mailboxMeta, "Mailbox settings should be stored in R2");
	assert.equal((await mailboxMeta.json()).acl, undefined, "no ACL in R2 settings");

	// Ownership is AUTH_DB rows: a user whose login is the new mailbox, owning it and the domain.
	{
		const d1 = authDbFor(bucket);
		const owner = await d1.prepare("select id, email, email_verified from user where email = ?").bind("founder@my-novel-company.com").first();
		assert.ok(owner, "webhook created the owner user");
		assert.equal(owner.email_verified, 1);
		const credential = await d1.prepare("select password from account where user_id = ? and provider_id = 'credential'").bind(owner.id).first("password");
		assert.equal(credential, "mock-pw-hash-99", "the checkout's password hash is the credential");
		const member = await d1.prepare("select role from mailbox_member where mailbox_id = ? and user_id = ?").bind("founder@my-novel-company.com", owner.id).first("role");
		assert.equal(member, "owner");
		const domainRow = await d1.prepare("select owner_user_id, status from domain where domain = ?").bind("my-novel-company.com").first();
		assert.equal(domainRow.owner_user_id, owner.id);
		assert.equal(domainRow.status, "active");
	}

	// Verify status endpoint now reports ready
	const readyStatusRes = await apiApp.request(
		"/api/v1/billing/checkout-status?domain=my-novel-company.com",
		{},
		env,
	);
	const readyStatus = await readyStatusRes.json();
	assert.equal(readyStatus.status, "ready");
	assert.equal(readyStatus.domain, "my-novel-company.com");

	// checkout-return is public: knowing a provisioned domain must not yield
	// a session for its owner, on mobile or web.
	assert.ok(savedMeta.ownerUserId, "fixture domain must have an owner");
	const hijackMobile = await apiApp.request(
		"/api/v1/billing/checkout-return?domain=my-novel-company.com&client=ios",
		{},
		env,
	);
	const hijackMobileLoc = hijackMobile.headers.get("Location") || "";
	assert.ok(!hijackMobileLoc.includes("token="), "mobile return must not carry a session token");
	assert.ok(!(await hijackMobile.text()).includes("token="), "bridge page must not carry a session token");
	const hijackWeb = await apiApp.request(
		"/api/v1/billing/checkout-return?domain=my-novel-company.com",
		{ headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } },
		env,
	);
	assert.equal(hijackWeb.headers.get("Set-Cookie"), null, "web return must not set a session cookie");

	console.log("✔ Stripe webhook fulfillment & HMAC verification tests passed");

	// ---------------------------------------------------------
	// 6. Dev-only /checkout/mock simulator
	// ---------------------------------------------------------
	console.log("\n6. Testing dev-only /checkout/mock flow...");

	const shell = workerShell();

	await withProdRuntime(async () => {
		// Unreachable in production, including React Router data requests and path spelling variants
		for (const path of [
			"/checkout/mock?session_id=mock_cs_x&domain=x.com",
			"/checkout/mock/",
			"/checkout/mock.data",
			"/Checkout/MOCK",
			"/checkout/%6Dock",
		]) {
			const res = await shell.request(path, {}, env);
			assert.equal(res.status, 404, `Prod: ${path} must be unreachable`);
		}
		const successPageRes = await shell.request("/checkout/success?domain=x.com", {}, env);
		assert.equal(await successPageRes.text(), "react-router", "Guard must not catch other checkout pages");
	});

	// Dev without a secret still rejects a signature it cannot check
	const unknownSigHeader = await stripeSignatureHeader(rawWebhookBody, "whsec_unknown");
	const devSignedNoSecretRes = await withDevRuntime(() =>
		postWebhook(rawWebhookBody, env, { "stripe-signature": unknownSigHeader }),
	);
	assert.equal(devSignedNoSecretRes.status, 400, "Dev + no secret: signed delivery must be rejected");

	// End-to-end mock purchase in local dev (placeholder secret from .dev.vars.example)
	const devEnv = mockEnv(bucket, { STRIPE_WEBHOOK_SECRET: "whsec_..." });
	await withDevRuntime(async () => {
		const devCheckoutRes = await apiApp.request(
			"/api/v1/billing/create-domain-checkout",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "dev-mock-purchase.com",
					username: "admin",
					password: "DevMockPassword123!",
					client: "android",
				}),
			},
			devEnv,
		);
		assert.equal(devCheckoutRes.status, 200);
		const devCheckout = await devCheckoutRes.json();
		assert.equal(devCheckout.mock, true);
		const mockPage = new URL(devCheckout.checkoutUrl);
		assert.equal(mockPage.pathname, "/checkout/mock");

		const mockPageRes = await shell.request(`${mockPage.pathname}${mockPage.search}`, {}, devEnv);
		assert.equal(mockPageRes.status, 200);
		assert.equal(await mockPageRes.text(), "react-router", "Dev: /checkout/mock falls through to the SPA");

		// Same unsigned event app/routes/checkout-mock.tsx posts
		const mockEventRes = await postWebhook(
			JSON.stringify({
				type: "checkout.session.completed",
				data: {
					object: {
						id: devCheckout.sessionId,
						metadata: {
							domain: "dev-mock-purchase.com",
							username: "admin",
							displayName: "Admin",
							totalAnnualUsd: "20.00",
							domainFeeUsd: "10.44",
							platformFeeUsd: "9.56",
						},
					},
				},
			}),
			devEnv,
		);
		assert.equal(mockEventRes.status, 200, "Dev: unsigned mock event is accepted");
		assert.equal((await mockEventRes.json()).status, "provisioned");

		const devStatusRes = await apiApp.request(
			`/api/v1/billing/checkout-status?session_id=${encodeURIComponent(devCheckout.sessionId)}`,
			{},
			devEnv,
		);
		assert.equal((await devStatusRes.json()).status, "ready");
	});
	assert.equal((await getDomainMetadata(bucket, "dev-mock-purchase.com"))?.status, "active");

	console.log("✔ Dev-only /checkout/mock flow tests passed");
	// 7. Hardening: checkout-return token minting, replay, unpaid, prod-only gates
	// ---------------------------------------------------------
	console.log("\n7. Testing checkout-return token gating & webhook hardening...");

	const tokenFrom = (res) => new URL(res.headers.get("Location").replace("inboxies://", "https://x/")).searchParams.get("token");
	const mobileReturn = (query) =>
		apiApp.request(`/api/v1/billing/checkout-return?${query}&client=ios`, {}, env);

	// A bare domain (the old takeover) never yields a session.
	assert.equal(tokenFrom(await mobileReturn("domain=my-novel-company.com")), null);
	// Session id for a different domain: no token.
	assert.equal(
		tokenFrom(await mobileReturn("domain=other-domain.com&session_id=cs_test_completed_123")),
		null,
	);
	// The paid session for this domain: exactly one token.
	const firstReturn = await mobileReturn("domain=my-novel-company.com&session_id=cs_test_completed_123");
	assert.ok(tokenFrom(firstReturn), "paid session should hand out the owner session once");
	assert.equal(
		tokenFrom(await mobileReturn("domain=my-novel-company.com&session_id=cs_test_completed_123")),
		null,
		"token must not be minted twice",
	);
	// Web: no cookie without a matching ready session.
	const webBare = await apiApp.request("/api/v1/billing/checkout-return?domain=my-novel-company.com", {}, env);
	assert.equal(webBare.headers.get("Set-Cookie"), null);

	const signedPost = async (payload, envToUse) => {
		const raw = JSON.stringify(payload);
		const t = Math.floor(Date.now() / 1000);
		const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
		const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
		return apiApp.request(
			"/api/v1/billing/stripe-webhook",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "stripe-signature": `t=${t},v1=${hex}` },
				body: raw,
			},
			envToUse,
		);
	};

	// Stripe retries the same event: no second provisioning.
	const replay = await (await signedPost(webhookPayload, secureEnv)).json();
	assert.equal(replay.duplicate, true);

	// Unpaid sessions (delayed payment methods) never provision; they keep the domain held.
	const unpaid = await (
		await signedPost(
			{
				id: "evt_unpaid_1",
				type: "checkout.session.completed",
				data: { object: { id: "cs_unpaid", payment_status: "unpaid", metadata: { domain: "unpaid-domain.com" } } },
			},
			secureEnv,
		)
	).json();
	assert.equal(unpaid.status, "awaiting_payment");
	assert.equal(await getDomainMetadata(bucket, "unpaid-domain.com"), null);
	const pendingHold = await reservationOf("unpaid-domain.com");
	assert.equal(pendingHold?.status, "awaiting_payment");
	assert.equal(pendingHold?.expires_at, null, "a pending bank payment holds the domain until Stripe decides");

	// The delayed payment failed: the domain is free again.
	const asyncFailed = await (
		await signedPost(
			{
				id: "evt_unpaid_failed_1",
				type: "checkout.session.async_payment_failed",
				data: { object: { id: "cs_unpaid", payment_status: "unpaid", metadata: { domain: "unpaid-domain.com" } } },
			},
			secureEnv,
		)
	).json();
	assert.equal(asyncFailed.status, "failed");
	assert.equal(await reservationOf("unpaid-domain.com"), null);
	assert.equal(await getDomainMetadata(bucket, "unpaid-domain.com"), null);

	await withProdRuntime(async () => {
		// Production without Stripe keys must not fall back to the mock checkout.
		const prevFetch = globalThis.fetch;
		globalThis.fetch = async (url) => {
			if (String(url).includes("/registrar/domain-check")) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						success: true,
						result: {
							domains: [
								{
									name: "brand-new-prod-domain.com",
									registrable: true,
									pricing: { currency: "USD", registration_cost: "10.44", renewal_cost: "10.44" },
								},
							],
						},
					}),
				};
			}
			throw new Error(`unexpected fetch ${url}`);
		};
		try {
			const prodCheckout = await apiApp.request(
				"/api/v1/billing/create-domain-checkout",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ domain: "brand-new-prod-domain.com", ...ownerLogin }),
				},
				{ ...env, CF_API_TOKEN: "t", CF_ACCOUNT_ID: "a" },
			);
			assert.equal(prodCheckout.status, 503);
			assert.equal(
				[...bucket.store.keys()].some((key) => key.startsWith("billing/sessions/mock_cs_brand_new_prod_domain")),
				false,
				"No mock session record should be written in production",
			);
		} finally {
			globalThis.fetch = prevFetch;
		}
	});

	console.log("✔ checkout-return & webhook hardening tests passed");

	// ---------------------------------------------------------
	// 8. Billing: delayed payments, safe retries, refunds, subscription lifecycle
	// ---------------------------------------------------------
	console.log("\n8. Testing delayed payments, retries, refunds and subscription lifecycle...");

	const d1 = authDbFor(bucket);
	const saveRecordFixture = (sessionId, domain, extra = {}) =>
		bucket.put(billingSessionKey(sessionId), {
			sessionId,
			domain,
			status: "pending",
			pricing: computeDomainPricing(10.44),
			username: "owner",
			displayName: "Domain Owner",
			passwordHash: `hash-for-${sessionId}`,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			...extra,
		});
	const checkoutEvent = (eventId, type, sessionId, domain, object = {}) => ({
		id: eventId,
		type,
		data: {
			object: {
				id: sessionId,
				payment_status: "paid",
				metadata: { domain, username: "owner", totalAnnualUsd: "20.00", domainFeeUsd: "10.44", platformFeeUsd: "9.56" },
				...object,
			},
		},
	});
	const readRecord = async (sessionId) => (await bucket.get(billingSessionKey(sessionId))).json();

	/** Fake Stripe API: answers by "METHOD /path", records every call. */
	const withFakeStripe = async (routes, fn) => {
		const calls = [];
		const prevFetch = globalThis.fetch;
		globalThis.fetch = async (url, init = {}) => {
			const u = new URL(String(url));
			if (u.hostname !== "api.stripe.com") throw new Error(`unexpected fetch ${url}`);
			const route = `${init.method || "GET"} ${u.pathname}`;
			calls.push({ route, headers: init.headers, body: init.body ? new URLSearchParams(init.body) : null, search: u.search });
			const handler = routes[route];
			if (!handler) throw new Error(`unexpected Stripe call ${route}`);
			const { status = 200, body } = typeof handler === "function" ? handler(calls.length) : handler;
			return { ok: status < 300, status, json: async () => body };
		};
		try {
			return await fn(calls);
		} finally {
			globalThis.fetch = prevFetch;
		}
	};
	const stripeSecureEnv = mockEnv(bucket, { STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_SECRET_KEY: "sk_test_mock_key_123" });

	// 8a. A delayed payment that settles later is fulfilled, not dropped.
	await saveRecordFixture("cs_async_ok", "async-paid.com");
	const asyncPending = await (
		await signedPost(checkoutEvent("evt_async_1", "checkout.session.completed", "cs_async_ok", "async-paid.com", { payment_status: "unpaid" }), secureEnv)
	).json();
	assert.equal(asyncPending.status, "awaiting_payment");
	assert.equal((await readRecord("cs_async_ok")).status, "awaiting_payment");
	const asyncPaid = await signedPost(
		checkoutEvent("evt_async_2", "checkout.session.async_payment_succeeded", "cs_async_ok", "async-paid.com"),
		secureEnv,
	);
	assert.equal(asyncPaid.status, 200);
	assert.equal((await asyncPaid.json()).status, "provisioned", "async_payment_succeeded provisions the domain");
	assert.equal((await getDomainMetadata(bucket, "async-paid.com"))?.status, "active");
	assert.ok(
		await d1.prepare("select id from user where email = ?").bind("owner@async-paid.com").first("id"),
		"the owner account exists after the delayed payment",
	);

	// 8b. The registrar already made the zone: fulfillment reuses it instead of failing.
	const preexistingZone = await createZone({}, "zone-exists.com");
	await saveRecordFixture("cs_zone_exists", "zone-exists.com");
	const zoneRes = await signedPost(checkoutEvent("evt_zone_1", "checkout.session.completed", "cs_zone_exists", "zone-exists.com"), secureEnv);
	assert.equal(zoneRes.status, 200);
	assert.equal((await getDomainMetadata(bucket, "zone-exists.com"))?.zoneId, preexistingZone.id, "the existing zone is reused");
	assert.equal((await readRecord("cs_zone_exists")).zoneId, preexistingZone.id, "the zone id is recorded on the checkout");

	// 8c. A failure after the account was made: the retry adopts that account
	// (even if the record lost track of it) and never buys the domain twice.
	let reviveCalls = 0;
	const flakyEnv = mockEnv(bucket, {
		STRIPE_WEBHOOK_SECRET: webhookSecret,
		MAILBOX: {
			idFromName: (name) => name,
			get: (id) => ({
				id,
				reviveMailbox: async () => {
					reviveCalls += 1;
					if (reviveCalls === 1) throw new Error("mailbox storage unavailable");
				},
				getFolders: async () => [],
				getEmails: async () => [],
				countEmails: async () => 0,
			}),
		},
	});
	await saveRecordFixture("cs_retry_owner", "retry-owner.com");
	const retryEvent = checkoutEvent("evt_retry_1", "checkout.session.completed", "cs_retry_owner", "retry-owner.com");
	const firstTry = await signedPost(retryEvent, flakyEnv);
	assert.equal(firstTry.status, 502, "a transient failure asks Stripe to retry");
	const afterFirst = await readRecord("cs_retry_owner");
	assert.ok(afterFirst.registration, "the registration is recorded before later steps");
	assert.ok(afterFirst.ownerUserId, "the created account is recorded");
	assert.equal(afterFirst.mailboxInitializedAt, undefined);
	assert.equal(Number((await reservationOf("retry-owner.com")).expires_at), 0, "the failed attempt ends its lease");
	// Simulate the record write that names the owner never landing.
	await bucket.put(billingSessionKey("cs_retry_owner"), { ...afterFirst, ownerUserId: undefined, mailboxId: undefined });

	const secondTry = await signedPost(retryEvent, flakyEnv);
	assert.equal(secondTry.status, 200, "the retry finishes the job");
	const retryMeta = await getDomainMetadata(bucket, "retry-owner.com");
	assert.equal(retryMeta.ownerUserId, afterFirst.ownerUserId, "the retry adopts the account, not registrar_owner");
	const retryRecord = await readRecord("cs_retry_owner");
	assert.equal(retryRecord.registration.registeredAt, afterFirst.registration.registeredAt, "registered once");
	assert.ok(retryRecord.mailboxInitializedAt);
	assert.equal(
		await d1.prepare("select count(*) as n from user where email = ?").bind("owner@retry-owner.com").first("n"),
		1,
		"no second account",
	);

	// 8d. The domain went to someone else before payment: cancel the subscription and refund.
	mockRegisterElsewhereForTesting("sniped-domain.com");
	await saveRecordFixture("cs_live_sniped", "sniped-domain.com");
	const snipedEvent = checkoutEvent("evt_sniped_1", "checkout.session.completed", "cs_live_sniped", "sniped-domain.com", {
		subscription: "sub_sniped",
		invoice: "in_sniped",
		customer: "cus_sniped",
	});
	const stripeRoutes = (refundStatus) => ({
		"GET /v1/subscriptions/sub_sniped": { body: { id: "sub_sniped", status: "active" } },
		"DELETE /v1/subscriptions/sub_sniped": { body: { id: "sub_sniped", status: "canceled" } },
		"GET /v1/invoices/in_sniped": {
			body: { id: "in_sniped", payments: { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_sniped" } }] } },
		},
		"POST /v1/refunds": refundStatus === 200
			? { body: { id: "re_sniped" } }
			: { status: refundStatus, body: { error: { message: "Stripe is having a moment" } } },
	});
	// Stripe hiccups on the refund: answer 502 so Stripe retries the event.
	await withFakeStripe(stripeRoutes(500), async () => {
		const res = await signedPost(snipedEvent, stripeSecureEnv);
		assert.equal(res.status, 502, "a failed refund is retried");
	});
	assert.equal((await readRecord("cs_live_sniped")).terminalError !== undefined, true, "the terminal reason is kept for the retry");
	await withFakeStripe(stripeRoutes(200), async (calls) => {
		const res = await signedPost(snipedEvent, stripeSecureEnv);
		assert.equal(res.status, 200);
		assert.equal((await res.json()).status, "refunded");
		const routes = calls.map((c) => c.route);
		assert.ok(routes.indexOf("DELETE /v1/subscriptions/sub_sniped") < routes.indexOf("POST /v1/refunds"), "cancel before refund");
		const refundCall = calls.find((c) => c.route === "POST /v1/refunds");
		assert.equal(refundCall.body.get("payment_intent"), "pi_sniped");
		assert.equal(refundCall.headers["Idempotency-Key"], "inboxies-refund-pi_sniped", "refunds are idempotent");
		assert.ok(calls.every((c) => c.headers["Stripe-Version"] === STRIPE_API_VERSION));
		assert.ok(calls.find((c) => c.route === "GET /v1/invoices/in_sniped").search.includes("expand"));
	});
	const snipedRecord = await readRecord("cs_live_sniped");
	assert.equal(snipedRecord.status, "refunded");
	assert.deepEqual(snipedRecord.refundIds, ["re_sniped"]);
	assert.equal(snipedRecord.passwordHash, undefined);
	assert.equal(await reservationOf("sniped-domain.com"), null);
	assert.equal(await getDomainMetadata(bucket, "sniped-domain.com"), null, "nothing provisioned");
	assert.equal(
		await d1.prepare("select id from user where email = ?").bind("owner@sniped-domain.com").first("id"),
		null,
		"no account for a refunded checkout",
	);
	const refundedStatus = await (
		await apiApp.request("/api/v1/billing/checkout-status?session_id=cs_live_sniped", {}, env)
	).json();
	assert.equal(refundedStatus.status, "refunded");
	assert.match(refundedStatus.error, /registered by someone else/);

	// 8e. Another buyer holds the domain: the paid session is refunded, the hold stays theirs.
	const contestedCheckout = await withDevRuntime(() =>
		postCheckout({ domain: "contested-domain.com", username: "first", password: "FirstBuyerPassword1!" }),
	);
	assert.equal(contestedCheckout.status, 200);
	const firstBuyerSession = (await contestedCheckout.json()).sessionId;
	await saveRecordFixture("cs_live_contested", "contested-domain.com");
	await withFakeStripe(
		{
			"GET /v1/invoices/in_contested": { body: { id: "in_contested", payments: { data: [] } } },
		},
		async () => {
			const res = await signedPost(
				checkoutEvent("evt_contested_1", "checkout.session.completed", "cs_live_contested", "contested-domain.com", {
					invoice: "in_contested",
				}),
				stripeSecureEnv,
			);
			assert.equal((await res.json()).status, "refunded");
		},
	);
	assert.equal((await reservationOf("contested-domain.com"))?.session_id, firstBuyerSession, "the first buyer keeps the hold");

	// 8e2. A checkout hold that lapsed (tab closed, never paid) doesn't block the next buyer,
	// but a pending bank payment does.
	await d1
		.prepare("insert into domain_reservation (domain, hold_id, session_id, status, expires_at) values (?, 'old-hold', 'cs_abandoned', 'checkout', ?)")
		.bind("lapsed-hold.com", Date.now() - 1000)
		.run();
	const lapsedRes = await withDevRuntime(() => postCheckout({ domain: "lapsed-hold.com", ...ownerLogin }));
	assert.equal(lapsedRes.status, 200, "a lapsed hold is taken over");
	assert.notEqual((await reservationOf("lapsed-hold.com")).session_id, "cs_abandoned");
	await d1
		.prepare("insert into domain_reservation (domain, session_id, status, expires_at) values (?, 'cs_bank', 'awaiting_payment', null)")
		.bind("bank-pending.com")
		.run();
	const bankPendingRes = await withDevRuntime(() => postCheckout({ domain: "bank-pending.com", ...ownerLogin }));
	assert.equal(bankPendingRes.status, 409, "a pending bank payment keeps the domain");

	// 8f. Another delivery of the same checkout is mid-provisioning: back off, don't buy twice.
	await d1
		.prepare("insert into domain_reservation (domain, session_id, status, expires_at) values (?, ?, 'provisioning', ?)")
		.bind("busy-domain.com", "cs_busy", Date.now() + 60_000)
		.run();
	await saveRecordFixture("cs_busy", "busy-domain.com");
	const busyRes = await signedPost(checkoutEvent("evt_busy_1", "checkout.session.completed", "cs_busy", "busy-domain.com"), secureEnv);
	assert.equal(busyRes.status, 409, "a live lease makes Stripe retry later");
	assert.equal((await readRecord("cs_busy")).registration, undefined, "nothing bought while another attempt holds the lease");

	// 8g. A domain already set up by someone else: the payment is not kept.
	await saveRecordFixture("cs_dupe_existing", "existing-inboxies.org");
	const dupeRes = await (
		await signedPost(checkoutEvent("evt_dupe_1", "checkout.session.completed", "cs_dupe_existing", "existing-inboxies.org"), secureEnv)
	).json();
	assert.equal(dupeRes.status, "failed", "without Stripe credentials it can't refund, but it never provisions");
	assert.equal((await getDomainMetadata(bucket, "existing-inboxies.org")).billing, undefined);

	// 8h. Subscription lifecycle on the domain bought in section 5 (customer cus_test_founder).
	const t0 = Math.floor(Date.now() / 1000);
	const lifecycle = (id, type, created, object) => signedPost({ id, type, created, data: { object } }, secureEnv);
	const founderBilling = async () => (await getDomainMetadata(bucket, "my-novel-company.com")).billing;

	await lifecycle("evt_inv_create", "invoice.paid", t0, { customer: "cus_test_founder", billing_reason: "subscription_create" });
	assert.equal((await founderBilling()).statusEventAt, undefined, "the first invoice belongs to the checkout");

	await lifecycle("evt_inv_failed", "invoice.payment_failed", t0 + 10, { customer: "cus_test_founder", billing_reason: "subscription_cycle" });
	assert.equal((await founderBilling()).status, "past_due");
	assert.ok((await founderBilling()).pastDueSince);

	await lifecycle("evt_sub_old", "customer.subscription.updated", t0 + 5, {
		customer: "cus_test_founder",
		status: "active",
		cancel_at_period_end: true,
	});
	assert.equal((await founderBilling()).status, "past_due", "an older event doesn't override a newer status");
	assert.ok(!(await founderBilling()).cancelAtPeriodEnd, "nor does it schedule the end of service");

	await lifecycle("evt_inv_paid", "invoice.paid", t0 + 20, { customer: "cus_test_founder", billing_reason: "subscription_cycle" });
	assert.equal((await founderBilling()).status, "active");
	assert.equal((await founderBilling()).pastDueSince, undefined);

	await lifecycle("evt_refund", "charge.refunded", t0 + 30, { customer: "cus_test_founder", amount_refunded: 956 });
	assert.equal((await founderBilling()).amountRefunded, 956);

	await withFakeStripe({ "GET /v1/charges/ch_disputed": { body: { id: "ch_disputed", customer: "cus_test_founder" } } }, async () => {
		const res = await signedPost(
			{ id: "evt_dispute", type: "charge.dispute.created", created: t0 + 40, data: { object: { charge: "ch_disputed", status: "needs_response" } } },
			stripeSecureEnv,
		);
		assert.equal(res.status, 200);
	});
	assert.equal((await founderBilling()).disputeStatus, "needs_response");
	assert.ok((await founderBilling()).disputedAt);

	await lifecycle("evt_sub_deleted", "customer.subscription.deleted", t0 + 50, { customer: "cus_test_founder", status: "canceled" });
	const endedMeta = await getDomainMetadata(bucket, "my-novel-company.com");
	assert.equal(endedMeta.billing.status, "canceled");
	assert.ok(endedMeta.billing.canceledAt);
	assert.equal(endedMeta.registration.autoRenew, false, "nobody pays for it any more: no auto-renew");
	assert.equal(endedMeta.status, "active", "mail keeps working until the registration lapses");

	const unknownCustomer = await (
		await lifecycle("evt_unknown_cus", "invoice.payment_failed", t0 + 60, { customer: "cus_nobody", billing_reason: "subscription_cycle" })
	).json();
	assert.equal(unknownCustomer.ignored, true);

	// 8i. Race: our claim fails because our own earlier delivery holds the lease, and that
	// delivery finishes (releasing the row) before we look at who holds it. That must be a
	// retry, never a refund of a purchase that just succeeded.
	await d1
		.prepare("insert into domain_reservation (domain, session_id, status, expires_at) values (?, ?, 'provisioning', ?)")
		.bind("race-domain.com", "cs_live_race", Date.now() + 60_000)
		.run();
	await saveRecordFixture("cs_live_race", "race-domain.com");
	const racyD1 = {
		...d1,
		prepare(sql) {
			const stmt = d1.prepare(sql);
			if (!/^insert into "domain_reservation"/i.test(sql)) return stmt;
			// The other delivery finishes right after our claim fails.
			const releaseAfter = (fn) => async (...args) => {
				const out = await fn(...args);
				d1.sqlite.prepare("delete from domain_reservation where domain = 'race-domain.com'").run();
				return out;
			};
			return {
				bind: (...params) => {
					const bound = stmt.bind(...params);
					return { all: releaseAfter(() => bound.all()), raw: releaseAfter(() => bound.raw()), run: releaseAfter(() => bound.run()), first: (c) => bound.first(c) };
				},
			};
		},
		batch: (s) => d1.batch(s),
	};
	await withFakeStripe({}, async (calls) => {
		const res = await signedPost(
			checkoutEvent("evt_race_1", "checkout.session.completed", "cs_live_race", "race-domain.com", {
				subscription: "sub_race",
				invoice: "in_race",
			}),
			{ ...stripeSecureEnv, AUTH_DB: racyD1 },
		);
		assert.equal(res.status, 409, "no holder after a failed claim means retry");
		assert.equal(calls.length, 0, "no Stripe cancel or refund");
	});
	assert.equal((await readRecord("cs_live_race")).status, "pending");

	// 8j. The registrar refuses and then can't tell us whether we own the name:
	// retry, don't refund (an earlier attempt may have bought it).
	{
		await saveRecordFixture("cs_live_lookup", "lookup-error.com");
		const calls = [];
		const prevFetch = globalThis.fetch;
		globalThis.fetch = async (url, init = {}) => {
			const u = new URL(String(url));
			calls.push(`${init.method || "GET"} ${u.hostname}${u.pathname}`);
			if (u.hostname === "api.cloudflare.com" && (init.method || "GET") === "POST") {
				return { ok: false, status: 400, json: async () => ({ success: false, errors: [{ code: 1, message: "not available" }] }) };
			}
			if (u.hostname === "api.cloudflare.com") {
				return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ code: 2, message: "registrar down" }] }) };
			}
			throw new Error(`unexpected fetch ${url}`);
		};
		try {
			const res = await signedPost(
				checkoutEvent("evt_lookup_1", "checkout.session.completed", "cs_live_lookup", "lookup-error.com", { subscription: "sub_lookup" }),
				{ ...stripeSecureEnv, CF_API_TOKEN: "t", CF_ACCOUNT_ID: "a" },
			);
			assert.equal(res.status, 502, "an ownership lookup error is retried");
		} finally {
			globalThis.fetch = prevFetch;
		}
		assert.ok(!calls.some((c) => c.includes("api.stripe.com")), "no refund while ownership is unknown");
		assert.equal((await readRecord("cs_live_lookup")).terminalError, undefined);
	}

	// 8k. Same buyer starting over (closed the Stripe tab) gets their hold back; others don't.
	const startFirst = await withDevRuntime(() => postCheckout({ domain: "start-over.com", username: "me", password: "MyOwnPassword123!" }));
	assert.equal(startFirst.status, 200);
	const firstSession = (await startFirst.json()).sessionId;
	const stranger = await withDevRuntime(() => postCheckout({ domain: "start-over.com", username: "me", password: "NotMyPassword1234!" }));
	assert.equal(stranger.status, 409, "the wrong password can't take the hold");
	const startOver = await withDevRuntime(() => postCheckout({ domain: "start-over.com", username: "me", password: "MyOwnPassword123!" }));
	assert.equal(startOver.status, 200, "the same buyer can start over");
	const secondSession = (await startOver.json()).sessionId;
	assert.equal((await reservationOf("start-over.com")).session_id, secondSession);
	const replaced = await readRecord(firstSession);
	assert.equal(replaced.status, "canceled");
	assert.equal(replaced.passwordHash, undefined);

	// 8l. A subscription event for a checkout still awaiting its bank payment is retried, not dropped.
	await saveRecordFixture("cs_bank_customer", "bank-customer.com");
	await signedPost(
		checkoutEvent("evt_bank_1", "checkout.session.completed", "cs_bank_customer", "bank-customer.com", {
			payment_status: "unpaid",
			customer: "cus_bank",
		}),
		secureEnv,
	);
	const earlyEvent = await signedPost(
		{ id: "evt_bank_sub_deleted", type: "customer.subscription.deleted", created: t0 + 70, data: { object: { customer: "cus_bank", status: "canceled" } } },
		secureEnv,
	);
	assert.equal(earlyEvent.status, 409, "Stripe redelivers once the domain is set up");

	console.log("✔ Delayed payment, retry, refund & lifecycle tests passed");


	console.log("\n=========================================");
	console.log("ALL REGISTRAR & BILLING TESTS PASSED!");
	console.log("=========================================\n");
}

runTests().catch((err) => {
	console.error("\n❌ Test failed:", err);
	process.exit(1);
});
