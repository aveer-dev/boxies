/**
 * Headless E2E: compose people-I've-emailed autocomplete.
 * Requires local `pnpm run dev` on :5173 with seeded mailbox.
 */
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const BASE = process.env.E2E_BASE || "http://localhost:5173";
const MAIL = "e2e@inboxies.email";

const browser = await chromium.launch({
	executablePath: "/usr/local/bin/google-chrome",
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
	await page.goto(`${BASE}/mailbox/${encodeURIComponent(MAIL)}/emails/inbox`, {
		waitUntil: "networkidle",
	});

	// Close agent panel if toggle exists to give compose more room
	const agentToggle = page.getByRole("button", { name: /agent/i }).first();
	if (await agentToggle.isVisible().catch(() => false)) {
		// leave it; width 1440 should be enough
	}

	await page.getByRole("button", { name: /^Compose$/i }).first().click();
	await page.waitForSelector('input[role="combobox"]');

	// Wait for people list
	await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
	const initialOptions = await page.locator('[role="listbox"] [role="option"]').allTextContents();
	console.log("initial options:", initialOptions);
	assert.ok(initialOptions.some((t) => t.includes("alice@example.com")), "alice in list");
	assert.ok(initialOptions.some((t) => t.includes("bob@example.com")), "bob in list");
	await page.screenshot({ path: "/opt/cursor/artifacts/e2e-playwright-list.png", fullPage: false });

	const toInput = page.locator('input[role="combobox"]').first();
	await toInput.click();
	await toInput.fill("ali");
	await page.waitForTimeout(200);
	const filtered = await page.locator('[role="listbox"] [role="option"]').allTextContents();
	console.log("filtered options:", filtered);
	assert.equal(filtered.length, 1, "only alice after typing ali");
	assert.ok(filtered[0].includes("alice@example.com"));
	await page.screenshot({ path: "/opt/cursor/artifacts/e2e-playwright-filtered.png", fullPage: false });

	await page.locator('[role="listbox"] [role="option"]').first().click();
	const afterAlice = await toInput.inputValue();
	console.log("after alice:", afterAlice);
	assert.match(afterAlice, /alice@example\.com/i);
	await page.screenshot({ path: "/opt/cursor/artifacts/e2e-playwright-alice.png", fullPage: false });

	// Multi-select bob from remaining list
	await page.waitForSelector('[role="listbox"] [role="option"]');
	const remaining = await page.locator('[role="listbox"] [role="option"]').allTextContents();
	console.log("remaining after alice:", remaining);
	assert.ok(!remaining.some((t) => t.includes("alice@example.com")), "alice removed from list");
	await page.locator('[role="listbox"] [role="option"]', { hasText: "bob@example.com" }).click();
	const afterBob = await toInput.inputValue();
	console.log("after bob:", afterBob);
	assert.match(afterBob, /alice@example\.com/i);
	assert.match(afterBob, /bob@example\.com/i);
	await page.screenshot({ path: "/opt/cursor/artifacts/e2e-playwright-alice-bob.png", fullPage: false });

	const report = {
		ok: true,
		afterAlice,
		afterBob,
		initialCount: initialOptions.length,
		filteredCount: filtered.length,
	};
	writeFileSync("/opt/cursor/artifacts/e2e-playwright-report.json", JSON.stringify(report, null, 2));
	console.log("E2E compose autocomplete: ok");
} catch (e) {
	await page.screenshot({ path: "/opt/cursor/artifacts/e2e-playwright-failure.png", fullPage: true }).catch(() => {});
	console.error("E2E failed:", e);
	process.exitCode = 1;
} finally {
	await browser.close();
}
