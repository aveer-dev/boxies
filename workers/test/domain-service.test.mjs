/**
 * When a domain's subscription ends, its service ends: mailboxes turn
 * read-only (read and export only; no send, receive, settings or AI), the
 * owner and admins get reminder emails with the registrar's renewal deadline,
 * and they can renew (or resume a subscription that is set to end).
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/domain-service.test.mjs
 */

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../auth/schema.ts";
import { setDevRuntimeForTesting } from "../lib/dev-runtime.ts";
import { getDomainMetadata } from "../lib/domain-registry.ts";
import {
	REGISTRAR_RENEWAL_GRACE_DAYS,
	summarizeDomainService,
} from "../lib/domain-service.ts";
import { dueReminder, sendServiceReminders } from "../lib/service-reminders.ts";
import { addDomain, addMailbox, addUser, createAuthTestEnv, principalFor, request } from "./auth-fixtures.mjs";

setDevRuntimeForTesting(true);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// ── Pure: the summary and the reminder schedule ─────────────────

{
	const meta = (billing, expiresInDays = 20) => ({
		domain: "x.com",
		registration: { provider: "cloudflare_registrar", expiresAt: iso(NOW + expiresInDays * DAY), autoRenew: false, whoisPrivacy: true, locked: true },
		billing: { provider: "stripe", checkoutSessionId: "cs", status: "active", updatedAt: iso(NOW), ...billing },
	});
	const active = summarizeDomainService(meta({}), new Date(NOW));
	assert.equal(active.status, "active");
	assert.equal(active.canRenew, false);
	assert.equal(active.renewBy, iso(NOW + (20 + REGISTRAR_RENEWAL_GRACE_DAYS) * DAY), "renew-by is expiry + the registrar's 40-day grace");

	const ending = summarizeDomainService(meta({ cancelAtPeriodEnd: true, serviceEndsAt: iso(NOW + 5 * DAY) }), new Date(NOW));
	assert.equal(ending.status, "ending");
	assert.equal(ending.canRenew, true);

	const ended = summarizeDomainService(meta({ serviceEndedAt: iso(NOW) }), new Date(NOW));
	assert.equal(ended.status, "ended");
	assert.equal(ended.daysLeftToRenew, 60);
	assert.equal(ended.canRenew, true);
	const tooLate = summarizeDomainService(meta({ serviceEndedAt: iso(NOW) }, -50), new Date(NOW));
	assert.equal(tooLate.canRenew, false, "past the grace period the domain can't be renewed");

	// Bring-your-own domain: no registrar deadline, renewable any time.
	const byo = summarizeDomainService({ ...meta({ serviceEndedAt: iso(NOW) }), registration: undefined }, new Date(NOW));
	assert.equal(byo.renewBy, undefined);
	assert.equal(byo.canRenew, true);

	// Schedule: one notice when the end is scheduled, then 7 and 1 days out.
	assert.deepEqual(dueReminder(ending, [], new Date(NOW)), { reminder: { kind: "ending", daysLeft: 5 }, keys: ["ending", "ending-7d"] });
	assert.equal(dueReminder(ending, ["ending", "ending-7d"], new Date(NOW)), null);
	assert.deepEqual(dueReminder(ending, ["ending", "ending-7d"], new Date(NOW + 4.5 * DAY)), {
		reminder: { kind: "ending", daysLeft: 1 },
		keys: ["ending-7d", "ending-1d"],
	});
	// Ended: the notice first, then the renewal countdown; several due at once → only the most urgent.
	assert.equal(dueReminder(ended, [], new Date(NOW)).reminder.kind, "ended");
	const late = dueReminder(ended, ["ended"], new Date(NOW + 57 * DAY));
	assert.deepEqual(late.reminder, { kind: "renew", daysLeft: 3 });
	assert.deepEqual(late.keys, ["renew-30d", "renew-14d", "renew-7d", "renew-3d"]);
	assert.equal(dueReminder(ended, ["ended"], new Date(NOW + 61 * DAY)).reminder.kind, "renew-closed");
	assert.equal(dueReminder(byo, ["ended"], new Date(NOW + 400 * DAY)), null, "no countdown without a registrar deadline");
}

// ── Fixture: acme.com, bought through Inboxies ──────────────────

