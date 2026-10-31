/**
 * The extension offers a site's existing private emails before creating one.
 * Covers label ↔ site matching and the background worker's SITE_ALIASES lookup.
 * Run: node extension/test/site-aliases.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (name) => readFileSync(join(root, name), "utf8");

// --- matching -------------------------------------------------------------

const matchContext = vm.createContext({ URL });
vm.runInContext(source("psl-data.js"), matchContext);
vm.runInContext(source("site-match.js"), matchContext);
const { siteOf, labelMatchesSite } = matchContext.InboxiesSiteMatch;

assert.equal(siteOf("www.github.com").domain, "github.com");
assert.equal(siteOf("gist.github.com").domain, "github.com");
assert.equal(siteOf("https://accounts.google.co.uk/signin").domain, "google.co.uk");
assert.equal(siteOf("shop.example.com.au").domain, "example.com.au");
assert.equal(siteOf("localhost"), null);
assert.equal(siteOf("GitHub"), null);

const github = siteOf("www.github.com");
for (const label of ["github.com", "www.github.com", "gist.github.com", "https://github.com/signup", "GitHub", "git hub"]) {
	assert.ok(labelMatchesSite(label, github), `${label} should match github.com`);
}
for (const label of ["gitlab.com", "github.io", "Github account", "", null, "notgithub.com"]) {
	assert.ok(!labelMatchesSite(label, github), `${label} should not match github.com`);
}
assert.ok(labelMatchesSite("Hacker News", siteOf("news.hackernews.com")));
// A plain name only stands for <name>.com/.org/.net/.io/.app/.co/.dev (AVE-165):
// country domains are too easy to register as look-alikes.
assert.ok(!labelMatchesSite("Amazon", siteOf("www.amazon.co.uk")));
assert.ok(labelMatchesSite("amazon.co.uk", siteOf("www.amazon.co.uk")));
assert.ok(!labelMatchesSite("amazon.com", siteOf("www.amazon.co.uk")));
assert.ok(!labelMatchesSite("anything", null));
for (const host of ["acme.com", "acme.org", "acme.net", "acme.io", "acme.app", "acme.co", "acme.dev"]) {
	assert.ok(labelMatchesSite("Acme", siteOf(host)), `Acme should match ${host}`);
}
// github.io is itself a public suffix (GitHub Pages), so it is never "GitHub".
assert.equal(siteOf("github.io"), null);

// --- AVE-165: registrable domains from the Public Suffix List -------------

const domainOf = (host) => siteOf(host)?.domain ?? null;
// ICANN suffixes.
assert.equal(domainOf("a.b.example.co.uk"), "example.co.uk");
assert.equal(domainOf("co.uk"), null);
assert.equal(domainOf("example.ac.jp"), "example.ac.jp");
// Private-section suffixes: each tenant is its own site.
assert.equal(domainOf("evil.github.io"), "evil.github.io");
assert.equal(domainOf("github.io"), null);
assert.equal(domainOf("foo.pages.dev"), "foo.pages.dev");
assert.equal(domainOf("preview.foo.pages.dev"), "foo.pages.dev");
assert.equal(domainOf("myapp.vercel.app"), "myapp.vercel.app");
assert.equal(domainOf("shop.myshopify.com"), "shop.myshopify.com");
assert.equal(siteOf("evil.github.io").private, true);
assert.equal(siteOf("github.com").private, false);
// Wildcards and exceptions: "*.ck" + "!www.ck", "*.kobe.jp" + "!city.kobe.jp".
assert.equal(domainOf("shop.foo.ck"), "shop.foo.ck");
assert.equal(domainOf("foo.ck"), null);
assert.equal(domainOf("a.b.kobe.jp"), "a.b.kobe.jp");
assert.equal(domainOf("b.kobe.jp"), null);
assert.equal(domainOf("city.kobe.jp"), "city.kobe.jp");
assert.equal(domainOf("www.city.kobe.jp"), "city.kobe.jp");
assert.equal(domainOf("x.y.city.kobe.jp"), "city.kobe.jp");
// Unknown TLDs fall back to the default "*" rule.
assert.equal(domainOf("a.b.example.notarealtld"), "example.notarealtld");
// IDN: punycode as URL.hostname gives it, and typed Unicode.
assert.equal(domainOf("www.xn--bcher-kva.de"), "xn--bcher-kva.de");
assert.equal(domainOf("shop.bücher.de"), "xn--bcher-kva.de");
assert.ok(labelMatchesSite("bücher.de", siteOf("xn--bcher-kva.de")));
// IPs, localhost and garbage have no site, so nothing is suggested.
for (const host of ["127.0.0.1", "http://192.168.1.10:8080/x", "[::1]", "http://[2001:db8::1]/", "localhost", "localhost:3000", "", null, "..", "a..b"]) {
	assert.equal(siteOf(host), null, `${host} has no site`);
	assert.ok(!labelMatchesSite(host, siteOf(host)));
}
assert.ok(!labelMatchesSite("127.0.0.1", siteOf("example.com")));

// The issue's repros: none of these may match.
const mustNotMatch = [
	["GitHub", "evil.github.io"],
	["GitHub", "github.ru"],
	["paypal", "paypal.xyz"],
	["foo.pages.dev", "attacker.pages.dev"],
	["myapp.vercel.app", "phish.vercel.app"],
	["shop.myshopify.com", "evil.myshopify.com"],
	["github.io", "evil.github.io"],
	["evil", "evil.github.io"],
	["foo", "foo.pages.dev"],
	["pages.dev", "foo.pages.dev"],
];
for (const [label, host] of mustNotMatch) {
	assert.ok(!labelMatchesSite(label, siteOf(host)), `${label} must not match ${host}`);
}
// …while the same tenant, and subdomains of a normal site, still do.
const mustMatch = [
	["foo.pages.dev", "foo.pages.dev"],
	["foo.pages.dev", "preview.foo.pages.dev"],
	["https://myapp.vercel.app/signup", "myapp.vercel.app"],
	["shop.myshopify.com", "shop.myshopify.com"],
	["example.com", "sub.example.com"],
	["sub.example.com", "example.com"],
	["PayPal", "www.paypal.com"],
];
for (const [label, host] of mustMatch) {
	assert.ok(labelMatchesSite(label, siteOf(host)), `${label} should match ${host}`);
}

// --- background SITE_ALIASES ------------------------------------------------

function loadBackground({ storage, aliasesByMailbox, status = 200 }) {
	let listener = null;
	const fetches = [];
	const context = vm.createContext({
		URL,
		console,
		importScripts: (...names) => names.forEach((name) => vm.runInContext(source(name), context)),
		fetch: async (url, init) => {
			fetches.push({ url, init });
			const mailboxId = decodeURIComponent(url.match(/mailboxes\/([^/]+)\/aliases/)[1]);
			return {
				ok: status === 200,
				status,
				json: async () => ({ aliases: aliasesByMailbox[mailboxId] ?? [] }),
			};
		},
		chrome: {
			runtime: { id: "ext", onMessage: { addListener: (fn) => (listener = fn) } },
			storage: {
				local: {
					setAccessLevel: () => Promise.resolve(),
					get: async (keys) => Object.fromEntries(keys.filter((k) => k in storage).map((k) => [k, storage[k]])),
					set: async (values) => Object.assign(storage, values),
					remove: async (keys) => keys.forEach((k) => delete storage[k]),
				},
			},
			tabs: { create: async () => {} },
		},
	});
	vm.runInContext(source("background.js"), context);
	const ask = (message, sender) =>
		new Promise((resolve) => {
			// Responses come from the vm realm; JSON brings them into this one.
			const reply = (res) => resolve(JSON.parse(JSON.stringify(res)));
			assert.equal(listener(message, { id: "ext", ...sender }, reply), true);
		});
	return { ask, fetches };
}

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const connected = {
	apiUrl: "https://inboxies.email",
	token: "tok",
	mailboxes: ["me@a.test", "work@b.test"],
	mailboxId: "me@a.test",
};
const alias = (email, label, extra = {}) => ({
	alias_email: email,
	label,
	is_active: true,
	expires_at: null,
	created_at: "2026-10-01T00:00:00.000Z",
	...extra,
});

{
	const { ask, fetches } = loadBackground({
		storage: { ...connected },
		aliasesByMailbox: {
			"me@a.test": [
				alias("old@a.test", "www.github.com", { created_at: "2026-09-01T00:00:00.000Z" }),
				alias("paused@a.test", "github.com", { is_active: false }),
				alias("expired@a.test", "github.com", { expires_at: past }),
				alias("other@a.test", "gitlab.com"),
			],
			"work@b.test": [alias("new@b.test", "GitHub", { expires_at: future, created_at: "2026-10-10T00:00:00.000Z" })],
		},
	});

	// A content script's host comes from its tab, not from the message.
	const fromPage = await ask(
		{ action: "SITE_ALIASES", host: "gitlab.com" },
		{ tab: { id: 1 }, url: "https://gist.github.com/join?x=1" },
	);
	assert.equal(fromPage.ok, true);
	assert.equal(fromPage.site, "github.com");
	assert.deepEqual(
		fromPage.aliases.map((a) => [a.email, a.mailboxId]),
		[
			["new@b.test", "work@b.test"],
			["old@a.test", "me@a.test"],
		],
	);
	assert.equal(fetches.length, 2, "lists every mailbox once");
	assert.equal(fetches[0].init.headers.Authorization, "Bearer tok");
	assert.equal(fetches[0].init.credentials, "omit");

	// The popup names the active tab's host; the list is cached.
	const fromPopup = await ask({ action: "SITE_ALIASES", host: "gitlab.com" }, {});
	assert.deepEqual(fromPopup.aliases.map((a) => a.email), ["other@a.test"]);
	assert.equal(fetches.length, 2, "second lookup uses the cache");

	const none = await ask({ action: "SITE_ALIASES", host: "localhost" }, {});
	assert.deepEqual([none.ok, none.aliases.length], [true, 0]);
}

{
	const { ask } = loadBackground({ storage: {}, aliasesByMailbox: {} });
	const res = await ask({ action: "SITE_ALIASES", host: "github.com" }, {});
	assert.deepEqual([res.ok, res.error], [false, "not_connected"]);
}

{
	const { ask } = loadBackground({ storage: { ...connected }, aliasesByMailbox: {}, status: 401 });
	const res = await ask({ action: "SITE_ALIASES", host: "github.com" }, {});
	assert.deepEqual([res.ok, res.error], [false, "session_expired"]);
}

{
	// Server unreachable: fall back to what this browser created.
	const { ask } = loadBackground({
		storage: {
			...connected,
			recentAliases: [
				{ email: "local@a.test", host: "www.github.com", createdAt: "2026-10-02T00:00:00.000Z" },
				{ email: "elsewhere@a.test", host: "example.com", createdAt: "2026-10-03T00:00:00.000Z" },
			],
		},
		aliasesByMailbox: {},
		status: 500,
	});
	const res = await ask({ action: "SITE_ALIASES", host: "github.com" }, {});
	assert.deepEqual(res.aliases.map((a) => a.email), ["local@a.test"]);
}

console.log("site-aliases.test.mjs: ok");
