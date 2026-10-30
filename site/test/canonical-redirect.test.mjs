// AVE-166: HTTP and www.inboxies.co go to https://inboxies.co (src/lib/canonical-redirect.ts).
// Run with `pnpm test:unit canonical-redirect`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalRedirect, isLocalHost } from "../src/lib/canonical-redirect.ts";

const go = (url, method = "GET") => canonicalRedirect(new Request(url, { method }));

test("http apex: 301 to https, same path and query", () => {
	const res = go("http://inboxies.co/support?topic=billing&x=1");
	assert.equal(res.status, 301);
	assert.equal(res.headers.get("Location"), "https://inboxies.co/support?topic=billing&x=1");
	assert.equal(go("http://inboxies.co/", "HEAD").status, 301);
	assert.equal(go("http://inboxies.co:80/").headers.get("Location"), "https://inboxies.co/");
});

test("http apex POST: 308, so the method and body survive", () => {
	for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
		const res = go("http://inboxies.co/api/contact", method);
		assert.equal(res.status, 308, method);
		assert.equal(res.headers.get("Location"), "https://inboxies.co/api/contact");
	}
});

test("www, http or https: one 301 hop to https://inboxies.co", () => {
	for (const url of ["http://www.inboxies.co/pricing?a=1", "https://www.inboxies.co/pricing?a=1", "https://WWW.Inboxies.co/pricing?a=1"]) {
		const res = go(url);
		assert.equal(res.status, 301, url);
		assert.equal(res.headers.get("Location"), "https://inboxies.co/pricing?a=1", url);
	}
	assert.equal(go("http://www.inboxies.co:80/", "HEAD").headers.get("Location"), "https://inboxies.co/");
});

test("www POST: stays on www over https (the Origin check would refuse it on the apex)", () => {
	assert.equal(go("https://www.inboxies.co/api/contact", "POST"), null);
	const res = go("http://www.inboxies.co/api/contact", "POST");
	assert.equal(res.status, 308);
	assert.equal(res.headers.get("Location"), "https://www.inboxies.co/api/contact");
});

test("https apex: untouched", () => {
	assert.equal(go("https://inboxies.co/"), null);
	assert.equal(go("https://inboxies.co/api/contact", "POST"), null);
});

test("local hosts: never redirected (astro dev, wrangler dev)", () => {
	for (const url of ["http://localhost:4321/", "http://127.0.0.1:8787/api/contact", "http://site.localhost/", "http://[::1]:8787/"]) {
		assert.equal(go(url), null, url);
		assert.equal(go(url, "POST"), null, url);
	}
	assert.equal(isLocalHost("localhost.inboxies.co"), false);
	assert.equal(isLocalHost("128.0.0.1"), false);
});
