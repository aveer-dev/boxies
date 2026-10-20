#!/usr/bin/env node
// Regenerates every Inboxies logo asset from the master geometry below.
//
//   pnpm install && node scripts/generate-logo-assets.mjs
//
// The mark is a stroked line drawing, not a traced bitmap, so it stays crisp at any size:
//   - MASTER  (512 grid, 10-unit strokes): anything drawn larger than 32 px.
//   - SMALL   (32 grid, 2-unit strokes): 32 px and below. Drops the inner folds that
//     turn to mush at favicon sizes and keeps the silhouette, keel and shadow.
//   - PRIVATE (32 grid): the small plane plus a half-filled shield badge, bottom right.
// Vertices sit on whole units of their grid. Backgrounds are 22% rounded tiles, except
// the iOS app icon and apple-touch-icon, which stay full-bleed because the OS masks them.
//
// SwiftUI (`SplashScreenView.swift`), Compose (`PrivateEmailLogoView.kt`), the web
// `PrivateEmailLogo.tsx`, `site/src/components/PlaneGlyph.astro` and the extension side
// panel embed the same path strings; keep them in sync when this geometry changes.
// Uses `sharp` from the site workspace (already a dependency), no extra packages.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
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

export const MASTER = {
	grid: 512,
	stroke: 10,
	outline: "M406 114 L106 224 L158 284 L182 396 L232 354 L294 398 Z",
	folds: "M106 224 L248 228 L406 114 M406 114 L206 316 L182 396 M406 114 L274 254 L294 398",
	shadow: "M206 316 L270 364 L266 377 L232 354 L182 396 Z",
};

export const SMALL = {
	grid: 32,
	stroke: 2,
	outline: "M26 6 L5 14 L9 18 L11 26 L15 23 L19 26 Z",
	folds: "M26 6 L13 20 L11 26",
	shadow: "M13 20 L17 24 L15 23 L11 26 Z",
};

// Absolute M/L/H/V/C/Z only: scale then translate every coordinate.
function transformPath(d, s, dx, dy) {
	const r = (n) => +n.toFixed(2);
	const tokens = d.match(/[MLHVCZ]|-?\d*\.?\d+/g);
	let out = [];
	let cmd = "";
	let xy = 0;
	for (const t of tokens) {
		if (/[MLHVCZ]/.test(t)) {
			cmd = t;
			xy = 0;
			out.push(t);
			continue;
		}
		const n = Number(t);
		if (cmd === "H") out.push(r(n * s + dx));
		else if (cmd === "V") out.push(r(n * s + dy));
		else {
			out.push(r(xy % 2 === 0 ? n * s + dx : n * s + dy));
			xy++;
		}
	}
	return out.join(" ").replace(/ ([MLHVCZ])/g, " $1");
}

// Private-email mark: small plane at 85% tucked top-left, shield bottom right, centred.
const PS = 0.85;
const PDX = -0.9;
const PDY = -1.4;
export const PRIVATE = {
	grid: 32,
	stroke: 2,
	shieldStroke: 1.5,
	outline: transformPath(SMALL.outline, PS, PDX, PDY),
	folds: transformPath(SMALL.folds, PS, PDX, PDY),
	shadow: transformPath(SMALL.shadow, PS, PDX, PDY),
	shield: transformPath(
		"M25 17.5 L29.5 19.25 V23.5 C29.5 26.5 27.5 28.6 25 29.75 C22.5 28.6 20.5 26.5 20.5 23.5 V19.25 Z",
		1,
		PDX,
		PDY,
	),
	shieldHalf: transformPath("M25 17.5 L29.5 19.25 V23.5 C29.5 26.5 27.5 28.6 25 29.75 Z", 1, PDX, PDY),
};

// ---------- SVG builders ----------

function markGroup(m, color, { scale = 1, dx = 0, dy = 0 } = {}) {
	const t = scale === 1 && !dx && !dy ? "" : ` transform="translate(${dx} ${dy}) scale(${scale})"`;
	const common = `fill="none" stroke="${color}" stroke-width="${m.stroke}" stroke-linejoin="round" stroke-linecap="round"`;
	let g = `<g${t} ${common}><path d="${m.outline}"/><path d="${m.folds}"/><path d="${m.shadow}" fill="${color}"/>`;
	if (m.shield) {
		g += `<path d="${m.shield}" stroke-width="${m.shieldStroke}"/><path d="${m.shieldHalf}" fill="${color}" stroke-width="${m.shieldStroke}"/>`;
	}
	return g + "</g>";
}

function svgDoc(size, body) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

