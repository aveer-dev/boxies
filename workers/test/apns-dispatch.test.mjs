/**
 * APNs dispatch: stale-token pruning and provider-JWT re-signing (AVE-103).
 * Run: pnpm test:unit apns-dispatch
 */

import assert from "node:assert/strict";
import { exportPKCS8, generateKeyPair } from "jose";
import { isRejectedProviderToken, sendAPNsPush } from "../lib/apns.ts";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const env = {
	APNS_KEY_ID: "KEY1234567",
	APNS_TEAM_ID: "TEAM123456",
	APNS_PRIVATE_KEY: await exportPKCS8(privateKey),
	APNS_SANDBOX: "false",
	APNS_TOPIC: "co.inboxies.app",
};
const payload = { title: "Ada", body: "Hi", mailboxId: "you@example.com", emailId: "e1" };

assert.equal(isRejectedProviderToken(403, '{"reason":"ExpiredProviderToken"}'), true);
assert.equal(isRejectedProviderToken(403, '{"reason":"InvalidProviderToken"}'), true);
assert.equal(isRejectedProviderToken(403, '{"reason":"BadCertificate"}'), false);
assert.equal(isRejectedProviderToken(400, '{"reason":"InvalidProviderToken"}'), false);

const calls = [];
let respond = () => new Response("", { status: 200 });
globalThis.fetch = async (url, init) => {
	calls.push({ url: String(url), auth: init.headers.authorization, body: JSON.parse(init.body) });
	return respond(String(url));
};

// Success on the production host; payload carries the deep-link fields.
{
	const result = await sendAPNsPush(env, ["tok-a"], payload);
	assert.equal(result.successCount, 1);
	assert.equal(calls[0].url, "https://api.push.apple.com/3/device/tok-a");
	assert.equal(calls[0].body.mailboxId, "you@example.com");
	assert.equal(calls[0].body.emailId, "e1");
	assert.equal(calls[0].body.folderId, "inbox");
}

// A cached JWT is reused while Apple accepts it.
{
	calls.length = 0;
	await sendAPNsPush(env, ["tok-a"], payload);
	const firstAuth = calls[0].auth;
	await sendAPNsPush(env, ["tok-a"], payload);
	assert.equal(calls[1].auth, firstAuth);
}

// Apple rejects the JWT: it isn't reused on the next push.
{
	calls.length = 0;
	respond = () => new Response('{"reason":"ExpiredProviderToken"}', { status: 403 });
	const failed = await sendAPNsPush(env, ["tok-a"], payload);
	assert.equal(failed.failureCount, 1);
	assert.deepEqual(failed.staleTokens, [], "a JWT problem must not prune the device");
	respond = () => new Response("", { status: 200 });
	await sendAPNsPush(env, ["tok-a"], payload);
	assert.notEqual(calls[1].auth, calls[0].auth, "rejected JWT must be re-signed");
}

// 410 Unregistered prunes the token.
{
	respond = () => new Response('{"reason":"Unregistered"}', { status: 410 });
	const result = await sendAPNsPush(env, ["tok-gone"], payload);
	assert.deepEqual(result.staleTokens, ["tok-gone"]);
}

// BadDeviceToken on production falls back to sandbox (debug builds); a sandbox
// success keeps the token.
{
	calls.length = 0;
	respond = (url) =>
		url.startsWith("https://api.push.apple.com")
			? new Response('{"reason":"BadDeviceToken"}', { status: 400 })
			: new Response("", { status: 200 });
	const result = await sendAPNsPush(env, ["tok-dev"], payload);
	assert.equal(result.successCount, 1);
	assert.deepEqual(result.staleTokens, []);
	assert.equal(calls[1].url, "https://api.sandbox.push.apple.com/3/device/tok-dev");
}

console.log("apns dispatch tests passed");