const opsInbox = "ops@inboxies.test";
const { env, db, bucket, email } = createAuthTestEnv({ OPS_ALERT_EMAIL: opsInbox });
const ada = await addUser(db, { id: "ada", email: "ada@acme.com" });
const bob = await addUser(db, { id: "bob", email: "bob@gmail.com" });
const asAda = principalFor(ada);
await db.insert(schema.recoveryEmail).values({ userId: "ada", email: "ada@personal.test", verifiedAt: new Date() });
await addMailbox(db, bucket, "ada@acme.com", { owners: ["ada"], members: ["bob"] });

const billedDomain = (domain, { expiresInDays = 20, billing = {} } = {}) =>
	addDomain(db, bucket, {
		domain,
		ownerUserId: "ada",
		admins: ["bob"],
		meta: {
			registration: {
				provider: "cloudflare_registrar",
				registeredAt: iso(NOW - 345 * DAY),
				expiresAt: iso(NOW + expiresInDays * DAY),
				autoRenew: true,
				whoisPrivacy: true,
				locked: true,
			},
			billing: {
				provider: "stripe",
				checkoutSessionId: `cs_${domain}`,
				customerId: `cus_${domain}`,
				subscriptionId: `sub_${domain}`,
				status: "active",
				domainFeeUsd: 10.44,
				platformFeeUsd: 9.56,
				updatedAt: iso(NOW),
				...billing,
			},
		},
	});
const indexCustomer = (domain) =>
	bucket.put(`billing/customers/cus_${domain}.json`, JSON.stringify({ customerId: `cus_${domain}`, domain, sessionId: `cs_${domain}` }));
await billedDomain("acme.com");
await indexCustomer("acme.com");

const webhook = (type, object, created = Math.floor(NOW / 1000)) =>
	request(env, {
		method: "POST",
		path: "/api/v1/billing/stripe-webhook",
		body: { id: `evt_${type}_${Math.random()}`, type, created, data: { object } },
	});
const sentTo = (to, subjectPattern) => email.sent.filter((m) => m.to === to && subjectPattern.test(m.subject));
const domainStatus = async (domain) =>
	(await db.select({ status: schema.domain.status }).from(schema.domain).where(eq(schema.domain.domain, domain)).get())?.status;

/** Fake Stripe API by "METHOD /path"; records calls. */
async function withFakeStripe(routes, fn) {
	const calls = [];
	const prev = globalThis.fetch;
	globalThis.fetch = async (url, init = {}) => {
		const u = new URL(String(url));
		if (u.hostname !== "api.stripe.com") throw new Error(`unexpected fetch ${url}`);
		const route = `${init.method || "GET"} ${u.pathname}`;
		calls.push({ route, body: init.body ? new URLSearchParams(init.body) : null });
		const handler = routes[route];
		if (!handler) throw new Error(`unexpected Stripe call ${route}`);
		return { ok: (handler.status ?? 200) < 300, status: handler.status ?? 200, json: async () => handler.body };
	};
	try {
		return await fn(calls);
	} finally {
		globalThis.fetch = prev;
	}
}

// ── The subscription is set to end: tell them, let them keep it ─