/** A mark (512 or 32 grid) placed in a `size` box, optional tile background. */
function iconSvg(size, m, { bg = null, radius = 0.22, border = null, color = INK, fill = 1 } = {}) {
	let body = "";
	if (bg) {
		const rx = +(size * radius).toFixed(2);
		body += border
			? `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${rx}" fill="${bg}" stroke="${border}"/>`
			: `<rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>`;
	}
	const scale = (size / m.grid) * fill;
	const off = (size - m.grid * scale) / 2;
	body += markGroup(m, color, { scale, dx: off, dy: off });
	return svgDoc(size, body);
}

/** Theme-aware SVG (prefers-color-scheme) for favicons and <img> logos. */
function adaptiveSvg(m) {
	const css = `<style>.i{stroke:${INK}}.f{fill:${INK}}@media (prefers-color-scheme:dark){.i{stroke:${INK_DARK}}.f{fill:${INK_DARK}}}</style>`;
	const common = `fill="none" stroke-width="${m.stroke}" stroke-linejoin="round" stroke-linecap="round"`;
	let body = `<g class="i" ${common}><path d="${m.outline}"/><path d="${m.folds}"/><path class="f" d="${m.shadow}"/>`;
	if (m.shield) body += `<path d="${m.shield}" stroke-width="${m.shieldStroke}"/><path class="f" d="${m.shieldHalf}" stroke-width="${m.shieldStroke}"/>`;
	body += "</g>";
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.grid} ${m.grid}">${css}${body}</svg>\n`;
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

// ---------- Android vector drawables ----------

