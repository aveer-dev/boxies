// The roadmap database (§4.3 R2), the landing's "Today and next" rows
// (`landing: true`, §4.1 L6) and "Coming next, in detail" (§4.3 R3).
// Status follows the branches: on main = available, merged to dev = next,
// open PR = review. Nothing here is "available" unless it's on main.
//
// Left out on purpose: the export-authorization fix (PR #48) and the
// offboarding-check fix (PR #47), which would point at a live gap (add a
// changelog line once they're on main), and "Offline on Android", which has
// no plan behind it.
import { IOS_STATUS, asOf, flags } from "../config";
import { onSomePublicPlatform } from "../lib/platforms";
import type { CalloutCopy, ComingNext, RoadmapGroup, RoadmapRow } from "./types";

export { asOf };

export const GROUP_LABEL: Record<RoadmapGroup, string> = {
	triage: "Triage",
	ai: "AI",
	"search-compose": "Search and compose",
	domains: "Domains and teams",
	privacy: "Privacy and trust",
	apps: "Apps and sync",
};

// Shipping either of these is a flag flip in config.ts, not a data edit.
const privateEmailStatus = flags.privateEmailShipped ? "available" : "next";
const draftsStatus = flags.autoDraftsFromDayOne ? "available" : "next"; // PR #49 merged to dev 9 Oct

