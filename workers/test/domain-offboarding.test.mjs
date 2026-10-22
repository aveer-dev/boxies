/**
 * Finalizing a decommissioned domain (AVE-43): the grace period and warning,
 * "finalize now" (typed confirmation, owner only), idempotent and resumable
 * runs, the Stripe cancellation, and the Cloudflare zone / registrar cleanup
 * (both mocked through fetch).
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-offboarding.test.mjs
 */

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../auth/schema.ts";
import { setDevRuntimeForTesting } from "../lib/dev-runtime.ts";
import {
	finalizeBlocker,
	finalizeDomainOffboarding,
	getOffboarding,
	OFFBOARDING_GRACE_MS,
	recordDecommission,
	runDomainOffboarding,
} from "../lib/domain-offboarding.ts";
import { billingCustomerKey } from "../lib/billing-fulfillment.ts";
import { domainR2Key, getDomainMetadata } from "../lib/domain-registry.ts";
import { aliasMetadataKey, mailboxMetadataKey } from "../lib/mailbox-routing.ts";
import { runScheduledMaintenance } from "../lib/maintenance.ts";
import {
	addDomain,
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

// Cloudflare API calls (catch-all disable) use the dev mocks.
setDevRuntimeForTesting(true);

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// ── Stripe, mocked at fetch ──────────────────────────────────────
const stripeCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
	const u = String(url);
	if (!u.startsWith("https://api.stripe.com/")) return realFetch(url, init);
	const method = init.method ?? "GET";
	stripeCalls.push({ method, path: u.replace("https://api.stripe.com/v1", "") });
	assert.equal(init.headers.Authorization, "Bearer sk_test_offboarding");
	const body = method === "DELETE" ? { id: "sub", status: "canceled" } : { id: "sub", status: "active" };
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
const cancels = (subId) => stripeCalls.filter((c) => c.method === "DELETE" && c.path === `/subscriptions/${subId}`);

const { env, db, bucket, mailboxes, email } = createAuthTestEnv({ STRIPE_SECRET_KEY: "sk_test_offboarding" });

const olive = await addUser(db, { id: "olive", email: "olive@gmail.com" });
const adam = await addUser(db, { id: "adam", email: "adam@gmail.com" });
const mallory = await addUser(db, { id: "mallory", email: "mallory@gmail.com" });
await db.insert(schema.recoveryEmail).values({ userId: "olive", email: "olive.recovery@example.com", verifiedAt: new Date() });
const [asOlive, asAdam, asMallory] = [olive, adam, mallory].map((u) => principalFor(u));

/** A billed domain with two mailboxes, an alias, a member and a pending invite. */
async function seedDomain(domain, { subscriptionId, customerId }) {
	await addDomain(db, bucket, {
		domain,
		ownerUserId: "olive",
		admins: ["adam"],
		meta: {
			billing: {
				provider: "stripe",
				checkoutSessionId: `cs_test_${domain}`,
				customerId,
				subscriptionId,
				status: "active",
				updatedAt: new Date().toISOString(),
			},
			aliases: [{ aliasLocal: "sales", aliasEmail: `sales@${domain}`, targetMailboxId: `a@${domain}`, createdAt: "" }],
		},
	});
	await addMailbox(db, bucket, `a@${domain}`, { owners: ["olive"], members: ["adam"] });
	await addMailbox(db, bucket, `b@${domain}`, { owners: ["olive"] });
	await db.insert(schema.invite).values({
		tokenHash: `hash-${domain}`,
		mailboxId: `a@${domain}`,
		role: "member",
		inviteeEmail: "new@example.com",
		expiresAt: new Date(Date.now() + 7 * DAY),
	});
	await bucket.put(aliasMetadataKey(`sales@${domain}`), JSON.stringify({ aliasEmail: `sales@${domain}`, targetMailboxId: `a@${domain}`, domain }));
	await bucket.put(billingCustomerKey(customerId), JSON.stringify({ customerId, domain }));
	await bucket.put(`billing/service-watch/${domain}`, "1");
}

const decommission = (domain, principal = asOlive) =>
	request(env, {
		method: "POST",
		path: `/api/v1/admin/domains/${domain}/decommission`,
		principal,
		body: { confirmDomain: domain, skipExportAcknowledged: true },
	});
const finalizeNow = (domain, body, principal = asOlive) =>
	request(env, { method: "POST", path: `/api/v1/admin/domains/${domain}/finalize`, principal, body });

async function assertDomainGone(domain) {
	assert.equal(await db.select().from(schema.domain).where(eq(schema.domain.domain, domain)).get(), undefined);
	assert.deepEqual(await db.select().from(schema.domainAdmin).where(eq(schema.domainAdmin.domain, domain)).all(), []);
	assert.deepEqual(await db.select().from(schema.mailbox).where(eq(schema.mailbox.domain, domain)).all(), []);
	for (const id of [`a@${domain}`, `b@${domain}`]) {
		assert.deepEqual(await db.select().from(schema.mailboxMember).where(eq(schema.mailboxMember.mailboxId, id)).all(), []);
		assert.deepEqual(await db.select().from(schema.invite).where(eq(schema.invite.mailboxId, id)).all(), []);
		assert.equal(bucket.store.has(mailboxMetadataKey(id)), false);
	}
	assert.equal(bucket.store.has(domainR2Key(domain)), false, "registry entry removed");
	assert.equal(bucket.store.has(aliasMetadataKey(`sales@${domain}`)), false, "alias removed");
	assert.equal(bucket.store.has(`billing/service-watch/${domain}`), false);
}

// ── Pure gating ──────────────────────────────────────────────────
{
	const t0 = new Date("2026-01-01T00:00:00Z");
	const row = {
		domain: "x.test",
		decommissionedAt: t0,
		finalizeAfter: new Date(t0.getTime() + OFFBOARDING_GRACE_MS),
		warningSentAt: null,
		finalizeRequestedAt: null,
		finalizeStartedAt: null,
		finalizedAt: null,
	};
	assert.equal(finalizeBlocker(undefined, "decommissioned", t0), "not_decommissioned");
	assert.equal(finalizeBlocker(row, "active", t0), "not_decommissioned");
	assert.equal(finalizeBlocker(row, "suspended", t0), "not_decommissioned");
	assert.equal(finalizeBlocker(row, undefined, t0), "not_decommissioned", "no domain row and never started");
	assert.equal(finalizeBlocker(row, "decommissioned", new Date(t0.getTime() + 31 * DAY)), "warning_pending");
	const warned = { ...row, warningSentAt: new Date(t0.getTime() + 23 * DAY) };
	assert.equal(finalizeBlocker(warned, "decommissioned", new Date(t0.getTime() + 29 * DAY)), "grace_period");
	assert.equal(finalizeBlocker(warned, "decommissioned", new Date(t0.getTime() + 30 * DAY)), null);
	assert.equal(finalizeBlocker({ ...row, finalizeRequestedAt: t0 }, "decommissioned", t0), null, "finalize now skips the grace period");
	assert.equal(finalizeBlocker({ ...row, finalizeStartedAt: t0 }, undefined, t0), null, "a started finalize resumes");
	assert.equal(finalizeBlocker({ ...row, finalizedAt: t0 }, "decommissioned", t0), "already_finalized");
}

// ── 1. Scheduled path: grace period, warning, finalize, re-run ───
await seedDomain("acme.test", { subscriptionId: "sub_acme", customerId: "cus_acme" });

// Before decommission: an admin may reach the route, but the domain must be decommissioned first.
{
	const res = await finalizeNow("acme.test", { confirmDomain: "acme.test" }, asAdam);
	assert.equal(res.status, 409);
	assert.equal(res.payload.code, "not_decommissioned");
	const blocked = await finalizeDomainOffboarding(env, "acme.test");
	assert.deepEqual(blocked, { status: "blocked", domain: "acme.test", reason: "not_decommissioned" });
}

const decommissionedAt = Date.now();
{
	const res = await decommission("acme.test");
	assert.equal(res.status, 200, JSON.stringify(res.payload));
	const finalizeAfter = Date.parse(res.payload.finalizeAfter);
	assert.ok(Math.abs(finalizeAfter - (decommissionedAt + 30 * DAY)) < 60_000, "30-day grace period");
	assert.equal(res.payload.offboarding.graceDays, 30);
	assert.equal(res.payload.offboarding.canFinalizeNow, true);
}
const t0 = (await getOffboarding(db, "acme.test")).decommissionedAt.getTime();

// The owner sees the grace period; the ex-admin and outsiders don't.
{
	const res = await request(env, { path: "/api/v1/admin/domains/acme.test/offboarding", principal: asOlive });
	assert.equal(res.status, 200);
	assert.equal(res.payload.offboarding.finalizeAfter, new Date(t0 + 30 * DAY).toISOString());
	assert.equal(res.payload.offboarding.finalizedAt, null);
	assert.equal((await request(env, { path: "/api/v1/admin/domains/acme.test/offboarding", principal: asAdam })).status, 403);
	assert.equal((await request(env, { path: "/api/v1/admin/domains/acme.test/offboarding", principal: asMallory })).status, 403);

	// The owner's list of domains waiting to be deleted; nobody else's.
	const list = await request(env, { path: "/api/v1/admin/offboarding-domains", principal: asOlive });
	assert.equal(list.status, 200);
	assert.deepEqual(list.payload.domains.map((d) => d.domain), ["acme.test"]);
	assert.equal(list.payload.domains[0].offboarding.finalizeAfter, new Date(t0 + 30 * DAY).toISOString());
	const adamList = await request(env, { path: "/api/v1/admin/offboarding-domains", principal: asAdam });
	assert.deepEqual(adamList.payload.domains, []);
	assert.equal((await request(env, { path: "/api/v1/admin/offboarding-domains" })).status, 401);
}

// Day 1: nothing happens.
{
	const report = await runDomainOffboarding(env, new Date(t0 + DAY));
	assert.deepEqual(report.warned, []);
	assert.deepEqual(report.finalized, []);
	assert.equal(cancels("sub_acme").length, 0);
}

// Day 23: the warning goes out, nothing is deleted.
{
	const sentBefore = email.sent.length;
	const report = await runDomainOffboarding(env, new Date(t0 + 23 * DAY + HOUR));
	assert.deepEqual(report.warned, ["acme.test"]);
	assert.deepEqual(report.finalized, []);
	const warnings = email.sent.slice(sentBefore);
	const to = warnings.map((m) => m.to).sort();
	assert.deepEqual(to, ["adam@gmail.com", "olive.recovery@example.com", "olive@gmail.com"]);
	assert.match(warnings[0].subject, /acme\.test: your Inboxies data will be deleted on/);
	const row = await getOffboarding(db, "acme.test");
	assert.ok(row.warningSentAt);
	// Never less than 7 days after the warning (the hourly cron sent it an hour late).
	assert.equal(row.finalizeAfter.getTime(), t0 + 30 * DAY + HOUR);
	// Sent once.
	const again = await runDomainOffboarding(env, new Date(t0 + 24 * DAY));
	assert.deepEqual(again.warned, []);
}

// Day 29: still in the grace period, even when asked directly.
{
	const res = await finalizeDomainOffboarding(env, "acme.test", { now: new Date(t0 + 29 * DAY) });
	assert.deepEqual(res, { status: "blocked", domain: "acme.test", reason: "grace_period" });
	assert.equal(mailboxes.calls.filter(([, m]) => m === "purgeMailbox").length, 0);
	assert.ok(await getDomainMetadata(bucket, "acme.test"));
}

// Day 30: the hourly maintenance finalizes it.
{
	const report = await runScheduledMaintenance(env, new Date(t0 + 30 * DAY + HOUR));
	assert.deepEqual(report.offboardingFinalized, ["acme.test"]);
	assert.equal(cancels("sub_acme").length, 1, "subscription cancelled once");
	const purged = mailboxes.calls.filter(([, m]) => m === "purgeMailbox").map(([id]) => id).sort();
	assert.deepEqual(purged, ["a@acme.test", "b@acme.test"]);
	await assertDomainGone("acme.test");
	assert.equal(bucket.store.has(billingCustomerKey("cus_acme")), false);
	const row = await getOffboarding(db, "acme.test");
	assert.ok(row.finalizedAt);
	assert.equal(row.step, "done");
	assert.equal(row.mailboxesPurged, 2);
	assert.ok(row.subscriptionCanceledAt);
	const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "domain.offboarding_finalized")).all();
	assert.equal(audit.length, 1);
	assert.equal(audit[0].target, "acme.test");
}

