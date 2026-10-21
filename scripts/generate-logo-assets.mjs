#!/usr/bin/env node
// Regenerates every Inboxies logo asset from ONE master drawing:
//
//   design/logo/inboxies-mark.svg   (512 grid; the only place the plane is drawn)
//
//   pnpm install && node scripts/generate-logo-assets.mjs
//
// Everything below is derived from the master's paths: scaled, padded, tiled, given
// rounded corners, recoloured, or given a heavier stroke. No asset draws its own plane.
//
// Stroke weights (master units, 512 grid). The geometry never changes between sizes;
// only the line weight does, so lines land at roughly 1.2-2 device px wherever the mark
// is shown. Tier by the rendered size of the cropped mark (GLYPH box):
//   master  2.5 / 2    the master as drawn (large previews, print)
//   large   5   / 4    ~100-250 px: app icons, apple-touch, in-app logos, splash, launcher
//   medium  9   / 7.5  ~33-100 px: web logo.svg, site footer tile, favicon.ico 48
//   small   18  / 15   32 px and below: favicon, header glyph, notification, Private
//                      Email. Drops the `fine` and `details` layers, which would close
//                      up into blobs at that size.
// Backgrounds are tiles with 22% rounded corners (iOS in-app tiles use the continuous
// squircle). The iOS app icon and apple-touch-icon stay full-bleed: the OS masks them.
// The Android launcher foreground fits the mark inside the round-mask safe zone.
//
// Code that embeds the mark inline (web PrivateEmailLogo.tsx, site PlaneGlyph.astro,
// extension side panel) is rewritten between `logo:generated` markers. Uses `sharp`
// from the site workspace (already a dependency).

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [join(root, "site"), root] }));

const INK = "#1F1F24";
const INK_DARK = "#EDEDF2";
const PAPER = "#FFFFFF";
const PAPER_DARK = "#141416";
const LINE = "#E5E5EA";
const TILE_RADIUS = 0.22;

// ---------- master ----------

const MASTER_PATH = "design/logo/inboxies-mark.svg";

function readMaster() {
	const svg = readFileSync(join(root, MASTER_PATH), "utf8");
	const layer = (id) => {
		const tag = svg.match(new RegExp(`<path[^>]*\\bid="${id}"[^>]*>`));
		if (!tag) throw new Error(`${MASTER_PATH}: missing <path id="${id}">`);
		const attr = (name) => tag[0].match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
		return { d: attr("d"), width: Number(attr("stroke-width") ?? 0) };
	};
	return {
		outline: layer("outline"),
		folds: layer("folds"),
		fine: layer("fine"),
		details: layer("details"),
		shadow: layer("shadow"),
	};
}

const M = readMaster();

/** Stroke weights per tier, in master units. `master` is the file as drawn. */
const TIERS = {
	master: { outline: M.outline.width, inner: M.folds.width, layers: ["folds", "fine", "details"] },
	large: { outline: 5, inner: 4, layers: ["folds", "fine", "details"] },
	medium: { outline: 9, inner: 7.5, layers: ["folds", "fine", "details"] },
	small: { outline: 18, inner: 15, layers: ["folds"] },
};

// Boxes (x, y, size) in master units. ARTBOARD keeps the master's padding (app icons,
// in-app logos); GLYPH crops to the mark so it fills small boxes (favicon, header).
const ARTBOARD = { x: 0, y: 0, size: 512 };
const GLYPH = { x: 88, y: 88, size: 336 };

// ---------- path math (absolute M/L/H/V/A/C/Z only) ----------

