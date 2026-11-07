// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// AVE-109: cleartext requests are redirected to HTTPS; HTTPS gets HSTS.
import assert from "node:assert/strict";
import { Hono } from "hono";
import { httpsRedirect, isLocalHost } from "../lib/https-redirect.ts";
import { setDevRuntimeForTesting } from "../lib/dev-runtime.ts";
import { STRICT_TRANSPORT_SECURITY, withSecurityHeaders } from "../lib/security-headers.ts";

setDevRuntimeForTesting(false);

// GET/HEAD: 301 to the same host, path and query.
{
	const res = httpsRedirect(new Request("http://inboxies.app/login?next=%2Finbox&x=1"));
	assert.equal(res.status, 301);
	assert.equal(res.headers.get("Location"), "https://inboxies.app/login?next=%2Finbox&x=1");
	const head = httpsRedirect(new Request("http://inboxies.email/api/v1/config", { method: "HEAD" }));
	assert.equal(head.status, 301);
	assert.equal(head.headers.get("Location"), "https://inboxies.email/api/v1/config");
}

// Explicit :80 is dropped (https default port); other ports are kept.
assert.equal(httpsRedirect(new Request("http://inboxies.app:80/")).headers.get("Location"), "https://inboxies.app/");

// Other methods: 308, so the method and body survive.
for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
	const res = httpsRedirect(new Request("http://inboxies.email/api/v1/emails", { method }));
	assert.equal(res.status, 308, method);
	assert.equal(res.headers.get("Location"), "https://inboxies.email/api/v1/emails");
}

// HTTPS: untouched.
assert.equal(httpsRedirect(new Request("https://inboxies.app/login")), null);

// Local hosts: never redirected, even outside the Vite dev runtime (wrangler dev).
for (const url of [
	"http://localhost:5173/login",
	"http://127.0.0.1:8787/api/v1/config",
	"http://app.localhost/",
	"http://[::1]:5173/",
	"http://10.0.2.2:5173/api/v1/config",
]) {
	assert.equal(httpsRedirect(new Request(url)), null, url);
}
assert.equal(isLocalHost("localhost.inboxies.app"), false);
assert.equal(isLocalHost("10.0.2.3"), false);

// Vite dev runtime: never redirected, whatever the host (LAN device testing).
setDevRuntimeForTesting(true);
assert.equal(httpsRedirect(new Request("http://192.168.1.20:5173/login")), null);
setDevRuntimeForTesting(false);
assert.equal(httpsRedirect(new Request("http://192.168.1.20:5173/login")).status, 301);

// Through the middleware order in workers/app.ts.
{
	const app = new Hono();
	app.use("*", async (c, next) => {
		await next();
		const res = withSecurityHeaders(c.res, c.req.raw);
		if (res !== c.res) c.res = res;
	});
	app.use("*", async (c, next) => httpsRedirect(c.req.raw) ?? next());
	app.all("*", (c) => c.text("page"));

	const http = await app.fetch(new Request("http://inboxies.app/login"));
	assert.equal(http.status, 301);
	assert.equal(http.headers.get("Location"), "https://inboxies.app/login");
	assert.equal(http.headers.get("Strict-Transport-Security"), null, "no HSTS over cleartext");
	assert.equal(http.headers.get("X-Content-Type-Options"), "nosniff");

	const post = await app.fetch(new Request("http://inboxies.email/api/v1/config", { method: "POST", body: "{}" }));
	assert.equal(post.status, 308);

	const https = await app.fetch(new Request("https://inboxies.app/login"));
	assert.equal(https.status, 200);
	assert.equal(await https.text(), "page");
	assert.equal(https.headers.get("Strict-Transport-Security"), STRICT_TRANSPORT_SECURITY);

	const local = await app.fetch(new Request("http://localhost:5173/login"));
	assert.equal(local.status, 200);
	assert.equal(local.headers.get("Strict-Transport-Security"), null);
}

setDevRuntimeForTesting(undefined);
console.log("https-redirect: ok");
