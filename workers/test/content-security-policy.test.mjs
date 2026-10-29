// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// AVE-148: the web app's Content-Security-Policy keeps remote mail images
// working (srcdoc frames inherit it), ships report-only, and its report
// endpoint logs only a short summary.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const {
	CSP_MODE,
	CSP_REPORT_PATH,
	buildContentSecurityPolicy,
	createCspNonce,
	cspHeaderName,
	handleCspReport,
	withContentSecurityPolicy,
} = await import("../lib/content-security-policy.ts");
const { EMAIL_FRAME_SCRIPT, EMAIL_FRAME_SCRIPT_HASH } = await import("../../shared/email-frame-script.ts");

function directives(policy) {
	const map = new Map();
	for (const part of policy.split(";")) {
		const [name, ...sources] = part.trim().split(/\s+/);
		assert.ok(!map.has(name), `${name} appears once`);
		map.set(name, sources);
	}
	return map;
}

// --- Rollout switch -------------------------------------------------------
assert.equal(CSP_MODE, "report-only", "ships report-only until reports are quiet");
assert.equal(cspHeaderName("report-only"), "Content-Security-Policy-Report-Only");
assert.equal(cspHeaderName("enforce"), "Content-Security-Policy");

// --- The policy -----------------------------------------------------------
const policy = buildContentSecurityPolicy({ nonce: "abc123", requestUrl: "https://inboxies.app/mailbox/a%40b.com" });
const d = directives(policy);

assert.deepEqual(d.get("default-src"), ["'self'"]);
assert.deepEqual(d.get("object-src"), ["'none'"]);
assert.deepEqual(d.get("base-uri"), ["'self'"]);
assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
assert.deepEqual(d.get("report-uri"), [CSP_REPORT_PATH]);

// Mail images: remote https (AVE-132), data: for inline cid images (AVE-110).
const img = d.get("img-src");
for (const source of ["'self'", "data:", "blob:", "https:"]) assert.ok(img.includes(source), `img-src has ${source}`);
assert.ok(!img.includes("http:") && !img.includes("*"), "no plain-http or wildcard images");

// Scripts: nonce + the mail frame's hash, never unsafe-inline/eval or wildcards.
const script = d.get("script-src");
assert.ok(script.includes("'self'"));
assert.ok(script.includes("'nonce-abc123'"));
assert.ok(script.includes(EMAIL_FRAME_SCRIPT_HASH), "the mail frame's script is allowed by hash");
for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "https:", "*", "data:"]) {
	assert.ok(!script.includes(bad), `script-src has no ${bad}`);
}
for (const origin of ["https://accounts.google.com/gsi/client", "https://appleid.cdn-apple.com", "https://static.cloudflareinsights.com"]) {
	assert.ok(script.includes(origin), `script-src allows ${origin}`);
}

// Styles: inline is needed for mail HTML and SSR style attributes.
assert.ok(d.get("style-src").includes("'unsafe-inline'"));
assert.ok(d.get("style-src").includes("https://fonts.googleapis.com"));
assert.ok(d.get("font-src").includes("https://fonts.gstatic.com"));

// Agents' WebSocket on the page's own host; analytics beacon endpoint.
const connect = d.get("connect-src");
assert.ok(connect.includes("'self'"));
assert.ok(connect.includes("wss://inboxies.app"));
assert.ok(connect.includes("https://cloudflareinsights.com"));
assert.ok(!connect.includes("wss:") && !connect.includes("https:"), "no scheme-wide connect");

assert.ok(d.get("frame-src").includes("https://accounts.google.com"), "Google's sign-in button frame");

// Local dev (http): ws:// on the dev host for Vite HMR and agents.
const dev = directives(buildContentSecurityPolicy({ nonce: "n", requestUrl: "http://localhost:5173/" }));
assert.ok(dev.get("connect-src").includes("ws://localhost:5173"));

// --- The mail frame's script hash is current ------------------------------
const actualHash = `'sha256-${createHash("sha256").update(EMAIL_FRAME_SCRIPT, "utf8").digest("base64")}'`;
assert.equal(EMAIL_FRAME_SCRIPT_HASH, actualHash, `update EMAIL_FRAME_SCRIPT_HASH to ${actualHash}`);
const iframeSource = readFileSync(new URL("../../app/components/EmailIframe.tsx", import.meta.url), "utf8");
assert.match(iframeSource, /<script>\$\{EMAIL_FRAME_SCRIPT\}<\\\/script>/, "the frame embeds the script verbatim");
assert.equal((iframeSource.match(/<script>/g) ?? []).length, 1, "the frame has no other inline script");

