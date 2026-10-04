/**
 * Tests for Cloudflare Registrar domain availability, Stripe $14/yr checkout sessions,
 * and automated domain provisioning webhook.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-purchase-and-billing.test.mjs
 */

import assert from "node:assert/strict";
import { app as apiApp } from "../index.ts";
import {
	checkDomainAvailability,
	registerDomain,
	getDomainEppCode,
	setDomainTransferLock,
	computeRetailPrice,
} from "../lib/cloudflare-registrar.ts";
import {
	saveDomainMetadata,
	getDomainMetadata,
} from "../lib/domain-registry.ts";

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

function mockEnv(bucket, extras = {}) {
	return {
		BUCKET: bucket,
		EMAIL_ADDRESSES: [],
		DOMAINS: "inboxies.email",
		DOMAIN_ADMINS: "superadmin@example.com",
		MAILBOX_CREATE_POLICY: "admin_only",
		MOBILE_JWT_SECRET: "test-mobile-jwt-secret-billing-99",
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

async function runTests() {
	console.log("Starting Cloudflare Registrar & Stripe Billing tests...\n");

	// ---------------------------------------------------------
	// 1. Unit Tests: Pricing & Cloudflare Registrar Client
	// ---------------------------------------------------------
	console.log("1. Testing Cloudflare Registrar Client & Pricing...");

	assert.equal(computeRetailPrice(10.44), 14.0, "Standard .com wholesale maps to $14 retail");
	assert.equal(computeRetailPrice(10.11), 14.0, "Standard .org wholesale maps to $14 retail");
	assert.equal(computeRetailPrice(35.0), 39.0, "Premium .io wholesale maps to $39 retail ($35 + $3.50 margin ceil)");

	const mockEnvInst = { CF_API_TOKEN: "", CF_ACCOUNT_ID: "" };

	const availCom = await checkDomainAvailability(mockEnvInst, "brand-new-startup-123.com");
	assert.equal(availCom.available, true, "New domain should be available");
	assert.equal(availCom.registered, false);
	assert.equal(availCom.retailPriceUsd, 14.0, "Retail price should be $14.00");
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
		assert.equal(liveAvail.retailPriceUsd, 14.0);

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

	console.log("✔ Cloudflare Registrar unit tests passed");

	// ---------------------------------------------------------
	// 2. HTTP Endpoint: GET /api/v1/auth/domains/check
	// ---------------------------------------------------------
	console.log("\n2. Testing GET /api/v1/auth/domains/check...");
	const bucket = mockBucket();
	const env = mockEnv(bucket);

	// Invalid domain
	const invRes = await apiApp.request("/api/v1/auth/domains/check?domain=invalid", {}, env);
	assert.equal(invRes.status, 400);

	// Available domain
	const checkRes = await apiApp.request("/api/v1/auth/domains/check?domain=fresh-domain-88.com", {}, env);
	assert.equal(checkRes.status, 200);
	const checkData = await checkRes.json();
	assert.equal(checkData.available, true);
	assert.equal(checkData.retailPriceUsd, 14.0);
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

	console.log("✔ Domain availability check HTTP tests passed");

	// ---------------------------------------------------------
	// 3. HTTP Endpoint: POST /api/v1/billing/create-domain-checkout
	// ---------------------------------------------------------
	console.log("\n3. Testing POST /api/v1/billing/create-domain-checkout...");

	// Conflict if domain is already in Inboxies
	const conflictRes = await apiApp.request(
		"/api/v1/billing/create-domain-checkout",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "existing-inboxies.org" }),
		},
		env,
	);
	assert.equal(conflictRes.status, 409);

	// Unavailable domain
	const unavailRes = await apiApp.request(
		"/api/v1/billing/create-domain-checkout",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ domain: "google.com" }),
		},
		env,
	);
	assert.equal(unavailRes.status, 400);

	// Success session creation
	const checkoutRes = await apiApp.request(
		"/api/v1/billing/create-domain-checkout",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				domain: "my-novel-company.com",
				username: "founder",
				displayName: "Alex Founder",
				password: "SuperSecretPassword123!",
			}),
		},
		env,
	);
	assert.equal(checkoutRes.status, 200);
	const checkoutData = await checkoutRes.json();
	assert.equal(checkoutData.domain, "my-novel-company.com");
	assert.equal(checkoutData.priceUsd, 14.0);
	assert.ok(checkoutData.checkoutUrl.includes("my-novel-company.com"));
	assert.ok(checkoutData.sessionId.startsWith("mock_cs_"));

	console.log("✔ Create domain checkout session tests passed");

	// ---------------------------------------------------------
	// 4. HTTP Endpoint: GET /api/v1/billing/checkout-return
	// ---------------------------------------------------------
	console.log("\n4. Testing GET /api/v1/billing/checkout-return...");

	// Mobile return triggers deep link redirect
	const mobileReturnRes = await apiApp.request(
		"/api/v1/billing/checkout-return?domain=my-novel-company.com&session_id=cs_test_123",
		{
			headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
		},
		env,
	);
	assert.equal(mobileReturnRes.status, 302);
	const mobileLoc = mobileReturnRes.headers.get("Location");
	assert.ok(mobileLoc.startsWith("inboxies://onboarding/domain-ready?domain=my-novel-company.com"));

	// Desktop web return redirects to web admin
	const webReturnRes = await apiApp.request(
		"/api/v1/billing/checkout-return?domain=my-novel-company.com&session_id=cs_test_123",
		{
			headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
		},
		env,
	);
	assert.equal(webReturnRes.status, 302);
	assert.ok(webReturnRes.headers.get("Location").includes("/admin?tab=dns"));

	console.log("✔ Checkout return redirect tests passed");

	// ---------------------------------------------------------
	// 5. HTTP Endpoint: POST /api/v1/billing/stripe-webhook
	// ---------------------------------------------------------
	console.log("\n5. Testing POST /api/v1/billing/stripe-webhook fulfillment...");

	const webhookPayload = {
		id: "evt_test_123",
		type: "checkout.session.completed",
		data: {
			object: {
				id: "cs_test_completed_123",
				metadata: {
					domain: "my-novel-company.com",
					username: "founder",
					displayName: "Alex Founder",
					passwordHash: "mock-pw-hash-99",
				},
			},
		},
	};

	const webhookRes = await apiApp.request(
		"/api/v1/billing/stripe-webhook",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(webhookPayload),
		},
		env,
	);

	assert.equal(webhookRes.status, 200);
	const webhookData = await webhookRes.json();
	assert.equal(webhookData.status, "provisioned");
	assert.equal(webhookData.retailPriceUsd, 14.0);

	// Verify Domain Metadata was saved in R2
	const savedMeta = await getDomainMetadata(bucket, "my-novel-company.com");
	assert.ok(savedMeta, "Domain metadata should exist in R2");
	assert.equal(savedMeta.domain, "my-novel-company.com");
	assert.equal(savedMeta.status, "active");
	assert.equal(savedMeta.emailRoutingEnabled, true);
	assert.equal(savedMeta.registration?.provider, "cloudflare_registrar");
	assert.equal(savedMeta.registration?.retailPriceUsd, 14.0);
	assert.equal(savedMeta.registration?.locked, true);

	// Verify Admin Mailbox was provisioned in R2
	const mailboxMeta = await bucket.get("mailboxes/founder@my-novel-company.com.json");
	assert.ok(mailboxMeta, "Mailbox settings should be stored in R2");

	console.log("✔ Stripe webhook fulfillment tests passed");

	console.log("\n=========================================");
	console.log("ALL REGISTRAR & BILLING TESTS PASSED!");
	console.log("=========================================\n");
}

runTests().catch((err) => {
	console.error("\n❌ Test failed:", err);
	process.exit(1);
});
