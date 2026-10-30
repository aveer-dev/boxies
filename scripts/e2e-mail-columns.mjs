/**
 * Headless E2E: horizontal Miller-column mailbox (web).
 *
 * Signs in through the dev-only `/api/v1/auth/dev`, seeds its own mailbox
 * through the local API + `/cdn-cgi/handler/email`, then walks the columns:
 * folder → thread (URL) → reload → Back, Screener triage, inline cid: image in
 * the reader (AVE-110), quick reply send, Pop Out, AI Assist, search,
 * settings panels, Esc, Reply Later, and the phone layout.
 *
 * Requires local `pnpm dev`. The quick reply goes through the dev server's
 * send path to a `.test` address (reserved, never delivered).
 *   E2E_BASE=http://localhost:5173 node scripts/e2e-mail-columns.mjs
 * E2E_CHROME and E2E_SHOTS: see scripts/e2e-lib.mjs.
 */
import assert from "node:assert/strict";
import { BASE, api, createMailbox, deliver, deliverRaw, launchBrowser, runId, shotsDir, signIn, step } from "./e2e-lib.mjs";

const RUN = runId();
const MAILBOX = `columns-${RUN}@inboxies.email`;
const MB = `/mailbox/${MAILBOX}`;
const SHOTS = shotsDir("columns");
// 1×1 PNG for the inline cid: image.
const PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const columns = () =>
	page.$$eval("section[data-column-id]", (els) => els.map((el) => el.dataset.columnId));
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
// Compose columns are `column-compose-<id>`, one per open draft.
const COMPOSE = "[id^='column-compose']";

async function seed() {
	await signIn(page, `columns-${RUN}@example.com`);
	await createMailbox(page, MAILBOX, "Columns E2E");
	const to = MAILBOX;
	await deliver(page, { to, from: "marcus@hyperion.test", name: "Marcus Vance", subject: "ADR: Vector Cache", html: "<p>p99 from 42ms to 7.4ms.</p>", ago: 60_000 });
	await deliver(page, { to, from: "julian@kodo.test", name: "Julian Thorne", subject: "Design tokens", html: "<p>Specs attached.</p>", ago: 120_000, id: `tokens-${RUN}` });
	await deliver(page, { to, from: "julian@kodo.test", name: "Julian Thorne", subject: "Re: Design tokens", html: "<p>Use brand blue for focus.</p>", ago: 90_000, inReplyTo: `tokens-${RUN}` });
	// multipart/related with an inline image the HTML references by cid: (AVE-110).
	const boundary = `rel-${RUN}`;
	await deliverRaw(page, {
		from: "ines@pixel.test",
		to,
		raw: [
			"From: Ines Duarte <ines@pixel.test>",
			`To: ${to}`,
			"Subject: Inline logo",
			`Message-ID: <cid-${RUN}@e2e.test>`,
			`Date: ${new Date(Date.now() - 30_000).toUTCString()}`,
			"MIME-Version: 1.0",
			`Content-Type: multipart/related; boundary="${boundary}"`,
			"",
			`--${boundary}`,
			"Content-Type: text/html; charset=utf-8",
			"",
			'<p>Logo below.</p><img id="inline-logo" alt="logo" src="cid:logo@e2e.test">',
			`--${boundary}`,
			"Content-Type: image/png",
			"Content-Transfer-Encoding: base64",
			"Content-ID: <logo@e2e.test>",
			'Content-Disposition: inline; filename="logo.png"',
			"",
			PIXEL_PNG,
			`--${boundary}--`,
			"",
		].join("\r\n"),
	});
	step(`signed in and seeded ${MAILBOX}`);
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

	// Inline cid: image (AVE-110): the sandboxed reader shows it as a data: URL.
	await page.locator("#column-list [data-email-id]", { hasText: "Inline logo" }).first().click();
	await page.waitForSelector("#column-reader iframe[title='Email content']");
	const reader = page.frameLocator("#column-reader iframe[title='Email content']");
	const logo = reader.locator("img#inline-logo");
	await logo.waitFor();
	const loaded = await logo.evaluate(
		(img) =>
			new Promise((resolve) => {
				const done = () => resolve({ src: img.getAttribute("src") || "", width: img.naturalWidth });
				if (img.complete) return done();
				img.addEventListener("load", done, { once: true });
				img.addEventListener("error", done, { once: true });
			}),
	);
	assert.match(loaded.src, /^data:image\/png;base64,/, "cid: swapped for a data: URL");
	assert.equal(loaded.width, 1, "inline image decoded");
	await shot("01b-inline-image");
	await page.goBack();
	await page.waitForFunction(() => !document.querySelector("#column-reader"));
	step("inline cid: image renders in the sandboxed reader");

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
	await page.waitForSelector(COMPOSE);
	assert.match(await page.locator(`${COMPOSE} [contenteditable]`).innerText(), /Draft for later/);
	assert.equal(await page.getByLabel("Quick reply").inputValue(), "");
	await shot("02-compose");
	step("Pop Out carries the text to the composer");

	// Esc closes the deepest column: compose, then reader.
	await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
	await page.keyboard.press("Escape");
	await page.waitForFunction((sel) => !document.querySelector(sel), COMPOSE);
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("#column-reader"));
	step("Esc unwinds compose → reader");

	// AI Assist opens the assistant with a prefilled prompt.
	await page.locator("#column-list [data-email-id]", { hasText: "Design tokens" }).first().click();
	await page.waitForSelector("#column-reader");
	await page.keyboard.press("Meta+j");
	await page.waitForSelector("#column-agent textarea");
	await page.waitForFunction(() => /Draft a reply/.test(document.querySelector("#column-agent textarea")?.value || ""));
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	step("⌘J opens the assistant with a reply prompt");

	// Search from the dock replaces the list column.
	await page.getByLabel("Search mail").fill("vector");
	await page.getByLabel("Search mail").press("Enter");
	await page.waitForURL(/\/search\?q=vector/);
	await page.waitForSelector("#column-list mark");
	step("dock search → results column with highlights");

	// Settings opens at the far right without replacing the results; a
	// sub-page opens beside it. Esc unwinds sub-page → settings.
	await page.getByRole("button", { name: "Settings" }).click();
	await page.waitForSelector("#column-settings");
	await page.locator("#column-settings [data-settings-page='forwarding']").click();
	await page.waitForSelector("#column-settings-page");
	assert.match(page.url(), /\/search\?q=vector/);
	assert.deepEqual(await columns(), ["accounts", "folders", "list", "settings", "settings-page"]);
	await shot("03-settings");
	await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("#column-settings-page"));
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("#column-settings"));
	assert.deepEqual(await columns(), ["accounts", "folders", "list"]);
	// Old settings links still open the panel.
	await page.goto(`${BASE}${MB}/settings/filters`, { waitUntil: "networkidle" });
	await page.waitForURL(/\/emails\/inbox$/);
	await page.waitForSelector("#column-settings-page");
	step("settings + sub-page panels beside the list");

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
	await page.waitForSelector(COMPOSE);
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
