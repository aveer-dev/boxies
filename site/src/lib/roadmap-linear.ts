// The public roadmap, read from Linear (AVE-85). Pure parsing and mapping only:
// src/pages/api/roadmap.ts does the fetching and caching, and test/roadmap-linear.test.mjs
// covers what's here.
//
// Linear is the only source: an issue is public when it carries the `public-roadmap`
// label. Everything Linear sends is untrusted, and only three things leave this module
// per issue: the title, a short "Public summary" (plain text, length-capped) and the
// status. No identifiers, links, assignees, estimates, comments or any other part of
// the description.

export const ROADMAP_LABEL = "public-roadmap";
export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export type RoadmapStatus = "Planned" | "In progress" | "Shipped";

export interface RoadmapItem {
	/** Opaque and stable: a hash of the Linear issue id, so it can key a list or a request without pointing into Linear. */
	id: string;
	title: string;
	/** Plain text from the issue's "Public summary" section, or null (show the title alone). */
	summary: string | null;
	status: RoadmapStatus;
}

/** Where the items came from. Anything but "linear" means the page should show its static list. */
export type RoadmapSource = "linear" | "unconfigured" | "error";

export interface RoadmapPayload {
	items: RoadmapItem[];
	source: RoadmapSource;
	/** ISO time the items were read from Linear; null when they weren't. */
	fetchedAt: string | null;
}

export const TITLE_MAX = 120;
export const SUMMARY_MAX = 280;
/** 100 issues a page, at most 3 pages. The roadmap is a hand-picked list, not the backlog. */
export const PAGE_SIZE = 100;
export const MAX_PAGES = 3;