// Re-running changes nothing.
{
	const callsBefore = mailboxes.calls.length;
	const report = await runDomainOffboarding(env, new Date(t0 + 31 * DAY));
	assert.deepEqual(report.finalized, []);
	assert.deepEqual(await finalizeDomainOffboarding(env, "acme.test", { now: new Date(t0 + 31 * DAY) }), {
		status: "blocked",
		domain: "acme.test",
		reason: "already_finalized",
	});
	assert.equal(cancels("sub_acme").length, 1);
	assert.equal(mailboxes.calls.length, callsBefore);
	// The finalized domain is gone for its owner too.
	assert.equal((await finalizeNow("acme.test", { confirmDomain: "acme.test" })).status, 403);
}

// ── 2. Finalize now: authorization and typed confirmation ────────
await seedDomain("now.test", { subscriptionId: "sub_now", customerId: "cus_now" });
assert.equal((await decommission("now.test")).status, 200);
{
	// Not signed in, outsiders and the former admin: refused.
	assert.equal((await finalizeNow("now.test", { confirmDomain: "now.test" }, null)).status, 401);
	assert.equal((await finalizeNow("now.test", { confirmDomain: "now.test" }, asMallory)).status, 403);
	assert.equal((await finalizeNow("now.test", { confirmDomain: "now.test" }, asAdam)).status, 403);

	// The owner must type the domain.
	const missing = await finalizeNow("now.test", {});
	assert.equal(missing.status, 400);
	assert.equal(missing.payload.code, "confirmation_required");
	const wrong = await finalizeNow("now.test", { confirmDomain: "now.tes" });
	assert.equal(wrong.status, 400);
	assert.equal(wrong.payload.code, "confirmation_mismatch");
	const other = await finalizeNow("now.test", { confirmDomain: "acme.test" });
	assert.equal(other.status, 400);
	assert.ok(await getDomainMetadata(bucket, "now.test"), "nothing deleted on a failed confirmation");
	assert.equal((await getOffboarding(db, "now.test")).finalizeRequestedAt, null);
	assert.equal(cancels("sub_now").length, 0);

	// Typed correctly (case and spaces don't matter): finalized at once, in the grace period.
	const ok = await finalizeNow("now.test", { confirmDomain: "  NOW.test " });
	assert.equal(ok.status, 200, JSON.stringify(ok.payload));
	assert.equal(ok.payload.finalized, true);
	assert.equal(ok.payload.mailboxesPurged, 2);
	assert.equal(ok.payload.subscriptionCanceled, true);
	assert.equal(cancels("sub_now").length, 1);
	await assertDomainGone("now.test");
	const row = await getOffboarding(db, "now.test");
	assert.equal(row.finalizeRequestedBy, "olive");
	assert.equal(row.warningSentAt, null, "finalize now doesn't wait for the warning");
}

