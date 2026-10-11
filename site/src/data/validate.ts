// Build-time content checks (§1.7). Base.astro calls validateContent() on
// every page; a throw fails the build, so a claim without a source, or a
// feature that isn't shipped, can't reach the site.
import { asOf, flags } from "../config";
import { daysBetween, parseDay } from "../lib/format";
import * as changelog from "./changelog";
import * as faqs from "./faqs";
import * as features from "./features";
import * as media from "./media";
import * as parity from "./parity";
import * as pricing from "./pricing";
import * as principles from "./principles";
import * as roadmap from "./roadmap";
import * as supportTopics from "./supportTopics";
import * as tour from "./tour";
import type { Faq, Feature, RoadmapRow, StillName, TourChapter } from "./types";

const MODULES: Record<string, Record<string, unknown>> = {
	changelog,
	faqs,
	features,
	media,
	parity,
	pricing,
	principles,
	roadmap,
	supportTopics,
	tour,
};

// Keys that hold child entries rather than copy: their items are entries too.
const CHILDREN = ["items", "rows", "lines", "columns", "groups"];

type Entry = Record<string, unknown>;
const isEntry = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Rule 1: every entry has a non-empty `src`, and ids are unique per collection.
 * An object whose only job is to hold entries (a compare group) may skip `src`;
 * its children may not.
 */
function checkSources(path: string, value: unknown, errors: string[]) {
	if (Array.isArray(value)) {
		const ids = new Set<string>();
		value.forEach((item, i) => {
			if (!isEntry(item)) return;
			const id = typeof item.id === "string" ? item.id : undefined;
			if (id !== undefined) {
				if (ids.has(id)) errors.push(`${path}: duplicate id "${id}"`);
				ids.add(id);
			}
			const label = `${path}[${id ?? i}]`;
			const children = CHILDREN.filter((k) => Array.isArray(item[k]) && (item[k] as unknown[]).some(isEntry));
			const isContainer = children.length > 0 && !("src" in item);
			if (!isContainer && !(typeof item.src === "string" && item.src.trim())) errors.push(`${label}: missing src`);
			for (const k of children) checkSources(`${label}.${k}`, item[k], errors);
		});
	} else if (isEntry(value)) {
		// An exported object: check it if it's an entry, then its child entries.
		if ("src" in value && !(typeof value.src === "string" && value.src.trim())) errors.push(`${path}: empty src`);
		for (const k of CHILDREN) if (Array.isArray(value[k])) checkSources(`${path}.${k}`, value[k], errors);
		if (isEntry(value.total)) checkSources(`${path}.total`, [value.total], errors);
	}
}

// Every string anywhere inside a value (copy, notes, list items, table cells).
function strings(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (isEntry(value)) return Object.entries(value).flatMap(([k, v]) => (k === "src" || k === "ownerConfirm" ? [] : strings(v)));
	return [];
}

let validated = false;

