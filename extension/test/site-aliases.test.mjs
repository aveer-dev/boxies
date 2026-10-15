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
assert.ok(labelMatchesSite("Amazon", siteOf("www.amazon.co.uk")));
assert.ok(!labelMatchesSite("amazon.com", siteOf("www.amazon.co.uk")));
assert.ok(!labelMatchesSite("anything", null));

// --- background SITE_ALIASES ------------------------------------------------

function loadBackground({ storage, aliasesByMailbox, status = 200 }) {
	let listener = null;
	const fetches = [];
	const context = vm.createContext({
		URL,
		console,
		importScripts: (name) => vm.runInContext(source(name), context),
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
