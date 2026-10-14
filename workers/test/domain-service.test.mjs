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

let inviteToken = "";

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

	// An invite sent while the domain still runs (used after it ends, below).
	const invited = await request(env, {
		method: "POST",
		path: "/api/v1/mailboxes/ada@acme.com/invites",
		principal: asAda,
		body: { inviteEmail: "carol@else.test" },
	});
	assert.equal(invited.status, 201);
	inviteToken = decodeURIComponent(
		email.sent.map((m) => m.text?.match(/\/invite\/([^\s"<]+)/)?.[1]).filter(Boolean).at(-1),
	);

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

	// A late, older "cancel scheduled" event doesn't reopen the end of service (or resend notices).
	const before = email.sent.length;
	await webhook(
		"customer.subscription.updated",
		{ id: "sub_acme.com", customer: "cus_acme.com", status: "active", cancel_at_period_end: true },
		Math.floor(NOW / 1000) - 3600,
	);
	assert.equal(email.sent.length, before, "nothing re-sent");
	assert.ok((await getDomainMetadata(bucket, "acme.com")).billing.serviceEndedAt);

	// An invite sent before the end can't be used to join now.
	const otp = await request(env, { method: "POST", path: `/api/v1/invites/${encodeURIComponent(inviteToken)}/otp` });
	assert.equal(otp.payload.code, "service_ended");
	const accept = await request(env, { method: "POST", path: `/api/v1/invites/${encodeURIComponent(inviteToken)}/accept`, body: {} });
	assert.equal(accept.payload.code, "service_ended");

	// Removing someone else is a change to the mailbox (bob is a domain admin, so only the freeze stops it)…
	const kick = await request(env, { method: "DELETE", path: "/api/v1/mailboxes/ada@acme.com/members/ada", principal: principalFor(bob) });
	assert.equal(kick.payload?.code, "service_ended");
	// …but leaving it yourself is an account action and still works.
	const leave = await request(env, { method: "DELETE", path: "/api/v1/mailboxes/ada@acme.com/members/bob", principal: principalFor(bob) });
	assert.notEqual(leave.payload?.code, "service_ended");
	assert.ok(leave.status < 300, `bob can leave (${leave.status})`);
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
	assert.deepEqual((await sendServiceReminders(env, new Date(NOW + 31 * DAY))).reminded, ["acme.com"]);
	assert.equal(sentTo("ada@personal.test", /29 days left to renew/).length, 1);
	assert.deepEqual((await sendServiceReminders(env, new Date(NOW + 31 * DAY + 3600_000))).reminded, [], "each reminder goes out once");

	await sendServiceReminders(env, new Date(NOW + 59.5 * DAY));
	assert.equal(sentTo("ada@personal.test", /1 day left to renew/).length, 1, "only the most urgent when several are due");
	assert.equal(sentTo("ada@personal.test", /days left to renew/).length, 1);

	await sendServiceReminders(env, new Date(NOW + 61 * DAY));
	assert.equal(sentTo("ada@personal.test", /can no longer be renewed/).length, 1);
	assert.match(sentTo("ada@personal.test", /can no longer be renewed/)[0].text, /deleted/, "it says when the mail is deleted");
	assert.ok(await bucket.get("billing/service-watch/acme.com"), "still watched: the mail is deleted 30 days after release");
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

// ── Unpaid, then paid: the same subscription brings the domain back ─

{
	await billedDomain("delta.com", { expiresInDays: 200 });
	await indexCustomer("delta.com");
	const t = Math.floor(NOW / 1000);
	await webhook("customer.subscription.updated", { id: "sub_delta.com", customer: "cus_delta.com", status: "unpaid" }, t);
	assert.equal(await domainStatus("delta.com"), "suspended", "Stripe stopped collecting: service ends");
	email.sent.length = 0;
	await webhook("invoice.paid", { customer: "cus_delta.com", subscription: "sub_delta.com", billing_reason: "subscription_cycle" }, t + 60);
	assert.equal(await domainStatus("delta.com"), "active", "paying the open invoice restores it, no second subscription");
	const meta = await getDomainMetadata(bucket, "delta.com");
	assert.equal(meta.billing.serviceEndedAt, undefined);
	assert.equal(meta.registration.autoRenew, true);
	assert.equal(sentTo("ada@personal.test", /back in service/).length, 1);
	assert.equal(await bucket.get("billing/service-watch/delta.com"), null);

	// A cancelled subscription never comes back this way.
	await webhook("customer.subscription.deleted", { id: "sub_delta.com", customer: "cus_delta.com", status: "canceled" }, t + 120);
	await webhook("invoice.paid", { customer: "cus_delta.com", subscription: "sub_delta.com", billing_reason: "subscription_cycle" }, t + 180);
	assert.equal(await domainStatus("delta.com"), "suspended");
}

// ── A domain already moved out stays out ────────────────────────

{
	await billedDomain("omega.com", { expiresInDays: 200 });
	await indexCustomer("omega.com");
	await db.update(schema.domain).set({ status: "decommissioned" }).where(eq(schema.domain.domain, "omega.com"));
	const offboarded = await getDomainMetadata(bucket, "omega.com");
	await bucket.put("platform/domains/omega.com.json", JSON.stringify({ ...offboarded, status: "offboarding" }));
	email.sent.length = 0;
	await webhook("customer.subscription.deleted", { id: "sub_omega.com", customer: "cus_omega.com", status: "canceled" });
	assert.equal(await domainStatus("omega.com"), "decommissioned", "not revived as suspended (which would restore admin rights)");
	assert.equal(email.sent.length, 0, "no renewal reminders for a domain that left");
	assert.equal(await bucket.get("billing/service-watch/omega.com"), null);
}

// ── The deadline uses the registrar's current expiry ────────────

{
	// The registrar renewed it last year; our stored expiry is a year stale.
	const { registerDomain } = await import("../lib/cloudflare-registrar.ts");
	const current = await registerDomain({}, "epsilon.com");
	await billedDomain("epsilon.com", { expiresInDays: -10 });
	await indexCustomer("epsilon.com");

	// Cancellation scheduled: auto-renew goes off right away, before the registrar's own renewal run.
	await webhook("customer.subscription.updated", {
		id: "sub_epsilon.com",
		customer: "cus_epsilon.com",
		status: "active",
		cancel_at_period_end: true,
		cancel_at: Math.floor((NOW + 20 * DAY) / 1000),
	});
	assert.equal((await getDomainMetadata(bucket, "epsilon.com")).registration.autoRenew, false);

	email.sent.length = 0;
	await webhook("customer.subscription.deleted", { id: "sub_epsilon.com", customer: "cus_epsilon.com", status: "canceled" });
	const meta = await getDomainMetadata(bucket, "epsilon.com");
	assert.equal(meta.registration.expiresAt, current.expiresAt, "expiry refreshed from the registrar");
	const summary = summarizeDomainService(meta);
	assert.equal(summary.canRenew, true, "not wrongly past the deadline");
	assert.equal(sentTo("ada@personal.test", /can no longer be renewed/).length, 0);
	assert.equal(sentTo("ada@personal.test", /service has ended/).length, 1);
}

// ── Domain owners need a recovery email ─────────────────────────

{
	const checkout = (body, principal) =>
		request(env, { method: "POST", path: "/api/v1/billing/create-domain-checkout", principal, body });
	const signup = { domain: "zeta.com", username: "zed", password: "ZetaPassword123!" };
	const missing = await checkout(signup);
	assert.equal(missing.status, 400);
	assert.equal(missing.payload.code, "recovery_email_required");
	const onDomain = await checkout({ ...signup, backupEmail: "zed@zeta.com" });
	assert.equal(onDomain.payload.code, "recovery_email_required", "not an address on the domain being bought");
	// A signed-in buyer without one is asked for it; ada already has one.
	const bobBuys = await checkout({ domain: "bob-shop.com" }, principalFor(bob));
	assert.equal(bobBuys.payload.code, "recovery_email_required");
	assert.equal((await checkout({ domain: "ada-shop.com" }, asAda)).status, 200);
	const bobClaims = await request(env, { method: "POST", path: "/api/v1/admin/domains", principal: principalFor(bob), body: { domain: "bob-own.com" } });
	assert.equal(bobClaims.payload.code, "recovery_email_required", "connecting your own domain needs one too");
	const byo = await request(env, {
		method: "POST",
		path: "/api/v1/auth/signup-domain",
		body: { domain: "own-domain.com", username: "me", password: "OwnDomainPassword1!" },
	});
	assert.equal(byo.status, 400, "signing up with your own domain needs one");

	// Paid: the new owner gets it as an (unverified) recovery email, with a code to confirm it.
	const created = await checkout({ ...signup, backupEmail: "Zed@Personal.test" });
	assert.equal(created.status, 200);
	email.sent.length = 0;
	const paid = await request(env, {
		method: "POST",
		path: "/api/v1/billing/stripe-webhook",
		body: { type: "checkout.session.completed", data: { object: { id: created.payload.sessionId, metadata: { domain: "zeta.com", username: "zed" } } } },
	});
	assert.equal(paid.payload.status, "provisioned");
	const zed = await db.select().from(schema.user).where(eq(schema.user.email, "zed@zeta.com")).get();
	const recovery = await db.select().from(schema.recoveryEmail).where(eq(schema.recoveryEmail.userId, zed.id)).get();
	assert.equal(recovery.email, "zed@personal.test");
	assert.equal(recovery.verifiedAt, null);
	assert.equal(sentTo("zed@personal.test", /verification code/).length, 1);

	// ── Charged 60 days before the registration expires, with a notice first ──
	const zeta = await getDomainMetadata(bucket, "zeta.com");
	assert.equal(
		zeta.billing.nextChargeAt,
		iso(Date.parse(zeta.registration.expiresAt) - 60 * DAY),
		"next charge 60 days before expiry (30 ahead of the registrar)",
	);
	assert.ok(await bucket.get("billing/service-watch/zeta.com"), "billed domains are watched for charge notices");
	const chargeAt = Date.parse(zeta.billing.nextChargeAt);
	assert.ok(!(await sendServiceReminders(env, new Date(chargeAt - 8 * DAY))).reminded.includes("zeta.com"), "not yet");
	await sendServiceReminders(env, new Date(chargeAt - 6.5 * DAY));
	const notice = sentTo("zed@personal.test", /renewal of \$20\.00/);
	assert.equal(notice.length, 1, "a week ahead: what, how much, when");
	assert.match(notice[0].text, /Manage billing/);
	await sendServiceReminders(env, new Date(chargeAt - 6 * DAY));
	assert.equal(sentTo("zed@personal.test", /renewal of/).length, 1, "once per charge");
}

// The Stripe side of moving the charge: trial_end, no proration.
{
	const { scheduleRenewalCharge } = await import("../lib/domain-service.ts");
	const meta = {
		domain: "moved.com",
		billing: { provider: "stripe", checkoutSessionId: "cs_live_moved", subscriptionId: "sub_moved", status: "active", updatedAt: iso(NOW) },
	};
	const coveredUntil = new Date(NOW + 365 * DAY);
	await withFakeStripe({ "POST /v1/subscriptions/sub_moved": { body: { id: "sub_moved", status: "trialing" } } }, async (calls) => {
		await scheduleRenewalCharge({ ...env, STRIPE_SECRET_KEY: "sk_test" }, meta, coveredUntil, new Date(NOW));
		assert.equal(calls.length, 1);
		assert.equal(calls[0].body.get("trial_end"), String(Math.floor((NOW + 305 * DAY) / 1000)));
		assert.equal(calls[0].body.get("proration_behavior"), "none", "no credit or extra charge for the moved date");
	});
	assert.equal(meta.billing.nextChargeAt, iso(NOW + 305 * DAY));
}

// A failed renewal charge: auto-renew off until it's paid, and the owner is told once.
{
	await billedDomain("theta.com", { expiresInDays: 55, billing: { nextChargeAt: iso(NOW - DAY) } });
	await indexCustomer("theta.com");
	email.sent.length = 0;
	const t = Math.floor(NOW / 1000);
	const failed = { customer: "cus_theta.com", subscription: "sub_theta.com", billing_reason: "subscription_cycle" };
	await webhook("invoice.payment_failed", failed, t);
	let meta = await getDomainMetadata(bucket, "theta.com");
	assert.equal(meta.registration.autoRenew, false, "the registrar won't renew an unpaid domain");
	assert.equal(sentTo("ada@personal.test", /payment didn't go through/).length, 1);
	await webhook("invoice.payment_failed", failed, t + 60);
	assert.equal(sentTo("ada@personal.test", /payment didn't go through/).length, 1, "Stripe's retries don't each email");

	const nextYear = Math.floor((NOW + 365 * DAY) / 1000);
	await webhook("invoice.paid", { ...failed, lines: { data: [{ period: { end: nextYear } }] } }, t + 120);
	meta = await getDomainMetadata(bucket, "theta.com");
	assert.equal(meta.registration.autoRenew, true, "paid: the registrar may renew");
	assert.equal(meta.billing.nextChargeAt, iso(nextYear * 1000));
	assert.equal(meta.billing.pastDueSince, undefined);
}

// ── 30 days after the name is released, the mail is deleted ─────

{
	const ended = (domain, expiresInDays, remindersSent) =>
		billedDomain(domain, { expiresInDays, billing: { serviceEndedAt: iso(NOW - 90 * DAY), status: "canceled", remindersSent } });

	// Warned first: released 75 days after expiry, deleted 30 days after that.
	await ended("lambda.com", -100, ["ended", "renew-closed"]);
	await db.update(schema.domain).set({ status: "suspended" }).where(eq(schema.domain.domain, "lambda.com"));
	await bucket.put("billing/service-watch/lambda.com", "1");
	email.sent.length = 0;
	await sendServiceReminders(env, new Date(NOW));
	assert.equal(sentTo("ada@personal.test", /lambda\.com: your mail will be deleted in 5 days/).length, 1);

	await ended("kappa.com", -110, ["ended", "renew-closed", "purge-7d", "purge-1d"]);
	await db.update(schema.domain).set({ status: "suspended" }).where(eq(schema.domain.domain, "kappa.com"));
	await addMailbox(db, bucket, "ada@kappa.com", { owners: ["ada"] });
	await bucket.put("billing/service-watch/kappa.com", "1");
	const { purged } = await sendServiceReminders(env, new Date(NOW));
	assert.ok(purged.includes("kappa.com"));
	assert.ok(env.MAILBOX.calls.some(([id, method]) => id === "ada@kappa.com" && method === "purgeMailbox"), "the mail is deleted");
	assert.equal(await db.select().from(schema.mailbox).where(eq(schema.mailbox.id, "ada@kappa.com")).get(), undefined);
	assert.equal(await domainStatus("kappa.com"), undefined, "the domain row is gone, so the name can be added again");
	assert.equal(await getDomainMetadata(bucket, "kappa.com"), null);
	assert.equal(await bucket.get("billing/service-watch/kappa.com"), null);
	assert.ok(await db.select().from(schema.user).where(eq(schema.user.id, "ada")).get(), "accounts stay");

	// A domain renewed in time is never touched.
	await billedDomain("mu.com", { expiresInDays: -110 });
	await bucket.put("billing/service-watch/mu.com", "1");
	assert.ok(!(await sendServiceReminders(env, new Date(NOW))).purged.includes("mu.com"));
	assert.ok(await getDomainMetadata(bucket, "mu.com"));
}

console.log("domain-service: ok");
