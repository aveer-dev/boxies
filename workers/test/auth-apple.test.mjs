/**
 * POST /api/v1/auth/apple end to end, with Apple's signing keys stubbed:
 * the iOS bundle audience, the web Services ID audience (only when
 * APPLE_WEB_SERVICES_ID is set), nonce checks, the web session cookie,
 * sign-up of a new identity, /api/v1/config's appleWebClientId, and the
 * refresh tokens kept per Apple client (bundle id / Services ID) so account
 * deletion and Apple unlink can revoke each with its own client.
 * Run: node --experimental-strip-types --import ./workers/test/register-ts-ext.mjs workers/test/auth-apple.test.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { decodeJwt, exportJWK, exportPKCS8, generateKeyPair, SignJWT } from "jose";
import * as schema from "../auth/schema.ts";
import { addUser, authedRequest, createAuthTestEnv, flushWaitUntil } from "./auth-fixtures.mjs";

const BUNDLE_ID = "co.inboxies.app";
const SERVICES_ID = "app.inboxies.web";

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: "apple-kid", alg: "RS256", use: "sig" };
const realFetch = globalThis.fetch;
/** Calls to Apple's /auth/token and /auth/revoke: `{ endpoint, body }`. */
const appleCalls = [];
let refreshTokenCounter = 0;
/** `sub` of the client-secret JWT sent to Apple: must be the client_id. */
const secretSub = (call) => decodeJwt(call.body.get("client_secret")).sub;
globalThis.fetch = async (input, init) => {
	const url = input instanceof Request ? input.url : String(input);
	if (url.startsWith("https://appleid.apple.com/auth/keys")) {
		return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
	}
	if (url === "https://appleid.apple.com/auth/token" || url === "https://appleid.apple.com/auth/revoke") {
		const body = new URLSearchParams(init.body);
		appleCalls.push({ endpoint: url.slice(url.lastIndexOf("/") + 1), body });
		if (url.endsWith("/token")) {
			const refresh_token = `refresh-${body.get("client_id")}-${++refreshTokenCounter}`;
			return new Response(JSON.stringify({ refresh_token }), { headers: { "content-type": "application/json" } });
		}
		return new Response("", { status: 200 });
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

// Refresh tokens per Apple client: a web code is exchanged as the Services
// ID with the login page as redirect_uri; the iOS token survives a later web
// sign-in; revocation uses each token's own client.
{
	const { privateKey: signinKey } = await generateKeyPair("ES256", { extractable: true });
	const { env, db } = createAuthTestEnv({
		APPLE_CLIENT_ID: BUNDLE_ID,
		APPLE_WEB_SERVICES_ID: SERVICES_ID,
		APPLE_TEAM_ID: "TEAM123456",
		APPLE_SIGNIN_KEY_ID: "KEY1234567",
		APPLE_SIGNIN_PRIVATE_KEY: await exportPKCS8(signinKey),
	});
	const signInApple = async (body) => {
		const res = await authedRequest(env, { method: "POST", path: "/api/v1/auth/apple", body });
		await flushWaitUntil();
		return res;
	};
	const storedTokens = async (userId) =>
		Object.fromEntries(
			(
				await db
					.select()
					.from(schema.appleRefreshToken)
					.where(eq(schema.appleRefreshToken.userId, userId))
					.all()
			).map((r) => [r.clientId, r.refreshToken]),
		);

	// iOS: the code is exchanged as the bundle id, without redirect_uri.
	appleCalls.length = 0;
	const ios = await signInApple({
		identityToken: await identityToken({ sub: "000010.both.0010", email: "bo@icloud.com" }),
		authorizationCode: "ios-code",
	});
	assert.equal(ios.status, 200, JSON.stringify(ios.payload));
	const userId = ios.payload.user.id;
	assert.equal(appleCalls.length, 1);
	assert.equal(appleCalls[0].endpoint, "token");
	assert.equal(appleCalls[0].body.get("code"), "ios-code");
	assert.equal(appleCalls[0].body.get("client_id"), BUNDLE_ID);
	assert.equal(secretSub(appleCalls[0]), BUNDLE_ID);
	assert.equal(appleCalls[0].body.get("redirect_uri"), null);
	const iosToken = (await storedTokens(userId))[BUNDLE_ID];
	assert.ok(iosToken);

	// Web: the same person (same team, same sub) on the login page. The code
	// is exchanged as the Services ID, with the Return URL Apple JS used.
	appleCalls.length = 0;
	const web = await signInApple({
		identityToken: await identityToken({ sub: "000010.both.0010", email: "bo@icloud.com", aud: SERVICES_ID, nonce: "n1" }),
		nonce: "n1",
		authorizationCode: "web-code",
	});
	assert.equal(web.status, 200, JSON.stringify(web.payload));
	assert.equal(web.payload.user.id, userId);
	assert.equal(appleCalls.length, 1);
	assert.equal(appleCalls[0].body.get("code"), "web-code");
	assert.equal(appleCalls[0].body.get("client_id"), SERVICES_ID);
	assert.equal(secretSub(appleCalls[0]), SERVICES_ID);
	assert.equal(appleCalls[0].body.get("redirect_uri"), `${env.APP_BASE_URL}/login`);
	const afterWeb = await storedTokens(userId);
	assert.equal(afterWeb[BUNDLE_ID], iosToken, "a web sign-in doesn't overwrite the iOS token");
	assert.ok(afterWeb[SERVICES_ID]);

	// Signing in on iOS again replaces only the iOS token.
	await signInApple({
		identityToken: await identityToken({ sub: "000010.both.0010", email: "bo@icloud.com" }),
		authorizationCode: "ios-code-2",
	});
	const afterIos = await storedTokens(userId);
	assert.notEqual(afterIos[BUNDLE_ID], iosToken);
	assert.equal(afterIos[SERVICES_ID], afterWeb[SERVICES_ID]);

	// Deleting the account revokes each token with its own client.
	const { token } = ios.payload;
	appleCalls.length = 0;
	const del = await authedRequest(env, { method: "DELETE", path: "/api/v1/me", token, body: { confirm: "DELETE" } });
	assert.equal(del.status, 200, JSON.stringify(del.payload));
	const revokes = appleCalls.filter((c) => c.endpoint === "revoke");
	assert.deepEqual(
		revokes.map((c) => [c.body.get("token"), c.body.get("client_id"), secretSub(c)]).sort(),
		[
			[afterIos[BUNDLE_ID], BUNDLE_ID, BUNDLE_ID],
			[afterIos[SERVICES_ID], SERVICES_ID, SERVICES_ID],
		].sort(),
	);
	assert.deepEqual(await storedTokens(userId), {}, "rows go with the user");
}

// Unlinking Apple revokes (web token as the Services ID, a legacy account-row
// token as the bundle id) and forgets the tokens; Apple failing doesn't block it.
{
	const { privateKey: signinKey } = await generateKeyPair("ES256", { extractable: true });
	const { env, db } = createAuthTestEnv({
		APPLE_CLIENT_ID: BUNDLE_ID,
		APPLE_WEB_SERVICES_ID: SERVICES_ID,
		APPLE_TEAM_ID: "TEAM123456",
		APPLE_SIGNIN_KEY_ID: "KEY1234567",
		APPLE_SIGNIN_PRIVATE_KEY: await exportPKCS8(signinKey),
	});
	const web = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/auth/apple",
		body: {
			identityToken: await identityToken({ sub: "000011.web.0011", email: "una@icloud.com", aud: SERVICES_ID }),
			authorizationCode: "web-code",
		},
	});
	await flushWaitUntil();
	assert.equal(web.status, 200, JSON.stringify(web.payload));
	const { token, user } = web.payload;
	// A refresh token stored on the account row by an older build (iOS).
	await db
		.update(schema.account)
		.set({ refreshToken: "legacy-ios-refresh" })
		.where(eq(schema.account.userId, user.id));
	const attach = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/attach",
		token,
		body: { provider: "password", password: "una password 12345" },
	});
	assert.equal(attach.status, 200, JSON.stringify(attach.payload));

	appleCalls.length = 0;
	const unlink = await authedRequest(env, { method: "DELETE", path: "/api/v1/me/identities/apple", token });
	assert.equal(unlink.status, 200, JSON.stringify(unlink.payload));
	assert.deepEqual(
		appleCalls.map((c) => [c.endpoint, c.body.get("token"), c.body.get("client_id"), secretSub(c)]).sort(),
		[
			["revoke", "legacy-ios-refresh", BUNDLE_ID, BUNDLE_ID],
			["revoke", `refresh-${SERVICES_ID}-${refreshTokenCounter}`, SERVICES_ID, SERVICES_ID],
		].sort(),
	);
	const left = await db.select().from(schema.appleRefreshToken).where(eq(schema.appleRefreshToken.userId, user.id)).all();
	assert.equal(left.length, 0);

	// Apple down: unlink still succeeds.
	const web2 = await authedRequest(env, {
		method: "POST",
		path: "/api/v1/auth/apple",
		body: {
			identityToken: await identityToken({ sub: "000012.web.0012", email: "vic@icloud.com", aud: SERVICES_ID }),
			authorizationCode: "web-code-2",
		},
	});
	await flushWaitUntil();
	assert.equal(web2.status, 200);
	await authedRequest(env, {
		method: "POST",
		path: "/api/v1/me/identities/attach",
		token: web2.payload.token,
		body: { provider: "password", password: "vic password 12345" },
	});
	const working = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url === "https://appleid.apple.com/auth/revoke") throw new Error("network down");
		return working(input, init);
	};
	const unlink2 = await authedRequest(env, { method: "DELETE", path: "/api/v1/me/identities/apple", token: web2.payload.token });
	globalThis.fetch = working;
	assert.equal(unlink2.status, 200, JSON.stringify(unlink2.payload));
}

globalThis.fetch = realFetch;
console.log("auth-apple: ok");