{
	const res = await webhook("customer.subscription.updated", {
		id: "sub_acme.com",
		customer: "cus_acme.com",
		status: "active",
		cancel_at_period_end: true,
		cancel_at: Math.floor((NOW + 5 * DAY) / 1000),
	});
	assert.equal(res.status, 200);
	const meta = await getDomainMetadata(bucket, "acme.com");
	assert.equal(meta.billing.cancelAtPeriodEnd, true);
	assert.equal(meta.billing.serviceEndsAt, iso(Math.floor((NOW + 5 * DAY) / 1000) * 1000));
	assert.equal(await domainStatus("acme.com"), "active", "still in service until the end");
	assert.equal(sentTo("ada@personal.test", /ends in 5 days/).length, 1, "the owner's recovery email hears first");
	assert.equal(sentTo("ada@acme.com", /ends in 5 days/).length, 1, "their address on the domain still works, so it's told too");
	assert.equal(sentTo("bob@gmail.com", /ends in 5 days/).length, 1, "domain admins are told");
	assert.ok(await bucket.get("billing/service-watch/acme.com"), "watched for reminders");

	const service = await request(env, { path: "/api/v1/billing/domains/acme.com/service", principal: asAda });
	assert.equal(service.payload.status, "ending");
	assert.equal(service.payload.canRenew, true);
	assert.equal(service.payload.canManage, true);

	// "Keep my subscription": the scheduled cancellation is taken back in Stripe.
	await withFakeStripe(
		{
			"GET /v1/subscriptions/sub_acme.com": { body: { id: "sub_acme.com", cancel_at_period_end: true } },
			"POST /v1/subscriptions/sub_acme.com": { body: { id: "sub_acme.com" } },
		},
		async (calls) => {
			const resumed = await request({ ...env, STRIPE_SECRET_KEY: "sk_test" }, {
				method: "POST",
				path: "/api/v1/billing/domains/acme.com/renew",
				principal: asAda,
				body: { client: "web" },
			});
			assert.equal(resumed.status, 200);
			assert.equal(resumed.payload.resumed, true);
			assert.equal(calls.find((c) => c.route === "POST /v1/subscriptions/sub_acme.com").body.get("cancel_at_period_end"), "false");
		},
	);
	assert.equal((await getDomainMetadata(bucket, "acme.com")).billing.cancelAtPeriodEnd, false);
	assert.equal(await bucket.get("billing/service-watch/acme.com"), null);
}

// ── It ends: read-only, the registrar deadline, reminders ───────

{
	const stale = await webhook("customer.subscription.deleted", { id: "sub_someone_else", customer: "cus_acme.com", status: "canceled" });
	assert.equal(stale.payload.reason, "previous_subscription", "another subscription's events change nothing");
	assert.equal(await domainStatus("acme.com"), "active");

	email.sent.length = 0;
	const res = await webhook("customer.subscription.deleted", { id: "sub_acme.com", customer: "cus_acme.com", status: "canceled" });
	assert.equal(res.status, 200);
	assert.equal(await domainStatus("acme.com"), "suspended");
	const meta = await getDomainMetadata(bucket, "acme.com");
	assert.ok(meta.billing.serviceEndedAt);
	assert.equal(meta.registration.autoRenew, false, "nobody pays for it: no registrar auto-renew");
	const notice = sentTo("ada@personal.test", /service has ended/);
	assert.equal(notice.length, 1);
	assert.match(notice[0].text, /renew until/, "the notice gives the renewal deadline");
	assert.equal(sentTo("ada@acme.com", /./).length, 0, "nothing goes to an address that can no longer receive");
	assert.equal(sentTo("bob@gmail.com", /service has ended/).length, 1);
}

// Read-only: reads and export work; sending, settings, config and AI don't.
{
	const list = await request(env, { path: "/api/v1/mailboxes", principal: asAda });
	assert.equal(list.payload.find((m) => m.id === "ada@acme.com").readOnly, true);

	const mailbox = await request(env, { path: "/api/v1/mailboxes/ada@acme.com", principal: asAda });
	assert.equal(mailbox.status, 200, "reads still work (clients treat a 403 here as lost access)");
	assert.equal(mailbox.payload.readOnly, true);
	assert.equal(mailbox.payload.service.status, "ended");
	assert.equal(mailbox.payload.service.renewBy, iso(NOW + 60 * DAY));
	assert.equal((await request(env, { path: "/api/v1/mailboxes/ada@acme.com/emails", principal: asAda })).status, 200);

	const blocked = [
		["POST", "/api/v1/mailboxes/ada@acme.com/emails", { to: "x@y.com", subject: "hi", body: "hi" }],
		["PUT", "/api/v1/mailboxes/ada@acme.com", { settings: { fromName: "A" } }],
		["POST", "/api/v1/mailboxes/ada@acme.com/folders", { name: "New" }],
		["POST", "/api/v1/mailboxes/ada@acme.com/invites", { inviteEmail: "c@d.com" }],
		["POST", "/api/v1/admin/domains/acme.com/dns/records", { type: "TXT", name: "x", content: "y" }],
		["POST", "/api/v1/admin/domains/acme.com/aliases", { aliasLocal: "sales", targetMailboxId: "ada@acme.com" }],
	];
	for (const [method, path, body] of blocked) {
		const res = await request(env, { method, path, principal: asAda, body });
		assert.equal(res.status, 403, `${method} ${path} is blocked`);
		assert.equal(res.payload.code, "service_ended", `${method} ${path} says why`);
	}
	const create = await request(env, { method: "POST", path: "/api/v1/mailboxes", principal: asAda, body: { email: "new@acme.com", name: "New" } });
	assert.equal(create.status, 403, "no new addresses on an ended domain");

	// Flags and export are still allowed (whatever they answer, it isn't service_ended).
	const flag = await request(env, { method: "PUT", path: "/api/v1/mailboxes/ada@acme.com/emails/e1", principal: asAda, body: { read: true } });
	assert.notEqual(flag.payload?.code, "service_ended");
	const exportRes = await request(env, { method: "POST", path: "/api/v1/mailboxes/ada@acme.com/export", principal: asAda });
	assert.notEqual(exportRes.payload?.code, "service_ended", "their mail can still be exported");
	const domainExport = await request(env, { method: "POST", path: "/api/v1/admin/domains/acme.com/export", principal: asAda });
	assert.notEqual(domainExport.payload?.code, "service_ended");
}