// Asks for only what the mapping reads. Canceled issues are left out here and again in
// statusFor, in case the filter ever changes.
export const ROADMAP_QUERY = `query PublicRoadmap($label: String!, $first: Int!, $after: String) {
  issues(
    first: $first
    after: $after
    filter: { labels: { some: { name: { eqIgnoreCase: $label } } }, state: { type: { neq: "canceled" } } }
  ) {
    nodes { id title description updatedAt completedAt state { type } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export interface LinearIssue {
	id: string;
	title: string;
	description: string | null;
	updatedAt: string | null;
	completedAt: string | null;
	stateType: string;
}

export interface LinearPage {
	issues: LinearIssue[];
	endCursor: string | null;
	hasNextPage: boolean;
}

/** Linear state type → public status. Canceled (which covers duplicates) and anything unknown → null, dropped. */
export function statusFor(stateType: string): RoadmapStatus | null {
	switch (stateType) {
		case "triage":
		case "backlog":
		case "unstarted":
			return "Planned";
		case "started":
			return "In progress";
		case "completed":
			return "Shipped";
		default:
			return null;
	}
}

/**
 * Reads one page of the GraphQL answer. Throws on GraphQL errors or a shape it doesn't
 * expect, never echoing Linear's text (an error message can quote the query or the account).
 * Malformed nodes are skipped rather than failing the whole page.
 */
export function parseLinearPage(body: unknown): LinearPage {
	if (!isObject(body)) throw new Error("linear: not an object");
	if (Array.isArray(body.errors) && body.errors.length) throw new Error("linear: graphql errors");
	const data = body.data;
	if (!isObject(data) || !isObject(data.issues) || !Array.isArray(data.issues.nodes)) throw new Error("linear: unexpected shape");
	const issues: LinearIssue[] = [];
	for (const node of data.issues.nodes) {
		if (!isObject(node) || typeof node.id !== "string" || typeof node.title !== "string") continue;
		const state = isObject(node.state) ? node.state : null;
		if (!state || typeof state.type !== "string") continue;
		issues.push({
			id: node.id,
			title: node.title,
			description: typeof node.description === "string" ? node.description : null,
			updatedAt: typeof node.updatedAt === "string" ? node.updatedAt : null,
			completedAt: typeof node.completedAt === "string" ? node.completedAt : null,
			stateType: state.type,
		});
	}
	const pageInfo = isObject(data.issues.pageInfo) ? data.issues.pageInfo : {};
	return {
		issues,
		hasNextPage: pageInfo.hasNextPage === true,
		endCursor: typeof pageInfo.endCursor === "string" ? pageInfo.endCursor : null,
	};
}

const ORDER: Record<RoadmapStatus, number> = { "In progress": 0, Planned: 1, Shipped: 2 };

/**
 * Issues → public items: drops canceled, unknown states and empty titles, then sorts In
 * progress, Planned, Shipped. Within a group the latest change comes first (for Shipped,
 * the latest completion).
 */
export async function toRoadmapItems(issues: LinearIssue[]): Promise<RoadmapItem[]> {
	const kept: { item: RoadmapItem; at: number }[] = [];
	const seen = new Set<string>();
	for (const issue of issues) {
		if (seen.has(issue.id)) continue;
		seen.add(issue.id);
		const status = statusFor(issue.stateType);
		const title = clip(toPlainText(issue.title), TITLE_MAX);
		if (!status || !title) continue;
		const at = Date.parse((status === "Shipped" && issue.completedAt) || issue.updatedAt || "") || 0;
		kept.push({ item: { id: await publicId(issue.id), title, summary: publicSummary(issue.description), status }, at });
	}
	kept.sort((a, b) => ORDER[a.item.status] - ORDER[b.item.status] || b.at - a.at || a.item.title.localeCompare(b.item.title));
	return kept.map((k) => k.item);
}

/** First 16 hex characters of SHA-256 over the Linear id. Stable, and not reversible into a Linear link. */
export async function publicId(linearId: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`inboxies-roadmap:${linearId}`));
	return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// How a "Public summary" section starts: a heading (any level), a bold line, or a line
// that begins "Public summary:". The bold and colon forms may carry the text on the same line.
const SUMMARY_STARTS = [
	/^\s{0,3}#{1,6}\s*public\s+summary\s*:?\s*#*\s*$/i,
	/^\s{0,3}(?:\*\*|__)\s*public\s+summary\s*:?\s*(?:\*\*|__)\s*:?\s*(.*)$/i,
	/^\s{0,3}public\s+summary\s*:\s*(.*)$/i,
];

/** The text after a "Public summary" opener ("" if none), or null when the line isn't one. */
function summaryStart(line: string): string | null {
	for (const re of SUMMARY_STARTS) {
		const m = re.exec(line);
		if (m) return m[1] ?? "";
	}
	return null;
}
// Where the section ends: the next heading, a bold-only line (another pseudo-heading) or a rule.
const SECTION_END = /^\s{0,3}(?:#{1,6}\s|(?:\*\*|__)[^*_]+(?:\*\*|__)\s*:?\s*$|(?:[-*_]\s*){3,}$)/;

/** The "Public summary" section of a description as plain, capped text; null when there isn't one or it's empty. */
export function publicSummary(description: string | null): string | null {
	if (!description) return null;
	const lines = description.replace(/\r\n?/g, "\n").split("\n");
	const start = lines.findIndex((l) => summaryStart(l) !== null);
	if (start === -1) return null;
	const body: string[] = [];
	const sameLine = summaryStart(lines[start]) ?? "";
	if (sameLine.trim()) body.push(sameLine);
	for (let i = start + 1; i < lines.length; i++) {
		if (SECTION_END.test(lines[i])) break;
		body.push(lines[i]);
	}
	const text = clip(toPlainText(body.join("\n")), SUMMARY_MAX);
	return text || null;
}

/**
 * Markdown (or anything else) → one line of plain text. Keeps link and image-less text,
 * drops URLs, HTML, code fences, emphasis markers, list and quote markers, and control
 * and bidi-override characters. The page still escapes it; this is about what's said.
 */
export function toPlainText(input: string): string {
	return (
		input
			.normalize("NFC")
			// Fenced code is internal detail, not a summary.
			.replace(/```[\s\S]*?(?:```|$)/g, " ")
			.replace(/~~~[\s\S]*?(?:~~~|$)/g, " ")
			// HTML comments, script and style bodies, then any other tag.
			.replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
			.replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
			.replace(/<\/?[a-z][^>]*>/gi, " ")
			// Images go; links keep their text.
			.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
			.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
			.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
			// Bare URLs and autolinks (Linear's own links included).
			.replace(/<?\b(?:https?|ftp|mailto):[^\s>]*>?/gi, " ")
			.replace(/\bwww\.[^\s]+/gi, " ")
			// Line-start markers: headings, quotes, lists, checkboxes.
			.replace(/^\s*#{1,6}\s+/gm, "")
			.replace(/^\s*>+\s?/gm, "")
			.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, "")
			// Inline code keeps its text; emphasis and strike markers go.
			.replace(/`+/g, "")
			.replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
			.replace(/(^|[^\w*])[*_](?=\S)([^*_\n]*?\S)[*_](?=[^\w*]|$)/g, "$1$2")
			// Entities the tag pass leaves behind.
			.replace(/&nbsp;/gi, " ")
			.replace(/&amp;/gi, "&")
			.replace(/&lt;/gi, "<")
			.replace(/&gt;/gi, ">")
			.replace(/&quot;/gi, '"')
			.replace(/&#39;|&apos;/gi, "'")
			// Control, zero-width and bidi-override characters.
			.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
	);
}

/** Cuts to `max` characters (by code point, so nothing is split), at a word where it can, with an ellipsis. */
export function clip(text: string, max: number): string {
	const chars = [...text];
	if (chars.length <= max) return text;
	const cut = chars.slice(0, max - 1).join("");
	const space = cut.lastIndexOf(" ");
	const head = space > max * 0.6 ? cut.slice(0, space) : cut;
	return `${head.replace(/[\s.,;:!?-]+$/, "")}…`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
