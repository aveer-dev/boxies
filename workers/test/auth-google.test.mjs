/**
 * POST /api/v1/auth/google end to end, with Google's signing keys stubbed:
 * Web and iOS client audiences, nonce checks, the web session cookie, and
 * no implicit linking by email.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-google.test.mjs
 */

import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { addUser, authedRequest, createAuthTestEnv } from "./auth-fixtures.mjs";

const WEB_CLIENT = "web.apps.googleusercontent.com";
const IOS_CLIENT = "ios.apps.googleusercontent.com";

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs")) {
		return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
	}
	return realFetch(input, init);
};

const idToken = ({ sub, email, aud = WEB_CLIENT, nonce } = {}) =>
	new SignJWT({ email, email_verified: true, name: email.split("@")[0], ...(nonce ? { nonce } : {}) })
		.setProtectedHeader({ alg: "RS256", kid: "test-kid" })
		.setIssuer("https://accounts.google.com")
		.setAudience(aud)
		.setSubject(sub)
		.setIssuedAt()
		.setExpirationTime("10m")
		.sign(privateKey);

const { env, db } = createAuthTestEnv({ GOOGLE_CLIENT_ID: WEB_CLIENT, GOOGLE_EXTRA_CLIENT_IDS: IOS_CLIENT });
const signInGoogle = (body) => authedRequest(env, { method: "POST", path: "/api/v1/auth/google", body });

// Android / web: audience is the Web client. The web login page needs the cookie.
{
	const res = await signInGoogle({ idToken: await idToken({ sub: "g-carol", email: "carol@gmail.com" }) });
	assert.equal(res.status, 200, JSON.stringify(res.payload));
	assert.ok(res.payload.token, "mobile gets a bearer token");
	const cookie = res.headers.get("set-cookie") ?? "";
	assert.ok(decodeURIComponent(cookie).includes(res.payload.token), "web gets the same session as a cookie");

	const me = await authedRequest(env, { path: "/api/v1/me", token: res.payload.token });
	assert.equal(me.status, 200);
}

// iOS: audience is the iOS client (GOOGLE_EXTRA_CLIENT_IDS), with a nonce.
{
	const nonce = "raw-nonce-123";
	const ok = await signInGoogle({
		idToken: await idToken({ sub: "g-dan", email: "dan@gmail.com", aud: IOS_CLIENT, nonce }),
		nonce,
	});
	assert.equal(ok.status, 200, JSON.stringify(ok.payload));

	const replayed = await signInGoogle({
		idToken: await idToken({ sub: "g-dan", email: "dan@gmail.com", aud: IOS_CLIENT, nonce }),
		nonce: "another-nonce",
	});
	assert.equal(replayed.status, 401, "nonce must match");
	assert.equal(replayed.headers.get("set-cookie"), null);
}

// A token minted for some other app is refused.
{
	const res = await signInGoogle({
		idToken: await idToken({ sub: "g-eve", email: "eve@gmail.com", aud: "other.apps.googleusercontent.com" }),
	});
	assert.equal(res.status, 401);
	assert.equal(res.headers.get("set-cookie"), null);
}

// An existing user's email doesn't link: they connect Google from Settings first.
{
	await addUser(db, { id: "fay", email: "fay@gmail.com", password: "fay password 123" });
	const res = await signInGoogle({ idToken: await idToken({ sub: "g-fay", email: "fay@gmail.com" }) });
	assert.equal(res.status, 409, JSON.stringify(res.payload));
	assert.match(res.payload.error, /isn't connected to an Inboxies account/);
	assert.equal(res.headers.get("set-cookie"), null);
}

globalThis.fetch = realFetch;
console.log("auth-google: ok");