// ── 3. A run that fails part-way resumes without redoing work ────
{
	let failB = true;
	const flaky = mockMailboxNamespace({
		purgeMailbox: async (mailboxId) => {
			flaky.calls.push([mailboxId, "purgeMailbox"]);
			if (mailboxId.startsWith("b@") && failB) throw new Error("DO unavailable");
			return { conversationIds: [] };
		},
	});
	env.MAILBOX = flaky;
	await seedDomain("flaky.test", { subscriptionId: "sub_flaky", customerId: "cus_flaky" });
	assert.equal((await decommission("flaky.test")).status, 200);

	const first = await finalizeNow("flaky.test", { confirmDomain: "flaky.test" });
	assert.equal(first.status, 202);
	assert.equal(first.payload.status, "will_retry");
	assert.match(first.payload.error, /DO unavailable/);
	let row = await getOffboarding(db, "flaky.test");
	assert.equal(row.finalizedAt, null);
	assert.equal(row.step, "mailboxes");
	assert.equal(row.mailboxesPurged, 1);
	assert.match(row.lastError, /DO unavailable/);
	assert.equal(row.leaseUntil, null, "a failed run gives the lease back");
	assert.ok(row.subscriptionCanceledAt);
	assert.equal(cancels("sub_flaky").length, 1);
	// Mailbox a is gone, b and the registry entry are still there.
	assert.equal(await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, "a@flaky.test")).get(), undefined);
	assert.ok(await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, "b@flaky.test")).get());
	assert.ok(await getDomainMetadata(bucket, "flaky.test"));

	// A runner holding the lease keeps others off.
	await db
		.update(schema.domainOffboarding)
		.set({ leaseUntil: new Date(Date.now() + 10 * 60 * 1000) })
		.where(eq(schema.domainOffboarding.domain, "flaky.test"));
	assert.equal((await finalizeDomainOffboarding(env, "flaky.test")).status, "busy");
	await db.update(schema.domainOffboarding).set({ leaseUntil: null }).where(eq(schema.domainOffboarding.domain, "flaky.test"));

	// The next hourly run picks it up (no grace period wait: it was requested and started).
	failB = false;
	const report = await runDomainOffboarding(env, new Date(Date.now() + HOUR));
	assert.deepEqual(report.finalized, ["flaky.test"]);
	assert.equal(cancels("sub_flaky").length, 1, "Stripe isn't called again");
	const purgedA = flaky.calls.filter(([id, m]) => id === "a@flaky.test" && m === "purgeMailbox").length;
	assert.equal(purgedA, 1, "a finished mailbox isn't purged again");
	await assertDomainGone("flaky.test");
	row = await getOffboarding(db, "flaky.test");
	assert.equal(row.mailboxesPurged, 2);
	assert.equal(row.lastError, null);
	assert.equal(row.attempts, 2);
}