function transformPath(d, s, dx, dy) {
	const r = (n) => +n.toFixed(2);
	const tokens = d.match(/[MLHVACZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
	const out = [];
	let cmd = "";
	let i = 0;
	for (const t of tokens) {
		if (/^[a-z]$/i.test(t)) {
			if (t !== t.toUpperCase()) throw new Error(`relative path command ${t} unsupported`);
			cmd = t;
			i = 0;
			out.push(t);
			continue;
		}
		const n = Number(t);
		if (cmd === "H") out.push(r(n * s + dx));
		else if (cmd === "V") out.push(r(n * s + dy));
		else if (cmd === "A") {
			// rx ry rotation large-arc sweep x y
			const k = i % 7;
			out.push(k < 2 ? r(n * s) : k < 5 ? n : k === 5 ? r(n * s + dx) : r(n * s + dy));
		} else out.push(r(i % 2 === 0 ? n * s + dx : n * s + dy));
		i++;
	}
	return out.join(" ");
}

/** Map master units into a box of `size` px starting at (ox, oy), via `box` (master units). */
function placer(box, size, ox = 0, oy = 0) {
	const s = size / box.size;
	return { s, dx: ox - box.x * s, dy: oy - box.y * s };
}

/**
 * The mark as a list of drawable parts in output space:
 *   { d, stroke?: width, fill?: true }
 * `color` is applied by each writer, so one part list serves SVG, Android and code.
 */
function markParts(tier, place) {
	const t = TIERS[tier];
	const { s, dx, dy } = place;
	const parts = [{ d: transformPath(M.outline.d, s, dx, dy), stroke: +(t.outline * s).toFixed(3) }];
	for (const id of t.layers) parts.push({ d: transformPath(M[id].d, s, dx, dy), stroke: +(t.inner * s).toFixed(3) });
	parts.push({ d: transformPath(M.shadow.d, s, dx, dy), fill: true });
	return parts;
}

// Private Email mark: the small-tier master plane, scaled down into the top-left of the
// GLYPH box, plus a shield whose right half is filled, bottom right. Same stroke weight
// for both, so it reads as one icon. Shield drawn in GLYPH-box fractions.
const PRIVATE = { planeScale: 0.8, planeShift: [0, 0], shieldStroke: 0.85 };
const SHIELD = (u, ox, oy) => {
	const X = (f) => +(ox + f * u).toFixed(2);
	const Y = (f) => +(oy + f * u).toFixed(2);
	// top centre, right shoulder, right side, bottom point (and mirror)
	const outline = `M ${X(0.775)} ${Y(0.54)} L ${X(0.93)} ${Y(0.6)} V ${Y(0.735)} C ${X(0.93)} ${Y(0.835)} ${X(0.865)} ${Y(0.905)} ${X(0.775)} ${Y(0.945)} C ${X(0.685)} ${Y(0.905)} ${X(0.62)} ${Y(0.835)} ${X(0.62)} ${Y(0.735)} V ${Y(0.6)} Z`;
	const half = `M ${X(0.775)} ${Y(0.54)} L ${X(0.93)} ${Y(0.6)} V ${Y(0.735)} C ${X(0.93)} ${Y(0.835)} ${X(0.865)} ${Y(0.905)} ${X(0.775)} ${Y(0.945)} Z`;
	return { outline, half };
};

function privateParts(size, ox = 0, oy = 0, tier = "small") {
	const p = placer(GLYPH, size * PRIVATE.planeScale, ox + size * PRIVATE.planeShift[0], oy + size * PRIVATE.planeShift[1]);
	const plane = markParts(tier, p);
	const w = +(TIERS[tier].outline * p.s * PRIVATE.shieldStroke).toFixed(3);
	const sh = SHIELD(size, ox, oy);
	return [...plane, { d: sh.outline, stroke: w }, { d: sh.half, stroke: w, fill: true }];
}

// ---------- writers ----------

function svgParts(parts, color) {
	return parts
		.map((p) => {
			const fill = p.fill ? color : "none";
			const stroke = p.stroke ? ` stroke="${color}" stroke-width="${p.stroke}"` : "";
			return `<path d="${p.d}" fill="${fill}"${stroke}/>`;
		})
		.join("");
}

const JOIN = `stroke-linecap="round" stroke-linejoin="round"`;

function svgDoc(size, body, { width = size, height = size } = {}) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

function tileRect(size, bg, border) {
	const rx = +(size * TILE_RADIUS).toFixed(2);
	return border
		? `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${rx}" fill="${bg}" stroke="${border}"/>`
		: `<rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>`;
}

/**
 * A mark in a `size` box. `box` picks ARTBOARD (padded) or GLYPH (cropped); `inset`
 * shrinks the mark inside a tile. `bg` adds a rounded tile (radius 0 = full bleed).
 */
function iconSvg(size, { tier, box = ARTBOARD, color = INK, bg = null, radius = TILE_RADIUS, border = null, inset = 0, parts = null }) {
	let body = "";
	if (bg) body += radius ? tileRect(size, bg, border) : `<rect width="${size}" height="${size}" fill="${bg}"/>`;
	const inner = size * (1 - 2 * inset);
	const ps = parts ?? markParts(tier, placer(box, inner, size * inset, size * inset));
	body += `<g ${JOIN}>${svgParts(ps, color)}</g>`;
	return svgDoc(size, body);
}

/** Theme-aware SVG (prefers-color-scheme) for favicons and <img> logos. */
function adaptiveSvg(size, parts) {
	const css = `<style>.i{stroke:${INK}}.f{fill:${INK}}@media (prefers-color-scheme:dark){.i{stroke:${INK_DARK}}.f{fill:${INK_DARK}}}</style>`;
	const body = parts
		.map((p) => {
			const cls = [p.stroke && "i", p.fill && "f"].filter(Boolean).join(" ");
			return `<path class="${cls}" d="${p.d}"${p.fill ? "" : ` fill="none"`}${p.stroke ? ` stroke-width="${p.stroke}"` : ""}/>`;
		})
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${css}<g ${JOIN}>${body}</g></svg>\n`;
}

async function png(svg, size, out) {
	mkdirSync(dirname(out), { recursive: true });
	await sharp(Buffer.from(svg), { density: 72 }).resize(size, size).png({ compressionLevel: 9 }).toFile(out);
}

async function pngBuffer(svg, size) {
	return sharp(Buffer.from(svg), { density: 72 }).resize(size, size).png().toBuffer();
}

/** ICO container with PNG payloads (supported by every browser that still reads .ico). */
function ico(entries) {
	const header = Buffer.alloc(6 + 16 * entries.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(entries.length, 4);
	let offset = header.length;
	entries.forEach(({ size, data }, i) => {
		const o = 6 + i * 16;
		header.writeUInt8(size >= 256 ? 0 : size, o);
		header.writeUInt8(size >= 256 ? 0 : size, o + 1);
		header.writeUInt16LE(1, o + 4);
		header.writeUInt16LE(32, o + 6);
		header.writeUInt32LE(data.length, o + 8);
		header.writeUInt32LE(offset, o + 12);
		offset += data.length;
	});
	return Buffer.concat([header, ...entries.map((e) => e.data)]);
}

function write(rel, content) {
	const p = join(root, rel);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, content);
}

/** Replace the text between `logo:generated:<name>` start/end markers in a file. */
function inject(rel, name, content) {
	const p = join(root, rel);
	const src = readFileSync(p, "utf8");
	const re = new RegExp(`(logo:generated:${name}\\b[^\\n]*)([\\s\\S]*?)(\\n[^\\n]*/logo:generated:${name}\\b)`);
	if (!re.test(src)) throw new Error(`${rel}: missing logo:generated:${name} markers`);
	writeFileSync(p, src.replace(re, (_, a, _b, c) => `${a}\n${content}${c}`));
}

// ---------- Android vector drawables ----------

function androidVector({ dp, viewport, parts, color, bg = null }) {
	let xml = "";
	if (bg) xml += `    <path\n        android:fillColor="${bg.color}"\n        android:pathData="${bg.path}" />\n`;
	for (const p of parts) {
		const lines = [];
		if (p.fill) lines.push(`android:fillColor="${color}"`);
		if (p.stroke) {
			lines.push(`android:strokeColor="${color}"`, `android:strokeWidth="${p.stroke}"`);
			lines.push(`android:strokeLineJoin="round"`, `android:strokeLineCap="round"`);
		}
		lines.push(`android:pathData="${p.d}"`);
		xml += `    <path\n        ${lines.join("\n        ")} />\n`;
	}
	return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from ${MASTER_PATH} by scripts/generate-logo-assets.mjs; do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp"
    android:height="${dp}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
${xml}</vector>
`;
}

// Launcher / splash: fit the mark inside the adaptive-icon safe zone (a circle of radius
// 33 in the 108 viewport). The mark is a wedge, so its smallest enclosing circle is not
// centred on its bounding box: measure it from a render of the master and centre that.
const SAFE_RADIUS = 32;

/** Smallest circle (master units) enclosing the rendered mark at a given tier. */
async function enclosingCircle(tier) {
	const svg = iconSvg(512, { tier });
	const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	// Outermost ink pixel per row (left and right) is enough to bound the shape.
	const pts = [];
	for (let y = 0; y < info.height; y++) {
		let l = -1;
		let r = -1;
		for (let x = 0; x < info.width; x++) {
			if (data[(y * info.width + x) * 4 + 3] > 8) {
				if (l < 0) l = x;
				r = x;
			}
		}
		if (l >= 0) pts.push([l, y + 0.5], [r + 1, y + 0.5]);
	}
	// Welzl's algorithm (iterative, randomised order).
	const circle2 = (a, b) => {
		const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		return { c, r: Math.hypot(a[0] - c[0], a[1] - c[1]) };
	};
	const circle3 = (a, b, c) => {
		const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
		const sq = (p) => p[0] * p[0] + p[1] * p[1];
		const ux = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
		const uy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
		return { c: [ux, uy], r: Math.hypot(a[0] - ux, a[1] - uy) };
	};
	const inside = (C, p) => Math.hypot(p[0] - C.c[0], p[1] - C.c[1]) <= C.r + 1e-7;
	for (let i = pts.length - 1; i > 0; i--) {
		const j = (i * 7919) % (i + 1);
		[pts[i], pts[j]] = [pts[j], pts[i]];
	}
	let C = { c: pts[0], r: 0 };
	for (let i = 1; i < pts.length; i++) {
		if (inside(C, pts[i])) continue;
		C = { c: pts[i], r: 0 };
		for (let j = 0; j < i; j++) {
			if (inside(C, pts[j])) continue;
			C = circle2(pts[i], pts[j]);
			for (let k = 0; k < j; k++) if (!inside(C, pts[k])) C = circle3(pts[i], pts[j], pts[k]);
		}
	}
	return C;
}

async function safePlacer(tier) {
	const { c, r } = await enclosingCircle(tier);
	const s = SAFE_RADIUS / r;
	return { s, dx: 54 - c[0] * s, dy: 54 - c[1] * s };
}

// ---------- inline code snippets ----------

/** JSX/HTML <path> elements for a part list drawn in currentColor. */
function inlinePaths(parts, { jsx = false, indent = "" } = {}) {
	return parts
		.map((p) => {
			const sw = p.stroke ? (jsx ? ` strokeWidth={${p.stroke}}` : ` stroke-width="${p.stroke}"`) : "";
			const fill = p.fill ? ` fill="currentColor"` : "";
			return `${indent}<path d="${p.d}"${fill}${sw} />`;
		})
		.join("\n");
}

// ---------- main ----------

async function main() {
	const glyph = (tier, size) => markParts(tier, placer(GLYPH, size));

	// Canonical derived artwork (for design review / other tools).
	write("design/logo/inboxies-mark-large.svg", iconSvg(512, { tier: "large" }) + "\n");
	write("design/logo/inboxies-mark-medium.svg", iconSvg(512, { tier: "medium" }) + "\n");
	write("design/logo/inboxies-mark-small.svg", iconSvg(32, { tier: "small", box: GLYPH }) + "\n");
	write("design/logo/private-email-mark.svg", iconSvg(32, { parts: privateParts(32) }) + "\n");
	write("design/logo/app-icon-light.svg", iconSvg(1024, { tier: "large", bg: PAPER, radius: 0 }) + "\n");
	write("design/logo/app-icon-dark.svg", iconSvg(1024, { tier: "large", bg: PAPER_DARK, radius: 0, color: INK_DARK }) + "\n");

	// Web app + marketing site.
	for (const dir of ["public", "site/public"]) {
		write(`${dir}/favicon.svg`, adaptiveSvg(32, glyph("small", 32)));
		write(`${dir}/logo.svg`, adaptiveSvg(512, markParts("medium", placer(GLYPH, 512))));
		const icoEntries = [];
		for (const s of [16, 32, 48]) {
			const svg = iconSvg(s, { tier: s <= 32 ? "small" : "medium", box: GLYPH, bg: PAPER, inset: s <= 32 ? 0.06 : 0.12 });
			icoEntries.push({ size: s, data: await pngBuffer(svg, s) });
		}
		write(`${dir}/favicon.ico`, ico(icoEntries));
		// apple-touch-icon: full bleed, iOS applies its own mask.
		await png(iconSvg(180, { tier: "large", bg: PAPER, radius: 0 }), 180, join(root, `${dir}/apple-touch-icon.png`));
	}

	// Chrome extension (Private Email): rounded tile + Private Email mark.
	for (const s of [16, 32, 48, 128]) {
		const inset = s <= 32 ? 0.04 : 0.1;
		const inner = s * (1 - 2 * inset);
		await png(
			iconSvg(s, { bg: PAPER, border: s >= 48 ? LINE : null, parts: privateParts(inner, s * inset, s * inset, s >= 128 ? "medium" : "small") }),
			s,
			join(root, `extension/icons/icon-${s}.png`),
		);
	}

	// iOS: app icon (full bleed, OS squircle mask) + template vector images for in-app use.
	const xc = "ios/AgenticInbox/Inboxies/Assets.xcassets";
	await png(iconSvg(1024, { tier: "large", bg: PAPER, radius: 0 }), 1024, join(root, `${xc}/AppIcon.appiconset/AppIcon-Light.png`));
	await png(
		iconSvg(1024, { tier: "large", bg: PAPER_DARK, radius: 0, color: INK_DARK }),
		1024,
		join(root, `${xc}/AppIcon.appiconset/AppIcon-Dark.png`),
	);
	const imageset = (name, files, { template = false } = {}) => {
		const set = `${xc}/${name}.imageset`;
		for (const f of ["AppLogo-Light.png", "AppLogo-Dark.png"]) if (existsSync(join(root, set, f))) rmSync(join(root, set, f));
		const images = files.map(([filename, svg, dark]) => {
			write(`${set}/${filename}`, svg + "\n");
			return dark
				? { appearances: [{ appearance: "luminosity", value: "dark" }], filename, idiom: "universal" }
				: { filename, idiom: "universal" };
		});
		const properties = { "preserves-vector-representation": true };
		if (template) properties["template-rendering-intent"] = "template";
		write(`${set}/Contents.json`, JSON.stringify({ images, info: { author: "xcode", version: 1 }, properties }, null, 2) + "\n");
	};
	// Launch screen (UILaunchScreen.UIImageName): drawn at its natural 72 pt size.
	imageset("AppLogo", [
		["AppLogo-Light.svg", iconSvg(72, { tier: "large" })],
		["AppLogo-Dark.svg", iconSvg(72, { tier: "large", color: INK_DARK }), true],
	]);
	imageset("InboxiesMark", [["InboxiesMark.svg", iconSvg(512, { tier: "large" })]], { template: true });
	imageset("InboxiesMarkSmall", [["InboxiesMarkSmall.svg", iconSvg(32, { tier: "small" })]], { template: true });
	imageset("PrivateEmailMark", [["PrivateEmailMark.svg", iconSvg(32, { parts: privateParts(32) })]], { template: true });

	// Android.
	const res = "android/app/src/main/res";
	const tint = "@color/splash_icon_color";
	const in108 = (tier) => markParts(tier, placer(ARTBOARD, 108));
	write(`${res}/drawable/ic_inboxies_logo.xml`, androidVector({ dp: 72, viewport: 108, parts: in108("large"), color: tint }));
	// In-app at 32 dp and below: same padding as ic_inboxies_logo, heavier strokes.
	write(`${res}/drawable/ic_inboxies_logo_small.xml`, androidVector({ dp: 32, viewport: 108, parts: in108("small"), color: tint }));
	// Notification small icon / autofill row: cropped to the mark so it fills 24 dp.
	write(`${res}/drawable/ic_inboxies_glyph.xml`, androidVector({ dp: 24, viewport: 24, parts: glyph("small", 24), color: tint }));
	write(`${res}/drawable/ic_private_email_logo.xml`, androidVector({ dp: 24, viewport: 32, parts: privateParts(32), color: tint }));
	const safe = markParts("large", await safePlacer("large"));
	write(`${res}/drawable/ic_splash_logo.xml`, androidVector({ dp: 108, viewport: 108, parts: safe, color: tint }));
	write(`${res}/drawable/ic_launcher_foreground.xml`, androidVector({ dp: 108, viewport: 108, parts: safe, color: INK }));
	write(`${res}/drawable-night/ic_launcher_foreground.xml`, androidVector({ dp: 108, viewport: 108, parts: safe, color: INK_DARK }));
	write(`${res}/drawable/ic_launcher_monochrome.xml`, androidVector({ dp: 108, viewport: 108, parts: safe, color: "#000000" }));
	const square = { color: PAPER, path: "M0,0h108v108h-108z" };
	const circle = {
		color: PAPER,
		path: "M54,0 C83.82,0 108,24.18 108,54 C108,83.82 83.82,108 54,108 C24.18,108 0,83.82 0,54 C0,24.18 24.18,0 54,0 Z",
	};
	write(`${res}/mipmap-hdpi/ic_launcher.xml`, androidVector({ dp: 108, viewport: 108, parts: safe, color: INK, bg: square }));
	write(`${res}/mipmap-hdpi/ic_launcher_round.xml`, androidVector({ dp: 108, viewport: 108, parts: safe, color: INK, bg: circle }));

	// Inline code: web Private Email logo, site plane glyph, extension side panel.
	inject("app/components/PrivateEmailLogo.tsx", "private", inlinePaths(privateParts(32), { jsx: true, indent: "\t\t\t" }));
	const astroPaths = (parts) => "`" + inlinePaths(parts).replace(/\n/g, "") + "`";
	inject(
		"site/src/components/PlaneGlyph.astro",
		"paths",
		`const PATHS = {\n\tsmall: ${astroPaths(glyph("small", 32))},\n\tfull: ${astroPaths(glyph("medium", 32))},\n};`,
	);
	inject("extension/sidepanel.html", "private", inlinePaths(privateParts(32), { indent: "\t\t\t\t" }));

	console.log("logo assets regenerated from", MASTER_PATH);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