// Inbound mail is refused, so senders get a bounce instead of silence.
{
	const { receiveEmail } = await import("../index.ts");
	const rejections = [];
	await receiveEmail(
		{
			to: "ada@acme.com",
			from: "someone@else.com",
			headers: new Headers(),
			raw: new ReadableStream({ start: (c) => c.close() }),
			rawSize: 0,
			setReject: (reason) => rejections.push(reason),
		},
		env,
		{ waitUntil() {} },
	);
	assert.deepEqual(rejections, ["This mailbox is not accepting mail"]);
}

// ── The hourly run: countdown to the renewal deadline ───────────

{
	email.sent.length = 0;
	// renewBy = expiry (+20d) + 40d = +60d. At +31d: 29 days left → the 30-day reminder.
	assert.deepEqual(await sendServiceReminders(env, new Date(NOW + 31 * DAY)), ["acme.com"]);
	assert.equal(sentTo("ada@personal.test", /29 days left to renew/).length, 1);
	assert.deepEqual(await sendServiceReminders(env, new Date(NOW + 31 * DAY + 3600_000)), [], "each reminder goes out once");

	await sendServiceReminders(env, new Date(NOW + 59.5 * DAY));
	assert.equal(sentTo("ada@personal.test", /1 day left to renew/).length, 1, "only the most urgent when several are due");
	assert.equal(sentTo("ada@personal.test", /days left to renew/).length, 1);

	await sendServiceReminders(env, new Date(NOW + 61 * DAY));
	assert.equal(sentTo("ada@personal.test", /can no longer be renewed/).length, 1);
	assert.equal(await bucket.get("billing/service-watch/acme.com"), null, "nothing left to say");
}

// ── Renewing brings it back ─────────────────────────────────────

{
	email.sent.length = 0;
	// Local dev without Stripe renews on the spot.
	const res = await request(env, { method: "POST", path: "/api/v1/billing/domains/acme.com/renew", principal: asAda, body: {} });
	assert.equal(res.status, 200);
	assert.equal(res.payload.renewed, true);
	assert.equal(await domainStatus("acme.com"), "active");
	const meta = await getDomainMetadata(bucket, "acme.com");
	assert.equal(meta.registration.autoRenew, true, "auto-renew back on");
	assert.equal(meta.billing.serviceEndedAt, undefined);
	assert.equal(sentTo(opsInbox, /Renew acme\.com at the registrar by hand/).length, 1, "expires in 20 days: too late for auto-renew, ops renew it");
	assert.equal(sentTo("ada@personal.test", /back in service/).length, 1);
	const send = await request(env, { method: "POST", path: "/api/v1/mailboxes/ada@acme.com/folders", principal: asAda, body: { name: "Back" } });
	assert.notEqual(send.payload?.code, "service_ended", "writes work again");
}