export function validateContent(): void {
	// Base runs this for every page; the data can't change mid-build.
	if (validated) return;
	const errors: string[] = [];

	// 1. Sources and ids.
	for (const [name, mod] of Object.entries(MODULES)) {
		for (const [key, value] of Object.entries(mod)) {
			if (name === "media") continue; // names and alt text, sourced as a whole (MEDIA)
			checkSources(`${name}.${key}`, value, errors);
		}
	}

	// Answer ids share one page with the group anchors and #contact.
	const supportIds = new Set<string>(["contact"]);
	for (const group of faqs.supportGroups) {
		for (const id of [group.id, ...group.items.map((f) => f.id)]) {
			if (supportIds.has(id)) errors.push(`faqs.supportGroups: id "${id}" is used twice on /support`);
			supportIds.add(id);
		}
	}

	// Links into /support must land on an answer that's on the page.
	const supportLinks = [
		...tour.chapters.map((c) => c.supportHref),
		...features.moreFeatures.map((f) => f.href),
		...principles.facts.map((p) => p.href),
		...strings([principles.plainly, roadmap.privateEmailCallout]).flatMap((s) => [...s.matchAll(/\]\((\/support#[^)]+)\)/g)].map((m) => m[1])),
	];
	for (const href of supportLinks) {
		if (href?.startsWith("/support#") && !supportIds.has(href.slice("/support#".length))) {
			errors.push(`link ${href} points at no answer on /support`);
		}
	}
	// …and so must in-page links inside the answers ("[How the Screener works](#screener)").
	for (const s of strings(faqs.supportGroups)) {
		for (const m of s.matchAll(/\]\(#([^)]+)\)/g)) {
			if (!supportIds.has(m[1])) errors.push(`faqs: link #${m[1]} points at no answer on /support`);
		}
	}
	for (const topic of supportTopics.topics) {
		if (topic.group && !faqs.supportGroups.some((g) => g.id === topic.group)) errors.push(`supportTopics[${topic.id}]: unknown group "${topic.group}"`);
		if (!topic.group && !topic.meta) errors.push(`supportTopics[${topic.id}]: needs a group or a meta`);
	}

	// 2. Shipped work has no owner gate on its status.
	for (const row of roadmap.rows as RoadmapRow[]) {
		if (row.status === "available" && row.ownerConfirm) errors.push(`roadmap.rows[${row.id}]: available rows can't carry ownerConfirm`);
	}

	// 3. "And the rest" and the tour only show what's shipped.
	for (const f of features.moreFeatures as Feature[]) {
		if (f.status !== "available") errors.push(`features.moreFeatures[${f.id}]: status must be "available"`);
	}
	for (const c of tour.chapters as TourChapter[]) {
		if ("status" in c) errors.push(`tour.chapters[${c.id}]: chapters are available by construction and take no status`);
	}

	// Every still exists in both themes, and every clip falls back to a real still.
	for (const name of Object.keys(media.stills) as StillName[]) {
		for (const theme of ["light", "dark"] as const) {
			try {
				media.getStill(name, theme);
			} catch (e) {
				errors.push((e as Error).message);
			}
		}
	}
	for (const [name, clip] of Object.entries(media.clips)) {
		if (!(clip.still in media.stills)) errors.push(`media.clips[${name}]: unknown still "${clip.still}"`);
	}

	// 4. Nothing in the changelog is dated after asOf; newest first.
	let previous = "9999-12-31";
	for (const e of changelog.entries) {
		parseDay(e.date);
		if (e.date > asOf) errors.push(`changelog "${e.title}": ${e.date} is after asOf (${asOf})`);
		if (e.date > previous) errors.push(`changelog "${e.title}": out of order (newest first)`);
		previous = e.date;
	}

	// 5. Until private email is on main, only roadmap-claimed copy may name it.
	if (!flags.privateEmailShipped) {
		const banned = /private (email|address)/i;
		const allFaqs: Faq[] = [...faqs.billing, ...faqs.supportGroups.flatMap((g) => g.items)];
		const scanned: [string, unknown][] = [
			...features.moreFeatures.map((f): [string, unknown] => [`features.moreFeatures[${f.id}]`, f]),
			...tour.chapters.map((c): [string, unknown] => [`tour.chapters[${c.id}]`, c]),
			...allFaqs.filter((f) => f.claim !== "roadmap").map((f): [string, unknown] => [`faqs[${f.id}]`, f]),
		];
		for (const [label, entry] of scanned) {
			const hit = strings(entry).find((s) => banned.test(s));
			if (hit) errors.push(`${label}: mentions private email before it ships: "${hit.slice(0, 60)}…"`);
		}
	}

	if (errors.length) {
		throw new Error(`Content checks failed (src/data/validate.ts):\n  - ${errors.join("\n  - ")}`);
	}

	// 6. A stale asOf is a warning, not a failure: the copy may still be true.
	const today = new Date().toISOString().slice(0, 10);
	const age = daysBetween(asOf, today);
	if (age > 45) console.warn(`[content] asOf is ${asOf}, ${age} days ago. Re-check the copy and bump asOf in src/config.ts.`);

	validated = true;
}