// ── 4. A subscription that also pays for another domain isn't cancelled ──
{
	await seedDomain("shared.test", { subscriptionId: "sub_shared", customerId: "cus_shared" });
	await addDomain(db, bucket, {
		domain: "sibling.test",
		ownerUserId: "olive",
		meta: { billing: { provider: "stripe", checkoutSessionId: "cs_sib", subscriptionId: "sub_shared", status: "active", updatedAt: "" } },
	});
	assert.equal((await decommission("shared.test")).status, 200);
	const res = await finalizeNow("shared.test", { confirmDomain: "shared.test" });
	assert.equal(res.status, 200);
	assert.equal(res.payload.subscriptionCanceled, false);
	assert.equal(cancels("sub_shared").length, 0);
	await assertDomainGone("shared.test");
	assert.ok(await getDomainMetadata(bucket, "sibling.test"), "the other domain is untouched");
}

// ── 5. Late warnings push the date; untracked decommissions get tracked ──
{
	await addDomain(db, bucket, { domain: "old.test", ownerUserId: "olive", status: "decommissioned" });
	const now = new Date();
	const report = await runDomainOffboarding(env, now);
	assert.ok(report.tracked.includes("old.test"), "decommissioned before this shipped: tracked now");
	const row = await getOffboarding(db, "old.test");
	assert.equal(row.decommissionedAt.getTime(), now.getTime());
	assert.equal(row.finalizeAfter.getTime(), now.getTime() + 30 * DAY);

	// The cron was down past the warning date: the admins still get 7 days.
	const late = new Date(now.getTime() + 29 * DAY);
	const lateReport = await runDomainOffboarding(env, late);
	assert.deepEqual(lateReport.warned, ["old.test"]);
	assert.deepEqual(lateReport.finalized, []);
	assert.equal((await getOffboarding(db, "old.test")).finalizeAfter.getTime(), late.getTime() + 7 * DAY);
	assert.deepEqual((await runDomainOffboarding(env, new Date(now.getTime() + 31 * DAY))).finalized, []);
	assert.deepEqual((await runDomainOffboarding(env, new Date(late.getTime() + 7 * DAY))).finalized, ["old.test"]);

	// recordDecommission never moves an existing deadline.
	const before = await getOffboarding(db, "old.test");
	await recordDecommission(db, "old.test", new Date(now.getTime() + 90 * DAY));
	assert.equal((await getOffboarding(db, "old.test")).finalizeAfter.getTime(), before.finalizeAfter.getTime());
}