// Through Stripe: a new subscription for the same customer at the original price.
{
	await billedDomain("beta.com", { expiresInDays: 200, billing: { serviceEndedAt: iso(NOW - DAY) } });
	await db.update(schema.domain).set({ status: "suspended" }).where(eq(schema.domain.domain, "beta.com"));
	const stripeEnv = { ...env, STRIPE_SECRET_KEY: "sk_test" };
	await withFakeStripe(
		{ "POST /v1/checkout/sessions": { body: { id: "cs_renew_beta", url: "https://checkout.stripe.com/c/pay/cs_renew_beta" } } },
		async (calls) => {
			const res = await request(stripeEnv, {
				method: "POST",
				path: "/api/v1/billing/domains/beta.com/renew",
				principal: asAda,
				body: { client: "ios" },
			});
			assert.equal(res.status, 200);
			assert.equal(res.payload.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_renew_beta");
			const form = calls[0].body;
			assert.equal(form.get("customer"), "cus_beta.com", "the same Stripe customer");
			assert.equal(form.get("metadata[purpose]"), "renew");
			assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1044");
			assert.ok(form.get("success_url").includes("/api/v1/billing/renew-return?domain=beta.com&client=ios"));
		},
	);
	const paid = await webhook("checkout.session.completed", {
		id: "cs_renew_beta",
		payment_status: "paid",
		customer: "cus_beta.com",
		subscription: "sub_beta_2",
		metadata: { domain: "beta.com", purpose: "renew", domainFeeUsd: "10.44", platformFeeUsd: "9.56" },
	});
	assert.equal(paid.payload.status, "renewed");
	assert.equal(await domainStatus("beta.com"), "active");
	assert.equal((await getDomainMetadata(bucket, "beta.com")).billing.subscriptionId, "sub_beta_2");

	// The old subscription's late events don't end the new one.
	await webhook("customer.subscription.deleted", { id: "sub_beta.com", customer: "cus_beta.com", status: "canceled" });
	assert.equal(await domainStatus("beta.com"), "active");

	// A second renewal checkout paid by mistake is refunded.
	await withFakeStripe(
		{
			"GET /v1/subscriptions/sub_beta_dup": { body: { id: "sub_beta_dup", status: "active" } },
			"DELETE /v1/subscriptions/sub_beta_dup": { body: { id: "sub_beta_dup", status: "canceled" } },
			"GET /v1/invoices/in_dup": { body: { id: "in_dup", payments: { data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_dup" } }] } } },
			"POST /v1/refunds": { body: { id: "re_dup" } },
		},
		async () => {
			const dup = await request(stripeEnv, {
				method: "POST",
				path: "/api/v1/billing/stripe-webhook",
				body: {
					id: "evt_dup",
					type: "checkout.session.completed",
					data: {
						object: {
							id: "cs_renew_beta_dup",
							payment_status: "paid",
							customer: "cus_beta.com",
							subscription: "sub_beta_dup",
							invoice: "in_dup",
							metadata: { domain: "beta.com", purpose: "renew" },
						},
					},
				},
			});
			assert.equal(dup.payload.status, "refunded");
		},
	);
	assert.equal((await getDomainMetadata(bucket, "beta.com")).billing.subscriptionId, "sub_beta_2", "the first renewal stands");

	const back = await request(env, { path: "/api/v1/billing/renew-return?domain=beta.com&client=ios" });
	assert.equal(back.headers.get("location"), "inboxies://billing/renewed?domain=beta.com");
}

// Past the registrar's grace period there's nothing to renew.
{
	await billedDomain("gamma.com", { expiresInDays: -50, billing: { serviceEndedAt: iso(NOW - 60 * DAY) } });
	const res = await request(env, { method: "POST", path: "/api/v1/billing/domains/gamma.com/renew", principal: asAda, body: {} });
	assert.equal(res.status, 409);
	assert.equal(res.payload.service.canRenew, false);

	// Only the domain's people may ask about it.
	const eve = await addUser(db, { id: "eve", email: "eve@elsewhere.test" });
	const nosy = await request(env, { path: "/api/v1/billing/domains/gamma.com/service", principal: principalFor(eve) });
	assert.equal(nosy.status, 403);
	const renewByStranger = await request(env, { method: "POST", path: "/api/v1/billing/domains/beta.com/renew", principal: principalFor(eve), body: {} });
	assert.equal(renewByStranger.status, 403);
}

console.log("domain-service: ok");
