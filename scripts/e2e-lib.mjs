/**
 * Shared setup for the headless web E2E scripts (scripts/e2e-*.mjs).
 *
 * Environment:
 *   E2E_BASE    App origin (default http://localhost:5173, `pnpm dev`).
 *   E2E_CHROME  Chrome/Chromium executable. Unset: the first of the usual
 *               macOS/Linux install paths that exists, else Playwright's
 *               `chrome` channel.
 *   E2E_SHOTS   Screenshot directory. Unset: a fresh temp directory, printed
 *               at start.
 *
 * Sign-in uses `POST /api/v1/auth/dev`, which only exists on a local dev
 * runtime (`pnpm dev`); against anything else it 404s and the script stops.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE = (process.env.E2E_BASE || "http://localhost:5173").replace(/\/+$/, "");

const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/local/bin/google-chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];

/** Launch options for headless Chrome, honoring E2E_CHROME. */
function chromeLaunchOptions() {
	const base = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
	const explicit = process.env.E2E_CHROME;
	if (explicit) {
		if (!existsSync(explicit)) throw new Error(`E2E_CHROME not found: ${explicit}`);
		return { ...base, executablePath: explicit };
	}
	const found = CHROME_CANDIDATES.find((path) => existsSync(path));
	return found ? { ...base, executablePath: found } : { ...base, channel: "chrome" };
}

export function launchBrowser() {
	return chromium.launch(chromeLaunchOptions());
}

/** Screenshot directory for this run (`name` labels the temp directory). */
export function shotsDir(name) {
	const dir = process.env.E2E_SHOTS || mkdtempSync(join(tmpdir(), `inboxies-e2e-${name}-`));
	mkdirSync(dir, { recursive: true });
	console.log(`screenshots → ${dir}`);
	return dir;
}

/** A unique, lower-case id for addresses and subjects in one run. */
export const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const step = (name) => console.log(`✓ ${name}`);

/**
 * JSON API call with the browser context's cookies. Throws unless the status
 * is one of `expect` (default: any 2xx).
 */
export async function api(page, method, path, body, { expect } = {}) {
	const res = await page.context().request.fetch(`${BASE}${path}`, {
		method,
		...(body === undefined ? {} : { data: body }),
	});
	const ok = expect ? [].concat(expect).includes(res.status()) : res.ok();
	if (!ok) throw new Error(`${method} ${path}: ${res.status()} ${(await res.text()).slice(0, 200)}`);
	const type = res.headers()["content-type"] || "";
	return type.includes("application/json") ? res.json() : res.text();
}

/**
 * Signs the page's browser context in as `email` through the dev-only
 * `/api/v1/auth/dev` route (creates the user on first use).
 */
export async function signIn(page, email) {
	const res = await page.context().request.post(`${BASE}/api/v1/auth/dev`, { data: { email } });
	if (res.status() === 404) {
		throw new Error(`${BASE} has no /api/v1/auth/dev: run the scripts against local \`pnpm dev\` only.`);
	}
	if (!res.ok()) throw new Error(`dev sign-in: ${res.status()} ${(await res.text()).slice(0, 200)}`);
}

/** Creates a mailbox owned by the signed-in user. */
export async function createMailbox(page, email, name) {
	await api(page, "POST", "/api/v1/mailboxes", { email, name }, { expect: 201 });
}

/**
 * Delivers a raw RFC 5322 message to `to` through the local Email Routing
 * handler (`/cdn-cgi/handler/email`, dev only).
 */
export async function deliverRaw(page, { from, to, raw }) {
	const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
	const res = await page.context().request.post(`${BASE}/cdn-cgi/handler/email?${qs}`, { data: raw });
	if (!res.ok()) throw new Error(`inbound to ${to}: ${res.status()}`);
}

/** Delivers a simple HTML message to `to`. */
export async function deliver(page, { to, from, name, subject, html, id, ago = 0, inReplyTo }) {
	const headers = [
		`From: ${name} <${from}>`,
		`To: ${to}`,
		`Subject: ${subject}`,
		`Message-ID: <${id || crypto.randomUUID()}@e2e.test>`,
		`Date: ${new Date(Date.now() - ago).toUTCString()}`,
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=utf-8",
	];
	if (inReplyTo) headers.push(`In-Reply-To: <${inReplyTo}@e2e.test>`);
	await deliverRaw(page, { from, to, raw: `${headers.join("\r\n")}\r\n\r\n${html}` });
}

/** Polls `fn` until it returns a truthy value or `timeout` ms pass. */
export async function waitFor(fn, { timeout = 10_000, interval = 250, what = "condition" } = {}) {
	const end = Date.now() + timeout;
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
		await new Promise((r) => setTimeout(r, interval));
	}
}
