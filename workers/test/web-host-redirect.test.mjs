// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert/strict";
import { webHostRedirect } from "../lib/web-host-redirect.ts";

const env = { APP_BASE_URL: "https://inboxies.app", WEB_REDIRECT_HOSTS: "inboxies.email" };
const get = (url, method = "GET") => webHostRedirect(env, new Request(url, { method }));
const location = (res) => res?.headers.get("Location");

// Web pages on the old host go to the same path on the web app.
assert.equal(get("https://inboxies.email/").status, 301);
assert.equal(location(get("https://inboxies.email/")), "https://inboxies.app/");
assert.equal(location(get("https://inboxies.email/login")), "https://inboxies.app/login");
assert.equal(location(get("https://inboxies.email/invite/abc?code=1")), "https://inboxies.app/invite/abc?code=1");
assert.equal(location(get("https://inboxies.email/extension/connect")), "https://inboxies.app/extension/connect");
assert.equal(location(get("https://INBOXIES.email/mailbox/x", "HEAD")), "https://inboxies.app/mailbox/x");
assert.equal(location(get("https://inboxies.email/apis")), "https://inboxies.app/apis");

// The apps, the extension, MCP, agents and operators stay put.
for (const path of [
	"/api",
	"/api/v1/config",
	"/api/auth/get-session",
	"/api/v1/billing/checkout-return?session_id=1",
	"/mcp",
	"/mcp/sse",
	"/agents/email-agent/x",
	"/ops",
	"/ops/users",
	"/.well-known/apple-app-site-association",
	"/cdn-cgi/access/logout",
]) {
	assert.equal(get(`https://inboxies.email${path}`), null, path);
}

// Only GET/HEAD: a POST can't follow a 301 safely.
assert.equal(get("https://inboxies.email/login", "POST"), null);

// The web app's own host, other hosts and unconfigured installs are served here.
assert.equal(get("https://inboxies.app/login"), null);
assert.equal(get("http://localhost:5173/login"), null);
assert.equal(webHostRedirect({ WEB_REDIRECT_HOSTS: "inboxies.email" }, new Request("https://inboxies.email/")), null);
assert.equal(webHostRedirect({ APP_BASE_URL: "https://inboxies.app" }, new Request("https://inboxies.email/")), null);
assert.equal(
	webHostRedirect({ APP_BASE_URL: "https://inboxies.app", WEB_REDIRECT_HOSTS: "inboxies.app" }, new Request("https://inboxies.app/")),
	null,
	"never redirects to itself",
);
assert.equal(webHostRedirect({ APP_BASE_URL: "not a url", WEB_REDIRECT_HOSTS: "inboxies.email" }, new Request("https://inboxies.email/")), null);

// A list of hosts, with spacing and case ignored.
const multi = { APP_BASE_URL: "https://inboxies.app/", WEB_REDIRECT_HOSTS: " Inboxies.Email , www.inboxies.app " };
assert.equal(location(webHostRedirect(multi, new Request("https://www.inboxies.app/settings"))), "https://inboxies.app/settings");
assert.equal(location(webHostRedirect(multi, new Request("https://inboxies.email/settings"))), "https://inboxies.app/settings");

console.log("web-host-redirect tests passed");
