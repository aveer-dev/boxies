// After the build: reads every page in dist/client and fails if a phrase we
// can't stand behind made it onto the site (§1.7). Copy that describes unbuilt
// work sits inside data-claim="roadmap"; candid "we don't do X" lines sit
// inside data-claim="negated"; developer copy (open source, MCP) sits inside
// data-claim="dev". Those wrappers are the only places some words may appear.
// It also checks where links into the web app go (D1). Exits 1 on any hit,
// printing file · phrase · context.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(SITE, "dist/client");

// ── Flags, read from src/config.ts so this script needs no TS loader ──
const config = readFileSync(join(SITE, "src/config.ts"), "utf8");
const iosStatus = config.match(/IOS_STATUS: IosStatus = "(\w+)"/)?.[1];
if (!iosStatus) throw new Error("check-claims: couldn't read IOS_STATUS from src/config.ts");
// Only inside `export const flags = { … }`, so NAV's `external: true` isn't read as a flag.
const flagBlock = config.match(/export const flags = \{([\s\S]*?)\}/)?.[1] ?? "";
const flags = Object.fromEntries([...flagBlock.matchAll(/(\w+): (true|false),/g)].map((m) => [m[1], m[2] === "true"]));
for (const name of ["webAppPublic", "privateEmailShipped", "autoDraftsFromDayOne", "iosAutofillInBeta", "chromeExtensionPublic", "domainPurchaseLive", "androidPublic"]) {
	if (!(name in flags)) throw new Error(`check-claims: couldn't read flags.${name} from src/config.ts`);
}
// The web app's origin and the one path visitors may be sent to (sign-up and sign-in share it).
const appOrigin = config.match(/APP_URL = "([^"]+)"/)?.[1];
const signUpPath = config.match(/SIGN_UP_URL = `\$\{APP_URL\}([^`]*)`/)?.[1];
if (!appOrigin || !signUpPath) throw new Error("check-claims: couldn't read APP_URL and SIGN_UP_URL from src/config.ts");
const appHost = new URL(appOrigin).host;

// ── Rules ──
// Never on the site, wrapper or not.
const bannedFull = [
	/zero[- ]knowledge/i,
	/never trains?/i,
	/\bunlimited\b/i,
	/\bSLA\b/,
	/24\/7/,
	/within 24 hours/i,
	/free forever/i,
	/\bforever\b/i,
	/trusted by/i,
	/join thousands/i,
	/military[- ]grade/i,
	/secure by default/i,
	// A claim of end-to-end encryption. The candid answers say mail "isn’t
	// end-to-end encrypted"; a negation right before it is allowed.
	/(?<!\b(?:isn[’']t|is not|not|aren[’']t|never)\s)end-to-end encrypted/i,
	// Sorting into Promotions and Updates is header rules (classify-email.ts),
	// and only for senders you haven't placed; a choice or a filter wins
	// (dev 31c58c6). Workers AI only checks for spam, so no "AI sorting".
	/\bsort\w*\b[^.]{0,60}\bWorkers AI\b|\bWorkers AI\b[^.]{0,60}\bsort/i,
	/\b(?:AI|smart)[- ]?sort/i,
	// Mail waiting in the Screener is forwarded on dev (cb0b217, unknown →
	// skipForward false); only screened-out mail and spam aren't.
	/\bScreener\b[^.]{0,120}\bnever\b[^.]{0,60}\bforwarded\b/i,
	// Deleting mail moves it to Trash first, MCP included (tools.ts
	// toolDeleteEmail); only a delete from Trash or Drafts is final.
	/\bpermanently delet\w*\s+(?:mail|emails?)\b/i,
	// Remote images load by default; only Spam holds them back until Load
	// images (AVE-132, #168: shared/remote-images.ts). So no claim that every
	// message hides them, and none that they're hidden or blocked unless the
	// same sentence says Spam.
	/\b(?:every|all|each|any)\b[^.]{0,30}\b(?:remote )?images?\b[^.]{0,30}\b(?:wait|hidden|held back|blocked)/i,
	/\bin (?:every|all|each) (?:message|email)s?\b[^.]{0,40}\b(?:hidden|blocked|wait)/i,
	/(?<!\bSpam\b[^.]{0,80})\bremote images?\b(?![^.]{0,80}\bSpam\b)[^.]{0,40}\b(?:hidden|blocked|wait\w*|held back|on request)\b/i,
	/\bhidden in (?:every|all|each) (?:message|email)/i,
	/(?<!\bSpam\b[^.]{0,80})\bblock\w* remote images?\b(?![^.]{0,80}\bSpam\b)/i,
	/\b(?:always|never) load\w* remote images\b|\bremote images (?:never|always) load/i,
	// ⌘K only focuses search on the web (FloatingDock.tsx); there are no commands.
	/command (?:bar|palette)/i,
	/⌘K bar/,
	// Account deletion is in the apps (eda481f), and connecting a domain you
	// own needs a TXT record you add yourself (ca531c6).
	/delet\w* (?:the|your) account[^.]{0,60}isn[’']t in the apps/i,
	/without the DNS homework/i,
	// The site sells the service (29 Oct 2026): no origin story, and no
	// framework or model names. Open-source and stack wording is for developers
	// only (bannedOutsideDev).
	/agentic-inbox/i,
	/\bfork(?:ed)? (?:of|from)\b/i,
	/\b(?:SwiftUI|Jetpack Compose)\b/,
	/\b(?:Kimi|Llama|Mistral|Gemma|Qwen)\b/i,
];

// Only inside data-claim="roadmap" or "negated" ("dev" doesn't exempt these).
const bannedPlain = [
	/end-to-end/i,
	/\bencrypt/i,
	/\bsnooze/i,
	/keyboard shortcut/i,
	/\bset aside\b/i,
	/schedul(ed|e) send/i,
	/hide my email/i,
];

// Only inside data-claim="dev" (30 Oct 2026). The code is open source again,
// but it isn't a selling point: it's mentioned where developers look (the
// Source link, Support → For developers, the legal clauses about the code),
// and Cloudflare is named elsewhere only as the network Inboxies runs on,
// never by its products (Cloudflare Registrar stays allowed: the terms name
// the registrar).
const bannedOutsideDev = [
	/open[- ]source/i,
	/\bself[- ]host/i,
	/Apache[- ]?(?:2|License)/i,
	/\bGitHub\b/i,
	/\bMCP\b|Model Context Protocol/i,
	/Durable Objects?/i,
	/\bSQLite\b/i,
	/\b(?:R2|D1)\b/,
	/Workers AI/i,
	/Cloudflare (?:Workers|Access|Email Service)\b/i,
	/Email Routing/i,
	/\bwrangler\b/i,
];

// Only inside data-claim="roadmap" ("negated" doesn't exempt these).
// Gmail-style j and k aren't built, though the welcome emails still promise
// them (welcome-emails.ts). The ? list shipped with AVE-28.
const bannedOutsideRoadmap = [/\bj and k\b/i];

if (iosStatus !== "appstore") bannedFull.push(/App Store/);
if (!flags.androidPublic) {
	bannedFull.push(/Google Play|Play Store/i);
	bannedPlain.push(/\bAndroid\b/);
}
if (!flags.domainPurchaseLive) bannedFull.push(/\$20\b/);
// While the web app isn't public (D1), "Web" leaves every platform and
// availability line. Capitalised only: prose about the web app may stay.
if (!flags.webAppPublic) bannedFull.push(/\bWeb\b(?! Store)/, new RegExp(`web app at ${appHost.replace(/\./g, "\\.")}`, "i"));
// Private email: allowed in plain copy once it's on dev (the site ships with
// dev); until then only roadmap copy may name it.
if (!flags.privateEmailShipped) bannedOutsideRoadmap.push(/private (email|address)/i);
// Drafts as mail arrives: plain copy may say so once they run on new
// mailboxes (PR #49, on dev).
if (!flags.autoDraftsFromDayOne) bannedPlain.push(/automatic draft/i);
// AutoFill: plain copy may name it once someone can use it (a TestFlight
// build carries the extension, or Android is public).
if (!flags.iosAutofillInBeta && !flags.androidPublic) bannedPlain.push(/autofill/i);
// The Chrome extension only loads unpacked until it's in the Chrome Web Store.
if (!flags.chromeExtensionPublic) bannedOutsideRoadmap.push(/\bChrome extension\b/i, /Chrome Web Store/i, /add to Chrome/i);

// ── Text extraction ──
const DROP = "script, style, template, noscript[data-ignore]";

// Text nodes joined with spaces, so words in neighbouring elements never run
// together into a false match (or hide a real one).
function textOf(root) {
	const parts = [];
	const walk = (node) => {
		if (node.nodeType === 3) parts.push(node.text);
		else for (const child of node.childNodes) walk(child);
	};
	walk(root);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

function pageText(html, removeSelector) {
	const root = parse(html, { comment: false });
	for (const el of root.querySelectorAll(DROP)) el.remove();
	if (removeSelector) for (const el of root.querySelectorAll(removeSelector)) el.remove();
	return textOf(root);
}

function htmlFiles(dir) {
	return readdirSync(dir, { recursive: true })
		.filter((f) => f.endsWith(".html"))
		.map((f) => join(dir, f))
		.sort();
}

// Every link into the web app goes to its sign-up page while it's public, and
// none exist while it isn't (D1). "/" sits behind Cloudflare Access.
function appLinkHits(root, name) {
	const hits = [];
	for (const a of root.querySelectorAll("a[href]")) {
		const href = a.getAttribute("href");
		let url;
		try {
			url = new URL(href, "https://site.invalid/");
		} catch {
			continue;
		}
		if (url.host !== appHost) continue;
		if (!flags.webAppPublic) hits.push(`${name} · link to the web app while flags.webAppPublic is false · ${href}`);
		else if (url.pathname !== signUpPath) hits.push(`${name} · link to the web app outside ${signUpPath} (use SIGN_UP_URL or primaryCta()) · ${href}`);
	}
	return hits;
}

function context(text, index, length) {
	const start = Math.max(0, index - 20);
	return text.slice(start, start + Math.max(60, length + 20)).replace(/\s+/g, " ");
}

// ── Run ──
if (!existsSync(DIST)) {
	console.error(`check-claims: ${relative(SITE, DIST)} doesn't exist. Run astro build first.`);
	process.exit(1);
}

