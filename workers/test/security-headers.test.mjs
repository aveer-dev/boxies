// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// AVE-115: baseline security headers on every Worker response.
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
	CROSS_ORIGIN_OPENER_POLICY,
	FRAME_ANCESTORS_POLICY,
	PERMISSIONS_POLICY,
	REFERRER_POLICY,
	STRICT_TRANSPORT_SECURITY,
	withSecurityHeaders,
} from "../lib/security-headers.ts";

const req = (url = "https://inboxies.app/login") => new Request(url);

// HTML page: everything, including COOP (popup-friendly for Apple/Google sign-in).
{
	const res = withSecurityHeaders(
		new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
		req(),
	);
	assert.equal(res.headers.get("Strict-Transport-Security"), STRICT_TRANSPORT_SECURITY);
	assert.match(STRICT_TRANSPORT_SECURITY, /max-age=31536000; includeSubDomains$/);
	assert.doesNotMatch(STRICT_TRANSPORT_SECURITY, /preload/);
	assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
	assert.equal(res.headers.get("Referrer-Policy"), REFERRER_POLICY);
	assert.equal(REFERRER_POLICY, "strict-origin-when-cross-origin");
	assert.equal(res.headers.get("X-Frame-Options"), "DENY");
	assert.equal(res.headers.get("Content-Security-Policy"), FRAME_ANCESTORS_POLICY);
	assert.equal(FRAME_ANCESTORS_POLICY, "frame-ancestors 'none'");
	assert.equal(res.headers.get("Permissions-Policy"), PERMISSIONS_POLICY);
	for (const feature of ["camera", "microphone", "geolocation"]) {
		assert.match(PERMISSIONS_POLICY, new RegExp(`${feature}=\\(\\)`));
	}
	assert.equal(res.headers.get("Cross-Origin-Opener-Policy"), CROSS_ORIGIN_OPENER_POLICY);
	assert.equal(CROSS_ORIGIN_OPENER_POLICY, "same-origin-allow-popups");
	assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), null);
	// Never a report-only CSP: that header belongs to AVE-148.
	assert.equal(res.headers.get("Content-Security-Policy-Report-Only"), null);
	assert.equal(await res.text(), "<!doctype html>");
}

// API JSON: the baseline, no COOP (HTML only), no CORP (downloads only).
{
	const res = withSecurityHeaders(Response.json({ ok: true }), req("https://inboxies.email/api/v1/me"));
	assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
	assert.equal(res.headers.get("Strict-Transport-Security"), STRICT_TRANSPORT_SECURITY);
	assert.equal(res.headers.get("X-Frame-Options"), "DENY");
	assert.equal(res.headers.get("Cross-Origin-Opener-Policy"), null);
	assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), null);
	assert.equal(res.headers.get("Content-Type"), "application/json");
	assert.deepEqual(await res.json(), { ok: true });
}

// Attachment / export downloads: CORP same-origin + nosniff; their own headers stay.
{
	const disposition = `attachment; filename="x.html"; filename*=UTF-8''x.html`;
	const res = withSecurityHeaders(
		new Response("<script>alert(1)</script>", {
			headers: { "Content-Type": "text/html", "Content-Disposition": disposition },
		}),
		req("https://inboxies.app/api/v1/mailboxes/a/emails/b/attachments/c"),
	);
	assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
	assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
	assert.equal(res.headers.get("Content-Type"), "text/html");
	assert.equal(res.headers.get("Content-Disposition"), disposition);
}
{
	const res = withSecurityHeaders(
		new Response("From x", {
			headers: { "Content-Type": "application/mbox; charset=utf-8", "Content-Disposition": `attachment; filename="e.mbox"` },
		}),
		req("https://inboxies.app/api/v1/exports/1/download"),
	);
	assert.equal(res.headers.get("Cross-Origin-Resource-Policy"), "same-origin");
}

// Headers a route already set win (OAuth consent page, workers/mcp/oauth.ts).
{
	const res = withSecurityHeaders(
		new Response("<p>consent</p>", {
			headers: {
				"Content-Type": "text/html",
				"Referrer-Policy": "same-origin",
				"Content-Security-Policy": "frame-ancestors 'none'; form-action 'self'",
				"X-Frame-Options": "SAMEORIGIN",
			},
		}),
		req("https://inboxies.app/authorize"),
	);
	assert.equal(res.headers.get("Referrer-Policy"), "same-origin");
	assert.equal(res.headers.get("Content-Security-Policy"), "frame-ancestors 'none'; form-action 'self'");
	assert.equal(res.headers.get("X-Frame-Options"), "SAMEORIGIN");
	assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
}

