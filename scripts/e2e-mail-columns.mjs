/**
 * Headless E2E: horizontal Miller-column mailbox (web).
 *
 * Seeds its own mailbox through the local API + `/cdn-cgi/handler/email`, then
 * walks the columns: folder → thread (URL) → reload → Back, Screener triage,
 * quick reply send, Pop Out, AI Assist, search, settings sub-page, Esc,
 * Reply Later, and the phone layout.
 *
 * Requires local `pnpm run dev` (DEV auth) on :5173.
 *   E2E_BASE=http://localhost:5173 E2E_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     node scripts/e2e-mail-columns.mjs
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const CHROME = process.env.E2E_CHROME || "/usr/local/bin/google-chrome";
const SHOTS = process.env.E2E_SHOTS || "";
const MAILBOX = `columns-${Date.now().toString(36)}@inboxies.email`;
const MB = `/mailbox/${MAILBOX}`;

const browser = await chromium.launch({
	executablePath: CHROME,
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const columns = () =>
	page.$$eval("section[data-column-id]", (els) => els.map((el) => el.dataset.columnId));
const shot = async (name) => {
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const step = (name) => console.log(`✓ ${name}`);

async function seed() {
	await page.goto(BASE, { waitUntil: "domcontentloaded" });
	await page.evaluate(
		async ({ mailbox }) => {
			const res = await fetch("/api/v1/mailboxes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: mailbox, name: "Columns E2E" }),
			});
			if (res.status !== 201) throw new Error(`create mailbox: ${res.status}`);
			const send = async (from, name, subject, body, extra = {}) => {
				const headers = [
					`From: ${name} <${from}>`,
					`To: ${mailbox}`,
					`Subject: ${subject}`,
					`Message-ID: <${extra.id || crypto.randomUUID()}@e2e.test>`,
					`Date: ${new Date(Date.now() - (extra.ago || 0)).toUTCString()}`,
					"MIME-Version: 1.0",
					"Content-Type: text/html; charset=utf-8",
				];
				if (extra.inReplyTo) headers.push(`In-Reply-To: <${extra.inReplyTo}@e2e.test>`);
				const r = await fetch(
					`/cdn-cgi/handler/email?from=${encodeURIComponent(from)}&to=${encodeURIComponent(mailbox)}`,
					{ method: "POST", body: `${headers.join("\r\n")}\r\n\r\n${body}` },
				);
				if (!r.ok) throw new Error(`inbound: ${r.status}`);
			};
			await send("marcus@hyperion.test", "Marcus Vance", "ADR: Vector Cache", "<p>p99 from 42ms to 7.4ms.</p>", { ago: 60_000 });
			await send("julian@kodo.test", "Julian Thorne", "Design tokens", "<p>Specs attached.</p>", { ago: 120_000, id: "tokens" });
			await send("julian@kodo.test", "Julian Thorne", "Re: Design tokens", "<p>Use brand blue for focus.</p>", { ago: 90_000, inReplyTo: "tokens" });
		},
		{ mailbox: MAILBOX },
	);
	step(`seeded ${MAILBOX}`);
}

try {
	await seed();

	// Columns render; first-time senders wait in the Screener.
	await page.goto(`${BASE}${MB}/emails/screener`, { waitUntil: "networkidle" });
	assert.deepEqual(await columns(), ["accounts", "folders", "list"]);
	for (const folder of ["Inbox", "Screener", "Promotions", "Updates", "Sent", "Drafts", "Archive", "Spam", "Screened out", "Trash", "Reply Later"]) {
		assert.ok(await page.locator("#column-folders").getByText(folder, { exact: true }).count(), `folder ${folder}`);
	}
	await shot("01-screener");
	step("four-column shell with every system folder + Reply Later");

	// Open a thread: reader column, URL carries the id, reload keeps it, Back closes it.
	await page.locator("#column-list [data-email-id]", { hasText: "Design tokens" }).first().click();
	await page.waitForSelector("#column-reader");
	assert.match(page.url(), new RegExp(`/emails/screener/[\\w-]+$`));
	await page.reload({ waitUntil: "networkidle" });
	await page.waitForSelector("#column-reader");
	await page.goBack();
	await page.waitForFunction(() => !document.querySelector("#column-reader"));
	step("thread deep link survives reload; Back closes the reader");

	// Screener triage closes the reader and files the thread into Inbox.
	await page.locator("#column-list [data-email-id]", { hasText: "Design tokens" }).first().click();
	await page.getByRole("button", { name: "Accept" }).click();
	await page.waitForFunction(() => !document.querySelector("#column-reader"));
	await page.goto(`${BASE}${MB}/emails/inbox`, { waitUntil: "networkidle" });
	await page.locator("#column-list [data-email-id]", { hasText: "Design tokens" }).first().click();
	await page.waitForSelector("#column-reader");
	step("Screener Accept → Inbox");

	// Quick reply sends a real reply (to, Re: subject, quoted body).
	await page.getByLabel("Quick reply").fill("Agreed, brand blue.");
	await page.getByLabel("Quick reply").press("Meta+Enter");
	await page.waitForFunction(() => document.querySelector("#column-reader textarea")?.value === "");
	const sent = await page.evaluate(async (mb) => {
		const r = await fetch(`/api/v1/mailboxes/${mb}/emails?folder=sent&page=1&limit=5`).then((x) => x.json());
		return r.emails?.[0];
	}, MAILBOX);
	assert.equal(sent?.recipient, "julian@kodo.test");
	assert.equal(sent?.subject, "Re: Design tokens");
	step("quick reply sent");

	// Pop Out moves the text into a reply compose column.
	await page.getByLabel("Quick reply").fill("Draft for later");
	await page.getByLabel("Quick reply").press("Meta+Shift+O");
	await page.waitForSelector("#column-compose");
	assert.match(await page.locator("#column-compose [contenteditable]").innerText(), /Draft for later/);
	assert.equal(await page.getByLabel("Quick reply").inputValue(), "");
	await shot("02-compose");
	step("Pop Out carries the text to the composer");

	// Esc closes the deepest column: compose, then reader.
	await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("#column-compose"));
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("#column-reader"));
	step("Esc unwinds compose → reader");

	// AI Assist opens the assistant with a prefilled prompt.
	await page.locator("#column-list [data-email-id]", { hasText: "Design tokens" }).first().click();
	await page.waitForSelector("#column-reader");
	await page.keyboard.press("Meta+j");
	await page.waitForSelector("#column-agent textarea");
	await page.waitForFunction(() => /Draft a reply/.test(document.querySelector("#column-agent textarea")?.value || ""));
	await page.getByRole("button", { name: "Toggle agent" }).click();
	step("⌘J opens the assistant with a reply prompt");

	// Search from the dock replaces the list column.
	await page.getByLabel("Search mail").fill("vector");
	await page.getByLabel("Search mail").press("Enter");
	await page.waitForURL(/\/search\?q=vector/);
	await page.waitForSelector("#column-list mark");
	step("dock search → results column with highlights");

	// Settings → sub-page opens in the next column.
	await page.getByRole("button", { name: "Settings" }).click();
	await page.waitForURL(/\/settings$/);
	await page.locator("#column-settings a[href$='/settings/forwarding']").click();
	await page.waitForSelector("#column-settings-page");
	assert.deepEqual(await columns(), ["accounts", "folders", "settings", "settings-page"]);
	await shot("03-settings");
	step("settings + sub-page columns");

	// Reply Later: Focus & Reply opens reader + reply compose.
	await page.goto(`${BASE}${MB}/emails/inbox`, { waitUntil: "networkidle" });
	const target = await page.locator("#column-list [data-email-id]").first().getAttribute("data-email-id");
	await page.evaluate(
		([mb, id]) =>
			fetch(`/api/v1/mailboxes/${mb}/emails/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reply_later: true }),
			}),
		[MAILBOX, target],
	);
	await page.goto(`${BASE}${MB}/reply-later`, { waitUntil: "networkidle" });
	await page.getByRole("button", { name: "Focus & Reply" }).click();
	await page.waitForSelector("#column-compose");
	assert.ok(await page.getByRole("button", { name: "Skip" }).isVisible());
	step("Reply Later Focus & Reply");

	// Phone: one column per screen, snapped to the deepest.
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto(`${BASE}${MB}/emails/inbox`, { waitUntil: "networkidle" });
	await page.waitForFunction(
		() => document.querySelector("[aria-label='Mail columns']").scrollLeft >= 700,
		null,
		{ timeout: 5000 },
	);
	await shot("04-phone");
	step("phone layout snaps to the list column");

	console.log("\nmail-columns e2e passed");
} finally {
	await browser.close();
}
