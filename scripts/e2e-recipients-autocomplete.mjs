/**
 * Headless E2E: compose people-I've-emailed autocomplete, and Enter in the
 * To/Cc/Bcc fields never sending (AVE-122).
 *
 * Signs in through the dev-only `/api/v1/auth/dev`, creates its own mailbox
 * and sends two messages through the API (to alice@ and bob@example.com,
 * reserved and never delivered) so the Sent folder feeds the suggestions.
 *
 * Requires local `pnpm dev`.
 *   E2E_BASE=http://localhost:5173 node scripts/e2e-recipients-autocomplete.mjs
 * E2E_CHROME and E2E_SHOTS: see scripts/e2e-lib.mjs.
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { BASE, api, createMailbox, launchBrowser, runId, shotsDir, signIn, step, waitFor } from "./e2e-lib.mjs";

const RUN = runId();
const MAILBOX = `recipients-${RUN}@inboxies.email`;
const MB = encodeURIComponent(MAILBOX);
const SHOTS = shotsDir("recipients");

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const shot = (name, fullPage = false) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
const options = () => page.locator('[role="listbox"] [role="option"]');
const sentCount = async () =>
	(await api(page, "GET", `/api/v1/mailboxes/${MB}/emails?folder=sent&page=1&limit=50`)).emails?.length ?? 0;

async function seed() {
	await signIn(page, `recipients-${RUN}@example.com`);
	await createMailbox(page, MAILBOX, "Recipients E2E");
	for (const [name, email] of [["Alice", "alice@example.com"], ["Bob", "bob@example.com"]]) {
		await api(page, "POST", `/api/v1/mailboxes/${MB}/emails`, {
			from: MAILBOX,
			to: email,
			subject: `Hello ${name}`,
			text: `Hi ${name}, this is an E2E seed message.`,
		}, { expect: 202 });
	}
	await waitFor(async () => (await sentCount()) === 2, { what: "2 Sent rows" });
	step(`signed in and seeded ${MAILBOX} (Sent → alice, bob)`);
}

try {
	await seed();

	await page.goto(`${BASE}/mailbox/${MB}/emails/inbox`, { waitUntil: "networkidle" });
	await page.getByRole("button", { name: /^Compose$/i }).first().click();
	const toInput = page.getByRole("combobox", { name: "recipient@example.com" });
	await toInput.waitFor();
	await toInput.click();

	// People I've emailed show up before typing.
	await options().first().waitFor({ timeout: 10_000 });
	const initial = await options().allTextContents();
	assert.ok(initial.some((t) => t.includes("alice@example.com")), "alice in list");
	assert.ok(initial.some((t) => t.includes("bob@example.com")), "bob in list");
	await shot("01-list");
	step(`suggestions list Sent recipients (${initial.length})`);

	// Typing filters.
	await toInput.fill("ali");
	await waitFor(async () => (await options().count()) === 1, { what: "only alice after typing ali" });
	assert.match(await options().first().innerText(), /alice@example\.com/);
	await shot("02-filtered");
	step("typing filters the suggestions");

	// Picking adds the address; the rest stay pickable.
	await options().first().click();
	assert.match(await toInput.inputValue(), /alice@example\.com/i);
	await options().first().waitFor();
	const remaining = await options().allTextContents();
	assert.ok(!remaining.some((t) => t.includes("alice@example.com")), "alice removed from list");
	await options().filter({ hasText: "bob@example.com" }).click();
	const afterBob = await toInput.inputValue();
	assert.match(afterBob, /alice@example\.com/i);
	assert.match(afterBob, /bob@example\.com/i);
	await shot("03-alice-bob");
	step("pick alice, then bob, into To");

	// AVE-122: with a sendable message (subject + body), plain Enter in To, Cc
	// and Bcc commits the typed address and never sends.
	await page.getByPlaceholder("Email subject").fill("Enter must not send");
	await page.locator("[id^='column-compose'] [contenteditable]").first().fill("Body text.");
	await toInput.click();
	await toInput.press("End");
	await toInput.pressSequentially("carol@example.com");
	await toInput.press("Enter");
	assert.match(await toInput.inputValue(), /carol@example\.com,\s*$/, "Enter commits the To address");
	await page.getByRole("button", { name: "CC / BCC" }).click();
	const [ccInput, bccInput] = await page
		.getByRole("combobox", { name: "Separate multiple addresses with commas" })
		.all();
	for (const [label, input, address] of [["Cc", ccInput, "dave@example.com"], ["Bcc", bccInput, "erin@example.com"]]) {
		await input.click();
		await input.pressSequentially(address);
		await input.press("Enter");
		assert.match(await input.inputValue(), new RegExp(`${address.replace(".", "\\.")},\\s*$`), `Enter commits the ${label} address`);
	}
	await page.waitForTimeout(1500);
	assert.equal(await page.locator("[id^='column-compose']").count(), 1, "composer still open");
	assert.equal(await sentCount(), 2, "nothing sent");
	await shot("04-enter-no-send");
	step("Enter in To/Cc/Bcc commits the address without sending");

	writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ ok: true, mailbox: MAILBOX, initial, afterBob }, null, 2));
	console.log("\nrecipients-autocomplete e2e passed");
} catch (e) {
	await shot("failure", true).catch(() => {});
	console.error("E2E failed:", e);
	process.exitCode = 1;
} finally {
	await browser.close();
}