// ── 6. Stripe failure blocks deletion and is retried ─────────────
{
	env.MAILBOX = mockMailboxNamespace();
	await seedDomain("stripe-down.test", { subscriptionId: "sub_down", customerId: "cus_down" });
	assert.equal((await decommission("stripe-down.test")).status, 200);
	const prev = globalThis.fetch;
	globalThis.fetch = async (url, init) =>
		String(url).startsWith("https://api.stripe.com/")
			? new Response(JSON.stringify({ error: { message: "Stripe is down" } }), { status: 500 })
			: prev(url, init);
	const res = await finalizeNow("stripe-down.test", { confirmDomain: "stripe-down.test" });
	globalThis.fetch = prev;
	assert.equal(res.status, 202);
	assert.match(res.payload.error, /Stripe is down/);
	assert.equal(env.MAILBOX.calls.filter(([, m]) => m === "purgeMailbox").length, 0, "nothing deleted while billing is live");
	assert.ok(await getDomainMetadata(bucket, "stripe-down.test"));
	assert.equal((await getOffboarding(db, "stripe-down.test")).subscriptionId, "sub_down", "subscription id kept");

	const report = await runDomainOffboarding(env, new Date(Date.now() + HOUR));
	assert.deepEqual(report.finalized, ["stripe-down.test"]);
	assert.equal(cancels("sub_down").length, 1);
	await assertDomainGone("stripe-down.test");
}