function androidVector({ dp, m, color, scale = 1, dx = 0, dy = 0, viewport = m.grid, bg = null }) {
	const sw = +(m.stroke * scale).toFixed(3);
	const p = (d) => transformPath(d, scale, dx, dy);
	const attrs = (fill) =>
		`${fill ? `android:fillColor="${color}"\n        ` : ""}android:strokeColor="${color}"\n        android:strokeWidth="${sw}"\n        android:strokeLineJoin="round"\n        android:strokeLineCap="round"`;
	let paths = "";
	if (bg) paths += `    <path\n        android:fillColor="${bg.color}"\n        android:pathData="${bg.path}" />\n`;
	paths += `    <path\n        ${attrs(false)}\n        android:pathData="${p(m.outline)}" />\n`;
	paths += `    <path\n        ${attrs(false)}\n        android:pathData="${p(m.folds)}" />\n`;
	paths += `    <path\n        ${attrs(true)}\n        android:pathData="${p(m.shadow)}" />\n`;
	if (m.shield) {
		const ss = +(m.shieldStroke * scale).toFixed(3);
		const s = (fill) => attrs(fill).replace(`android:strokeWidth="${sw}"`, `android:strokeWidth="${ss}"`);
		paths += `    <path\n        ${s(false)}\n        android:pathData="${p(m.shield)}" />\n`;
		paths += `    <path\n        ${s(true)}\n        android:pathData="${p(m.shieldHalf)}" />\n`;
	}
	return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by scripts/generate-logo-assets.mjs; do not edit by hand. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${dp}dp"
    android:height="${dp}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
${paths}</vector>
`;
}

// Master placed in a 108 viewport at the same 59% optical size as iOS (in-app use).
const IN_APP = { scale: 108 / 512, dx: 0, dy: 0 };
// Launcher / splash: fit the round 2/3 safe zone (radius 36 of 108). The tip is the
// farthest point, so nudge the mark 8 units down-left before scaling to balance it.
const SAFE_SCALE = 0.172;
const SAFE = { scale: SAFE_SCALE, dx: 54 - (256 + 8) * SAFE_SCALE, dy: 54 - (256 - 8) * SAFE_SCALE };

// ---------- main ----------

async function main() {
	// Canonical artwork
	write("design/logo/inboxies-mark.svg", iconSvg(512, MASTER) + "\n");
	write("design/logo/inboxies-mark-small.svg", iconSvg(32, SMALL) + "\n");
	write("design/logo/private-email-mark.svg", iconSvg(32, PRIVATE) + "\n");
	write("design/logo/app-icon-light.svg", iconSvg(512, MASTER, { bg: PAPER, radius: 0 }) + "\n");
	write("design/logo/app-icon-dark.svg", iconSvg(512, MASTER, { bg: PAPER_DARK, radius: 0, color: INK_DARK }) + "\n");

	// Web app + marketing site
	for (const dir of ["public", "site/public"]) {
		write(`${dir}/favicon.svg`, adaptiveSvg(SMALL));
		write(`${dir}/logo.svg`, adaptiveSvg(MASTER));
		const icoEntries = [];
		for (const s of [16, 32, 48]) {
			const m = s <= 32 ? SMALL : MASTER;
			icoEntries.push({ size: s, data: await pngBuffer(iconSvg(s, m, { bg: PAPER, fill: m === SMALL ? 1 : 1.25 }), s) });
		}
		write(`${dir}/favicon.ico`, ico(icoEntries));
		// apple-touch-icon: full bleed, iOS applies its own mask.
		await png(iconSvg(180, MASTER, { bg: PAPER, radius: 0 }), 180, join(root, `${dir}/apple-touch-icon.png`));
	}

	// Chrome extension (Private Email): tile + private mark, 1x and 2x.
	for (const s of [16, 32, 48, 128]) {
		await png(
			iconSvg(s, PRIVATE, { bg: PAPER, border: s >= 48 ? LINE : null, fill: s <= 32 ? 1 : 0.9 }),
			s,
			join(root, `extension/icons/icon-${s}.png`),
		);
	}

	// iOS
	const xc = "ios/AgenticInbox/Inboxies/Assets.xcassets";
	await png(iconSvg(1024, MASTER, { bg: PAPER, radius: 0 }), 1024, join(root, `${xc}/AppIcon.appiconset/AppIcon-Light.png`));
	await png(
		iconSvg(1024, MASTER, { bg: PAPER_DARK, radius: 0, color: INK_DARK }),
		1024,
		join(root, `${xc}/AppIcon.appiconset/AppIcon-Dark.png`),
	);
	// Launch-screen logo: vector, 72 pt to match SplashScreenView so the hand-off is seamless.
	const logoSet = `${xc}/AppLogo.imageset`;
	for (const f of ["AppLogo-Light.png", "AppLogo-Dark.png"]) {
		if (existsSync(join(root, logoSet, f))) rmSync(join(root, logoSet, f));
	}
	write(`${logoSet}/AppLogo-Light.svg`, iconSvg(72, MASTER) + "\n");
	write(`${logoSet}/AppLogo-Dark.svg`, iconSvg(72, MASTER, { color: INK_DARK }) + "\n");
	write(
		`${logoSet}/Contents.json`,
		JSON.stringify(
			{
				images: [
					{ filename: "AppLogo-Light.svg", idiom: "universal" },
					{
						appearances: [{ appearance: "luminosity", value: "dark" }],
						filename: "AppLogo-Dark.svg",
						idiom: "universal",
					},
				],
				info: { author: "xcode", version: 1 },
				properties: { "preserves-vector-representation": true },
			},
			null,
			2,
		) + "\n",
	);

	// Android
	const res = "android/app/src/main/res";
	write(`${res}/drawable/ic_inboxies_logo.xml`, androidVector({ dp: 72, m: MASTER, color: "@color/splash_icon_color", viewport: 108, ...IN_APP }));
	write(`${res}/drawable/ic_inboxies_logo_small.xml`, androidVector({ dp: 24, m: SMALL, color: "@color/splash_icon_color" }));
	write(`${res}/drawable/ic_private_email_logo.xml`, androidVector({ dp: 24, m: PRIVATE, color: "@color/splash_icon_color" }));
	write(`${res}/drawable/ic_splash_logo.xml`, androidVector({ dp: 108, m: MASTER, color: "@color/splash_icon_color", viewport: 108, ...SAFE }));
	write(`${res}/drawable/ic_launcher_foreground.xml`, androidVector({ dp: 108, m: MASTER, color: INK, viewport: 108, ...SAFE }));
	write(`${res}/drawable-night/ic_launcher_foreground.xml`, androidVector({ dp: 108, m: MASTER, color: INK_DARK, viewport: 108, ...SAFE }));
	write(`${res}/drawable/ic_launcher_monochrome.xml`, androidVector({ dp: 108, m: MASTER, color: "#000000", viewport: 108, ...SAFE }));
	const square = { color: PAPER, path: "M0,0h108v108h-108z" };
	const circle = {
		color: PAPER,
		path: "M54,0 C83.82,0 108,24.18 108,54 C108,83.82 83.82,108 54,108 C24.18,108 0,83.82 0,54 C0,24.18 24.18,0 54,0 Z",
	};
	write(`${res}/mipmap-hdpi/ic_launcher.xml`, androidVector({ dp: 108, m: MASTER, color: INK, viewport: 108, bg: square, ...SAFE }));
	write(`${res}/mipmap-hdpi/ic_launcher_round.xml`, androidVector({ dp: 108, m: MASTER, color: INK, viewport: 108, bg: circle, ...SAFE }));

	console.log("PRIVATE geometry (embed in native/web code):");
	console.log(JSON.stringify(PRIVATE, null, 2));
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