const all: (RoadmapRow & { hidden?: boolean })[] = [
	// ── Triage ──
	{ id: "screener", group: "triage", name: "Screener", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "On for every new mailbox. No off switch yet.", landing: true, src: "FSW#the-screener; RM#3" },
	{ id: "new-and-seen", group: "triage", name: "New and Seen", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "Opening a thread moves it to Seen.", src: "FSW#supporting-features" },
	{ id: "categories", group: "triage", name: "Promotions and Updates, by sender", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Accept a sender into either. No automatic tabs, and no Social or Forums.", landing: true, src: "RM#2 (categories); D2 (sender-triage.ts: the sender's destination files mail while the Screener is on)" },
	{ id: "sender-destinations", group: "triage", name: "Sender destinations", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "Settings → Senders.", src: "FSW#sender-destinations" },
	{ id: "reply-later", group: "triage", name: "Reply Later", status: "available", lineage: "HEY", platforms: ["ios", "android", "web"], note: "Leaves the pile when you reply.", landing: true, src: "RM#3" },
	{ id: "focus-reply", group: "triage", name: "Focus & Reply", status: "available", lineage: "HEY", platforms: ["web"], note: "Web only.", landing: true, src: "RM#3 (web only)" },
	{ id: "filters", group: "triage", name: "Filters", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Up to 50 per mailbox.", src: "FSW#filters" },
	{ id: "swipes", group: "triage", name: "Swipe actions", status: "available", platforms: ["ios", "android"], note: "Up to three per edge.", src: "FC#4.4" },
	{ id: "undo", group: "triage", name: "Undo for delete, archive and move", status: "available", lineage: "Gmail", platforms: ["ios", "android"], note: "About five seconds.", src: "FC#4.4; J (no undo on web)" },
	{ id: "undo-send", group: "triage", name: "Undo send", status: "available", lineage: "Gmail", platforms: ["ios"], note: "A few seconds after you tap Send.", src: "RM#2 (iOS only)" },
	{ id: "set-aside", group: "triage", name: "Set Aside", status: "planned", lineage: "HEY", platforms: [], note: "A second pile for mail you need to keep handy.", landing: true, src: "RM#1 (4)" },
	{ id: "tags", group: "triage", name: "Tags and a VIP view", status: "exploring", lineage: "Gmail", platforms: [], note: "Today: folders and stars.", src: "RM#1 (8)" },

	// ── AI ──
	{ id: "ask-ai", group: "ai", name: "Ask AI", status: "available", platforms: ["ios", "android", "web"], note: flags.webAppPublic ? "Drafts and files; never sends. Several chats in the apps, one on the web." : "Drafts and files; never sends. Several chats at once.", landing: true, src: "FSW#ai-email-agent; FC#4.8; FC#2" },
	{ id: "ai-prompt", group: "ai", name: "Custom AI prompt", status: "available", platforms: ["ios", "android", "web"], note: "One per mailbox.", src: "FC#4.8" },
	{ id: "mcp", group: "ai", name: "MCP server", status: "available", platforms: ["mcp"], note: "On self-hosted installs today. 13 tools with your permissions, including sending and deleting mail.", src: "FSW#mcp-server; mcp/index.ts (13 tools incl. delete_email); D3 (no way to connect a client to inboxies.email: app.ts auth, MCPPanel.tsx)" },
	{
		id: "drafts-day-one",
		group: "ai",
		name: "Drafts from day one",
		status: draftsStatus,
		platforms: [],
		note: "Automatic draft replies that start on a brand-new mailbox’s first email.",
		src: "RM#1 (2, PR #49)",
		ownerConfirm: draftsStatus === "available" ? undefined : "list publicly",
	},
	{ id: "for-you", group: "ai", name: "“For you” brief", status: "progress", lineage: "HEY", platforms: ["ios", "android"], note: "To-dos and topics to catch up on. Built, not switched on yet.", src: "FC#7 (built, hidden)", ownerConfirm: "tease publicly" },
	{ id: "rewrite", group: "ai", name: "Rewrite in the composer", status: "exploring", lineage: "Gmail", platforms: [], note: "Ask the assistant to tighten or rephrase.", src: "RM#1 (11)" },
	{ id: "scoped-keys", group: "ai", name: "Scoped keys for outside agents", status: "exploring", platforms: [], note: "Read, draft or send permissions per mailbox, so MCP clients can connect to inboxies.email.", src: "RM#1 (12); D3" },

	// ── Search and compose ──
	{ id: "search-operators", group: "search-compose", name: "Search operators", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "from: to: subject: in: is: has: before: after:", landing: true, src: "FSW#search; RM#2" },
	{ id: "full-text-search", group: "search-compose", name: "Full-text search", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Message bodies, not just previews.", src: "FSW#search" },
	{ id: "on-device-search", group: "search-compose", name: "Instant on-device search", status: "available", platforms: ["ios"], note: "Your phone’s index first, then the server.", src: "FC#4.7" },
	{ id: "compose-dock", group: "search-compose", name: "Compose dock", status: "available", platforms: ["ios", "android"], note: "Swipe a draft down to park it.", src: "FC#4.6" },
	{ id: "formatting", group: "search-compose", name: "Formatting and attachments", status: "available", platforms: ["ios", "android", "web"], note: flags.androidPublic ? "No text colour on Android yet." : undefined, src: "FC#4.6 (text colour iOS, not Android); FSW#supporting-features; ComposeFormatSheet.tsx (text colour on the web)" },
	{ id: "recipients", group: "search-compose", name: "Recipient suggestions", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "From people you’ve emailed.", src: "FSW#supporting-features" },
	{ id: "web-workspace", group: "search-compose", name: "New desktop web workspace", status: "progress", platforms: ["web"], note: "Sliding panes, a ⌘K bar and a quick-reply bar.", landing: true, src: "RM#1 (5)" },
	{ id: "shortcuts", group: "search-compose", name: "Keyboard shortcuts on the web", status: "planned", lineage: "Gmail", platforms: ["web"], note: "c, j and k, r, l and more, with a ? overlay.", landing: true, src: "RM#1 (6)" },
	{ id: "signature-web", group: "search-compose", name: "Signature editor on the web", status: "exploring", lineage: "Gmail", platforms: ["web"], note: "The iPhone app can add a fixed “Sent with Inboxies Email” line; custom signatures can’t be written yet.", src: "RM#1 (10); FSW#caveats (7); SettingsSheetView.swift (signature toggle only)" },
	{ id: "scheduled-send", group: "search-compose", name: "Scheduled send", status: "exploring", lineage: "Gmail", platforms: [], note: "Write now, send later.", landing: true, src: "RM#1 (9)" },

	// ── Domains and teams ──
	{
		id: "custom-domains",
		group: "domains",
		name: "Custom domains with automatic DNS",
		status: "available",
		platforms: ["ios", "android", "web"],
		note: flags.domainPurchaseLive ? "Connect one you own, or register one." : "Connect one you own.",
		landing: true,
		src: "FSW#custom-domains",
	},
	{ id: "dns", group: "domains", name: "DNS editor and health check", status: "available", platforms: ["ios", "android", "web"], note: "One-click Fix Email DNS.", src: "FSW#custom-domains" },
	{ id: "domain-admin", group: "domains", name: "Domain Admin and invites", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Create, assign, invite, delete.", src: "FSW#domain-admin-console" },
	{ id: "shared-mailboxes", group: "domains", name: "Shared mailboxes", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Owners and members.", src: "FSW#shared-mailboxes" },
	{ id: "domain-export", group: "domains", name: "Whole-domain .mbox export", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "Domain admins.", src: "FSW#leave-anytime" },
	{ id: "transfer", group: "domains", name: "Transfer code and unlock", status: "available", platforms: ["ios", "android", "web"], note: "Domains registered through Inboxies.", src: "PS#5" },
	{ id: "mailbox-export", group: "domains", name: "Export a mailbox from Settings", status: "planned", lineage: "Gmail", platforms: [], note: "One button, any mailbox.", landing: true, src: "RM#1 (7)" },

	// ── Privacy and trust ──
	{
		id: "private-email",
		group: "privacy",
		name: "Private email addresses",
		anchor: "private-email",
		status: privateEmailStatus,
		lineage: "Hide My Email",
		platforms: ["ios", "android", "web", "chrome"],
		note: "A fresh address per sign-up; replies come from it. Up to 1,000 per mailbox.",
		landing: true,
		src: "RM#1 (1, merged to dev); FC#7; app/routes.ts settings/aliases (web)",
	},
	{ id: "spoofing", group: "privacy", name: "Spoofing warnings", status: "available", lineage: "Gmail", platforms: ["ios", "android", "web"], note: "SPF, DKIM and DMARC alignment.", src: "FSW#spoofing-protection" },
	{ id: "safe-html", group: "privacy", name: "Safe HTML", status: "available", platforms: ["ios", "android", "web"], note: "Cleaned and sandboxed.", src: "FSW#supporting-features" },
	{ id: "tracking-pixels", group: "privacy", name: "Tracking-pixel blocking", status: "notyet", lineage: "HEY", platforms: [], note: "Remote images load today.", src: "RM#3" },

	// ── Apps and sync ──
	{ id: "web-app", group: "apps", name: "Web app", status: "available", platforms: ["web"], note: "inboxies.email", src: "FSW (scope)" },
	{
		id: "iphone-app",
		group: "apps",
		name: "iPhone app",
		status: "available",
		platforms: ["ios"],
		note: IOS_STATUS === "appstore" ? "On the App Store." : "Beta on TestFlight.",
		hidden: IOS_STATUS === "hidden",
		src: "FC#8.5",
	},
	{
		id: "android-app",
		group: "apps",
		name: "Android app",
		status: "available",
		platforms: ["android"],
		note: "On Google Play.",
		hidden: !flags.androidPublic,
		src: "FC#1 (Android 14+); FC#8.5",
	},
	{ id: "push", group: "apps", name: "Push notifications", status: "available", lineage: "Gmail", platforms: ["ios", "android"], note: "Tap to open the exact email.", src: "RM#2" },
	{ id: "live", group: "apps", name: "Live updates", status: "available", platforms: ["ios", "android", "web"], note: "New mail appears as it arrives.", src: "FSW#supporting-features" },
	{ id: "offline", group: "apps", name: "Offline on iPhone", status: "available", lineage: "Gmail", platforms: ["ios"], note: "A local copy, and actions queued until you’re back.", src: "FC#4.10" },
];

/**
 * Every visible row, in group order (45 with the default flags). A shipped
 * row whose platforms are all hidden (the web app and Focus & Reply while the
 * web app isn't public) drops out rather than show no platform.
 */
export const rows: RoadmapRow[] = all
	.filter((r) => !r.hidden && (r.status !== "available" || onSomePublicPlatform(r.platforms)))
	.map(({ hidden: _, ...r }) => r);

// The landing's "Today and next" table lists its rows in its own order (§4.1
// L6), not the database's group order. RoadmapTable sorts by status and keeps
// this order within a status.
const LANDING_ORDER = [
	"screener",
	"reply-later",
	"focus-reply",
	"categories",
	"search-operators",
	"ask-ai",
	"custom-domains",
	"private-email",
	"web-workspace",
	"shortcuts",
	"set-aside",
	"mailbox-export",
	"scheduled-send",
];

/** The `landing: true` rows in the landing table's order (13 with the default flags). Use this, not `rows.filter((r) => r.landing)`. */
const landingRank = (id: string) => (LANDING_ORDER.includes(id) ? LANDING_ORDER.indexOf(id) : LANDING_ORDER.length);
export const landingRows: RoadmapRow[] = rows
	.filter((r) => r.landing)
	.sort((a, b) => landingRank(a.id) - landingRank(b.id));

const allComingNext: (ComingNext & { hidden?: boolean })[] = [
	{
		id: "private-email",
		title: "Private email addresses",
		status: "next",
		body:
			"Make a fresh address for every site you sign up to, from Settings → Private email. Mail to it reaches your mailbox with a “Private email” badge (a site’s first email waits in the Screener, like any new sender), and replies go out from that address, so your real one stays private. Pause one, set it to expire, or delete it. Up to 1,000 per mailbox." +
			" AutoFill on iPhone, which creates one right in the email field (on iOS 17 it copies one for you to paste), follows in a later TestFlight build, and a Chrome extension follows once it’s in Chrome’s store." +
			(flags.androidPublic ? " Android’s autofill does the same." : ""),
		hidden: flags.privateEmailShipped,
		src: "FC#7 (iOS 18+ inserts, iOS 17 copies; Chrome pairing; From enforced; cap 1,000); FC#4.9; RM#1 (1); dev index.ts (alias mail runs through resolveInboundFolder, no Screener bypass); d5df670 (AutoFill needs App ID and App Group setup); extension/manifest.json (no store listing)",
	},
	{
		id: "drafts-day-one",
		title: "Drafts from day one",
		status: draftsStatus,
		body: "Automatic draft replies to personal mail, working from a new mailbox’s first email. Drafts still wait in Drafts until you send them.",
		hidden: flags.autoDraftsFromDayOne,
		src: "RM#1 (2); PR #49 merged to dev",
		ownerConfirm: "list publicly",
	},
	{
		id: "web-workspace",
		title: "New desktop web workspace",
		status: "progress",
		body: "Panes that slide from accounts to folders to threads to the message, a floating ⌘K bar, and a quick-reply bar under each conversation.",
		src: "RM#1 (5)",
	},
	{
		id: "for-you",
		title: "“For you” brief",
		status: "progress",
		body: "A short summary in the iPhone app: replies you probably owe, as to-dos you can tick off, and topics like purchases, travel and security to catch up on. It’s built, and not switched on yet.",
		src: "FC#7; FSW#supporting-features (Inbox Brief: rules, not AI)",
		ownerConfirm: "tease publicly",
	},
	{
		id: "shortcuts",
		title: "Keyboard shortcuts on the web",
		status: "planned",
		body: "Single-key shortcuts like Gmail’s: c to compose, j and k to move through mail, r to reply, l for Reply Later, and ? to see them all.",
		src: "RM#1 (6); PS#5 (shortcut list)",
	},
	{
		id: "set-aside",
		title: "Set Aside",
		status: "planned",
		body: "A second pile next to Reply Later, for mail you need to keep handy, like tickets or a document you’re waiting on.",
		src: "RM#1 (4)",
	},
	{
		id: "export",
		title: "Export a mailbox from Settings",
		status: "planned",
		body: "One button to download any mailbox, a personal address included, as .mbox.",
		src: "RM#1 (7)",
	},
];

export const comingNext: ComingNext[] = allComingNext.filter((c) => !c.hidden).map(({ hidden: _, ...c }) => c);

// The landing callout under "Today and next" (tone="next", icon="private").
// null once private email is on main: the feature joins "And the rest" instead.
export const privateEmailCallout: CalloutCopy | null = flags.privateEmailShipped
	? null
	: {
			id: "private-email-callout",
			title: "Private email, for every sign-up form.",
			body: `Make a fresh address for each site you sign up to. Mail to it reaches your mailbox, though a site’s first email waits in the Screener like any new sender, and your replies go out from that address, so your real one stays yours. Pause or delete any of them, up to 1,000 per mailbox. AutoFill on iPhone${flags.androidPublic ? " and Android" : ""} and a Chrome extension follow soon after. [What’s coming next →](/roadmap#next)`,
			status: "next",
			claim: "roadmap",
			src: "RM#1 (1); FC#7 (apex aliases, From enforced, cap 1,000, iOS AutoFill, Chrome pairing); dev index.ts (no Screener bypass for alias mail); d5df670 and extension/manifest.json (AutoFill and extension not yet distributable)",
		};
