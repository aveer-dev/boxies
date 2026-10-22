// Builds public/og.png (1200×630): the plane, the headline, the domain and a
// light Inbox screenshot. Run once with `pnpm og`; the output is committed.
//
// librsvg finds fonts through fontconfig, and Inter isn't a system font. So
// the Inter 500/400 WOFF files from @fontsource are unpacked to plain TTFs in
// a temp folder and fontconfig is pointed there before sharp loads.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");
const FONTS = join(SITE, "node_modules/@fontsource/inter/files");
const OUT = join(SITE, "public/og.png");

const W = 1200;
const H = 630;
const INK = "#171717";
const MUTED = "#73736f";
const RING = "#e4e4df";

// WOFF 1.0 → TTF: copy each table out (inflating the compressed ones) behind
// a fresh sfnt header. Checksums carry over from the WOFF directory.
function woffToTtf(woff) {
	if (woff.toString("ascii", 0, 4) !== "wOFF") throw new Error("not a WOFF 1.0 file");
	const flavor = woff.readUInt32BE(4);
	const numTables = woff.readUInt16BE(12);
	const tables = [];
	for (let i = 0; i < numTables; i++) {
		const at = 44 + i * 20;
		const offset = woff.readUInt32BE(at + 4);
		const compLength = woff.readUInt32BE(at + 8);
		const origLength = woff.readUInt32BE(at + 12);
		const raw = woff.subarray(offset, offset + compLength);
		tables.push({
			tag: woff.subarray(at, at + 4),
			checksum: woff.readUInt32BE(at + 16),
			data: compLength < origLength ? inflateSync(raw) : raw,
		});
	}
	const pow = 2 ** Math.floor(Math.log2(numTables));
	const head = Buffer.alloc(12 + numTables * 16);
	head.writeUInt32BE(flavor, 0);
	head.writeUInt16BE(numTables, 4);
	head.writeUInt16BE(pow * 16, 6);
	head.writeUInt16BE(Math.log2(pow), 8);
	head.writeUInt16BE(numTables * 16 - pow * 16, 10);
	const chunks = [head];
	let offset = head.length;
	tables.forEach((t, i) => {
		const at = 12 + i * 16;
		t.tag.copy(head, at);
		head.writeUInt32BE(t.checksum, at + 4);
		head.writeUInt32BE(offset, at + 8);
		head.writeUInt32BE(t.data.length, at + 12);
		const padded = Buffer.alloc(Math.ceil(t.data.length / 4) * 4);
		t.data.copy(padded);
		chunks.push(padded);
		offset += padded.length;
	});
	return Buffer.concat(chunks);
}

const tmp = mkdtempSync(join(tmpdir(), "inboxies-og-"));
for (const weight of [400, 500]) {
	const woff = readFileSync(join(FONTS, `inter-latin-${weight}-normal.woff`));
	writeFileSync(join(tmp, `inter-${weight}.ttf`), woffToTtf(woff));
}
writeFileSync(
	join(tmp, "fonts.conf"),
	`<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig><dir>${tmp}</dir><cachedir>${join(tmp, "cache")}</cachedir></fontconfig>
`,
);
process.env.FONTCONFIG_FILE = join(tmp, "fonts.conf");
const { default: sharp } = await import("sharp");

// The plane, derived from the master mark (scripts/generate-logo-assets.mjs), in ink.
const markSvg = readFileSync(join(REPO, "design/logo/inboxies-mark-medium.svg"), "utf8");
const plane = markSvg
	.replace(/^[\s\S]*?<svg[^>]*>/, "")
	.replace(/<\/svg>\s*$/, "")
	.replace(/#1F1F24/g, INK);

// The headline's top sits at 260px; line boxes are 1.15 × 52px.
const FONT = 'font-family="Inter, Helvetica, Arial, sans-serif"';
const base = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<rect width="${W}" height="${H}" fill="#fcfcfc"/>
	<svg x="96" y="120" width="72" height="72" viewBox="0 0 512 512">${plane}</svg>
	<text ${FONT} font-size="52" font-weight="500" letter-spacing="-1.3" fill="${INK}">
		<tspan x="96" y="307">Email that waits</tspan>
		<tspan x="96" y="367">for your yes.</tspan>
	</text>
	<text ${FONT} font-size="24" font-weight="400" fill="${MUTED}" x="96" y="${H - 96}">inboxies.co</text>
</svg>`;

// The screenshot: 260px wide, 36px corners, a 1px ring. It starts level with
// the headline block's margin and runs off the bottom edge.
const SHOT_W = 260;
const RADIUS = 36;
const shotSrc = sharp(join(SITE, "src/assets/screens/inbox-light.png")).resize({ width: SHOT_W });
const { data: shotPx, info } = await shotSrc.png().toBuffer({ resolveWithObject: true });
const SHOT_H = info.height;
const mask = Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${SHOT_W}" height="${SHOT_H}"><rect width="${SHOT_W}" height="${SHOT_H}" rx="${RADIUS}" fill="#fff"/></svg>`,
);
const rounded = await sharp(shotPx).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
const ring = Buffer.from(
	`<svg xmlns="http://www.w3.org/2000/svg" width="${SHOT_W}" height="${SHOT_H}"><rect x="0.5" y="0.5" width="${SHOT_W - 1}" height="${SHOT_H - 1}" rx="${RADIUS - 0.5}" fill="none" stroke="${RING}" stroke-width="1"/></svg>`,
);
const framed = await sharp(rounded).composite([{ input: ring }]).png().toBuffer();

const left = W - 120 - SHOT_W;
const top = 96;
const visible = Math.min(SHOT_H, H - top);
const cropped = await sharp(framed).extract({ left: 0, top: 0, width: SHOT_W, height: visible }).png().toBuffer();

await sharp(Buffer.from(base))
	.composite([{ input: cropped, left, top }])
	.png({ compressionLevel: 9, palette: false })
	.toFile(OUT);

rmSync(tmp, { recursive: true, force: true });
console.log(`og: wrote ${OUT} (${W}×${H})`);
