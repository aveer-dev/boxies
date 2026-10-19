#!/usr/bin/env node
// Runs every *.test.mjs under workers/test, android/test and extension/test,
// one node process per file, stopping at the first failure. Tests are discovered
// rather than listed in package.json so PRs that add tests don't conflict.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const suites = [
	{
		dir: "workers/test",
		args: ["--experimental-strip-types", "--import", "./workers/test/register-ts-ext.mjs"],
	},
	{ dir: "android/test", args: [] },
	{ dir: "extension/test", args: [] },
];

const only = process.argv.slice(2);
let ran = 0;

for (const { dir, args } of suites) {
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".test.mjs"))
		.sort();
	for (const name of files) {
		const file = join(dir, name);
		if (only.length && !only.some((pattern) => file.includes(pattern))) continue;
		console.log(`\n▶ ${file}`);
		const result = spawnSync(process.execPath, [...args, file], { stdio: "inherit" });
		if (result.status !== 0) {
			console.error(`\n✖ ${file} failed (exit ${result.status ?? result.signal})`);
			process.exit(result.status || 1);
		}
		ran++;
	}
}

console.log(`\n✔ ${ran} test files passed`);
