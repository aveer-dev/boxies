// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();

function tryExtensions(filePath) {
	const exts = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
	for (const ext of exts) {
		const target = filePath + ext;
		if (existsSync(target)) {
			return pathToFileURL(target).href;
		}
	}
	return null;
}

export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith("shared/")) {
		const subpath = specifier.slice("shared/".length);
		const target = pathResolve(rootDir, "shared", subpath);
		const resolved = tryExtensions(target);
		if (resolved) {
			return { url: resolved, shortCircuit: true };
		}
	}

	if (specifier.startsWith("~/")) {
		const subpath = specifier.slice(2);
		const target = pathResolve(rootDir, "app", subpath);
		const resolved = tryExtensions(target);
		if (resolved) {
			return { url: resolved, shortCircuit: true };
		}
	}

	if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
		if (context.parentURL) {
			const parentPath = new URL(context.parentURL).pathname;
			const target = pathResolve(parentPath, "..", specifier);
			const resolved = tryExtensions(target);
			if (resolved) {
				return { url: resolved, shortCircuit: true };
			}
		}
	}

	return nextResolve(specifier, context);
}
