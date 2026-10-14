// After the build: weighs what each page makes the browser download and run,
// gzipped, and fails if a page goes over budget (§7.2).
//   JS:  inline <script>s + every /_astro/*.js the page loads, and their
//        static imports, followed recursively and counted once.  ≤ 20KB
//   CSS: inline <style>s + every stylesheet the page links.        ≤ 30KB
// It also fails if a page, stylesheet or script points at an /_astro/*.png:
// public/.assetsignore keeps those out of the deploy (they're unused originals).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { parse } from "node-html-parser";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(SITE, "dist/client");
const KB = 1024;
const BUDGET = { js: 20 * KB, css: 30 * KB };

// Script types the browser executes. JSON and speculation rules are data.
const JS_TYPES = new Set(["", "module", "text/javascript", "application/javascript"]);

const gz = (s) => gzipSync(Buffer.from(s)).length;
const fmt = (n) => `${(n / KB).toFixed(1)}KB`;

// Static imports and re-exports, minified or not. import("…") is dynamic and
// only loads on demand, so it isn't counted.
const IMPORT = /\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']([^"']+)["']|\bexport\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;

function readAsset(urlPath) {
	const file = join(DIST, urlPath);
	if (!existsSync(file)) throw new Error(`check-budget: ${urlPath} is referenced but missing from dist/client`);
	return readFileSync(file, "utf8");
}

// Walk a module and everything it statically imports; each file counts once.
function addModule(urlPath, seen) {
	if (seen.has(urlPath)) return 0;
	seen.add(urlPath);
	const code = readAsset(urlPath);
	let total = gz(code);
	for (const m of code.matchAll(IMPORT)) total += addImport(m[1] ?? m[2], urlPath, seen);
	return total;
}

function addImport(spec, fromPath, seen) {
	// Only local files; bare specifiers can't appear in built output.
	if (!spec.startsWith("/") && !spec.startsWith(".")) return 0;
	const resolved = spec.startsWith("/") ? spec : posix.join(posix.dirname(fromPath), spec);
	return addModule(resolved.split(/[?#]/)[0], seen);
}

function localPath(href, pagePath) {
	if (!href || /^(https?:)?\/\//.test(href) || href.startsWith("data:")) return null;
	const path = href.startsWith("/") ? href : posix.join(posix.dirname(pagePath), href);
	return path.split(/[?#]/)[0];
}

function weigh(file) {
	const root = parse(readFileSync(file, "utf8"), { comment: false });
	const pagePath = `/${relative(DIST, file).split("\\").join("/")}`;
	const seenJs = new Set();
	const seenCss = new Set();
	let js = 0;
	let css = 0;

	for (const el of root.querySelectorAll("script")) {
		const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
		if (!JS_TYPES.has(type)) continue;
		const src = localPath(el.getAttribute("src"), pagePath);
		if (src) {
			js += addModule(src, seenJs);
		} else if (!el.hasAttribute("src")) {
			const code = el.rawText;
			js += gz(code);
			for (const m of code.matchAll(IMPORT)) js += addImport(m[1] ?? m[2], pagePath, seenJs);
		}
	}
	// Preloaded modules are downloaded and parsed whether or not a script imports them.
	for (const el of root.querySelectorAll('link[rel="modulepreload"]')) {
		const href = localPath(el.getAttribute("href"), pagePath);
		if (href) js += addModule(href, seenJs);
	}

	for (const el of root.querySelectorAll("style")) css += gz(el.rawText);
	for (const el of root.querySelectorAll('link[rel="stylesheet"]')) {
		const href = localPath(el.getAttribute("href"), pagePath);
		if (href && !seenCss.has(href)) {
			seenCss.add(href);
			css += gz(readAsset(href));
		}
	}
	return { page: pagePath, js, css };
}

if (!existsSync(DIST)) {
	console.error(`check-budget: ${relative(SITE, DIST)} doesn't exist. Run astro build first.`);
	process.exit(1);
}

const files = readdirSync(DIST, { recursive: true })
	.filter((f) => f.endsWith(".html"))
	.map((f) => join(DIST, f))
	.sort();

const results = files.map(weigh);
const width = Math.max(...results.map((r) => r.page.length));
let failed = false;

for (const r of results) {
	const over = [];
	if (r.js > BUDGET.js) over.push(`JS over ${fmt(BUDGET.js)}`);
	if (r.css > BUDGET.css) over.push(`CSS over ${fmt(BUDGET.css)}`);
	if (over.length) failed = true;
	console.log(`  ${r.page.padEnd(width)}  js ${fmt(r.js).padStart(7)}  css ${fmt(r.css).padStart(7)}${over.length ? `  ✗ ${over.join(", ")}` : ""}`);
}

if (failed) {
	console.error("check-budget: over budget (gzip). See §7.2.");
	process.exit(1);
}

// Anything under /_astro that ends in .png is never uploaded, so nothing may reference it.
const shipped = readdirSync(DIST, { recursive: true }).filter((f) => /\.(html|css|js|mjs)$/.test(f));
const pngRefs = shipped.flatMap((f) =>
	[...readFileSync(join(DIST, f), "utf8").matchAll(/\/_astro\/[^"'()\s]+?\.png\b/g)].map((m) => `${f}: ${m[0]}`),
);
if (pngRefs.length) {
	console.error(`check-budget: these point at /_astro/*.png, which public/.assetsignore keeps out of the deploy:\n  ${pngRefs.join("\n  ")}`);
	process.exit(1);
}
console.log(`check-budget: ${results.length} page${results.length === 1 ? "" : "s"} within budget (JS ≤ ${fmt(BUDGET.js)}, CSS ≤ ${fmt(BUDGET.css)} gzip)`);
