// Shapes for every data module. Every entry carries `src` (where the claim
// comes from in the research; never rendered), and `ownerConfirm` when the
// line is true in code but waits on a policy the owner hasn't stated.
// src/data/validate.ts enforces both at build time.
import type { ClipName, StillName } from "./media";

export type { ClipName, StillName };

export type Platform = "ios" | "android" | "web" | "chrome" | "mcp";
export type Status = "available" | "next" | "review" | "progress" | "planned" | "exploring" | "partly" | "notyet";
export type Claim = "roadmap" | "negated";
export type Block = string | { list: string[] } | { table: [string, string][] } | { records: [string, string][] };

export interface Sourced { src: string; ownerConfirm?: string }

export interface MediaRef { still: StillName; clip?: ClipName }           // names from media.ts

// A row in a tour chapter. `src` per row (an addition to the spec's shape) so
// each claim keeps its own source.
export interface TourRow extends Sourced { lead: string; text: string; platforms?: Platform[] }

export interface TourChapter extends Sourced {
	id: string; num: string; name: string; lineage?: "HEY" | "Gmail";
	platforms: Platform[]; title: string; body: string;
	extra?: "operators" | "agent-strip";
	rows: TourRow[];
	supportHref: string; railLabel: string; media: MediaRef;
}

// Search operators shown as chips in the Search chapter.
export interface Operator extends Sourced { op: string; meaning: string }

export interface Feature extends Sourced {                                 // "And the rest"
	id: string; title: string; href?: string; platforms: Platform[];
	description: string; status: "available";                              // FeatureRow throws otherwise
}

export interface Principle extends Sourced { id: string; title: string; body: string; href?: string; meta?: string; claim?: Claim }
export interface Tile extends Sourced { dt: string; dd: string; p: string }

// Copy for a Callout: `body` is markdown-lite (renderInline).
export interface CalloutCopy extends Sourced { id: string; title: string; body: string; status?: Status; claim?: Claim }

export type RoadmapGroup = "triage" | "ai" | "search-compose" | "domains" | "privacy" | "apps";

export interface RoadmapRow extends Sourced {
	id: string; name: string;
	group: RoadmapGroup;
	status: Exclude<Status, "partly">; lineage?: "Gmail" | "HEY" | "Hide My Email";
	platforms: Platform[]; note?: string; landing?: boolean; anchor?: string;
}
export interface ComingNext extends Sourced { id: string; title: string; status: Status; body: string }

export interface ParityRow extends Sourced {
	competitor: "gmail" | "hey"; theirs: string; ours: string; status: Status; note?: string; landing?: boolean;
}

export interface ChangeEntry extends Sourced { date: string /* YYYY-MM-DD */; title: string; description: string }

export interface Plan extends Sourced {
	id: "personal" | "own-domain" | "registered"; name: string; badge?: string; audience: string;
	price: string; unit: string; cta: { label: string; href: string; variant: "primary" | "secondary" };
	leadIn?: string; includes: string[]; footnote: string; hidden?: boolean;
}
export interface CompareGroup { label: string; rows: { label: string; values: (string | boolean)[]; src: string; ownerConfirm?: string }[] }
export interface CompareColumn extends Sourced { name: string; price: string }
export interface PlanCompare extends Sourced { caption: string; columns: CompareColumn[]; groups: CompareGroup[]; footnote?: string }
export interface RecordRow extends Sourced { label: string; value: string }

// "Where the $20 goes": two lines that add up to the total.
export interface BreakdownLine extends Sourced { label: string; detail?: string; amount: string }
export interface PriceBreakdown extends Sourced { lines: BreakdownLine[]; total: BreakdownLine; note: string }

// A Row on the landing's pricing brief, and the self-host row on /pricing.
export interface BriefRow extends Sourced { id: string; title: string; href: string; meta: string; description: string }
export interface SelfHost extends Sourced { title: string; href: string; meta: string; description: string }

export interface Faq extends Sourced {
	id: string; group: string; q: string; a: Block[]; claim?: Claim; hidden?: boolean;
}
export interface FaqGroup extends Sourced { id: string; title: string; items: Faq[] }

// `meta` replaces the computed answer count (Billing: "on Pricing", Contact: "—").
export interface SupportTopic extends Sourced { id: string; title: string; href: string; description: string; group?: string; meta?: string }
