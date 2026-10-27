/**
 * AVE-99: Report spam on RFC 8058 bulk mail offers one-click unsubscribe.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/list-unsubscribe.test.mjs
 */

import assert from "node:assert/strict";
import {
	ONE_CLICK_BODY,
	oneClickUnsubscribeUrl,
	safeUnsubscribeUrl,
	sendOneClickUnsubscribe,
	supportsOneClickUnsubscribe,
} from "../lib/list-unsubscribe.ts";
import {
	addMailbox,
	addUser,
	createAuthTestEnv,
	mockMailboxNamespace,
	principalFor,
	request,
} from "./auth-fixtures.mjs";

const headers = (...pairs) => JSON.stringify(pairs.map(([key, value]) => ({ key, value })));
const RFC8058 = headers(
	["List-Unsubscribe", "<mailto:unsub@news.example?subject=unsub>, <https://news.example/u/abc?x=1>"],
	["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
);

// ── Header detection ─────────────────────────────────────────────────────
{
	assert.equal(oneClickUnsubscribeUrl(RFC8058), "https://news.example/u/abc?x=1");
	assert.equal(supportsOneClickUnsubscribe(RFC8058), true);
	// Header names are case-insensitive; the Post value tolerates spacing.
	assert.equal(
		oneClickUnsubscribeUrl(headers(["list-unsubscribe", "<https://a.example/u>"], ["LIST-UNSUBSCRIBE-POST", " List-Unsubscribe = One-Click "])),
		"https://a.example/u",
	);
	// mailto-only: no one-click.
	assert.equal(
		supportsOneClickUnsubscribe(headers(["List-Unsubscribe", "<mailto:u@x.example>"], ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"])),
		false,
	);
	// https List-Unsubscribe without the RFC 8058 Post header: no one-click.
	assert.equal(supportsOneClickUnsubscribe(headers(["List-Unsubscribe", "<https://a.example/u>"])), false);
	assert.equal(
		supportsOneClickUnsubscribe(headers(["List-Unsubscribe", "<https://a.example/u>"], ["List-Unsubscribe-Post", "Something=Else"])),
		false,
	);
	// http, private hosts and IP literals are refused (SSRF).
	for (const uri of [
		"http://a.example/u",
		"https://localhost/u",
		"https://intranet/u",
		"https://127.0.0.1/u",
		"https://10.0.0.5/u",
		"https://[::1]/u",
		"https://box.local/u",
		"https://svc.internal/u",
		"https://user:pw@a.example/u",
		"https://a.example:8443/u",
	]) {
		assert.equal(safeUnsubscribeUrl(uri), null, uri);
		assert.equal(
			supportsOneClickUnsubscribe(headers(["List-Unsubscribe", `<${uri}>`], ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"])),
			false,
			uri,
		);
	}
	assert.equal(supportsOneClickUnsubscribe(null), false);
	assert.equal(supportsOneClickUnsubscribe("not json"), false);
	console.log("✓ detects RFC 8058 one-click only");
}

// ── sendOneClickUnsubscribe ──────────────────────────────────────────────
{
	const calls = [];
	const fakeFetch = async (url, init) => {
		calls.push({ url, init });
		return new Response(null, { status: 200 });
	};
	const ok = await sendOneClickUnsubscribe("https://news.example/u/abc", { fetch: fakeFetch });
	assert.deepEqual(ok, { status: "sent", httpStatus: 200 });
	assert.equal(calls.length, 1);
	assert.equal(calls[0].init.method, "POST");
	assert.equal(calls[0].init.body, ONE_CLICK_BODY);
	assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
	assert.equal(calls[0].init.redirect, "manual");

	const failing = await sendOneClickUnsubscribe("https://news.example/u", {
		fetch: async () => { throw new TypeError("network down"); },
	});
	assert.equal(failing.status, "failed");
	const redirect = await sendOneClickUnsubscribe("https://news.example/u", {
		fetch: async () => new Response(null, { status: 302, headers: { Location: "http://evil.example" } }),
	});
	assert.deepEqual(redirect, { status: "failed", httpStatus: 302 });
	const unsafe = await sendOneClickUnsubscribe("https://127.0.0.1/u", { fetch: fakeFetch });
	assert.equal(unsafe.status, "failed");
	assert.equal(calls.length, 1, "never fetches an unsafe URL");
	console.log("✓ POST shape, failures never throw");
}

// ── HTTP: Report spam with/without the unsubscribe flag ──────────────────
const MAILBOX = "ada@inboxies.email";
const state = { emails: new Map(), triage: new Map(), claims: new Set() };
const stub = {
	getEmail: async (id) => {
		const email = state.emails.get(id);
		return email ? { ...email } : null;
	},
	moveEmail: async (id, folderId) => {
		const email = state.emails.get(id);
		if (!email) return false;
		email.folder_id = folderId;
		return true;
	},
	getSenderTriage: async (sender) => state.triage.get(sender) ?? null,
	upsertSenderTriage: async (row) => {
		const saved = { sender: row.sender, status: row.status, destination_folder_id: null, display_name: null };
		state.triage.set(row.sender, saved);
		return saved;
	},
	getSenderPreference: async () => null,
	upsertSenderPreference: async (input) => ({ preference: input, refiledCount: 0 }),
	deleteSenderPreference: async () => false,
	claimOneClickUnsubscribe: async (id) => {
		if (state.claims.has(id)) return false;
		state.claims.add(id);
		return true;
	},
};
const put = (id, folder_id, raw_headers) =>
	state.emails.set(id, { id, folder_id, sender: "news@news.example", sender_name: null, raw_headers });

const { env, db, bucket } = createAuthTestEnv({ MAILBOX: mockMailboxNamespace(stub) });
const ada = await addUser(db, { id: "ada", email: MAILBOX });
await addMailbox(db, bucket, MAILBOX, { owners: ["ada"] });
const asAda = principalFor(ada);
const move = (id, body) =>
	request(env, { method: "POST", path: `/api/v1/mailboxes/${MAILBOX}/emails/${id}/move`, principal: asAda, body });

const posts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
	const href = typeof url === "string" ? url : url.url;
	if (href.startsWith("https://news.example/")) {
		posts.push({ url: href, init });
		return new Response(null, { status: 200 });
	}
	return realFetch(url, init);
};

try {
	{
		// Not flagged: report spam, no POST.
		put("e1", "inbox", RFC8058);
		const res = await move("e1", { folderId: "spam", setSenderPreference: true });
		assert.equal(res.status, 200);
		assert.equal(res.payload.senderStatus, "rejected");
		assert.equal(res.payload.unsubscribe, undefined);
		assert.equal(posts.length, 0, "no POST without the flag");
	}
	{
		// Flagged: exactly one POST, even on retry and double tap.
		put("e2", "inbox", RFC8058);
		const [a, b] = await Promise.all([
			move("e2", { folderId: "spam", setSenderPreference: true, unsubscribe: true }),
			move("e2", { folderId: "spam", setSenderPreference: true, unsubscribe: true }),
		]);
		assert.equal(a.status, 200);
		assert.equal(b.status, 200);
		const retry = await move("e2", { folderId: "spam", setSenderPreference: true, unsubscribe: true });
		assert.equal(retry.status, 200);
		assert.equal(posts.length, 1, "exactly one POST");
		assert.equal(posts[0].url, "https://news.example/u/abc?x=1");
		assert.equal(posts[0].init.method, "POST");
		assert.equal(posts[0].init.body, ONE_CLICK_BODY);
		assert.equal([a, b].filter((r) => r.payload.unsubscribe === "sent").length, 1);
	}
	{
		// Flagged on mail without RFC 8058: still reported, no POST.
		put("e3", "inbox", headers(["List-Unsubscribe", "<mailto:u@news.example>"]));
		const res = await move("e3", { folderId: "spam", unsubscribe: true });
		assert.equal(res.payload.senderStatus, "rejected");
		assert.equal(res.payload.unsubscribe, undefined);
		assert.equal(posts.length, 1);
	}
	{
		// A failing endpoint never fails the spam move.
		put("e4", "inbox", headers(
			["List-Unsubscribe", "<https://news.example/fail>"],
			["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
		));
		const saved = globalThis.fetch;
		globalThis.fetch = async () => { throw new TypeError("boom"); };
		const res = await move("e4", { folderId: "spam", unsubscribe: true });
		globalThis.fetch = saved;
		assert.equal(res.status, 200);
		assert.equal(res.payload.status, "moved");
		assert.equal(res.payload.unsubscribe, "failed");
		assert.equal(state.emails.get("e4").folder_id, "spam");
	}
	{
		// Moves that aren't Report spam never unsubscribe.
		put("e5", "spam", RFC8058);
		await move("e5", { folderId: "inbox", unsubscribe: true });
		put("e6", "inbox", RFC8058);
		await move("e6", { folderId: "archive", unsubscribe: true });
		assert.equal(posts.length, 1);
	}
	console.log("✓ Report spam sends exactly one POST only when asked");
} finally {
	globalThis.fetch = realFetch;
}
