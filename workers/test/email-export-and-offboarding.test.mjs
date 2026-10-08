/**
 * Tests for Email Data Export (.mbox RFC 4155), Decommission Safeguards, and EPP Transfer.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/email-export-and-offboarding.test.mjs
 */

import assert from "node:assert/strict";
import { app as apiApp } from "../index.ts";
import {
	formatAsctime,
	fromQuote,
	formatMboxEntry,
	exportMailboxToMbox,
	runMailboxExportJob,
	runDomainExportJob,
	hasRecentExportForDomain,
} from "../lib/email-exporter.ts";
import {
	saveDomainMetadata,
	getDomainMetadata,
} from "../lib/domain-registry.ts";
import { principalFromClaims } from "../lib/mailbox-acl.ts";

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
			const val = store.get(key);
			return {
				text: async () => (typeof val === "string" ? val : JSON.stringify(val)),
				json: async () => (typeof val === "string" ? JSON.parse(val) : val),
				body: typeof val === "string" ? val : JSON.stringify(val),
			};
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

function mockEnv(bucket, sampleEmails = []) {
	return {
		BUCKET: bucket,
		EMAIL_ADDRESSES: [],
		DOMAINS: "inboxies.email",
		DOMAIN_ADMINS: "superadmin@example.com",
		MAILBOX_CREATE_POLICY: "admin_only",
		MOBILE_JWT_SECRET: "test-mobile-jwt-secret-export-99",
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
					getBatchForExport: async (offset = 0, limit = 200) => {
						return sampleEmails.slice(offset, offset + limit);
					},
					getEmails: async () => sampleEmails,
					getTotalEmailCountForExport: async () => sampleEmails.length,
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
	};
}

import { Hono } from "hono";

function harness(env, defaultPrincipal = null) {
	const parent = new Hono();
	parent.use("*", async (c, next) => {
		const override = c.req.header("x-test-user");
		if (override) {
			c.set("principal", principalFromClaims({ email: override, sub: `sub-${override}` }));
		} else if (defaultPrincipal) {
			c.set("principal", defaultPrincipal);
		}
		return next();
	});
	parent.route("/", apiApp);
	return {
		async request(path, init = {}) {
			const url = path.startsWith("http") ? path : `http://localhost${path}`;
			const req = new Request(url, init);
			return parent.fetch(req, env);
		},
	};
}