// --- Nonces ---------------------------------------------------------------
const n1 = createCspNonce();
const n2 = createCspNonce();
assert.notEqual(n1, n2);
assert.match(n1, /^[A-Za-z0-9+/]{22}==$/, "128-bit base64 nonce");

// --- Applying it ----------------------------------------------------------
const html = withContentSecurityPolicy(
	new Response("<!doctype html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
	{ nonce: "n1", requestUrl: "https://inboxies.app/" },
);
assert.match(html.headers.get("Content-Security-Policy-Report-Only"), /'nonce-n1'/);
assert.equal(html.headers.get("Content-Security-Policy"), null, "report-only doesn't enforce");
assert.equal(await html.text(), "<!doctype html>", "body passes through");

const enforced = withContentSecurityPolicy(
	new Response("x", { headers: { "Content-Type": "text/html", "Content-Security-Policy": "frame-ancestors 'none'" } }),
	{ nonce: "n2", requestUrl: "https://inboxies.app/", mode: "enforce" },
);
const enforcedHeader = enforced.headers.get("Content-Security-Policy");
assert.match(enforcedHeader, /^frame-ancestors 'none', default-src 'self'/, "appended, not replacing an existing policy");
assert.equal(enforced.headers.get("Content-Security-Policy-Report-Only"), null);

for (const type of ["application/json", "text/plain", "text/x-script"]) {
	const res = withContentSecurityPolicy(new Response("{}", { headers: { "Content-Type": type } }), {
		nonce: "n",
		requestUrl: "https://inboxies.app/",
	});
	assert.equal(res.headers.get("Content-Security-Policy-Report-Only"), null, `${type} gets no CSP`);
}

// --- Report endpoint ------------------------------------------------------
const logged = [];
const realWarn = console.warn;
console.warn = (line) => logged.push(JSON.parse(line));
try {
	const legacy = await handleCspReport(
		new Request("https://inboxies.app/api/csp-report", {
			method: "POST",
			headers: { "Content-Type": "application/csp-report" },
			body: JSON.stringify({
				"csp-report": {
					"document-uri": "https://inboxies.app/mailbox/ada%40inboxies.email/emails/123",
					"effective-directive": "script-src-elem",
					"blocked-uri": "https://evil.example/x.js?mailbox=ada@inboxies.email",
					"source-file": "https://inboxies.app/assets/root.js",
					disposition: "report",
				},
			}),
		}),
	);
	assert.equal(legacy.status, 204);
	assert.deepEqual(logged.at(-1), {
		event: "csp-violation",
		directive: "script-src-elem",
		blocked: "https://evil.example",
		source: "https://inboxies.app",
		disposition: "report",
	});
	assert.ok(!JSON.stringify(logged).includes("ada"), "no document path, query or mailbox in logs");

	const reportingApi = await handleCspReport(
		new Request("https://inboxies.app/api/csp-report", {
			method: "POST",
			headers: { "Content-Type": "application/reports+json" },
			body: JSON.stringify([
				{ type: "csp-violation", body: { effectiveDirective: "img-src", blockedURL: "data:image/png;base64,xx" } },
				{ type: "deprecation", body: { id: "x" } },
			]),
		}),
	);
	assert.equal(reportingApi.status, 204);
	assert.deepEqual(logged.at(-1), {
		event: "csp-violation",
		directive: "img-src",
		blocked: "data:",
	});

	const before = logged.length;
	const big = await handleCspReport(
		new Request("https://inboxies.app/api/csp-report", { method: "POST", body: "x".repeat(9000) }),
	);
	assert.equal(big.status, 413, "oversized bodies are refused");
	const bad = await handleCspReport(new Request("https://inboxies.app/api/csp-report", { method: "POST", body: "{" }));
	assert.equal(bad.status, 400);
	assert.equal(logged.length, before, "nothing logged for refused reports");
	const get = await handleCspReport(new Request("https://inboxies.app/api/csp-report"));
	assert.equal(get.status, 405);
} finally {
	console.warn = realWarn;
}

console.log("content security policy ok");
