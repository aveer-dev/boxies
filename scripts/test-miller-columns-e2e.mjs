#!/usr/bin/env node
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Miller Columns Persistent Horizontal Navigation Canvas E2E Test Runner
 *
 * Runs opaque-box, requirement-driven E2E tests across Tiers 1-4:
 *   - Tier 1: Feature Coverage (75 tests across F1-F15)
 *   - Tier 2: Boundary & Corner Cases (75 tests across F1-F15)
 *   - Tier 3: Cross-Feature Combinations (16 pairwise interaction tests)
 *   - Tier 4: Real-World Application Workflows (6 realistic scenarios)
 *
 * Usage:
 *   node scripts/test-miller-columns-e2e.mjs [options]
 *
 * Options:
 *   --tier=<1|2|3|4>    Run only tests for the specified tier
 *   --feature=<name>    Filter tests by feature name
 *   --verbose, -v       Print detailed assertion status for every test
 *   --json              Output results in structured JSON format
 */

import { spawnSync } from "node:child_process";
import { register } from "node:module";

// Ensure Node runs with --experimental-strip-types
if (!process.execArgv.includes("--experimental-strip-types")) {
	const result = spawnSync(
		process.execPath,
		["--experimental-strip-types", ...process.argv.slice(1)],
		{
			stdio: "inherit",
			env: process.env,
		},
	);
	process.exit(result.status ?? 0);
}

// Register path alias resolver for shared/* and ~/*
try {
	register(new URL("../tests/miller-columns/resolve-loader.mjs", import.meta.url));
} catch (e) {
	// Loader already registered
}

// Parse command line arguments
const args = process.argv.slice(2);
let tierFilter = null;
let featureFilter = null;
let verbose = false;
let jsonOutput = false;

for (const arg of args) {
	if (arg.startsWith("--tier=")) {
		tierFilter = parseInt(arg.split("=")[1], 10);
	} else if (arg === "-t" && args[args.indexOf(arg) + 1]) {
		tierFilter = parseInt(args[args.indexOf(arg) + 1], 10);
	} else if (arg.startsWith("--feature=")) {
		featureFilter = arg.split("=")[1];
	} else if (arg === "-f" && args[args.indexOf(arg) + 1]) {
		featureFilter = args[args.indexOf(arg) + 1];
	} else if (arg === "--verbose" || arg === "-v") {
		verbose = true;
	} else if (arg === "--json") {
		jsonOutput = true;
	}
}

// Dynamic imports of test registries
const { tier1Registry } = await import("../tests/miller-columns/tier1-features.test.mjs");
const { tier2Registry } = await import("../tests/miller-columns/tier2-boundaries.test.mjs");
const { tier3Registry } = await import("../tests/miller-columns/tier3-pairwise.test.mjs");
const { tier4Registry } = await import("../tests/miller-columns/tier4-workflows.test.mjs");

const registries = [
	{ tier: 1, reg: tier1Registry },
	{ tier: 2, reg: tier2Registry },
	{ tier: 3, reg: tier3Registry },
	{ tier: 4, reg: tier4Registry },
];

const startTime = Date.now();
const allResults = [];
const tierSummaries = [];

if (!jsonOutput) {
	console.log("\n========================================================================");
	console.log("  MILLER COLUMNS PERSISTENT HORIZONTAL CANVAS E2E TEST SUITE");
	console.log("  Inboxies Web Client (`app/`) | Figma node-id=18-970 | Kumo tokens");
	console.log("========================================================================\n");
}

for (const { tier, reg } of registries) {
	if (tierFilter && tier !== tierFilter) continue;

	if (!jsonOutput) {
		console.log(`▶ Executing ${reg.name}...`);
	}

	const summary = await reg.execute({
		tierFilter,
		featureFilter,
		verbose,
	});

	tierSummaries.push(summary);
	allResults.push(...summary.results);

	if (!jsonOutput) {
		const statusText = summary.failed === 0 ? "PASSED" : "FAILED";
		const passRatio = `${summary.passed}/${summary.total}`;
		console.log(`  └─ [${statusText}] ${passRatio} tests in ${summary.duration}ms\n`);
	}
}

const totalDuration = Date.now() - startTime;
const totalTests = allResults.length;
const passedTests = allResults.filter((r) => r.passed).length;
const failedTests = allResults.filter((r) => !r.passed).length;
const allPassed = failedTests === 0;

if (jsonOutput) {
	const jsonReport = {
		timestamp: new Date().toISOString(),
		total: totalTests,
		passed: passedTests,
		failed: failedTests,
		duration_ms: totalDuration,
		passRate: totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) + "%" : "0%",
		tiers: tierSummaries.map((s) => ({
			name: s.name,
			total: s.total,
			passed: s.passed,
			failed: s.failed,
			duration_ms: s.duration,
		})),
		results: allResults,
	};
	console.log(JSON.stringify(jsonReport, null, 2));
} else {
	// Print Feature Coverage Matrix
	console.log("------------------------------------------------------------------------");
	console.log("  FEATURE INVENTORY VERIFICATION SUMMARY");
	console.log("------------------------------------------------------------------------");

	const featureMap = new Map();
	for (const r of allResults) {
		const feat = r.feature;
		if (!featureMap.has(feat)) {
			featureMap.set(feat, { total: 0, passed: 0, failed: 0 });
		}
		const stats = featureMap.get(feat);
		stats.total++;
		if (r.passed) stats.passed++;
		else stats.failed++;
	}

	for (const [feat, stats] of featureMap.entries()) {
		const mark = stats.failed === 0 ? "✔" : "✖";
		const countStr = `${stats.passed}/${stats.total}`.padStart(7);
		console.log(`  ${mark} ${feat.padEnd(42)} ${countStr} passed`);
	}

	console.log("------------------------------------------------------------------------");
	console.log("  TIER COVERAGE SUMMARY");
	console.log("------------------------------------------------------------------------");
	for (const s of tierSummaries) {
		const pct = s.total > 0 ? ((s.passed / s.total) * 100).toFixed(0) : "0";
		console.log(`  Tier ${s.results[0]?.tier ?? "?"}: ${s.name.padEnd(40)} ${s.passed}/${s.total} (${pct}%)`);
	}

	console.log("========================================================================");
	console.log(`  TOTAL: ${passedTests}/${totalTests} Passed | ${failedTests} Failed | Duration: ${totalDuration}ms`);
	console.log(`  STATUS: ${allPassed ? "ALL TESTS PASSED (EXIT 0)" : "FAILURES DETECTED (EXIT 1)"}`);
	console.log("========================================================================\n");

	if (!allPassed) {
		console.log("FAILURE DETAILS:");
		for (const r of allResults.filter((res) => !res.passed)) {
			console.log(`\n✖ [${r.id}] [Tier ${r.tier}] [${r.feature}] ${r.title}`);
			console.log(`  Error: ${r.error}`);
			if (r.stack) {
				console.log(`  ${r.stack.split("\n").slice(1, 4).join("\n  ")}`);
			}
		}
		console.log();
	}
}

process.exit(allPassed ? 0 : 1);