async function runTests() {
	console.log("Starting Email Export Engine & Offboarding Safeguard tests...\n");

	// ---------------------------------------------------------
	// 1. Unit Tests: RFC 4155 Formatting & From-Quoting
	// ---------------------------------------------------------
	console.log("1. Testing RFC 4155 MBOX formatting...");

	const asctime = formatAsctime(new Date("2026-10-01T12:00:00Z"));
	assert.ok(asctime.length >= 24, "Asctime format should be at least 24 chars");
	assert.match(asctime, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) /);

	// Test From-Quoting
	const rawBody = "Hello world\nFrom the other side\nFrom here";
	const quoted = fromQuote(rawBody);
	assert.equal(quoted, "Hello world\n>From the other side\n>From here", "Body lines starting with From must be escaped to >From");

	// Test formatMboxEntry
	const entry = formatMboxEntry("alice@example.com", "2026-10-01T12:00:00Z", "Subject: Hi\r\n\r\nHello!", "Archive");
	assert.ok(entry.startsWith("From alice@example.com "), "Entry must start with From <sender> <date>");
	assert.ok(entry.includes("X-Folder: Archive\r\n"), "Entry should include folder metadata");
	assert.ok(entry.endsWith("\r\n\r\n"), "Entry must terminate with blank line");

	console.log("✔ RFC 4155 unit tests passed");

	// ---------------------------------------------------------
	// 2. Unit Tests: Mailbox & Domain Export Execution
	// ---------------------------------------------------------
	console.log("\n2. Testing Mailbox & Domain MBOX export execution...");

	const bucket = mockBucket();
	const sampleEmails = [
		{
			id: "email-1",
			subject: "First email",
			sender: "bob@example.com",
			sender_name: "Bob Jones",
			recipient: "you@acme.com",
			date: "2026-09-15T10:00:00Z",
			folder_id: "inbox",
		},
		{
			id: "email-2",
			subject: "Second email",
			sender: "carol@example.com",
			sender_name: "Carol Smith",
			recipient: "you@acme.com",
			date: "2026-09-16T11:00:00Z",
			folder_id: "sent",
		},
	];

	// Store raw eml for email-1
	await bucket.put(
		"emails/email-1/raw.eml",
		"From: \"Bob Jones\" <bob@example.com>\r\nTo: you@acme.com\r\nSubject: First email\r\n\r\nHello Bob",
	);

	// Store body.html for email-2 (fallback test)
	await bucket.put(
		"emails/email-2/body.html",
		"<p>Hello Carol</p>",
	);

	const env = mockEnv(bucket, sampleEmails);

	// Run single mailbox export
	const mailboxResult = await exportMailboxToMbox(env, "you@acme.com");
	assert.equal(mailboxResult.totalEmails, 2, "Should export 2 emails");
	assert.ok(mailboxResult.mboxContent.includes("From bob@example.com "), "MBOX should contain Bob's message");
	assert.ok(mailboxResult.mboxContent.includes("From carol@example.com "), "MBOX should contain Carol's reconstructed message");

	// Run export job packaged to R2
	const job = await runMailboxExportJob(env, "you@acme.com");
	assert.equal(job.status, "completed");
	assert.equal(job.totalEmails, 2);
	assert.ok(job.downloadUrl.includes(job.id));
	assert.ok(job.fileSizeBytes > 0);

	// Verify MBOX file stored in R2
	const storedMbox = await bucket.get(job.downloadKey);
	assert.ok(storedMbox, "MBOX file must exist in R2");

	const mailboxOnlyCheck = await hasRecentExportForDomain(bucket, "acme.com");
	assert.equal(mailboxOnlyCheck.hasExport, false, "A single-mailbox export must not count as a domain backup");
	assert.equal(mailboxOnlyCheck.lastExport, undefined);

	// Setup multiple mailboxes for acme.com domain
	await bucket.put("mailboxes/you@acme.com.json", JSON.stringify({ fromName: "You" }));
	await bucket.put("mailboxes/support@acme.com.json", JSON.stringify({ fromName: "Support" }));

	const domainJob = await runDomainExportJob(env, "acme.com");
	assert.equal(domainJob.status, "completed");
	assert.equal(domainJob.targetType, "domain");
	assert.ok(domainJob.totalEmails >= 2);

	const recentCheck = await hasRecentExportForDomain(bucket, "acme.com");
	assert.equal(recentCheck.hasExport, true, "Should report recent export exists");
	assert.equal(recentCheck.lastExport?.id, domainJob.id);

	console.log("✔ Mailbox & Domain export execution tests passed");

	// ---------------------------------------------------------
	// 3. HTTP Endpoints: Export API & Download
	// ---------------------------------------------------------
	console.log("\n3. Testing Export API & Download streaming...");

	// Register domain in R2
	await saveDomainMetadata(bucket, {
		domain: "acme.com",
		zoneId: "zone-acme",
		ownerUserId: "admin-user",
		adminUserIds: ["admin-user"],
		status: "active",
		nameservers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
		emailRoutingEnabled: true,
		registration: {
			provider: "cloudflare_registrar",
			registeredAt: new Date().toISOString(),
			autoRenew: true,
			whoisPrivacy: true,
			locked: true,
			retailPriceUsd: 14.0,
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	const adminPrincipal = { email: "admin@acme.com", linkedUserIds: ["admin-user"] };
	const client = harness(env, adminPrincipal);

	// Domain export via admin endpoint
	const adminDomainExportRes = await client.request(
		"/api/v1/admin/domains/acme.com/export",
		{
			method: "POST",
		},
	);

	assert.equal(adminDomainExportRes.status, 200);
	const exportData = await adminDomainExportRes.json();
	assert.equal(exportData.status, "completed");
	assert.ok(exportData.exportId);

	// Download exported .mbox stream
	const downloadRes = await client.request(
		`/api/v1/exports/${exportData.exportId}/download`,
	);
	assert.equal(downloadRes.status, 200);
	assert.equal(downloadRes.headers.get("Content-Type"), "application/mbox; charset=utf-8");
	assert.ok(downloadRes.headers.get("Content-Disposition").includes(".mbox"));

	console.log("✔ Export API & Download tests passed");

	// ---------------------------------------------------------
	// 4. HTTP Endpoints: Decommission Preflight & Safeguards
	// ---------------------------------------------------------
	console.log("\n4. Testing Decommission Preflight & Safeguards...");

	// Preflight check
	const preflightRes = await client.request(
		"/api/v1/admin/domains/acme.com/decommission-preflight",
		{ method: "POST" },
	);
	assert.equal(preflightRes.status, 200);
	const preflightData = await preflightRes.json();
	assert.equal(preflightData.domain, "acme.com");
	assert.equal(preflightData.hasRecentExport, true);
	assert.equal(preflightData.isRegistrarDomain, true);

	// Rejection when confirmation domain doesn't match
	const mismatchRes = await client.request(
		"/api/v1/admin/domains/acme.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "wrong-domain.com" }),
		},
	);
	assert.equal(mismatchRes.status, 400);
	assert.ok((await mismatchRes.json()).error.includes("mismatch"));

	// Domain without export requiring explicit skip
	await saveDomainMetadata(bucket, {
		domain: "no-export.com",
		zoneId: "zone-no-export",
		ownerUserId: "admin-user",
		adminUserIds: ["admin-user"],
		status: "active",
		nameservers: ["ns1.cloudflare.com"],
		emailRoutingEnabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	const blockedRes = await client.request(
		"/api/v1/admin/domains/no-export.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "no-export.com", skipExportAcknowledged: false }),
		},
	);
	assert.equal(blockedRes.status, 400);
	const blockedData = await blockedRes.json();
	assert.equal(blockedData.requiresExportOrSkip, true);

	// Successful decommission when skipExportAcknowledged: true
	const decommRes = await client.request(
		"/api/v1/admin/domains/no-export.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "no-export.com", skipExportAcknowledged: true }),
		},
	);
	assert.equal(decommRes.status, 200);
	const decommData = await decommRes.json();
	assert.equal(decommData.status, "offboarding");

	// Verify domain status in R2
	const updatedMeta = await getDomainMetadata(bucket, "no-export.com");
	assert.equal(updatedMeta.status, "offboarding");
	assert.equal(updatedMeta.emailRoutingEnabled, false);

	// ---------------------------------------------------------
	// 5. Registrar EPP Code & Transfer Lock Endpoints
	// ---------------------------------------------------------
	console.log("\n5. Testing EPP Code & Transfer Lock endpoints...");

	const eppRes = await client.request(
		"/api/v1/admin/domains/acme.com/epp-code",
	);
	assert.equal(eppRes.status, 200);
	const eppData = await eppRes.json();
	assert.match(eppData.eppCode, /^EPP-ACME-/);

	const lockRes = await client.request(
		"/api/v1/admin/domains/acme.com/transfer-lock",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ locked: false }),
		},
	);
	assert.equal(lockRes.status, 200);
	const lockData = await lockRes.json();
	assert.equal(lockData.locked, false);

	console.log("✔ Decommission & EPP endpoint tests passed");

	// ---------------------------------------------------------
	// 6. Export matching: look-alike domains & mailbox-only exports
	// ---------------------------------------------------------
	console.log("\n6. Testing export matching for look-alike domains & mailbox-only exports...");

	const isoBucket = mockBucket();
	const isoEnv = mockEnv(isoBucket, sampleEmails);
	const isoClient = harness(isoEnv, adminPrincipal);

	await saveDomainMetadata(isoBucket, {
		domain: "acme.com",
		zoneId: "zone-acme-iso",
		ownerUserId: "admin-user",
		adminUserIds: ["admin-user"],
		status: "active",
		nameservers: ["ns1.cloudflare.com"],
		emailRoutingEnabled: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	});

	const completedJob = (id, targetType, targetId, createdAt) => ({
		id,
		targetType,
		targetId,
		status: "completed",
		progress: 100,
		totalEmails: 42,
		processedEmails: 42,
		downloadKey: `exports/data/${id}.mbox`,
		downloadUrl: `/api/v1/exports/${id}/download`,
		filename: `${id}.mbox`,
		createdAt,
		completedAt: createdAt,
		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
	});
	const putJob = (j) => isoBucket.put(`exports/jobs/${j.id}.json`, JSON.stringify(j));

	// Another tenant's domain export, plus mailbox exports on both domains.
	const later = new Date(Date.now() + 60 * 1000).toISOString();
	await putJob(completedJob("exp_dom_notacme", "domain", "notacme.com", later));
	await putJob(completedJob("exp_mbx_notacme", "mailbox", "you@notacme.com", later));
	await putJob(completedJob("exp_mbx_acme", "mailbox", "you@acme.com", later));

	const lookalikeCheck = await hasRecentExportForDomain(isoBucket, "acme.com");
	assert.equal(lookalikeCheck.hasExport, false, "Look-alike suffix and mailbox exports must not count for acme.com");
	assert.equal(lookalikeCheck.lastExport, undefined);

	const lookalikePreflight = await isoClient.request(
		"/api/v1/admin/domains/acme.com/decommission-preflight",
		{ method: "POST" },
	);
	assert.equal(lookalikePreflight.status, 200);
	const lookalikePreflightData = await lookalikePreflight.json();
	assert.equal(lookalikePreflightData.hasRecentExport, false);
	assert.equal(lookalikePreflightData.lastExport, null, "Preflight must not leak another tenant's export");

	const lookalikeDecomm = await isoClient.request(
		"/api/v1/admin/domains/acme.com/decommission",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirmDomain: "acme.com", skipExportAcknowledged: false }),
		},
	);
	assert.equal(lookalikeDecomm.status, 400, "Foreign or mailbox-only exports must not satisfy the safeguard");
	assert.equal((await lookalikeDecomm.json()).requiresExportOrSkip, true);
	assert.equal((await getDomainMetadata(isoBucket, "acme.com")).status, "active");

	// The domain's own export is picked even though the other jobs are newer.
	await isoBucket.put("mailboxes/you@acme.com.json", JSON.stringify({ fromName: "You" }));
	const ownDomainJob = await runDomainExportJob(isoEnv, "acme.com");

	const ownCheck = await hasRecentExportForDomain(isoBucket, "ACME.com ");
	assert.equal(ownCheck.hasExport, true);
	assert.equal(ownCheck.lastExport?.id, ownDomainJob.id);

	const ownPreflight = await isoClient.request(
		"/api/v1/admin/domains/acme.com/decommission-preflight",
		{ method: "POST" },
	);
	const ownPreflightData = await ownPreflight.json();
	assert.equal(ownPreflightData.hasRecentExport, true);
	assert.equal(ownPreflightData.lastExport?.id, ownDomainJob.id);
	assert.equal(ownPreflightData.lastExport?.downloadUrl, ownDomainJob.downloadUrl);

	console.log("✔ Export matching tests passed");

	console.log("\n=========================================");
	console.log("ALL EMAIL EXPORT & OFFBOARDING TESTS PASSED!");
	console.log("=========================================\n");
}

runTests().catch((err) => {
	console.error("\n❌ Test failed:", err);
	process.exit(1);
});