// ── 7. Cloudflare cleanup: zone deleted, registrar auto-renew off ──
{
	env.MAILBOX = mockMailboxNamespace();
	env.CF_API_TOKEN = "cf_test_token";
	env.CF_ACCOUNT_ID = "acct_test";
	env.OPS_ALERT_EMAIL = "ops@example.com";

	const cfCalls = [];
	/** Per-test answer for DELETE /zones/{id}: a status code. */
	let zoneDeleteStatus = () => 200;
	const prev = globalThis.fetch;
	globalThis.fetch = async (url, init = {}) => {
		const u = String(url);
		if (!u.startsWith("https://api.cloudflare.com/")) return prev(url, init);
		const method = init.method ?? "GET";
		const path = u.replace("https://api.cloudflare.com/client/v4", "");
		cfCalls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
		assert.equal(init.headers.Authorization, "Bearer cf_test_token");
		const json = (status, body) =>
			new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
		if (method === "DELETE" && path.startsWith("/zones/")) {
			const status = zoneDeleteStatus(path);
			return status === 200
				? json(200, { success: true, result: { id: path.slice("/zones/".length) } })
				: json(status, { success: false, errors: [{ code: 1000, message: `zone delete ${status}` }] });
		}
		if (path.endsWith("/transfer_auth_code")) return json(200, { success: true, result: { auth_code: "epp-123" } });
		// Catch-all disable, transfer unlock, auto-renew off.
		return json(200, { success: true, result: init.body ? JSON.parse(init.body) : {} });
	};
	const zoneDeletes = (domain) => cfCalls.filter((c) => c.method === "DELETE" && c.path === `/zones/zone-${domain}`);
	const autoRenewOffs = (domain) =>
		cfCalls.filter(
			(c) => c.method === "PATCH" && c.path === `/accounts/acct_test/registrar/registrations/${domain}` && c.body?.auto_renew === false,
		);
	const registrarCalls = (domain) => cfCalls.filter((c) => c.path.includes(`/registrar/`) && c.path.includes(domain));
	const opsAlerts = (domain) => email.sent.filter((m) => m.to === "ops@example.com" && m.subject.includes(domain));
	const registration = { provider: "cloudflare_registrar", autoRenew: true, locked: true, registeredAt: "", expiresAt: "2027-01-01T00:00:00Z" };

	// a) BYO domain: its recorded zone is deleted; the registrar is never touched.
	await seedDomain("byo.test", { subscriptionId: "sub_byo", customerId: "cus_byo" });
	assert.equal((await decommission("byo.test")).status, 200);
	{
		const res = await finalizeNow("byo.test", { confirmDomain: "byo.test" });
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(res.payload.finalized, true);
		assert.equal(res.payload.cloudflareCleanupPending, undefined);
		assert.equal(zoneDeletes("byo.test").length, 1, "the recorded zone id is deleted");
		assert.deepEqual(registrarCalls("byo.test"), [], "BYO domain: no registrar calls");
		assert.equal(cfCalls.filter((c) => c.method === "GET" && c.path.startsWith("/zones?")).length, 0, "never looked up by name");
		await assertDomainGone("byo.test");
		const row = await getOffboarding(db, "byo.test");
		assert.equal(row.zoneId, "zone-byo.test");
		assert.equal(row.registrarManaged, false);
		assert.ok(row.dataDeletedAt && row.zoneDeletedAt && row.registrarReleasedAt && row.finalizedAt);
		assert.equal(row.step, "done");
	}

	// b) Registered through us, zone already gone (404): both count as done.
	await seedDomain("gone.test", { subscriptionId: "sub_gone", customerId: "cus_gone" });
	await bucket.put(
		domainR2Key("gone.test"),
		JSON.stringify({ ...(await getDomainMetadata(bucket, "gone.test")), registration }),
	);
	assert.equal((await decommission("gone.test")).status, 200);
	{
		zoneDeleteStatus = () => 404;
		const res = await finalizeNow("gone.test", { confirmDomain: "gone.test" });
		zoneDeleteStatus = () => 200;
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(res.payload.cloudflareCleanupPending, undefined, "404 is success");
		assert.equal(zoneDeletes("gone.test").length, 1);
		assert.equal(autoRenewOffs("gone.test").length, 1, "registrar auto-renew turned off");
		const row = await getOffboarding(db, "gone.test");
		assert.equal(row.registrarManaged, true);
		assert.ok(row.finalizedAt);
		assert.equal(row.lastError, null);
		assert.deepEqual(opsAlerts("gone.test"), []);
	}

	// c) Zone delete fails: data is deleted anyway, the failure is recorded and
	// alerted once, and the next runs retry only the zone.
	await seedDomain("cfdown.test", { subscriptionId: "sub_cfdown", customerId: "cus_cfdown" });
	await bucket.put(
		domainR2Key("cfdown.test"),
		JSON.stringify({ ...(await getDomainMetadata(bucket, "cfdown.test")), registration }),
	);
	assert.equal((await decommission("cfdown.test")).status, 200);
	{
		zoneDeleteStatus = () => 500;
		const res = await finalizeNow("cfdown.test", { confirmDomain: "cfdown.test" });
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(res.payload.finalized, true);
		assert.equal(res.payload.cloudflareCleanupPending, true);
		await assertDomainGone("cfdown.test");
		assert.equal(cancels("sub_cfdown").length, 1);
		let row = await getOffboarding(db, "cfdown.test");
		assert.ok(row.dataDeletedAt);
		assert.equal(row.finalizedAt, null);
		assert.equal(row.zoneDeletedAt, null);
		assert.ok(row.registrarReleasedAt, "the registrar step finished on its own");
		assert.match(row.lastError, /zone: zone delete 500/);
		assert.equal(row.leaseUntil, null);
		assert.equal(opsAlerts("cfdown.test").length, 1, "ops alerted");

		// Still failing an hour later: retried, not re-alerted.
		const purgesBefore = env.MAILBOX.calls.filter(([, m]) => m === "purgeMailbox").length;
		const stillDown = await runDomainOffboarding(env, new Date(Date.now() + HOUR));
		assert.deepEqual(stillDown.finalized, []);
		assert.ok(stillDown.errors.some((e) => e.startsWith("cloudflare cfdown.test")));
		assert.equal(zoneDeletes("cfdown.test").length, 2);
		assert.equal(opsAlerts("cfdown.test").length, 1, "same error: no second alert");

		// Cloudflare is back: only the zone step runs again.
		zoneDeleteStatus = () => 200;
		const report = await runScheduledMaintenance(env, new Date(Date.now() + 2 * HOUR));
		assert.deepEqual(report.offboardingCloudflareCleaned, ["cfdown.test"]);
		assert.deepEqual(report.offboardingFinalized, [], "the data was finalized earlier");
		assert.equal(zoneDeletes("cfdown.test").length, 3);
		assert.equal(autoRenewOffs("cfdown.test").length, 1, "registrar step not repeated");
		assert.equal(cancels("sub_cfdown").length, 1, "Stripe not called again");
		assert.equal(env.MAILBOX.calls.filter(([, m]) => m === "purgeMailbox").length, purgesBefore, "no mailbox purged again");
		row = await getOffboarding(db, "cfdown.test");
		assert.ok(row.zoneDeletedAt && row.finalizedAt);
		assert.equal(row.step, "done");
		assert.equal(row.lastError, null);
		const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, "cfdown.test")).all();
		assert.equal(audit.filter((a) => a.action === "domain.offboarding_finalized").length, 1);

		// Done: later runs leave it alone.
		const after = await runDomainOffboarding(env, new Date(Date.now() + 3 * HOUR));
		assert.deepEqual(after.cloudflareCleaned, []);
		assert.equal(zoneDeletes("cfdown.test").length, 3);
	}

	globalThis.fetch = prev;
	delete env.CF_API_TOKEN;
	delete env.CF_ACCOUNT_ID;
}

globalThis.fetch = realFetch;
console.log("✔ domain offboarding tests passed");