const files = htmlFiles(DIST);
const hits = [];

for (const file of files) {
	const html = readFileSync(file, "utf8");
	const name = relative(DIST, file);
	// Not a claim, but the same pass catches it: two elements with one id
	// break anchors (#private-email), labels and aria references.
	const seenIds = new Set();
	const root = parse(html);
	for (const el of root.querySelectorAll("[id]")) {
		const id = el.getAttribute("id");
		if (seenIds.has(id)) hits.push(`${name} · duplicate id "${id}"`);
		seenIds.add(id);
	}
	hits.push(...appLinkHits(root, name));
	// Links to the repository are developer copy too.
	for (const a of root.querySelectorAll('a[href*="github.com"]')) {
		if (!a.closest('[data-claim="dev"]')) hits.push(`${name} · link to GitHub outside data-claim="dev" · ${a.getAttribute("href")}`);
	}
	const views = [
		[pageText(html), bannedFull, ""],
		[pageText(html, '[data-claim="roadmap"], [data-claim="negated"]'), bannedPlain, ' (outside data-claim="roadmap" or "negated")'],
		[pageText(html, '[data-claim="roadmap"]'), bannedOutsideRoadmap, ' (outside data-claim="roadmap")'],
		[pageText(html, '[data-claim="dev"]'), bannedOutsideDev, ' (outside data-claim="dev")'],
	];
	for (const [text, rules, where] of views) {
		for (const rule of rules) {
			const flagsWithG = rule.flags.includes("g") ? rule.flags : `${rule.flags}g`;
			for (const m of text.matchAll(new RegExp(rule.source, flagsWithG))) {
				hits.push(`${name} · ${m[0]}${where} · ${context(text, m.index, m[0].length)}`);
			}
		}
	}
}

if (hits.length) {
	console.error(`check-claims: ${hits.length} problem${hits.length === 1 ? "" : "s"} in the build:`);
	for (const hit of hits) console.error(`  ${hit}`);
	process.exit(1);
}

console.log(
	`check-claims: ${files.length} page${files.length === 1 ? "" : "s"} clean ` +
		`(IOS_STATUS=${iosStatus}, ${Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(", ")})`,
);
