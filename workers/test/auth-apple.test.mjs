/**
 * POST /api/v1/auth/apple end to end, with Apple's signing keys stubbed:
 * the iOS bundle audience, the web Services ID audience (only when
 * APPLE_WEB_SERVICES_ID is set), nonce checks, the web session cookie,
 * sign-up of a new identity, and /api/v1/config's appleWebClientId.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-apple.test.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { addUser, authedRequest, createAuthTestEnv } from "./auth-fixtures.mjs";

const BUNDLE_ID = "co.inboxies.app";
const SERVICES_ID = "app.inboxies.web";

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "apple-kid", alg: "RS256", use: "sig" };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url.startsWith("https://appleid.apple.com/auth/keys")) {
		return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
	}
	return realFetch(input, init);
};

const identityToken = ({ sub, email, aud = BUNDLE_ID, nonce } = {}) =>
	new SignJWT({ email, email_verified: "true", ...(nonce ? { nonce } : {}) })
		.setProtectedHeader({ alg: "RS256", kid: "apple-kid" })
		.setIssuer("https://appleid.apple.com")
		.setAudience(aud)
		.setSubject(sub)
		.setIssuedAt()
		.setExpirationTime("10m")
		.sign(privateKey);

// Without a web Services ID: iOS only, and the web button stays hidden.
{
	const { env } = createAuthTestEnv({ APPLE_CLIENT_ID: BUNDLE_ID });
	const signInApple = (body) => authedRequest(env, { method: "POST", path: "/api/v1/auth/apple", body });

	const config = await authedRequest(env, { path: "/api/v1/config" });
	assert.equal(config.status, 200);
	assert.equal(config.payload.appleSignInConfigured, true);
	assert.equal(config.payload.appleWebClientId, null, "no Services ID, no web button");

	// iOS passes SHA-256(nonce) to Apple and the raw nonce to us.
	const nonce = "ios-raw-nonce";
	const hashed = createHash("sha256").update(nonce).digest("hex");
	const ios = await signInApple({
		identityToken: await identityToken({ sub: "000001.ios.0001", email: "ivy@icloud.com", nonce: hashed }),
		nonce,
	});
	assert.equal(ios.status, 200, JSON.stringify(ios.payload));
	assert.ok(ios.payload.token);

	const web = await signInApple({
		identityToken: await identityToken({ sub: "000001.web.0001", email: "wes@icloud.com", aud: SERVICES_ID }),
	});
	assert.equal(web.status, 401, "Services ID audience is refused until APPLE_WEB_SERVICES_ID is set");
	assert.equal(web.headers.get("set-cookie"), null);
}

// With a web Services ID: both audiences verify; others don't.
{
	const { env, db } = createAuthTestEnv({ APPLE_CLIENT_ID: BUNDLE_ID, APPLE_WEB_SERVICES_ID: SERVICES_ID });
	const signInApple = (body) => authedRequest(env, { method: "POST", path: "/api/v1/auth/apple", body });

	const config = await authedRequest(env, { path: "/api/v1/config" });
	assert.equal(config.payload.appleWebClientId, SERVICES_ID);

	// Web (Apple JS): the raw nonce is in the token. A new identity signs up,
	// like it does on iOS, and the browser gets the session as a cookie.
	{
		const nonce = "web-raw-nonce";
		const res = await signInApple({
			identityToken: await identityToken({ sub: "000002.web.0002", email: "wren@icloud.com", aud: SERVICES_ID, nonce }),
			nonce,
		});
		assert.equal(res.status, 200, JSON.stringify(res.payload));
		assert.equal(res.payload.user.email, "wren@icloud.com");
		const cookie = res.headers.get("set-cookie") ?? "";
		assert.ok(decodeURIComponent(cookie).includes(res.payload.token), "web gets the same session as a cookie");
		const me = await authedRequest(env, { path: "/api/v1/me", token: res.payload.token });
		assert.equal(me.status, 200);

		const wrongNonce = await signInApple({
			identityToken: await identityToken({ sub: "000002.web.0002", email: "wren@icloud.com", aud: SERVICES_ID, nonce }),
			nonce: "another-nonce",
		});
		assert.equal(wrongNonce.status, 401, "nonce must match");
		assert.equal(wrongNonce.headers.get("set-cookie"), null);
	}

	// iOS still works alongside.
	{
		const res = await signInApple({ identityToken: await identityToken({ sub: "000003.ios.0003", email: "iris@icloud.com" }) });
		assert.equal(res.status, 200, JSON.stringify(res.payload));
	}

	// A token minted for some other app is refused.
	{
		const res = await signInApple({
			identityToken: await identityToken({ sub: "000004.x.0004", email: "eve@icloud.com", aud: "com.example.other" }),
		});
		assert.equal(res.status, 401);
		assert.equal(res.headers.get("set-cookie"), null);
	}

	// An existing user's email doesn't link: they connect Apple from Settings first.
	{
		await addUser(db, { id: "fay", email: "fay@icloud.com", password: "fay password 123" });
		const res = await signInApple({
			identityToken: await identityToken({ sub: "000005.web.0005", email: "fay@icloud.com", aud: SERVICES_ID }),
		});
		assert.equal(res.status, 409, JSON.stringify(res.payload));
		assert.match(res.payload.error, /isn't connected to an Inboxies account/);
		assert.equal(res.headers.get("set-cookie"), null);
	}
}

globalThis.fetch = realFetch;
console.log("auth-apple: ok");
