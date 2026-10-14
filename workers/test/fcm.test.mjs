/**
 * FCM HTTP v1 dispatch: data-only messages + stale-token pruning.
 * Run: node --experimental-strip-types workers/test/fcm.test.mjs
 */

import assert from "node:assert/strict";
import { exportPKCS8, generateKeyPair } from "jose";
import { buildFcmMessage, isStaleFcmTokenResponse, sendFcmPush } from "../lib/fcm.ts";

const payload = {
	title: "Ada Lovelace",
	body: "Here are the numbers",
	fcmBody: "Quarterly report\nHere are the numbers",
	subtitle: "Quarterly report",
	mailboxId: "you@example.com",
	emailId: "email-1",
};

// ── Message shape ─────────────────────────────────────────────────

const message = buildFcmMessage("tok-1", payload);
assert.equal(message.token, "tok-1");
assert.equal("notification" in message, false, "FCM message must be data-only");
assert.deepEqual(message.data, {
	title: "Ada Lovelace",
	body: "Quarterly report\nHere are the numbers",
	mailboxId: "you@example.com",
	emailId: "email-1",
	folderId: "inbox",
});
assert.equal(message.android.priority, "high");
assert.equal(
	buildFcmMessage("t", { ...payload, fcmBody: undefined, folderId: "updates" }).data.body,
	"Here are the numbers",
);
assert.equal(buildFcmMessage("t", { ...payload, folderId: "updates" }).data.folderId, "updates");
// FCM rejects non-string data values; every field must be a string.
for (const value of Object.values(message.data)) assert.equal(typeof value, "string");

// ── Stale-token classification ───────────────────────────────────

const unregistered = JSON.stringify({
	error: {
		code: 404,
		status: "NOT_FOUND",
		details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
	},
});
const invalidArgument = JSON.stringify({
	error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid value at 'message.data[0].value'" },
});
assert.equal(isStaleFcmTokenResponse(404, unregistered), true);
assert.equal(isStaleFcmTokenResponse(404, ""), true);
assert.equal(isStaleFcmTokenResponse(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}'), true);
assert.equal(isStaleFcmTokenResponse(400, invalidArgument), false, "INVALID_ARGUMENT must not prune");
assert.equal(isStaleFcmTokenResponse(500, "INTERNAL"), false);
assert.equal(isStaleFcmTokenResponse(429, "QUOTA_EXCEEDED"), false);

// ── sendFcmPush end to end (mocked fetch) ────────────────────────

const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const env = {
	FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
		project_id: "inboxies-test",
		client_email: "push@inboxies-test.iam.gserviceaccount.com",
		private_key: await exportPKCS8(privateKey),
	}),
};

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
	if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
		return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }), {
			headers: { "content-type": "application/json" },
		});
	}
	const body = JSON.parse(init.body);
	sent.push({ url: String(url), body, auth: init.headers.authorization });
	switch (body.message.token) {
		case "good":
			return new Response("{}", { status: 200 });
		case "gone":
			return new Response(unregistered, { status: 404 });
		case "bad-payload":
			return new Response(invalidArgument, { status: 400 });
		default:
			return new Response("oops", { status: 500 });
	}
};

try {
	const result = await sendFcmPush(env, ["good", "gone", "bad-payload"], payload);
	assert.equal(result.successCount, 1);
	assert.equal(result.failureCount, 2);
	assert.deepEqual(result.staleTokens, ["gone"]);
	assert.equal(sent.length, 3);
	for (const call of sent) {
		assert.equal(call.url, "https://fcm.googleapis.com/v1/projects/inboxies-test/messages:send");
		assert.equal(call.auth, "Bearer ya29.test");
		assert.equal("notification" in call.body.message, false);
		assert.equal(call.body.message.data.title, "Ada Lovelace");
		assert.equal(call.body.message.android.priority, "high");
	}

	const skipped = await sendFcmPush({}, ["good"], payload);
	assert.deepEqual(skipped, { successCount: 0, failureCount: 0, staleTokens: [], details: [] });
} finally {
	globalThis.fetch = realFetch;
}

console.log("fcm.test.mjs: ok");
