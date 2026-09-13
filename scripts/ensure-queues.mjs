#!/usr/bin/env node
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Ensure Cloudflare Queues referenced by wrangler.jsonc exist before deploy.
 * Wrangler does not auto-create consumer queues; missing queues fail CI/deploy.
 */

import { execSync } from "node:child_process";

const QUEUES = ["email-sending-events"];

for (const queue of QUEUES) {
	try {
		execSync(`npx wrangler queues create ${queue}`, { stdio: "pipe" });
		console.log(`Created queue "${queue}"`);
	} catch (error) {
		const message = String(error?.stderr || error?.stdout || error?.message || error);
		if (/already exists/i.test(message)) {
			console.log(`Queue "${queue}" already exists`);
			continue;
		}
		// Race / permission: list to confirm presence before failing hard.
		try {
			const listed = execSync("npx wrangler queues list", { encoding: "utf8" });
			if (listed.includes(queue)) {
				console.log(`Queue "${queue}" already exists`);
				continue;
			}
		} catch {
			// fall through
		}
		console.error(`Failed to ensure queue "${queue}":`, message);
		process.exit(1);
	}
}