// AVE-148's report-only policy is left alone, and the enforcing frame-ancestors joins it.
{
	const res = withSecurityHeaders(
		new Response("<html>", {
			headers: { "Content-Type": "text/html", "Content-Security-Policy-Report-Only": "default-src 'self'" },
		}),
		req(),
	);
	assert.equal(res.headers.get("Content-Security-Policy-Report-Only"), "default-src 'self'");
	assert.equal(res.headers.get("Content-Security-Policy"), FRAME_ANCESTORS_POLICY);
}

// Plain HTTP (local dev): no HSTS, the rest as usual.
{
	const res = withSecurityHeaders(new Response("ok"), req("http://localhost:5173/"));
	assert.equal(res.headers.get("Strict-Transport-Security"), null);
	assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
}

// Redirects keep status and Location.
{
	const res = withSecurityHeaders(Response.redirect("https://inboxies.app/login", 301), req("https://inboxies.email/login"));
	assert.equal(res.status, 301);
	assert.equal(res.headers.get("Location"), "https://inboxies.app/login");
	assert.equal(res.headers.get("Strict-Transport-Security"), STRICT_TRANSPORT_SECURITY);
}

// Immutable headers (fetched/redirect responses): copied, not mutated in place.
{
	const original = Response.redirect("https://inboxies.app/", 302);
	assert.throws(() => original.headers.set("X-Test", "1"));
	const res = withSecurityHeaders(original, req());
	assert.notEqual(res, original);
	assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
}

// Nothing missing: the same response comes back.
{
	const first = withSecurityHeaders(Response.json({}), req());
	assert.equal(withSecurityHeaders(first, req()), first);
}

// WebSocket upgrades (Agents SDK / Durable Objects) pass through untouched.
{
	const upgrade = { status: 101, headers: new Headers(), webSocket: {} };
	assert.equal(withSecurityHeaders(upgrade, req("https://inboxies.app/agents/email-agent/x")), upgrade);
	const withSocket = { status: 200, headers: new Headers(), webSocket: {} };
	assert.equal(withSecurityHeaders(withSocket, req()), withSocket);
}

// Streaming bodies are passed through, not buffered.
{
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
			controller.close();
		},
	});
	const res = withSecurityHeaders(new Response(stream, { headers: { "Content-Type": "text/event-stream" } }), req());
	assert.equal(res.body, stream);
	assert.equal(res.headers.get("Content-Type"), "text/event-stream");
}

// The middleware shape used by workers/app.ts covers early returns (redirect
// middleware), route responses and 404s.
{
	const app = new Hono();
	app.use("*", async (c, next) => {
		await next();
		const res = withSecurityHeaders(c.res, c.req.raw);
		if (res !== c.res) c.res = res;
	});
	app.use("*", async (c, next) => (new URL(c.req.url).hostname === "inboxies.email" && c.req.path === "/login"
		? Response.redirect("https://inboxies.app/login", 301)
		: next()));
	app.get("/api/v1/me", (c) => c.json({ id: "u" }));
	app.get("/login", (c) => c.html("<!doctype html><title>Login</title>"));

	const me = await app.request("https://inboxies.app/api/v1/me");
	assert.equal(me.status, 200);
	assert.equal(me.headers.get("X-Content-Type-Options"), "nosniff");
	assert.equal(me.headers.get("Cross-Origin-Opener-Policy"), null);

	const login = await app.request("https://inboxies.app/login");
	assert.equal(login.headers.get("Cross-Origin-Opener-Policy"), CROSS_ORIGIN_OPENER_POLICY);
	assert.equal(login.headers.get("Content-Security-Policy"), FRAME_ANCESTORS_POLICY);
	assert.equal(login.headers.get("Strict-Transport-Security"), STRICT_TRANSPORT_SECURITY);

	const redirect = await app.request("https://inboxies.email/login");
	assert.equal(redirect.status, 301);
	assert.equal(redirect.headers.get("Strict-Transport-Security"), STRICT_TRANSPORT_SECURITY);

	const missing = await app.request("https://inboxies.app/nope");
	assert.equal(missing.status, 404);
	assert.equal(missing.headers.get("X-Frame-Options"), "DENY");
}

// workers/app.ts runs it first, before every other middleware and route.
{
	const { readFileSync } = await import("node:fs");
	const source = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
	const hook = source.indexOf("withSecurityHeaders(c.res, c.req.raw)");
	assert.ok(hook > 0, "app.ts applies withSecurityHeaders");
	const firstOther = Math.min(
		...["webHostRedirect(c.env", "app.on(", "app.route(", 'app.all("*"']
			.map((needle) => source.indexOf(needle))
			.filter((i) => i >= 0),
	);
	assert.ok(hook < firstOther, "security headers middleware is registered first");
}

console.log("security-headers: ok");
