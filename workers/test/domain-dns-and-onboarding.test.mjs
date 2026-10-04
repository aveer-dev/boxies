/**
 * Tests for Cloudflare DNS suite, domain registry, and HEY-style onboarding.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-dns-and-onboarding.test.mjs
 */

import assert from "node:assert/strict";
import { Hono } from "hono";
import { app as apiApp } from "../index.ts";
import { principalFromClaims } from "../lib/mailbox-acl.ts";
import { auditEmailHealth } from "../lib/cloudflare-client.ts";
import {
	saveDomainMetadata,
	getDomainMetadata,
	listDomainsForPrincipal,
	isPrincipalAdminForDomain,
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
		MOBILE_JWT_SECRET: "test-mobile-jwt-secret-dns-99",
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

import { verifyPasswordSessionToken } from "../lib/password-auth.ts";
import { expandPrincipalWithLinks } from "../lib/identity-links.ts";

function harness(env, defaultPrincipal = null) {
	const parent = new Hono();
	parent.use("*", async (c, next) => {
		const authHeader = c.req.header("authorization");
		const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
		if (bearer) {
			try {
				const claims = await verifyPasswordSessionToken(bearer, env.MOBILE_JWT_SECRET);
				const principal = await expandPrincipalWithLinks(
					env.BUCKET,
					principalFromClaims(claims),
				);
				c.set("principal", principal);
				return next();
			} catch {
				// invalid token
			}
		}

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
		fetch(req) {
			return parent.fetch(req, env);
		},
	};
}

async function runTests() {
	console.log("Starting DNS Suite & Onboarding tests...");

	// 1. Audit logic unit tests
	{
		const mockRecords = [
			{ type: "MX", name: "example.com", content: "route1.mx.cloudflare.net", priority: 10 },
			{ type: "TXT", name: "example.com", content: "v=spf1 include:_spf.mx.cloudflare.net ~all" },
			{ type: "TXT", name: "_dmarc.example.com", content: "v=DMARC1; p=reject;" },
		];
		const auditHealthy = auditEmailHealth("example.com", mockRecords, "active", ["ns1.cf.net", "ns2.cf.net"]);
		assert.equal(auditHealthy.overallStatus, "healthy");
		assert.equal(auditHealthy.items.find((i) => i.type === "MX")?.status, "connected");
		assert.equal(auditHealthy.items.find((i) => i.type === "SPF")?.status, "connected");
		assert.equal(auditHealthy.items.find((i) => i.type === "DMARC")?.status, "connected");

		// Missing MX
		const auditNoMx = auditEmailHealth("example.com", [], "active");
		assert.equal(auditNoMx.overallStatus, "action_needed");
		assert.equal(auditNoMx.items.find((i) => i.type === "MX")?.status, "missing");

		// Pending zone
		const auditPending = auditEmailHealth("example.com", mockRecords, "pending");
		assert.equal(auditPending.overallStatus, "pending");
	}
	console.log("✔ auditEmailHealth unit tests passed");

	// 2. Domain Registry unit tests
	{
		const bucket = mockBucket();
		const domainMeta = {
			domain: "acme.corp",
			zoneId: "zone-123",
			ownerUserId: "user-alice",
			adminUserIds: ["user-alice", "user-bob", "carol@acme.corp"],
			status: "active",
			nameservers: ["anna.ns.cloudflare.com", "bob.ns.cloudflare.com"],
			emailRoutingEnabled: true,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		await saveDomainMetadata(bucket, domainMeta);

		const fetched = await getDomainMetadata(bucket, "acme.corp");
		assert.equal(fetched?.zoneId, "zone-123");

		const alice = principalFromClaims({ email: "alice@acme.corp", sub: "user:user-alice" });
		const bob = principalFromClaims({ email: "bob@acme.corp", sub: "user:user-bob" });
		const carol = principalFromClaims({ email: "carol@acme.corp", sub: "user:user-carol" });
		const stranger = principalFromClaims({ email: "stranger@other.com", sub: "user:user-stranger" });

		assert.equal(isPrincipalAdminForDomain(domainMeta, alice), true, "Alice (owner) is admin");
		assert.equal(isPrincipalAdminForDomain(domainMeta, bob), true, "Bob (in adminUserIds) is admin");
		assert.equal(isPrincipalAdminForDomain(domainMeta, carol), true, "Carol (email match) is admin");
		assert.equal(isPrincipalAdminForDomain(domainMeta, stranger), false, "Stranger is not admin");
		assert.equal(isPrincipalAdminForDomain(domainMeta, stranger, true), true, "Super admin always passes");

		const aliceDomains = await listDomainsForPrincipal(bucket, alice);
		assert.equal(aliceDomains.length, 1);
		assert.equal(aliceDomains[0].domain, "acme.corp");

		const strangerDomains = await listDomainsForPrincipal(bucket, stranger);
		assert.equal(strangerDomains.length, 0);
	}
	console.log("✔ domain-registry unit tests passed");

	// 3. HTTP: Personal Onboarding (@inboxies.email)
	{
		const bucket = mockBucket();
		const env = mockEnv(bucket);
		const app = harness(env);

		// Valid signup
		const res = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-personal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "sarah",
					password: "supersecretpassword123",
					displayName: "Sarah Connor",
				}),
			}),
		);
		assert.equal(res.status, 201);
		const data = await res.json();
		assert.equal(data.mailbox.id, "sarah@inboxies.email");
		assert.equal(data.mailbox.name, "Sarah Connor");
		assert.ok(data.token);
		assert.ok(res.headers.get("set-cookie")?.includes("inboxies_session="));

		// Duplicate username
		const resDup = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-personal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "sarah",
					password: "anotherpassword123",
				}),
			}),
		);
		assert.equal(resDup.status, 409);

		// Password too short
		const resShort = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-personal", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: "john",
					password: "123",
				}),
			}),
		);
		assert.equal(resShort.status, 400);
	}
	console.log("✔ signup-personal HTTP tests passed");

	// 4. HTTP: Custom Domain Onboarding & Cloudflare Provisioning
	{
		const bucket = mockBucket();
		const env = mockEnv(bucket);
		const app = harness(env);

		const res = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-domain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "supercorp.io",
					username: "ceo",
					password: "securepassword999",
					displayName: "Chief Executive",
				}),
			}),
		);
		assert.equal(res.status, 201);
		const data = await res.json();
		assert.equal(data.mailbox.id, "ceo@supercorp.io");
		assert.equal(data.domain.domain, "supercorp.io");
		assert.ok(data.domain.nameservers.length > 0);
		assert.ok(data.audit);
		assert.ok(data.token);

		// Duplicate domain rejected
		const resDup = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-domain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "supercorp.io",
					username: "cto",
					password: "anotherpassword123",
				}),
			}),
		);
		assert.equal(resDup.status, 409);
	}
	console.log("✔ signup-domain HTTP tests passed");

	// 5. HTTP: Admin DNS Suite
	{
		const bucket = mockBucket();
		const env = mockEnv(bucket);
		const app = harness(env);

		// Setup domain by onboarding
		const signupRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-domain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "startup.dev",
					username: "founder",
					password: "founderpassword123",
				}),
			}),
		);
		assert.equal(signupRes.status, 201);
		const { token, user } = await signupRes.json();
		const authHeader = { Authorization: `Bearer ${token}` };

		// 5.1 List administered domains
		const listRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains", {
				headers: authHeader,
			}),
		);
		assert.equal(listRes.status, 200);
		const listData = await listRes.json();
		assert.equal(listData.domains.length, 1);
		assert.equal(listData.domains[0].domain, "startup.dev");

		// Stranger cannot access
		const strangerRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev", {
				headers: { "x-test-user": "stranger@other.com" },
			}),
		);
		assert.equal(strangerRes.status, 403);

		// 5.2 Get Domain & Zone Details
		const getDomainRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev", {
				headers: authHeader,
			}),
		);
		assert.equal(getDomainRes.status, 200);
		const domainInfo = await getDomainRes.json();
		assert.equal(domainInfo.domain, "startup.dev");
		assert.ok(domainInfo.nameservers.length > 0);

		// 5.3 DNS Health check
		const healthRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/dns/health", {
				headers: authHeader,
			}),
		);
		assert.equal(healthRes.status, 200);
		const healthData = await healthRes.json();
		assert.ok(healthData.audit);
		assert.ok(healthData.audit.items.length > 0);

		// 5.4 Fix Email DNS
		const fixRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/dns/fix-email", {
				method: "POST",
				headers: authHeader,
			}),
		);
		assert.equal(fixRes.status, 200);
		const fixData = await fixRes.json();
		assert.equal(fixData.success, true);
		assert.ok(fixData.audit);

		// 5.5 List DNS records
		const recordsRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/dns/records", {
				headers: authHeader,
			}),
		);
		assert.equal(recordsRes.status, 200);
		const recordsData = await recordsRes.json();
		assert.ok(Array.isArray(recordsData.records));

		// 5.6 Create custom DNS record
		const createRecRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/dns/records", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "CNAME",
					name: "blog.startup.dev",
					content: "hashnode.network",
					ttl: 300,
				}),
			}),
		);
		assert.equal(createRecRes.status, 201);
		const created = await createRecRes.json();
		assert.equal(created.record.type, "CNAME");
		assert.equal(created.record.name, "blog.startup.dev");
		const recId = created.record.id;

		// 5.7 Update DNS record
		const updateRecRes = await app.fetch(
			new Request(`https://inboxies.email/api/v1/admin/domains/startup.dev/dns/records/${recId}`, {
				method: "PUT",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					type: "CNAME",
					name: "blog.startup.dev",
					content: "custom.hashnode.network",
					ttl: 600,
				}),
			}),
		);
		assert.equal(updateRecRes.status, 200);
		const updated = await updateRecRes.json();
		assert.equal(updated.record.content, "custom.hashnode.network");

		// 5.8 Delete DNS record
		const deleteRecRes = await app.fetch(
			new Request(`https://inboxies.email/api/v1/admin/domains/startup.dev/dns/records/${recId}`, {
				method: "DELETE",
				headers: authHeader,
			}),
		);
		assert.equal(deleteRecRes.status, 200);

		// Verify deleted
		const verifyRecsRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/dns/records", {
				headers: authHeader,
			}),
		);
		const verifyRecs = await verifyRecsRes.json();
		assert.ok(!verifyRecs.records.some((r) => r.id === recId));
	}
	console.log("✔ Admin DNS Suite HTTP tests passed");

	// 6. HTTP: Domain-scoped admin for custom domain owners
	{
		const bucket = mockBucket();
		const env = mockEnv(bucket);
		const app = harness(env);

		// Alice signs up startup.dev
		const signupRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-domain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "startup.dev",
					username: "alice",
					password: "securepassword123",
				}),
			}),
		);
		assert.equal(signupRes.status, 201);
		const signupData = await signupRes.json();
		const authHeader = { Authorization: `Bearer ${signupData.token}` };

		// 6.1 /api/v1/me returns isAdmin: true and administeredDomains
		const meRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/me", {
				headers: authHeader,
			}),
		);
		assert.equal(meRes.status, 200);
		const meData = await meRes.json();
		assert.equal(meData.isAdmin, true);
		assert.deepEqual(meData.administeredDomains, ["startup.dev"]);

		// 6.2 Alice can list admin mailboxes (scoped to startup.dev)
		const listMbRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/mailboxes", {
				headers: authHeader,
			}),
		);
		assert.equal(listMbRes.status, 200);
		const mbList = await listMbRes.json();
		assert.equal(mbList.length, 1);
		assert.equal(mbList[0].id, "alice@startup.dev");

		// 6.3 Alice can create another mailbox under startup.dev
		const createMbRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/mailboxes", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					email: "bob@startup.dev",
					name: "Bob",
				}),
			}),
		);
		assert.equal(createMbRes.status, 201);
		const createdMb = await createMbRes.json();
		assert.equal(createdMb.id, "bob@startup.dev");

		// 6.4 Alice can create an invite for bob@startup.dev
		const inviteRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/invites", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					mailboxId: "bob@startup.dev",
					inviteEmail: "bob.personal@gmail.com",
					inviteeName: "Bob Smith",
				}),
			}),
		);
		assert.equal(inviteRes.status, 201);
		const inviteData = await inviteRes.json();
		assert.equal(inviteData.mailboxId, "bob@startup.dev");
		assert.equal(inviteData.inviteeEmail, "bob.personal@gmail.com");

		// 6.5 Alice cannot create a mailbox under a domain she does not own
		const forbiddenMbRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/mailboxes", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					email: "evil@inboxies.email",
				}),
			}),
		);
		assert.equal(forbiddenMbRes.status, 403);

		// 6.6 Stranger cannot create mailbox under startup.dev
		const strangerRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/mailboxes", {
				method: "POST",
				headers: {
					"x-test-user": "stranger@other.com",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: "hacker@startup.dev",
				}),
			}),
		);
		assert.equal(strangerRes.status, 403);
	}
	console.log("✔ Domain-scoped Admin mailboxes & invites tests passed");

	// =========================================================================
	// 7. Email Aliases & Batch Onboarding Setup Tests
	// =========================================================================
	{
		const bucket = mockBucket();
		const env = mockEnv(bucket);
		const app = harness(env);

		const signupRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/auth/signup-domain", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domain: "startup.dev",
					username: "alice",
					password: "alicepassword123",
				}),
			}),
		);
		assert.equal(signupRes.status, 201);
		const { token } = await signupRes.json();
		const authHeader = { Authorization: `Bearer ${token}` };

		// 7.1 List aliases (initially empty)
		const listRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/aliases", {
				headers: authHeader,
			}),
		);
		assert.equal(listRes.status, 200);
		const listData = await listRes.json();
		assert.equal(listData.domain, "startup.dev");
		assert.deepEqual(listData.aliases, []);

		// 7.2 Create an email alias support -> alice@startup.dev
		const createAliasRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/aliases", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					aliasLocal: "support",
					targetMailboxId: "alice@startup.dev",
				}),
			}),
		);
		assert.equal(createAliasRes.status, 201);
		const createdAlias = await createAliasRes.json();
		assert.equal(createdAlias.alias.aliasEmail, "support@startup.dev");
		assert.equal(createdAlias.alias.targetMailboxId, "alice@startup.dev");

		// 7.3 Test alias resolution via routeInboundEnvelope
		const { routeInboundEnvelope, aliasMetadataKey } = await import("../lib/mailbox-routing.ts");
		const routeResult = await routeInboundEnvelope(
			"support@startup.dev",
			async (id) => id === "alice@startup.dev",
			async (alias) => {
				const obj = await bucket.get(aliasMetadataKey(alias));
				if (!obj) return null;
				const data = await obj.json();
				return data.targetMailboxId || null;
			},
		);
		assert.equal(routeResult.action, "deliver");
		assert.equal(routeResult.mailboxId, "alice@startup.dev");
		assert.equal(routeResult.resolvedViaAlias, true);

		// 7.4 Batch setup aliases during onboarding
		const batchAliasRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/setup-aliases", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					aliases: [
						{ aliasLocal: "billing", targetMailboxId: "alice@startup.dev" },
						{ aliasLocal: "hello", targetMailboxId: "alice@startup.dev" },
					],
				}),
			}),
		);
		assert.equal(batchAliasRes.status, 200);
		const batchAliasData = await batchAliasRes.json();
		assert.equal(batchAliasData.aliases.length, 2);

		// 7.5 Batch setup team users during onboarding
		const batchUsersRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/setup-users", {
				method: "POST",
				headers: { ...authHeader, "Content-Type": "application/json" },
				body: JSON.stringify({
					users: [
						{ fullName: "Carol Danvers", contactEmail: "carol@external.com", username: "carol" },
						{ fullName: "Dave Bowman", contactEmail: "dave@external.com", username: "dave" },
					],
				}),
			}),
		);
		assert.equal(batchUsersRes.status, 200);
		const batchUsersData = await batchUsersRes.json();
		assert.equal(batchUsersData.users.length, 2);
		assert.equal(batchUsersData.users[0].mailboxId, "carol@startup.dev");
		assert.ok(batchUsersData.users[0].invite?.token);

		// 7.6 Delete an alias
		const delAliasRes = await app.fetch(
			new Request("https://inboxies.email/api/v1/admin/domains/startup.dev/aliases/hello", {
				method: "DELETE",
				headers: authHeader,
			}),
		);
		assert.equal(delAliasRes.status, 200);
	}
	console.log("✔ Email Aliases & Batch Onboarding setup tests passed");

	console.log("\nALL DNS SUITE & ONBOARDING TESTS PASSED!\n");
}

runTests().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
